"""Defensas del backend contra XSS, inyección y phishing.

Capas (de afuera hacia adentro):
1. `FiltroPeticionesMiddleware`: rechaza con 400 las peticiones a /api/ cuyos textos traen
   marcado HTML activo (XSS) o patrones típicos de inyección SQL. Es una red de seguridad: la
   defensa real contra SQL es el ORM (consultas parametrizadas) y contra XSS la salida escapada.
2. `CabecerasSeguridadMiddleware`: CSP estricta, Permissions-Policy, no-store, etc.
3. `JSONRendererSeguro` (en renderers.py): escapa < > & en las respuestas JSON.
4. `validar_enlaces_correo`: los enlaces de los correos (recuperación y verificación) solo
   pueden apuntar a hosts de confianza, para que nadie pueda fabricar enlaces de phishing.
"""

import json
import re
from urllib.parse import unquote, urlsplit

from django.conf import settings
from django.http import JsonResponse

# --- Detección de payloads -----------------------------------------------------------------

_PATRONES_XSS = [
    re.compile(r"<\s*/?\s*(script|iframe|object|embed|svg|math|link|meta|style|base|form)\b", re.I),
    re.compile(r"<\s*[a-z][^>]*\bon[a-z]+\s*=", re.I),  # <img onerror=...>
    re.compile(
        r"['\"]\s*(on[a-z]+|autofocus|style)\s*=", re.I
    ),  # ' onmouseover=... (rompe atributo)
    re.compile(r"(javascript|vbscript)\s*:", re.I),
    re.compile(r"data\s*:\s*text/html", re.I),
    re.compile(
        r"on(error|load|focus|blur|click|dblclick|mouse\w+|key\w+|toggle|start|submit|change|"
        r"input|pointer\w+|animation\w+)\s*=",
        re.I,
    ),  # manejadores de eventos tras romper un atributo
    re.compile(
        r"\bon(error|load|focus|blur|click|dblclick|mouse\w+|key\w+|toggle|start|submit|change|"
        r"input|pointer\w+|animation\w+)\s*=",
        re.I,
    ),  # manejadores de eventos tras romper un atributo
    re.compile(r"expression\s*\(", re.I),  # CSS expression() de navegadores antiguos
    re.compile(r"(%3c|&lt;?|&#x?0*3c;?)\s*/?\s*(script|iframe|svg|img)", re.I),  # codificados
    re.compile(r"&#x?0*[0-9a-f]+;?.*(script|alert)", re.I),  # entidades que ocultan <script>
]

_PATRONES_SQL = [
    re.compile(r"\bunion\b[\s/*()]+(all\b[\s/*()]+)?select\b", re.I),
    # Tautologías: ' OR 1=1 · 1 OR 1=1 · ') OR ('1'='1 · " OR ""="
    re.compile(r"['\"]\s*\)?\s*(or|and)\s*\(?\s*['\"]?\w*['\"]?\s*(=|like)\s*['\"]?\w*", re.I),
    re.compile(r"\b(or|and)\s+\(?\s*['\"]?(\d+|true|false|null)['\"]?\s*(=|<|>|like|is)", re.I),
    re.compile(r"\b(or|and)\s+(true|false)\b\s*(--|#|/\*|;|$)", re.I),
    # Consultas apiladas: solo sentencias con estructura SQL real (evita "; insert comments")
    re.compile(
        r";\s*(drop\s+(table|database|schema|user)|truncate\s+\w|delete\s+from|insert\s+into|"
        r"update\s+\w+\s+set|alter\s+(table|user|role)|create\s+(table|user|role|function)|"
        r"select\s+.+\bfrom\b|select\s+(pg_|version|current_|\*)|exec(ute)?\b|shutdown\b|"
        r"copy\s+\w+)",
        re.I,
    ),
    re.compile(
        r"\bselect\b[^;]{0,200}\bfrom\b[^;]{0,100}\b(where|limit|union|information_schema)\b", re.I
    ),
    re.compile(r"\b(sleep|pg_sleep|benchmark|waitfor\s+delay)\s*\(", re.I),
    re.compile(
        r"\b(pg_read_file|pg_ls_dir|lo_import|xp_cmdshell|load_file|into\s+outfile)\b", re.I
    ),
    re.compile(r"\bcopy\b[^;]{0,80}\b(to|from)\s+program\b", re.I),
    re.compile(r"\b(information_schema|pg_catalog|pg_tables|pg_shadow|sqlite_master)\b", re.I),
    re.compile(r"\border\s+by\s+\d+\s*(--|#|/\*)", re.I),
    re.compile(r"\bhaving\s+\d+\s*=\s*\d+", re.I),
    re.compile(r"['\"]\s*(--|#|/\*)"),  # comillas + comentario para truncar la consulta
    re.compile(r"['\"]\s*;\s*--"),
    re.compile(r"\w/\*.*?\*/\w", re.S),  # ofuscación con comentarios: OR/**/1=1
]

# Campos con secretos: pueden llevar cualquier carácter y nunca se interpretan como texto.
_CAMPOS_EXENTOS = {
    "password",
    "password_confirmacion",
    "token",
    "refresh",
    "access",
    "uid",
    "mfa_token",
    "dispositivo",
    "desafio_token",
}

_MAX_PROFUNDIDAD = 8
_MAX_CUERPO_ESCANEO = 256 * 1024  # bytes


# Usuarios con sesión válida: solo HTML/JS activo. El texto normal (observaciones, descripciones,
# "Pregunta 1 OR 2 = ?") jamás debe rechazarse; la inyección SQL no es posible porque el ORM
# parametriza todas las consultas, y la salida se escapa.
_PATRONES_ACTIVOS = [_PATRONES_XSS[0], _PATRONES_XSS[1], _PATRONES_XSS[3], _PATRONES_XSS[4]]


def _es_malicioso(texto, estricto=True):
    # También se revisa la versión decodificada (%27%20OR... / %3Cscript%3E) para frenar la
    # doble codificación que algunos atacantes usan para saltar filtros.
    variantes = {texto, unquote(texto)}
    patrones = (*_PATRONES_XSS, *_PATRONES_SQL) if estricto else _PATRONES_ACTIVOS
    return any(p.search(v) for v in variantes for p in patrones)


def _contiene_payload(valor, clave=None, nivel=0, estricto=True):
    if nivel > _MAX_PROFUNDIDAD:
        return True  # estructuras absurdamente anidadas: se descartan
    if clave in _CAMPOS_EXENTOS:
        return False
    if isinstance(valor, str):
        return "\x00" in valor or _es_malicioso(valor, estricto)
    if isinstance(valor, dict):
        return any(
            _contiene_payload(k, None, nivel + 1, estricto)
            or _contiene_payload(v, k, nivel + 1, estricto)
            for k, v in valor.items()
        )
    if isinstance(valor, list):
        return any(_contiene_payload(v, clave, nivel + 1, estricto) for v in valor)
    return False


def _rechazo(codigo="peticion_bloqueada"):
    return JsonResponse(
        {"error": {"code": codigo, "message": "La petición contiene contenido no permitido."}},
        status=400,
    )


class FiltroPeticionesMiddleware:
    """Bloquea payloads de XSS e inyección SQL en query string, ruta y cuerpo JSON/formulario."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith("/api/") and self._bloquear(request):
            return _rechazo()
        return self.get_response(request)

    @staticmethod
    def _con_sesion_valida(request):
        """True si trae un access token firmado y vigente (no consulta la base de datos)."""
        cabecera = request.META.get("HTTP_AUTHORIZATION", "")
        if not cabecera.startswith("Bearer "):
            return False
        try:
            from rest_framework_simplejwt.tokens import AccessToken

            AccessToken(cabecera[7:].strip())
            return True
        except Exception:
            return False

    def _bloquear(self, request):
        # Quien no ha iniciado sesión recibe el filtro completo; un usuario registrado, solo el
        # filtro de HTML activo, para no rechazar nunca su texto legítimo.
        estricto = not self._con_sesion_valida(request)
        if _es_malicioso(request.path) or "\x00" in request.path:
            return True
        for clave, valores in request.GET.lists():
            if _contiene_payload(clave, None, 0, estricto) or any(
                _contiene_payload(v, clave, 0, estricto) for v in valores
            ):
                return True
        if request.method not in ("POST", "PUT", "PATCH"):
            return False

        tipo = request.content_type or ""
        if tipo == "application/json":
            cuerpo = request.body[:_MAX_CUERPO_ESCANEO]
            try:
                datos = json.loads(cuerpo or b"null")
            except (ValueError, UnicodeDecodeError):
                return False  # JSON roto: lo rechaza la validación normal de DRF
            return _contiene_payload(datos, None, 0, estricto)
        if tipo in ("application/x-www-form-urlencoded", "multipart/form-data"):
            return any(
                _contiene_payload(v, k, 0, estricto) for k, vs in request.POST.lists() for v in vs
            )
        return False


# --- Cabeceras -----------------------------------------------------------------------------

# La API solo devuelve JSON: ningún recurso externo ni incrustación tiene sentido.
_CSP_API = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
_PERMISSIONS_POLICY = (
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), "
    "accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()"
)


class CabecerasSeguridadMiddleware:
    """Añade cabeceras de endurecimiento. El admin conserva una CSP más permisiva (necesita
    sus propios estilos y scripts, servidos desde el mismo origen)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        respuesta = self.get_response(request)
        if request.path.startswith("/api/"):
            respuesta.setdefault("Content-Security-Policy", _CSP_API)
            # Respuestas con datos personales: que ninguna caché compartida las guarde.
            respuesta.setdefault("Cache-Control", "no-store, max-age=0")
            respuesta.setdefault("Pragma", "no-cache")
        else:
            respuesta.setdefault(
                "Content-Security-Policy",
                "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
                "script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; "
                "form-action 'self'",
            )
        respuesta.setdefault("Permissions-Policy", _PERMISSIONS_POLICY)
        respuesta.setdefault("Cross-Origin-Resource-Policy", "same-site")
        respuesta.setdefault("X-Permitted-Cross-Domain-Policies", "none")
        return respuesta


# --- Anti-phishing: enlaces de correo ------------------------------------------------------


def _host(url):
    return (urlsplit(url).hostname or "").lower()


def validar_enlaces_correo(urls, hosts_confiables, *, exigir_https):
    """Devuelve la lista de problemas de los enlaces de correo (vacía si todo está bien).

    Un enlace de recuperación que apunte a un dominio ajeno permitiría robar cuentas: el
    usuario recibiría un correo legítimo que lo lleva a un sitio falso.
    """
    problemas = []
    confiables = {h.lower() for h in hosts_confiables if h}
    for nombre, url in urls.items():
        partes = urlsplit(url)
        if partes.scheme not in ("http", "https") or not partes.hostname:
            problemas.append(f"{nombre}: no es una URL http(s) válida ({url!r}).")
            continue
        if partes.username or partes.password:
            problemas.append(f"{nombre}: no puede incluir credenciales en la URL.")
        if exigir_https and partes.scheme != "https":
            problemas.append(f"{nombre}: debe usar https en producción.")
        if confiables and _host(url) not in confiables:
            problemas.append(
                f"{nombre}: el host {_host(url)!r} no está en HOSTS_ENLACES_CONFIABLES."
            )
    return problemas


def enlace_confiable(url):
    """True si `url` puede ir en un correo. Se usa justo antes de enviarlo."""
    hosts = getattr(settings, "HOSTS_ENLACES_CONFIABLES", [])
    return not validar_enlaces_correo(
        {"enlace": url}, hosts, exigir_https=getattr(settings, "ENLACES_EXIGIR_HTTPS", False)
    )
