import pytest
from rest_framework.test import APIClient

from planes.models import PlantillaCorreoPlan
from planes.plantillas_correo import renderizar_plantilla
from usuarios.models import EventoAuditoria, Usuario
from usuarios.roles import Rol

pytestmark = pytest.mark.django_db

CLAVE = "Clave-segura-2026"


def crear(email, rol):
    return Usuario.objects.create_user(
        email,
        CLAVE,
        nombres="Nombre",
        apellidos="Prueba",
        email_verificado=True,
        rol=rol,
    )


def cliente(usuario):
    api = APIClient()
    respuesta = api.post(
        "/api/auth/login/", {"email": usuario.email, "password": CLAVE}, format="json"
    )
    assert respuesta.status_code == 200
    api.credentials(HTTP_AUTHORIZATION="Bearer " + respuesta.json()["access"])
    return api


def test_solo_coordinacion_puede_consultar_y_editar_plantillas():
    coordinador = crear("coordinador@colegio.edu.co", Rol.COORDINADOR)
    tutor = crear("tutor@colegio.edu.co", Rol.TUTOR)

    respuesta = cliente(coordinador).get("/api/plantillas-correo/")

    assert respuesta.status_code == 200
    assert {item["clave"] for item in respuesta.json()} == {
        PlantillaCorreoPlan.Clave.ASIGNACION_TUTOR,
        PlantillaCorreoPlan.Clave.ASIGNACION_ESTUDIANTE,
    }
    assert cliente(tutor).get("/api/plantillas-correo/").status_code == 403

    editada = cliente(coordinador).patch(
        "/api/plantillas-correo/asignacion_tutor/",
        {"asunto": "Tutor asignado: {{ estudiante }}"},
        format="json",
    )

    assert editada.status_code == 200
    assert editada.json()["asunto"] == "Tutor asignado: {{ estudiante }}"
    evento = EventoAuditoria.objects.get(accion="plantilla_correo.actualizada")
    assert evento.actor_id == coordinador.pk
    assert evento.recurso_id == PlantillaCorreoPlan.Clave.ASIGNACION_TUTOR
    assert evento.detalles == {"campos": ["asunto"]}


def test_rechaza_variables_no_permitidas_y_escapa_valores_html():
    coordinador = crear("coordinador@colegio.edu.co", Rol.COORDINADOR)
    cliente(coordinador).get("/api/plantillas-correo/")

    respuesta = cliente(coordinador).patch(
        "/api/plantillas-correo/asignacion_tutor/",
        {"cuerpo_html": "<p>{{ nombre_desconocido }}</p>"},
        format="json",
    )

    assert respuesta.status_code == 400
    assert (
        renderizar_plantilla(
            "{{ nombres }}", {"nombres": "<script>alert(1)</script>"}, html_body=True
        )
        == "&lt;script&gt;alert(1)&lt;/script&gt;"
    )

    html_inseguro = cliente(coordinador).patch(
        "/api/plantillas-correo/asignacion_tutor/",
        {"cuerpo_html": '<p onclick="alert(1)">Hola</p>'},
        format="json",
    )
    assert html_inseguro.status_code == 400
