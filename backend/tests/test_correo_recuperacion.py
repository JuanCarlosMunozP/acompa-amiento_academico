import re

import pytest
from django.core import mail
from rest_framework.test import APIClient

from usuarios.models import Usuario

pytestmark = pytest.mark.django_db

CLAVE = "Clave-segura-2026"


def pedir(nombres="Ana"):
    Usuario.objects.create_user(
        "ana@colegio.edu.co", CLAVE, nombres=nombres, apellidos="Ruiz", email_verificado=True
    )
    r = APIClient().post("/api/auth/recuperar/", {"email": "ana@colegio.edu.co"}, format="json")
    assert r.status_code == 200
    return mail.outbox[0]


def html_de(mensaje):
    ((contenido, tipo),) = mensaje.alternatives
    assert tipo == "text/html"
    return contenido


def test_el_correo_tiene_version_html_y_texto():
    m = pedir()
    assert m.to == ["ana@colegio.edu.co"]
    assert "Recupera tu contraseña" in m.subject
    assert m.body  # texto plano
    assert "<html" in html_de(m)


def test_el_enlace_del_texto_y_del_html_es_el_mismo():
    m = pedir()
    enlace_txt = re.search(r"https?://\S+", m.body).group(0)
    enlace_html = re.search(r'href="([^"]+)"', html_de(m)).group(1).replace("&amp;", "&")
    assert enlace_txt == enlace_html
    assert "uid=" in enlace_txt and "token=" in enlace_txt


def test_el_enlace_del_texto_no_se_escapa():
    # En texto plano el & debe ir tal cual, no como &amp;.
    m = pedir()
    assert "&amp;" not in m.body and "&token=" in m.body


def test_muestra_nombre_y_vencimiento():
    m = pedir(nombres="Ana María")
    for contenido in (m.body, html_de(m)):
        assert "Ana María" in contenido
        assert "60 minutos" in contenido
        assert "una sola vez" in contenido


def test_explica_que_se_puede_ignorar_si_no_fue_el_usuario():
    m = pedir()
    assert "ignora este mensaje" in m.body
    assert "ignora este mensaje" in html_de(m)


def test_el_vencimiento_sigue_la_configuracion(settings):
    settings.PASSWORD_RESET_TIMEOUT = 15 * 60
    m = pedir()
    assert "15 minutos" in m.body and "15 minutos" in html_de(m)


def test_el_nombre_se_escapa_en_html_para_evitar_inyeccion():
    m = pedir(nombres='<script>alert("x")</script>')
    html = html_de(m)
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    # En texto plano se muestra tal cual (no es HTML).
    assert '<script>alert("x")</script>' in m.body


def test_usa_la_identidad_de_la_institucion(settings):
    settings.INSTITUCION_NOMBRE = "Colegio San Martín"
    settings.INSTITUCION_COLOR = "#123456"
    m = pedir()
    html = html_de(m)
    assert "Colegio San Martín" in html and "Colegio San Martín" in m.body
    assert "#123456" in html


def test_el_html_no_depende_de_recursos_externos():
    html = html_de(pedir())
    assert not re.search(r'(src|href)="https?://(?!localhost)', html)
    assert "<img" not in html and "<link" not in html
