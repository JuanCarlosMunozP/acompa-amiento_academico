from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from rest_framework_simplejwt.tokens import RefreshToken

from .excepciones import (
    CorreoNoVerificado,
    CredencialesInvalidas,
    CuentaBloqueada,
    CuentaDesactivada,
)
from .models import Usuario

# Hash de relleno para que "correo inexistente" tarde igual que "contraseña errónea".
_HASH_RELLENO = make_password("relleno-no-es-una-contrasena")


def _evaluar(email, password):
    """Aplica las reglas y guarda el conteo de intentos. Devuelve (usuario, error)."""
    with transaction.atomic():
        usuario = Usuario.objects.select_for_update().filter(email__iexact=email.strip()).first()

        if usuario is None:
            check_password(password, _HASH_RELLENO)
            return None, CredencialesInvalidas()

        if usuario.esta_bloqueado():
            minutos = usuario.minutos_de_bloqueo_restantes()
            return None, CuentaBloqueada(
                f"Demasiados intentos fallidos. Inténtalo de nuevo en {minutos} min."
            )

        if not usuario.check_password(password):
            usuario.registrar_fallo()
            if usuario.esta_bloqueado():
                return None, CuentaBloqueada(
                    "Demasiados intentos fallidos. Tu cuenta quedó bloqueada "
                    f"por {usuario.minutos_de_bloqueo_restantes()} min."
                )
            return None, CredencialesInvalidas()

        # Con MFA activo el conteo NO se reinicia aquí sino al validar el código: si no, quien
        # conozca la contraseña tendría intentos ilimitados para adivinar el segundo factor.
        if not usuario.mfa_activo:
            usuario.registrar_exito()

    # Solo se revela después de acertar la contraseña, para no delatar qué cuentas existen.
    if not usuario.is_active:
        return None, CuentaDesactivada()
    if not usuario.email_verificado:
        return None, CorreoNoVerificado()
    return usuario, None


def validar_credenciales(email, password):
    """Primer factor: valida correo y contraseña con control de intentos. Devuelve el usuario.

    No emite tokens: si el usuario tiene MFA activo todavía falta el segundo factor.
    """
    # Las excepciones se lanzan fuera de la transacción para no revertir el conteo.
    usuario, error = _evaluar(email, password)
    if error is not None:
        raise error
    return usuario


def emitir_tokens(usuario, huella=None):
    """Emite access y refresh. Con `huella`, la sesión queda atada a ese dispositivo (`did`)."""
    refresh = RefreshToken.for_user(usuario)
    if huella:
        refresh["did"] = huella
    return {"access": str(refresh.access_token), "refresh": str(refresh)}
