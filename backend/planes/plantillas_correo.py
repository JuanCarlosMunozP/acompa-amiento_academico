import html
import re
from html.parser import HTMLParser
from urllib.parse import urlsplit

from django.conf import settings
from django.core.mail import EmailMultiAlternatives

from .models import PlantillaCorreoPlan

VARIABLES_PLANTILLA = frozenset(
    {
        "nombres",
        "correo",
        "estudiante",
        "tutor",
        "asignatura",
        "periodo",
        "fecha_inicio",
        "fecha_fin",
        "objetivos",
        "app",
        "institucion",
        "color",
    }
)

PLANTILLAS_INICIALES = {
    PlantillaCorreoPlan.Clave.ASIGNACION_TUTOR: {
        "asunto": "Se te asignó un plan de refuerzo",
        "cuerpo_texto": (
            "Hola {{ nombres }},\n\n"
            "Quedaste como tutor responsable del plan de refuerzo de {{ estudiante }}.\n"
            "Asignatura: {{ asignatura }}\nPeriodo: {{ periodo }}\n"
            "Del {{ fecha_inicio }} al {{ fecha_fin }}\n\n"
            "Objetivos:\n{{ objetivos }}\n\n"
            "Abre {{ app }} para ver la ficha completa."
        ),
        "cuerpo_html": (
            "<h1>Plan de refuerzo asignado</h1>"
            "<p>Hola {{ nombres }},</p>"
            "<p>Quedaste como tutor responsable del plan de refuerzo de "
            "<strong>{{ estudiante }}</strong>.</p>"
            "<ul><li>Asignatura: {{ asignatura }}</li><li>Periodo: {{ periodo }}</li>"
            "<li>Del {{ fecha_inicio }} al {{ fecha_fin }}</li></ul>"
            "<p><strong>Objetivos</strong></p><p>{{ objetivos }}</p>"
            "<p>Abre {{ app }} para ver la ficha completa.</p>"
        ),
    },
    PlantillaCorreoPlan.Clave.ASIGNACION_ESTUDIANTE: {
        "asunto": "Tu plan de refuerzo ya tiene tutor",
        "cuerpo_texto": (
            "Hola {{ nombres }},\n\n"
            "Se asignó a {{ tutor }} como tutor de tu plan de refuerzo.\n"
            "Asignatura: {{ asignatura }}\nPeriodo: {{ periodo }}\n"
            "Del {{ fecha_inicio }} al {{ fecha_fin }}\n\n"
            "Objetivos:\n{{ objetivos }}\n\n"
            "Abre {{ app }} para consultar el seguimiento."
        ),
        "cuerpo_html": (
            "<h1>Tu plan ya tiene tutor</h1>"
            "<p>Hola {{ nombres }},</p>"
            "<p><strong>{{ tutor }}</strong> será tu tutor para el plan de refuerzo.</p>"
            "<ul><li>Asignatura: {{ asignatura }}</li><li>Periodo: {{ periodo }}</li>"
            "<li>Del {{ fecha_inicio }} al {{ fecha_fin }}</li></ul>"
            "<p><strong>Objetivos</strong></p><p>{{ objetivos }}</p>"
            "<p>Abre {{ app }} para consultar el seguimiento.</p>"
        ),
    },
}

_VARIABLE = re.compile(r"{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}")
_ETIQUETAS_HTML = frozenset(
    {"a", "br", "div", "em", "h1", "h2", "h3", "li", "ol", "p", "span", "strong", "ul"}
)
_CONTENEDORES_BLOQUEADOS = frozenset({"iframe", "object", "script", "style"})


class _SanitizadorHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.partes = []
        self.abiertas = []
        self.omitir = 0

    def handle_starttag(self, tag, attrs):
        if self.omitir:
            self.omitir += 1
            return
        if tag in _CONTENEDORES_BLOQUEADOS:
            self.omitir = 1
            return
        if tag not in _ETIQUETAS_HTML:
            return
        atributos = []
        for nombre, valor in attrs:
            if nombre == "title" and valor:
                atributos.append(f'title="{html.escape(valor, quote=True)}"')
            elif nombre == "href" and tag == "a" and valor:
                esquema = urlsplit(valor).scheme.lower()
                if esquema in {"https", "mailto"}:
                    atributos.append(f'href="{html.escape(valor, quote=True)}"')
        sufijo = f" {' '.join(atributos)}" if atributos else ""
        self.partes.append(f"<{tag}{sufijo}>")
        if tag != "br":
            self.abiertas.append(tag)

    def handle_endtag(self, tag):
        if self.omitir:
            self.omitir -= 1
            return
        if tag not in self.abiertas:
            return
        while self.abiertas:  # pragma: no branch - la etiqueta está en la pila: siempre sale por break
            abierta = self.abiertas.pop()
            self.partes.append(f"</{abierta}>")
            if abierta == tag:
                break

    def handle_data(self, data):
        if not self.omitir:
            self.partes.append(html.escape(data))

    def finish(self):
        self.close()
        while self.abiertas:
            self.partes.append(f"</{self.abiertas.pop()}>")
        return "".join(self.partes)


def sanitizar_html(contenido):
    parser = _SanitizadorHTML()
    parser.feed(contenido)
    return parser.finish()


def asegurar_plantillas():
    return [
        PlantillaCorreoPlan.objects.get_or_create(clave=clave, defaults=valores)[0]
        for clave, valores in PLANTILLAS_INICIALES.items()
    ]


def renderizar_plantilla(contenido, contexto, *, html_body=False):
    def reemplazar(coincidencia):
        nombre = coincidencia.group(1)
        valor = str(contexto.get(nombre, ""))
        if not html_body:
            return valor
        valor = html.escape(valor)
        return valor.replace("\r\n", "\n").replace("\n", "<br>") if nombre == "objetivos" else valor

    resultado = _VARIABLE.sub(reemplazar, contenido)
    return sanitizar_html(resultado) if html_body else resultado


def enviar_correo_de_plan(plantilla, contexto, destinatario):
    contexto = {
        "app": "Acompañamiento Académico",
        "institucion": settings.INSTITUCION_NOMBRE,
        "color": settings.INSTITUCION_COLOR,
        **contexto,
    }
    correo = EmailMultiAlternatives(
        subject=renderizar_plantilla(plantilla.asunto, contexto),
        body=renderizar_plantilla(plantilla.cuerpo_texto, contexto),
        to=[destinatario],
    )
    correo.attach_alternative(
        renderizar_plantilla(plantilla.cuerpo_html, contexto, html_body=True),
        "text/html",
    )
    correo.send()
