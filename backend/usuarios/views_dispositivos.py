"""Endpoints de dispositivos registrados. La lógica vive en `dispositivos.py`."""

from rest_framework import status
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from . import dispositivos
from .autenticacion import emitir_tokens
from .serializers import DispositivoVerificarSerializer, UsuarioSerializer
from .views_mfa import MfaAnonThrottle


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([MfaAnonThrottle])
def verificar(request):
    """Canjea el código enviado al correo: registra el dispositivo y emite la sesión."""
    datos = DispositivoVerificarSerializer(data=request.data)
    datos.is_valid(raise_exception=True)
    usuario, huella = dispositivos.verificar_desafio(
        datos.validated_data["desafio_token"], datos.validated_data["codigo"]
    )
    dispositivos.registrar(usuario, huella, request)
    return Response({**emitir_tokens(usuario, huella), "usuario": UsuarioSerializer(usuario).data})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def listar(request):
    """Dispositivos vigentes del usuario; marca el que está usando ahora."""
    actual = (request.auth or {}).get("did") if request.auth else None
    filas = request.user.dispositivos.filter(revocado_en__isnull=True)
    return Response(
        [
            {
                "id": d.pk,
                "nombre": d.nombre,
                "ip": d.ip,
                "creado": d.creado,
                "ultimo_uso": d.ultimo_uso,
                "actual": bool(actual) and d.huella == actual,
            }
            for d in filas
        ]
    )


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def revocar(request, pk):
    """Cierra la sesión de ese dispositivo y exige verificarlo de nuevo la próxima vez."""
    if not dispositivos.revocar(request.user, pk):
        raise NotFound()
    return Response(status=status.HTTP_204_NO_CONTENT)
