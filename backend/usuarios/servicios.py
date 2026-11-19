from django.conf import settings
from django.core import signing
from django.core.signing import BadSignature, SignatureExpired

from .correo import enviar_correo
from .excepciones import TokenExpirado, TokenInvalido
from .models import Usuario

SALT = "usuarios.verificacion-correo"


def generar_token_verificacion(usuario):
    return signing.dumps({"uid": usuario.pk, "email": usuario.email}, salt=SALT)


def leer_token_verificacion(token):
    """Devuelve el payload del token o lanza signing.BadSignature / SignatureExpired."""
    return signing.loads(token, salt=SALT, max_age=settings.VERIFICACION_MAX_AGE)


def enviar_correo_verificacion(usuario):
    """Envía al usuario el enlace para verificar su correo institucional."""
    enlace = f"{settings.VERIFICACION_URL}?token={generar_token_verificacion(usuario)}"
    horas = settings.VERIFICACION_MAX_AGE // 3600
    enviar_correo(
        asunto="Verifica tu correo - Acompañamiento Académico",
        plantilla="verificacion",
        contexto={"nombres": usuario.nombres, "enlace": enlace, "horas": horas},
        destinatario=usuario.email,
    )


def verificar_correo(token):
    """Marca el correo como verificado. Idempotente. Devuelve el usuario."""
    try:
        datos = leer_token_verificacion(token)
    except SignatureExpired as exc:
        raise TokenExpirado() from exc
    except BadSignature as exc:
        raise TokenInvalido() from exc

    usuario = Usuario.objects.filter(pk=datos.get("uid"), email=datos.get("email")).first()
    if usuario is None:  # usuario borrado o correo cambiado desde que se emitió
        raise TokenInvalido()
    if not usuario.email_verificado:
        usuario.email_verificado = True
        usuario.save(update_fields=["email_verificado"])
    return usuario
