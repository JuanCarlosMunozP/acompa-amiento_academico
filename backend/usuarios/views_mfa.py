"""Endpoints de verificación en dos pasos (MFA). La lógica vive en `mfa.py`."""

from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle

from . import dispositivos, mfa
from .autenticacion import emitir_tokens
from .serializers import (
    MfaCodigoSerializer,
    MfaReautenticacionSerializer,
    MfaVerificarSerializer,
    UsuarioSerializer,
)


class MfaAnonThrottle(AnonRateThrottle):
    """Límite por IP del segundo paso del login (además del bloqueo por cuenta)."""

    scope = "mfa"


class MfaUserThrottle(UserRateThrottle):
    """Límite por usuario de las operaciones de configuración del MFA."""

    scope = "mfa"


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([MfaAnonThrottle])
def verificar(request):
    """Segundo paso del login: canjea `mfa_token` + código (TOTP o de recuperación) por tokens."""
    datos = MfaVerificarSerializer(data=request.data)
    datos.is_valid(raise_exception=True)
    usuario = mfa.verificar_desafio(
        datos.validated_data["mfa_token"], datos.validated_data["codigo"]
    )
    huella = mfa.huella_del_desafio(datos.validated_data["mfa_token"])
    if huella and dispositivos.activo():
        dispositivos.registrar(usuario, huella, request)
    else:
        huella = None
    return Response({**emitir_tokens(usuario, huella), "usuario": UsuarioSerializer(usuario).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([MfaUserThrottle])
def configurar(request):
    """Genera un secreto nuevo y devuelve el código QR (PNG en data URI) para escanearlo."""
    return Response(mfa.iniciar_configuracion(request.user))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([MfaUserThrottle])
def activar(request):
    """Confirma el alta con un código de la app. Devuelve los códigos de recuperación (una vez)."""
    datos = MfaCodigoSerializer(data=request.data)
    datos.is_valid(raise_exception=True)
    codigos = mfa.activar(request.user, datos.validated_data["codigo"])
    return Response({"mfa_activo": True, "codigos_recuperacion": codigos})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([MfaUserThrottle])
def desactivar(request):
    """Quita el MFA. Exige la contraseña y un código vigente."""
    datos = MfaReautenticacionSerializer(data=request.data)
    datos.is_valid(raise_exception=True)
    mfa.desactivar(request.user, **datos.validated_data)
    return Response({"mfa_activo": False})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([MfaUserThrottle])
def regenerar_codigos(request):
    """Invalida los códigos de recuperación anteriores y entrega un juego nuevo."""
    datos = MfaReautenticacionSerializer(data=request.data)
    datos.is_valid(raise_exception=True)
    codigos = mfa.regenerar_codigos_recuperacion(request.user, **datos.validated_data)
    return Response({"codigos_recuperacion": codigos})
