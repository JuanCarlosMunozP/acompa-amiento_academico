"""Autenticación multifactor (segundo factor TOTP, alta mediante código QR).

Por qué existe: una contraseña sola se puede adivinar, filtrar o robar (phishing, reutilización
en otros sitios). Con MFA, quien tenga la contraseña también necesita el teléfono del usuario,
que genera un código de 6 dígitos cada 30 s (RFC 6238). Protege los datos académicos de los
estudiantes, y sobre todo las cuentas con más poder (administración y coordinación).

Flujo de inicio de sesión (usuario con MFA activo):
1. `POST /auth/login/` con contraseña correcta → NO se emiten tokens JWT; se devuelve
   `mfa_requerido` y un `mfa_token` firmado que vence en pocos minutos.
2. `POST /auth/mfa/verificar/` con ese `mfa_token` y el código → recién ahí se emite la sesión.

Defensas:
- El secreto TOTP se guarda cifrado (Fernet); un volcado de la base no sirve para generar códigos.
- Cada código sirve una sola vez (`mfa_ultimo_paso`), aunque siga dentro de su ventana de 30 s.
- Los códigos erróneos suman al mismo conteo de intentos fallidos que la contraseña: con 6
  dígitos y sin este límite se podrían adivinar por fuerza bruta.
- Códigos de recuperación de un solo uso (solo se guarda su huella) para perder el teléfono sin
  quedar fuera de la cuenta.
- Desactivar el MFA o regenerar los códigos exige contraseña y un código vigente, para que una
  sesión robada no pueda quitar la protección.
"""

import base64
import hashlib
import hmac
import io
import secrets
import time

import pyotp
import qrcode
from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.contrib.auth.hashers import check_password
from django.core import signing
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac
from qrcode.image.pure import PyPNGImage

from .auditoria import registrar_evento
from .excepciones import (
    CodigoMfaIncorrecto,
    CodigoMfaInvalido,
    ContrasenaIncorrecta,
    CuentaBloqueada,
    CuentaDesactivada,
    MfaNoActivo,
    MfaNoIniciado,
    MfaTokenInvalido,
    MfaYaActivo,
)
from .models import CodigoRecuperacionMFA, Usuario

PASO_SEGUNDOS = 30
CANTIDAD_CODIGOS_RECUPERACION = 8
_ALFABETO_RECUPERACION = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sin 0/O/1/I para evitar confusiones
_SAL_DESAFIO = "usuarios.mfa.desafio"


def _ahora():
    """Reloj del servidor (aislado en una función para poder fijarlo en las pruebas)."""
    return time.time()


# --- Cifrado del secreto -------------------------------------------------------------------


def _fernet():
    material = settings.MFA_CLAVE_CIFRADO or settings.SECRET_KEY
    clave = base64.urlsafe_b64encode(hashlib.sha256(material.encode()).digest())
    return Fernet(clave)


def _cifrar(secreto):
    return _fernet().encrypt(secreto.encode()).decode()


def _descifrar(cifrado):
    try:
        return _fernet().decrypt(cifrado.encode()).decode()
    except InvalidToken:  # clave rotada o dato corrupto: se trata como configuración perdida
        return None


# --- Códigos -------------------------------------------------------------------------------


def _normalizar(codigo):
    return "".join(str(codigo).split()).replace("-", "").upper()


def _es_codigo_totp(codigo):
    return len(codigo) == 6 and codigo.isdigit()


def _huella(codigo):
    return salted_hmac("usuarios.mfa.recuperacion", codigo, algorithm="sha256").hexdigest()


def _paso_totp_valido(usuario, codigo):
    """Devuelve el paso de 30 s al que corresponde `codigo`, o None si no es aceptable."""
    secreto = _descifrar(usuario.mfa_secreto) if usuario.mfa_secreto else None
    if not secreto:
        return None
    totp = pyotp.TOTP(secreto, interval=PASO_SEGUNDOS)
    actual = int(_ahora()) // PASO_SEGUNDOS
    ventana = settings.MFA_VENTANA_PASOS
    encontrado = None
    # Se recorre toda la ventana sin cortar, para no filtrar por tiempo cuál paso coincidió.
    for paso in range(actual - ventana, actual + ventana + 1):
        if hmac.compare_digest(totp.at(paso * PASO_SEGUNDOS), codigo) and (
            paso > usuario.mfa_ultimo_paso
        ):
            encontrado = paso
    return encontrado


def _consumir_codigo_recuperacion(usuario, codigo):
    huella = _huella(codigo)
    registro = (
        CodigoRecuperacionMFA.objects.select_for_update()
        .filter(usuario=usuario, huella=huella, usado_en__isnull=True)
        .first()
    )
    if registro is None:
        return False
    registro.usado_en = timezone.now()
    registro.save(update_fields=["usado_en"])
    return True


def _aceptar_codigo(usuario, codigo, *, permitir_recuperacion=True):
    """Valida un código TOTP o de recuperación y lo consume. Va dentro de una transacción."""
    codigo = _normalizar(codigo)
    if _es_codigo_totp(codigo):
        paso = _paso_totp_valido(usuario, codigo)
        if paso is None:
            return False
        usuario.mfa_ultimo_paso = paso
        usuario.save(update_fields=["mfa_ultimo_paso"])
        return True
    if permitir_recuperacion and codigo:
        if _consumir_codigo_recuperacion(usuario, codigo):
            registrar_evento(usuario, "mfa_codigo_recuperacion_usado", "usuario", usuario.pk)
            return True
    return False


def _generar_codigos_recuperacion(usuario):
    """Reemplaza los códigos del usuario y devuelve los nuevos en claro (única vez)."""
    CodigoRecuperacionMFA.objects.filter(usuario=usuario).delete()
    codigos = []
    for _ in range(CANTIDAD_CODIGOS_RECUPERACION):
        crudo = "".join(secrets.choice(_ALFABETO_RECUPERACION) for _ in range(10))
        CodigoRecuperacionMFA.objects.create(usuario=usuario, huella=_huella(crudo))
        codigos.append(f"{crudo[:5]}-{crudo[5:]}")
    return codigos


# --- Alta por QR ---------------------------------------------------------------------------


def _qr_png_data_uri(contenido):
    """QR como imagen PNG embebida (data URI): se muestra igual en web y en móvil, sin
    depender de librerías nativas en el cliente."""
    imagen = qrcode.make(contenido, image_factory=PyPNGImage, box_size=8, border=2)
    buffer = io.BytesIO()
    imagen.save(buffer)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


def iniciar_configuracion(usuario):
    """Genera un secreto nuevo (pendiente de confirmar) y devuelve lo necesario para el QR."""
    if usuario.mfa_activo:
        raise MfaYaActivo()
    secreto = pyotp.random_base32()
    usuario.mfa_secreto = _cifrar(secreto)
    usuario.mfa_ultimo_paso = 0
    usuario.save(update_fields=["mfa_secreto", "mfa_ultimo_paso"])
    uri = pyotp.TOTP(secreto, interval=PASO_SEGUNDOS).provisioning_uri(
        name=usuario.email, issuer_name=settings.MFA_EMISOR
    )
    return {"secreto": secreto, "otpauth_uri": uri, "qr": _qr_png_data_uri(uri)}


def activar(usuario, codigo):
    """Confirma el alta con un código generado por la app. Devuelve los códigos de recuperación."""
    with transaction.atomic():
        usuario = Usuario.objects.select_for_update().get(pk=usuario.pk)
        if usuario.mfa_activo:
            raise MfaYaActivo()
        if not usuario.mfa_secreto:
            raise MfaNoIniciado()
        if not _aceptar_codigo(usuario, codigo, permitir_recuperacion=False):
            raise CodigoMfaIncorrecto()
        usuario.mfa_activo = True
        usuario.save(update_fields=["mfa_activo"])
        codigos = _generar_codigos_recuperacion(usuario)
        registrar_evento(usuario, "mfa_activado", "usuario", usuario.pk)
    return codigos


# --- Reautenticación para operaciones sensibles --------------------------------------------


def _exigir_reautenticacion(usuario, password, codigo):
    """Contraseña + código vigente. Los fallos cuentan para el bloqueo de la cuenta."""
    error = None
    with transaction.atomic():
        usuario = Usuario.objects.select_for_update().get(pk=usuario.pk)
        if not usuario.mfa_activo:
            raise MfaNoActivo()
        if usuario.esta_bloqueado():
            error = CuentaBloqueada(
                f"Demasiados intentos fallidos. Inténtalo de nuevo en "
                f"{usuario.minutos_de_bloqueo_restantes()} min."
            )
        elif not check_password(password, usuario.password):
            usuario.registrar_fallo()
            error = ContrasenaIncorrecta()
        elif not _aceptar_codigo(usuario, codigo):
            usuario.registrar_fallo()
            error = CodigoMfaIncorrecto()
        else:
            usuario.registrar_exito()
    if error is not None:
        raise error
    return usuario


def desactivar(usuario, password, codigo):
    # La reautenticación va fuera de la transacción de cambios: si falla, el conteo de
    # intentos fallidos que registra no debe revertirse.
    usuario = _exigir_reautenticacion(usuario, password, codigo)
    with transaction.atomic():
        usuario.mfa_activo = False
        usuario.mfa_secreto = ""
        usuario.mfa_ultimo_paso = 0
        usuario.save(update_fields=["mfa_activo", "mfa_secreto", "mfa_ultimo_paso"])
        CodigoRecuperacionMFA.objects.filter(usuario=usuario).delete()
        registrar_evento(usuario, "mfa_desactivado", "usuario", usuario.pk)


def regenerar_codigos_recuperacion(usuario, password, codigo):
    usuario = _exigir_reautenticacion(usuario, password, codigo)
    with transaction.atomic():
        codigos = _generar_codigos_recuperacion(usuario)
        registrar_evento(usuario, "mfa_codigos_regenerados", "usuario", usuario.pk)
    return codigos


def restablecer(usuario, *, por=None):
    """Quita el MFA de una cuenta (p. ej. el usuario perdió el teléfono y los códigos).

    Es una acción administrativa: queda auditada con quién la hizo.
    """
    with transaction.atomic():
        usuario.mfa_activo = False
        usuario.mfa_secreto = ""
        usuario.mfa_ultimo_paso = 0
        usuario.save(update_fields=["mfa_activo", "mfa_secreto", "mfa_ultimo_paso"])
        CodigoRecuperacionMFA.objects.filter(usuario=usuario).delete()
        registrar_evento(por, "mfa_restablecido", "usuario", usuario.pk)


# --- Inicio de sesión (segundo paso) -------------------------------------------------------


def emitir_desafio(usuario, huella=None):
    """Token firmado que prueba que la contraseña ya fue validada; no da acceso a nada más."""
    return signing.dumps({"uid": usuario.pk, "did": huella}, salt=_SAL_DESAFIO)


def huella_del_desafio(token):
    """Huella del dispositivo que inició el login (None si no se usan dispositivos)."""
    try:
        datos = signing.loads(token, salt=_SAL_DESAFIO, max_age=settings.MFA_DESAFIO_SEGUNDOS)
    except signing.BadSignature:
        raise MfaTokenInvalido() from None
    return datos.get("did")


def _usuario_id_del_desafio(token):
    try:
        datos = signing.loads(token, salt=_SAL_DESAFIO, max_age=settings.MFA_DESAFIO_SEGUNDOS)
        return int(datos["uid"])
    except (signing.BadSignature, KeyError, TypeError, ValueError):
        raise MfaTokenInvalido() from None


def verificar_desafio(token, codigo):
    """Segundo paso del login. Devuelve el usuario si el código es válido."""
    usuario_id = _usuario_id_del_desafio(token)
    error = None
    with transaction.atomic():
        usuario = Usuario.objects.select_for_update().filter(pk=usuario_id).first()
        if usuario is None or not usuario.mfa_activo:
            raise MfaTokenInvalido()
        if not usuario.is_active:
            raise CuentaDesactivada()
        if usuario.esta_bloqueado():
            error = CuentaBloqueada(
                f"Demasiados intentos fallidos. Inténtalo de nuevo en "
                f"{usuario.minutos_de_bloqueo_restantes()} min."
            )
        elif _aceptar_codigo(usuario, codigo):
            usuario.registrar_exito()
        else:
            usuario.registrar_fallo()
            error = (
                CuentaBloqueada(
                    "Demasiados intentos fallidos. Tu cuenta quedó bloqueada "
                    f"por {usuario.minutos_de_bloqueo_restantes()} min."
                )
                if usuario.esta_bloqueado()
                else CodigoMfaInvalido()
            )
    # Se lanza fuera de la transacción para no revertir el conteo de fallos.
    if error is not None:
        raise error
    return usuario
