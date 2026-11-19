"""Dispositivos registrados: acceso para usuarios legítimos, barrera para quien solo tiene la clave.

Idea: el cliente genera un identificador aleatorio y lo guarda en su almacenamiento. El servidor
solo conserva su huella SHA-256. Al iniciar sesión:

- Dispositivo conocido → entra normal (con MFA si la cuenta lo tiene).
- Dispositivo nuevo → NO se bloquea al usuario: debe demostrar que es el dueño de la cuenta con
  su código MFA (si lo tiene) o con un código de 6 dígitos enviado a su correo. Al verificarlo,
  el dispositivo queda registrado y se le avisa por correo.

Quien robe la contraseña no recibe tokens: le falta el correo o el teléfono del usuario. Y las
sesiones quedan atadas al dispositivo (claim `did`): al revocarlo, access y refresh mueren.
Se activa con DISPOSITIVOS_VERIFICACION (por defecto activa en producción).
"""

import hashlib
import re
import secrets
from datetime import timedelta

from django.conf import settings
from django.core import signing
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac
from rest_framework import status
from rest_framework.exceptions import APIException

from .auditoria import registrar_evento
from .correo import enviar_correo
from .models import DesafioDispositivo, Dispositivo

_SAL = "usuarios.dispositivo.desafio"
_FORMATO_ID = re.compile(r"^[A-Za-z0-9_-]{16,128}$")

_NAVEGADORES = (
    ("Edge", "Edg/"),
    ("Chrome", "Chrome/"),
    ("Firefox", "Firefox/"),
    ("Safari", "Safari/"),
    ("App móvil", "okhttp"),
    ("App móvil", "Expo"),
)
_SISTEMAS = (
    ("Windows", "Windows"),
    ("Android", "Android"),
    ("iPhone", "iPhone"),
    ("Mac", "Mac OS"),
    ("Linux", "Linux"),
)


class DispositivoRequerido(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "Falta el identificador del dispositivo."
    default_code = "dispositivo_requerido"


class DesafioDispositivoInvalido(APIException):
    status_code = status.HTTP_401_UNAUTHORIZED
    default_detail = "El código no es válido o ya venció. Vuelve a iniciar sesión."
    default_code = "codigo_dispositivo_invalido"


class CorreoNoDisponible(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = (
        "No pudimos enviar el código a tu correo en este momento. Inténtalo de nuevo en unos "
        "minutos o usa un dispositivo que ya hayas verificado."
    )
    default_code = "correo_no_disponible"


def activo():
    return getattr(settings, "DISPOSITIVOS_VERIFICACION", False)


def huella_de(identificador):
    """SHA-256 del identificador del cliente; None si no tiene el formato esperado."""
    if not identificador or not _FORMATO_ID.match(identificador):
        return None
    return hashlib.sha256(identificador.encode()).hexdigest()


def nombre_legible(user_agent):
    """Etiqueta corta («Chrome en Windows») para que el usuario reconozca el dispositivo."""
    ua = user_agent or ""
    navegador = next((n for n, k in _NAVEGADORES if k in ua), "Navegador")
    sistema = next((n for n, k in _SISTEMAS if k in ua), "dispositivo desconocido")
    return f"{navegador} en {sistema}"[:120]


def _ip(request):
    return request.META.get("REMOTE_ADDR") or None


def buscar_confiable(usuario, huella):
    return Dispositivo.objects.filter(
        usuario=usuario, huella=huella, revocado_en__isnull=True
    ).first()


def dispositivo_activo(usuario_id, huella):
    return Dispositivo.objects.filter(
        usuario_id=usuario_id, huella=huella, revocado_en__isnull=True
    ).exists()


def registrar(usuario, huella, request):
    """Registra (o reactiva) el dispositivo. Avisa por correo si es nuevo."""
    ahora = timezone.now()
    nombre = nombre_legible(request.META.get("HTTP_USER_AGENT", ""))
    with transaction.atomic():
        disp, creado = Dispositivo.objects.get_or_create(
            usuario=usuario,
            huella=huella,
            defaults={"nombre": nombre, "ip": _ip(request), "ultimo_uso": ahora},
        )
        reactivado = not creado and disp.revocado_en is not None
        if not creado:
            disp.nombre, disp.ip = nombre, _ip(request)
            disp.ultimo_uso, disp.revocado_en = ahora, None
            disp.save()
        if creado or reactivado:
            # Tope de dispositivos: se retira el menos usado para que el usuario no quede fuera.
            vigentes = Dispositivo.objects.filter(usuario=usuario, revocado_en__isnull=True)
            sobrantes = vigentes.exclude(pk=disp.pk).order_by("-ultimo_uso")[
                max(settings.DISPOSITIVOS_MAX - 1, 0) :
            ]
            Dispositivo.objects.filter(pk__in=[d.pk for d in sobrantes]).update(revocado_en=ahora)
            registrar_evento(
                usuario, "dispositivo_registrado", "dispositivo", disp.pk, {"nombre": nombre}
            )
    if creado or reactivado:
        try:
            enviar_correo(
                "Nuevo dispositivo en tu cuenta - Acompañamiento Académico",
                "dispositivo_nuevo",
                {"nombres": usuario.nombres, "dispositivo": nombre, "correo": usuario.email},
                usuario.email,
            )
        except Exception:  # el aviso nunca debe impedir entrar a un usuario legítimo
            pass
    return disp


def tocar(disp, request):
    disp.ultimo_uso = timezone.now()
    disp.ip = _ip(request)
    disp.save(update_fields=["ultimo_uso", "ip"])


def revocar(usuario, pk):
    n = Dispositivo.objects.filter(pk=pk, usuario=usuario, revocado_en__isnull=True).update(
        revocado_en=timezone.now()
    )
    if n:
        registrar_evento(usuario, "dispositivo_revocado", "dispositivo", pk)
    return bool(n)


# --- Verificación de dispositivo nuevo por correo (cuentas sin MFA) ------------------------


def _hash_codigo(codigo, desafio_id):
    return salted_hmac(_SAL, f"{desafio_id}:{codigo}", algorithm="sha256").hexdigest()


def iniciar_desafio(usuario, huella):
    """Crea y envía un código de 6 dígitos. Devuelve el token firmado que lo identifica."""
    codigo = f"{secrets.randbelow(1_000_000):06d}"
    minutos = settings.DISPOSITIVO_CODIGO_MINUTOS
    with transaction.atomic():
        # Un solo código vigente por usuario: pedir otro invalida el anterior.
        DesafioDispositivo.objects.filter(usuario=usuario, usado=False).update(usado=True)
        d = DesafioDispositivo.objects.create(
            usuario=usuario,
            huella=huella,
            codigo_hash="",
            expira=timezone.now() + timedelta(minutes=minutos),
        )
        d.codigo_hash = _hash_codigo(codigo, d.pk)
        d.save(update_fields=["codigo_hash"])
    try:
        enviar_correo(
            "Código para verificar tu dispositivo - Acompañamiento Académico",
            "codigo_dispositivo",
            {
                "nombres": usuario.nombres,
                "codigo": codigo,
                "minutos": minutos,
                "correo": usuario.email,
            },
            usuario.email,
        )
    except Exception:
        DesafioDispositivo.objects.filter(pk=d.pk).update(usado=True)
        raise CorreoNoDisponible() from None
    return signing.dumps({"d": d.pk}, salt=_SAL)


def verificar_desafio(token, codigo):
    """Devuelve (usuario, huella) si el código es correcto; consume el desafío."""
    try:
        pk = signing.loads(token, salt=_SAL, max_age=settings.DISPOSITIVO_CODIGO_MINUTOS * 60)["d"]
    except (signing.BadSignature, KeyError, TypeError):
        raise DesafioDispositivoInvalido() from None
    with transaction.atomic():
        d = (
            DesafioDispositivo.objects.select_for_update()
            .select_related("usuario")
            .filter(pk=pk, usado=False)
            .first()
        )
        if d is None or d.expira < timezone.now() or not d.usuario.is_active:
            raise DesafioDispositivoInvalido()
        correcto = constant_time_compare(_hash_codigo((codigo or "").strip(), d.pk), d.codigo_hash)
        if correcto:
            d.usado = True
        else:
            d.intentos += 1
            if d.intentos >= settings.DISPOSITIVO_CODIGO_INTENTOS:
                d.usado = True
        d.save(update_fields=["intentos", "usado"])
    if not correcto:
        raise DesafioDispositivoInvalido()
    return d.usuario, d.huella


def correo_parcial(email):
    usuario, _, dominio = email.partition("@")
    return f"{usuario[:1]}***@{dominio}"
