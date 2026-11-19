import hashlib

from django.conf import settings
from django.db import transaction
from rest_framework import status
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from planes.models import NotificacionAcompanamiento
from planes.servicios import notificar_proceso

from . import dispositivos
from .autenticacion import emitir_tokens, validar_credenciales
from .mfa import emitir_desafio
from .models import Usuario
from .recuperacion import confirmar_recuperacion, solicitar_recuperacion
from .roles import Rol
from .serializers import (
    ActualizarDatosPersonalesSerializer,
    ConfirmarRecuperacionSerializer,
    LoginSerializer,
    LogoutSerializer,
    ReenviarVerificacionSerializer,
    RegistroSerializer,
    SolicitarRecuperacionSerializer,
    UsuarioSerializer,
    VerificarCorreoSerializer,
)
from .servicios import enviar_correo_verificacion, verificar_correo


class LoginThrottle(AnonRateThrottle):
    """Limita intentos de login por IP + correo: quien adivina claves de una cuenta se frena,
    pero muchos usuarios legítimos tras la misma IP (un colegio) no se bloquean entre sí."""

    scope = "login"

    def get_cache_key(self, request, view):
        email = ""
        if hasattr(request.data, "get"):
            email = str(request.data.get("email", "")).strip().lower()[:254]
        ident = hashlib.sha256(f"{self.get_ident(request)}|{email}".encode()).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": ident}


class LoginIpThrottle(AnonRateThrottle):
    """Tope amplio por IP contra barridos de muchas cuentas (credential stuffing)."""

    scope = "login_ip"


class RegistroThrottle(AnonRateThrottle):
    """Limita la creación automatizada de cuentas y el envío de correos."""

    scope = "registro"


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([RegistroThrottle])
def registro(request):
    """Crea una cuenta de estudiante y envía el correo de verificación (si está activado)."""
    serializer = RegistroSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    with transaction.atomic():
        usuario = serializer.save()
        if settings.REGISTRO_VERIFICA_CORREO:
            enviar_correo_verificacion(usuario)
        else:
            usuario.email_verificado = True
            usuario.save(update_fields=["email_verificado"])
        notificar_proceso(
            [usuario],
            tipo=NotificacionAcompanamiento.Tipo.REGISTRO,
            titulo="Bienvenido a Acompañamiento Académico",
            mensaje=(
                "Tu cuenta está creada. Verifica tu correo para empezar a usarla."
                if settings.REGISTRO_VERIFICA_CORREO
                else "Tu cuenta está creada y lista para usarse."
            ),
        )
        responsables = Usuario.objects.filter(
            is_active=True, rol__in=[Rol.ADMINISTRADOR, Rol.SUPERADMIN, Rol.COORDINADOR]
        )
        notificar_proceso(
            responsables,
            tipo=NotificacionAcompanamiento.Tipo.REGISTRO,
            titulo="Nuevo estudiante registrado",
            mensaje=(
                f"{usuario.nombre_completo} creó una cuenta y está pendiente de verificar "
                "su correo."
                if settings.REGISTRO_VERIFICA_CORREO
                else f"{usuario.nombre_completo} creó una cuenta."
            ),
        )
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([LoginThrottle, LoginIpThrottle])
def login(request):
    """Inicia sesión con correo y contraseña y emite tokens JWT (access y refresh).

    Si la cuenta tiene verificación en dos pasos, no emite tokens: responde `mfa_requerido`
    con un `mfa_token` de corta vida para completar el inicio en `/auth/mfa/verificar/`.
    """
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    datos = serializer.validated_data
    usuario = validar_credenciales(datos["email"], datos["password"])

    huella = None
    conocido = None
    if dispositivos.activo():
        huella = dispositivos.huella_de(datos.get("dispositivo"))
        if huella is None:
            raise dispositivos.DispositivoRequerido()
        conocido = dispositivos.buscar_confiable(usuario, huella)

    if usuario.mfa_activo:
        # El código MFA también prueba que es el dueño: registra el dispositivo nuevo.
        return Response({"mfa_requerido": True, "mfa_token": emitir_desafio(usuario, huella)})
    if huella and conocido is None:
        # Dispositivo nuevo: no se bloquea; se verifica con un código enviado al correo.
        return Response(
            {
                "dispositivo_nuevo": True,
                "desafio_token": dispositivos.iniciar_desafio(usuario, huella),
                "correo": dispositivos.correo_parcial(usuario.email),
            }
        )
    if conocido is not None:
        dispositivos.tocar(conocido, request)
    return Response({**emitir_tokens(usuario, huella), "usuario": UsuarioSerializer(usuario).data})


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def verificar_correo_view(request):
    """Confirma el correo con el token recibido por email."""
    serializer = VerificarCorreoSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    usuario = verificar_correo(serializer.validated_data["token"])
    return Response({"email": usuario.email, "email_verificado": True})


class ReenvioThrottle(AnonRateThrottle):
    """Límite de reenvíos por IP (tasa `reenvio` en REST_FRAMEWORK)."""

    scope = "reenvio"


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([ReenvioThrottle])
def reenviar_verificacion(request):
    """Reenvía el correo de verificación. Siempre responde igual para no revelar cuentas."""
    serializer = ReenviarVerificacionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    usuario = Usuario.objects.filter(
        email__iexact=serializer.validated_data["email"].strip(), is_active=True
    ).first()
    if usuario is not None and not usuario.email_verificado:
        enviar_correo_verificacion(usuario)
    return Response({"detail": "Si la cuenta existe y falta verificarla, te enviamos un correo."})


class RecuperacionThrottle(AnonRateThrottle):
    """Límite de solicitudes de recuperación por IP."""

    scope = "recuperacion"


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([RecuperacionThrottle])
def solicitar_recuperacion_view(request):
    """Envía el enlace de recuperación. Responde igual exista o no la cuenta."""
    serializer = SolicitarRecuperacionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    solicitar_recuperacion(serializer.validated_data["email"])
    return Response({"detail": "Si la cuenta existe, te enviamos un correo con el enlace."})


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def confirmar_recuperacion_view(request):
    """Cambia la contraseña con el enlace recibido por correo (un solo uso)."""
    serializer = ConfirmarRecuperacionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    confirmar_recuperacion(**serializer.validated_data)
    return Response({"detail": "Tu contraseña fue actualizada. Ya puedes iniciar sesión."})


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def me(request):
    """GET: datos del usuario autenticado (sirve también para comprobar la sesión).

    PATCH: edita sus datos personales (nombres y apellidos). El correo, el rol y el estado
    de la cuenta no se pueden cambiar desde aquí.
    """
    if request.method == "PATCH":
        datos = ActualizarDatosPersonalesSerializer(data=request.data, partial=True)
        datos.is_valid(raise_exception=True)
        for campo, valor in datos.validated_data.items():
            setattr(request.user, campo, valor)
        if datos.validated_data:
            request.user.save(update_fields=list(datos.validated_data))
    return Response(UsuarioSerializer(request.user).data)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def logout(request):
    """Cierra la sesión invalidando el refresh token. Idempotente."""
    serializer = LogoutSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        RefreshToken(serializer.validated_data["refresh"]).blacklist()
    except TokenError:
        pass  # ya vencido o invalidado: la sesión ya estaba cerrada
    return Response(status=status.HTTP_204_NO_CONTENT)
