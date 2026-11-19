from rest_framework import status
from rest_framework.exceptions import APIException


class CredencialesInvalidas(APIException):
    status_code = status.HTTP_401_UNAUTHORIZED
    default_detail = "Correo o contraseña incorrectos."
    default_code = "credenciales_invalidas"


class CorreoNoVerificado(APIException):
    status_code = status.HTTP_403_FORBIDDEN
    default_detail = "Verifica tu correo antes de iniciar sesión."
    default_code = "correo_no_verificado"


class CuentaBloqueada(APIException):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    default_detail = "Demasiados intentos fallidos. Inténtalo más tarde."
    default_code = "cuenta_bloqueada"


class CodigoMfaInvalido(APIException):
    status_code = status.HTTP_401_UNAUTHORIZED
    default_detail = "El código de verificación no es válido o ya venció."
    default_code = "codigo_mfa_invalido"


class CodigoMfaIncorrecto(CodigoMfaInvalido):
    """Mismo error pero para operaciones con sesión iniciada: va como 400 porque el cliente
    interpreta un 401 como "token vencido" y reintentaría (contando el fallo dos veces)."""

    status_code = status.HTTP_400_BAD_REQUEST


class ContrasenaIncorrecta(APIException):
    status_code = status.HTTP_400_BAD_REQUEST  # 400 y no 401, por la misma razón
    default_detail = "La contraseña no es correcta."
    default_code = "contrasena_incorrecta"


class MfaTokenInvalido(APIException):
    status_code = status.HTTP_401_UNAUTHORIZED
    default_detail = "La verificación venció. Vuelve a iniciar sesión."
    default_code = "mfa_token_invalido"


class MfaYaActivo(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "La verificación en dos pasos ya está activa en tu cuenta."
    default_code = "mfa_ya_activo"


class MfaNoIniciado(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "Primero genera el código QR para configurar la verificación en dos pasos."
    default_code = "mfa_no_iniciado"


class MfaNoActivo(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "La verificación en dos pasos no está activa en tu cuenta."
    default_code = "mfa_no_activo"


class TokenInvalido(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "El enlace de verificación no es válido."
    default_code = "token_invalido"


class TokenExpirado(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "El enlace de verificación venció. Solicita uno nuevo."
    default_code = "token_expirado"


class EnlaceRecuperacionInvalido(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "El enlace no es válido o ya venció. Solicita uno nuevo."
    default_code = "enlace_invalido"


class CuentaDesactivada(APIException):
    status_code = status.HTTP_403_FORBIDDEN
    default_detail = "Tu cuenta está desactivada. Comunícate con la institución."
    default_code = "cuenta_desactivada"


class NoPuedesCambiarTuEstado(APIException):
    status_code = status.HTTP_403_FORBIDDEN
    default_detail = "No puedes desactivar tu propia cuenta. Pídeselo a otro administrador."
    default_code = "no_puedes_cambiar_tu_estado"
