"""Pruebas funcionales de seguridad (QA): acceso sin sesión, tokens manipulados, inyección SQL,
XSS y comportamiento de sesión. Atacan la API como lo haría un cliente hostil."""

import json
import uuid

import pytest
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from usuarios.models import Rol, Usuario

pytestmark = pytest.mark.django_db

CLAVE = "Clave-segura-2026"

# Rutas que deben ser accesibles sin sesión (login, registro, recuperación, salud...).
PUBLICAS = {
    "/api/",
    "/api/health/",
    "/api/auth/",
    "/api/auth/login/",
    "/api/auth/registro/",
    "/api/auth/refresh/",
    "/api/auth/verificar-correo/",
    "/api/auth/reenviar-verificacion/",
    "/api/auth/recuperar/",
    "/api/auth/recuperar/confirmar/",
    "/api/auth/mfa/verificar/",
    "/api/auth/dispositivo/verificar/",
    # Idempotente por diseño: se puede cerrar sesión con el access vencido; solo actúa
    # si llega un refresh token válido (sin él responde 400 y no revela nada).
    "/api/auth/logout/",
}

PAYLOADS_SQL = [
    "' OR '1'='1",
    "admin'--",
    "1 OR 1=1",
    "1; DROP TABLE usuarios_usuario;--",
    "' UNION SELECT password FROM usuarios_usuario--",
    "1' AND SLEEP(5)--",
    "') OR ('1'='1",
    "1/**/OR/**/1=1",
]
PAYLOADS_XSS = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "<svg/onload=alert(1)>",
    "javascript:alert(1)",
    '" onmouseover="alert(1)',
    "<iframe src=//evil.example>",
]


def _rutas_api():
    """Todas las rutas /api/ del proyecto, con los parámetros reemplazados por valores dummy."""
    rutas = []

    def recorrer(patrones, prefijo):
        for p in patrones:
            tramo = str(p.pattern)
            if isinstance(p, URLResolver):
                recorrer(p.url_patterns, prefijo + tramo)
            elif isinstance(p, URLPattern):
                rutas.append(prefijo + tramo)

    recorrer(get_resolver().url_patterns, "/")
    resultado = []
    for ruta in rutas:
        if not ruta.startswith("/api/"):
            continue
        for conv, valor in (("int", "1"), ("str", "x"), ("slug", "x"), ("uuid", str(uuid.uuid4()))):
            while f"<{conv}:" in ruta:
                ini = ruta.index(f"<{conv}:")
                fin = ruta.index(">", ini)
                ruta = ruta[:ini] + valor + ruta[fin + 1 :]
        if "<" not in ruta:
            resultado.append(ruta)
    return sorted(set(resultado))


RUTAS = _rutas_api()


@pytest.fixture
def usuario():
    return Usuario.objects.create_user(
        "ana@colegio.edu.co", CLAVE, nombres="Ana", apellidos="Ruiz", email_verificado=True
    )


@pytest.fixture
def cliente_auth(usuario):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(usuario).access_token}")
    return c


# --- 1. Acceso sin sesión (equivale a abrir una URL directa en otro navegador/incógnito) ---


def test_se_descubren_rutas_para_probar():
    assert len(RUTAS) > 30


@pytest.mark.parametrize("ruta", [r for r in RUTAS if r not in PUBLICAS])
@pytest.mark.parametrize("metodo", ["get", "post", "patch", "put", "delete"])
def test_ruta_privada_rechaza_a_quien_no_inicio_sesion(ruta, metodo):
    r = getattr(APIClient(), metodo)(ruta, {}, format="json")
    assert r.status_code in (401, 403, 404, 405), f"{metodo.upper()} {ruta} -> {r.status_code}"
    assert r.status_code != 200


@pytest.mark.parametrize("ruta", [r for r in RUTAS if r not in PUBLICAS])
def test_ruta_privada_no_filtra_datos_sin_sesion(ruta):
    r = APIClient().get(ruta)
    cuerpo = r.content.decode()
    assert "ana@colegio.edu.co" not in cuerpo
    assert "password" not in cuerpo.lower() or r.status_code in (401, 403)


# --- 2. Tokens manipulados / falsificados ---


def test_token_basura_es_rechazado():
    c = APIClient()
    for malo in ("abc", "Bearer", "a.b.c", "", "null", "undefined"):
        c.credentials(HTTP_AUTHORIZATION=f"Bearer {malo}")
        assert c.get("/api/auth/me/").status_code == 401, malo


def test_token_con_firma_alterada_es_rechazado(usuario):
    token = str(RefreshToken.for_user(usuario).access_token)
    cabecera, carga, firma = token.split(".")
    alterado = f"{cabecera}.{carga}.{firma[:-3]}AAA"
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {alterado}")
    assert c.get("/api/auth/me/").status_code == 401


def test_token_alg_none_es_rechazado(usuario):
    import base64

    def b64(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()

    cabecera = b64({"alg": "none", "typ": "JWT"})
    carga = b64({"user_id": str(usuario.pk), "token_type": "access", "exp": 9999999999})
    falso = f"{cabecera}.{carga}."
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {falso}")
    assert c.get("/api/auth/me/").status_code == 401


def test_refresh_token_no_sirve_como_access(usuario):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(usuario)}")
    assert c.get("/api/auth/me/").status_code == 401


def test_token_expirado_es_rechazado(usuario):
    from datetime import timedelta

    t = AccessToken.for_user(usuario)
    t.set_exp(lifetime=-timedelta(minutes=1))
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {t}")
    assert c.get("/api/auth/me/").status_code == 401


def test_token_de_usuario_desactivado_deja_de_servir(usuario, cliente_auth):
    assert cliente_auth.get("/api/auth/me/").status_code == 200
    usuario.is_active = False
    usuario.save()
    assert cliente_auth.get("/api/auth/me/").status_code == 401


def test_refresh_reutilizado_tras_rotar_es_rechazado(usuario):
    r1 = str(RefreshToken.for_user(usuario))
    c = APIClient()
    assert c.post("/api/auth/refresh/", {"refresh": r1}, format="json").status_code == 200
    assert c.post("/api/auth/refresh/", {"refresh": r1}, format="json").status_code == 401


def test_logout_invalida_el_refresh(usuario):
    c = APIClient()
    sesion = c.post(
        "/api/auth/login/", {"email": usuario.email, "password": CLAVE}, format="json"
    ).json()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {sesion['access']}")
    c.post("/api/auth/logout/", {"refresh": sesion["refresh"]}, format="json")
    r = APIClient().post("/api/auth/refresh/", {"refresh": sesion["refresh"]}, format="json")
    assert r.status_code == 401


# --- 3. Inyección SQL ---


@pytest.mark.parametrize("payload", PAYLOADS_SQL)
def test_sqli_en_login_no_da_acceso(usuario, payload):
    for campos in (
        {"email": payload, "password": CLAVE},
        {"email": usuario.email, "password": payload},
    ):
        r = APIClient().post("/api/auth/login/", campos, format="json")
        assert r.status_code in (400, 401, 429)
        assert "access" not in r.json()


@pytest.mark.parametrize("payload", PAYLOADS_SQL)
def test_sqli_en_registro_se_bloquea_y_no_crea_cuentas(payload):
    r = APIClient().post(
        "/api/auth/registro/",
        {
            "email": "x@colegio.edu.co",
            "nombres": payload,
            "apellidos": "Ruiz",
            "password": CLAVE,
            "password_confirmacion": CLAVE,
        },
        format="json",
    )
    assert r.status_code == 400
    assert not Usuario.objects.filter(email="x@colegio.edu.co").exists()


@pytest.mark.parametrize("payload", PAYLOADS_SQL)
def test_sqli_en_query_string_de_todas_las_rutas_nunca_causa_500(cliente_auth, payload):
    for ruta in RUTAS:
        for param in ("q", "search", "buscar", "ordering", "id", "estado"):
            r = cliente_auth.get(ruta, {param: payload})
            assert r.status_code < 500, f"{ruta}?{param}={payload} -> {r.status_code}"


def test_sqli_en_parametro_de_ruta_no_resuelve_ni_rompe(cliente_auth):
    for payload in ("1 OR 1=1", "1;DROP TABLE x", "' OR '1'='1"):
        r = cliente_auth.get(f"/api/usuarios/{payload}/")
        assert r.status_code in (400, 404)


def test_la_tabla_de_usuarios_sobrevive_a_los_ataques(usuario):
    for payload in PAYLOADS_SQL:
        APIClient().post("/api/auth/login/", {"email": payload, "password": "x"}, format="json")
    assert Usuario.objects.filter(email=usuario.email).exists()


def test_la_busqueda_legitima_con_apostrofe_no_se_rompe(usuario):
    r = APIClient().post(
        "/api/auth/login/", {"email": "o'brien@colegio.edu.co", "password": CLAVE}, format="json"
    )
    assert r.status_code in (400, 401)  # credenciales inválidas, no un 500


# --- 4. XSS ---


@pytest.mark.parametrize("payload", PAYLOADS_XSS)
def test_xss_en_registro_se_bloquea(payload):
    for campo in ("nombres", "apellidos"):
        datos = {
            "email": "x@colegio.edu.co",
            "nombres": "Ana",
            "apellidos": "Ruiz",
            "password": CLAVE,
            "password_confirmacion": CLAVE,
            campo: payload,
        }
        r = APIClient().post("/api/auth/registro/", datos, format="json")
        assert r.status_code == 400, f"{campo}: {payload}"
    assert not Usuario.objects.filter(email="x@colegio.edu.co").exists()


# Con sesión se rechaza HTML/JS activo; el texto inerte sin etiquetas (p. ej. un atributo suelto)
# no se rechaza porque no puede ejecutarse: la salida va escapada y el cliente no interpreta HTML.
@pytest.mark.parametrize("payload", [p for p in PAYLOADS_XSS if "<" in p or "javascript:" in p])
def test_xss_al_editar_perfil_no_se_guarda(usuario, cliente_auth, payload):
    r = cliente_auth.patch("/api/auth/me/", {"nombres": payload}, format="json")
    assert r.status_code in (400, 404, 405)
    usuario.refresh_from_db()
    assert "<" not in usuario.nombres and "javascript:" not in usuario.nombres


def test_nombres_legitimos_con_acentos_y_apostrofe_se_aceptan():
    r = APIClient().post(
        "/api/auth/registro/",
        {
            "email": "maria@colegio.edu.co",
            "nombres": "María José",
            "apellidos": "O'Brien-Pérez",
            "password": CLAVE,
            "password_confirmacion": CLAVE,
        },
        format="json",
    )
    assert r.status_code == 201


def test_las_respuestas_json_escapan_html(usuario, cliente_auth):
    usuario.nombres = "<b>Ana</b>"  # dato "sucio" escrito directo en BD
    usuario.save()
    r = cliente_auth.get("/api/auth/me/")
    assert b"<b>" not in r.content
    assert r["Content-Type"].startswith("application/json")


def test_pagina_inexistente_no_refleja_la_entrada(client):
    r = client.get("/api/ruta-inexistente/<script>alert(1)</script>/")
    assert b"<script>" not in r.content


# --- 5. Sesión, caché y cabeceras (el equivalente seguro al "modo incógnito") ---


def test_la_api_no_deja_cookies_de_sesion(usuario):
    r = APIClient().post(
        "/api/auth/login/", {"email": usuario.email, "password": CLAVE}, format="json"
    )
    assert r.status_code == 200
    assert not r.cookies, "el login no debe fijar cookies: la sesión vive solo en el cliente"


def test_las_respuestas_con_datos_no_se_pueden_cachear(cliente_auth):
    r = cliente_auth.get("/api/auth/me/")
    assert "no-store" in r["Cache-Control"]
    assert r["Pragma"] == "no-cache"


def test_sin_sesion_no_se_obtiene_nada_aunque_se_repita_la_url_en_otra_ventana(
    usuario, cliente_auth
):
    """Un token guardado en una ventana no sirve a otra ventana sin ese token."""
    assert cliente_auth.get("/api/auth/me/").status_code == 200
    otra_ventana = APIClient()
    assert otra_ventana.get("/api/auth/me/").status_code == 401


def test_cabeceras_anti_clickjacking_y_sniffing(client):
    r = client.get("/api/health/")
    assert r["X-Frame-Options"] == "DENY"
    assert r["X-Content-Type-Options"] == "nosniff"
    assert "frame-ancestors 'none'" in r["Content-Security-Policy"]


# --- 6. Autorización: no escalar privilegios ---


def test_un_estudiante_no_puede_asignarse_un_rol(usuario, cliente_auth):
    assert usuario.rol == Rol.ESTUDIANTE
    for ruta in ("/api/auth/me/", "/api/perfil/"):
        cliente_auth.patch(
            ruta, {"rol": "administrador", "is_staff": True, "is_superuser": True}, format="json"
        )
    usuario.refresh_from_db()
    assert usuario.rol == Rol.ESTUDIANTE
    assert not usuario.is_staff and not usuario.is_superuser


def test_un_estudiante_no_accede_al_admin_de_django(cliente_auth, client):
    r = client.get("/admin/", follow=False)
    assert r.status_code in (301, 302)
    assert "/login" in r["Location"]


# --- 7. Fuerza bruta ---


def test_bloqueo_de_cuenta_tras_intentos_fallidos(usuario):
    for _ in range(5):
        APIClient().post(
            "/api/auth/login/", {"email": usuario.email, "password": "mala"}, format="json"
        )
    r = APIClient().post(
        "/api/auth/login/", {"email": usuario.email, "password": CLAVE}, format="json"
    )
    assert r.status_code == 429
    assert "access" not in r.json()


def test_cuerpos_gigantes_se_rechazan(client):
    grande = json.dumps({"email": "a" * (2 * 1024 * 1024)})
    r = client.post("/api/auth/login/", data=grande, content_type="application/json")
    assert r.status_code in (400, 413)


# --- 8. La protección frena a anónimos, no a usuarios registrados ---

TEXTOS_LEGITIMOS = [
    "Tarea: cálculo 3 > 2 and 5 = 5",
    "Pregunta 1 OR 2 = ?",
    "Hola 'amigo' or 'amiga' = bienvenido",
    "Reforzar fracciones; update the plan; delete from the list the old items",
    "Repasar: select la opción correcta from the list where aplica",
    "O'Brien dijo: 'sleep (dormir)' en inglés",
]


def test_el_filtro_estricto_sigue_frenando_a_anonimos():
    for texto in TEXTOS_LEGITIMOS[:3]:
        r = APIClient().post("/api/auth/login/", {"email": texto, "password": "x"}, format="json")
        assert r.status_code == 400 and r.json()["error"]["code"] == "peticion_bloqueada"


@pytest.mark.parametrize("texto", TEXTOS_LEGITIMOS)
def test_un_usuario_registrado_puede_escribir_texto_normal(cliente_auth, texto):
    """Con sesión válida, el filtro no rechaza texto legítimo (el ORM ya parametriza el SQL)."""
    r = cliente_auth.patch("/api/auth/me/", {"observaciones": texto}, format="json")
    assert r.status_code != 400 or r.json()["error"]["code"] != "peticion_bloqueada"
    r = cliente_auth.get("/api/auth/me/", {"q": texto})
    assert r.status_code != 400 or r.json()["error"]["code"] != "peticion_bloqueada"


@pytest.mark.parametrize("payload", PAYLOADS_XSS[:3] + ["<body onload=alert(1)>"])
def test_un_usuario_registrado_tampoco_puede_enviar_html_activo(cliente_auth, payload):
    r = cliente_auth.patch("/api/auth/me/", {"observaciones": payload}, format="json")
    assert r.status_code == 400 and r.json()["error"]["code"] == "peticion_bloqueada"


def test_un_token_falso_no_activa_el_modo_de_usuario_registrado():
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION="Bearer falso.falso.falso")
    r = c.get("/api/health/", {"q": "' OR '1'='1"})
    assert r.status_code == 400


def test_login_no_bloquea_a_otros_usuarios_que_comparten_la_ip(usuario):
    """Varios usuarios tras la misma IP (un colegio) no se frenan entre sí."""
    for i in range(12):
        r = APIClient().post(
            "/api/auth/login/",
            {"email": f"alumno{i}@colegio.edu.co", "password": "x"},
            format="json",
        )
        assert r.status_code == 401, i
    r = APIClient().post(
        "/api/auth/login/", {"email": usuario.email, "password": CLAVE}, format="json"
    )
    assert r.status_code == 200
