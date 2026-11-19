"""Recuperación de contraseña con enlace de un solo uso y con expiración.

El token es el de Django (`default_token_generator`): se firma con el hash de la contraseña
actual y `last_login`, así que en cuanto la contraseña cambia el mismo enlace deja de servir
(un solo uso), y además caduca a los `PASSWORD_RESET_TIMEOUT` segundos.
"""

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import serializers
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from .correo import APP_NOMBRE, enviar_correo
from .excepciones import EnlaceRecuperacionInvalido
from .models import Usuario


def generar_enlace(usuario):
    uid = urlsafe_base64_encode(force_bytes(usuario.pk))
    token = default_token_generator.make_token(usuario)
    return f"{settings.RECUPERACION_URL}?uid={uid}&token={token}"


def solicitar_recuperacion(email):
    """Envía el correo si la cuenta existe y está activa. No revela si existe."""
    usuario = Usuario.objects.filter(email__iexact=email.strip(), is_active=True).first()
    if usuario is None:
        return
    enviar_correo(
        asunto=f"Recupera tu contraseña - {APP_NOMBRE}",
        plantilla="recuperacion",
        contexto={
            "nombres": usuario.nombres,
            "correo": usuario.email,
            "enlace": generar_enlace(usuario),
            "minutos": settings.PASSWORD_RESET_TIMEOUT // 60,
        },
        destinatario=usuario.email,
    )


def _usuario_desde_enlace(uid, token):
    try:
        pk = urlsafe_base64_decode(uid).decode()
        usuario = Usuario.objects.get(pk=pk, is_active=True)
    except (TypeError, ValueError, OverflowError, UnicodeDecodeError, Usuario.DoesNotExist):
        raise EnlaceRecuperacionInvalido() from None
    if not default_token_generator.check_token(usuario, token):
        raise EnlaceRecuperacionInvalido()
    return usuario


def cerrar_todas_las_sesiones(usuario):
    """Invalida los refresh tokens vigentes del usuario."""
    for pendiente in OutstandingToken.objects.filter(user=usuario):
        BlacklistedToken.objects.get_or_create(token=pendiente)


def confirmar_recuperacion(uid, token, password):
    """Cambia la contraseña si el enlace es válido. El enlace queda inutilizado."""
    usuario = _usuario_desde_enlace(uid, token)
    try:
        validate_password(password, user=usuario)
    except DjangoValidationError as exc:
        raise serializers.ValidationError({"password": list(exc.messages)}) from exc

    with transaction.atomic():
        usuario.set_password(password)
        # El enlace llegó al correo: queda probado que es suyo, y se levanta el bloqueo.
        usuario.email_verificado = True
        usuario.intentos_fallidos = 0
        usuario.bloqueado_hasta = None
        usuario.save(
            update_fields=["password", "email_verificado", "intentos_fallidos", "bloqueado_hasta"]
        )
        cerrar_todas_las_sesiones(usuario)
    return usuario
