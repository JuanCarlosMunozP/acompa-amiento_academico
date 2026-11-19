from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

from common.seguridad import enlace_confiable

APP_NOMBRE = "Acompañamiento Académico"


def enviar_correo(asunto, plantilla, contexto, destinatario):
    """Envía un correo con versión HTML y texto plano a partir de una plantilla.

    `plantilla` es un nombre simple (se busca en `usuarios/correo/`) o una ruta completa como
    `planes/correo/asignacion_tutor`. Busca la versión `.html` y la `.txt`.
    """
    base = plantilla if "/" in plantilla else f"usuarios/correo/{plantilla}"
    contexto = {
        "app": APP_NOMBRE,
        "institucion": settings.INSTITUCION_NOMBRE,
        "color": settings.INSTITUCION_COLOR,
        **contexto,
    }
    # Anti-phishing: nunca se envía un enlace que apunte fuera de los hosts de confianza.
    enlace = contexto.get("enlace")
    if enlace and not enlace_confiable(enlace):
        raise ValueError("El enlace del correo apunta a un host no confiable; no se envía.")
    texto = render_to_string(f"{base}.txt", contexto)
    html = render_to_string(f"{base}.html", contexto)

    mensaje = EmailMultiAlternatives(subject=asunto, body=texto, to=[destinatario])
    mensaje.attach_alternative(html, "text/html")
    mensaje.send()
