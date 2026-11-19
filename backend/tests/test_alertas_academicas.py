"""HU-07.T6–T8: las alertas del motor de reglas llegan a la bandeja de coordinación."""

import datetime

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from academico.models import Matricula, PeriodoAcademico
from planes.models import NotificacionAcompanamiento, PreferenciaNotificacion
from usuarios.models import Asignatura, Grado, Grupo, Usuario
from usuarios.roles import Rol

pytestmark = pytest.mark.django_db

CLAVE = "Clave-segura-2026"
ALERTA = NotificacionAcompanamiento.Tipo.ALERTA


def crear(email, rol):
    return Usuario.objects.create_user(
        email, CLAVE, nombres="Nombre", apellidos="Prueba", email_verificado=True, rol=rol
    )


def cliente(usuario):
    api = APIClient()
    r = api.post("/api/auth/login/", {"email": usuario.email, "password": CLAVE}, format="json")
    assert r.status_code == 200
    api.credentials(HTTP_AUTHORIZATION="Bearer " + r.json()["access"])
    return api


@pytest.fixture
def contexto():
    hoy = timezone.localdate()
    periodo = PeriodoAcademico.objects.create(
        nombre="Vigente",
        fecha_inicio=hoy - datetime.timedelta(days=60),
        fecha_fin=hoy + datetime.timedelta(days=60),
    )
    grupo = Grupo.objects.create(grado=Grado.objects.create(nombre="Sexto", orden=6), nombre="A")
    estudiante = crear("est@colegio.edu.co", Rol.ESTUDIANTE)
    Matricula.objects.create(estudiante=estudiante, periodo=periodo, grupo=grupo)
    coord = crear("coord@colegio.edu.co", Rol.COORDINADOR)
    return periodo, estudiante, coord


def registrar_nota(api, estudiante, periodo, valor):
    return api.post(
        "/api/notas/",
        {
            "estudiante": estudiante.pk,
            "periodo": periodo.pk,
            "asignatura": Asignatura.objects.get(nombre="Matemáticas").pk,
            "valor": valor,
        },
        format="json",
    )


def test_nota_baja_publica_alerta_a_coordinacion_sin_duplicar(contexto):
    periodo, estudiante, coord = contexto
    api = cliente(coord)
    assert registrar_nota(api, estudiante, periodo, "1.5").status_code == 201

    avisos = NotificacionAcompanamiento.objects.filter(tipo=ALERTA)
    assert avisos.count() == 1
    aviso = avisos.get()
    assert aviso.destinatario == coord
    assert "Matemáticas" in aviso.mensaje

    # Guardar de nuevo el mismo estado no repite la alerta.
    nota_id = api.get("/api/notas/").json()["results"][0]["id"]
    api.patch(f"/api/notas/{nota_id}/", {"valor": "1.6", "motivo": "Corrección"}, format="json")
    assert NotificacionAcompanamiento.objects.filter(tipo=ALERTA).count() == 1


def test_bandeja_de_alertas_filtra_por_tipo_y_es_personal(contexto):
    periodo, estudiante, coord = contexto
    registrar_nota(cliente(coord), estudiante, periodo, "1.5")

    bandeja = cliente(coord).get("/api/mis-notificaciones/?tipo=alerta").json()
    assert bandeja["no_leidas"] == 1
    assert [n["tipo"] for n in bandeja["resultados"]] == ["alerta"]
    assert (
        cliente(estudiante).get("/api/mis-notificaciones/?tipo=alerta").json()["resultados"] == []
    )
    assert cliente(coord).get("/api/mis-notificaciones/?tipo=otro").status_code == 400


def test_preferencia_desactivada_silencia_alertas(contexto):
    periodo, estudiante, coord = contexto
    PreferenciaNotificacion.objects.create(usuario=coord, tipo=ALERTA, habilitada=False)
    registrar_nota(cliente(coord), estudiante, periodo, "1.5")
    assert not NotificacionAcompanamiento.objects.filter(tipo=ALERTA).exists()


def test_nota_sin_alerta_no_publica_nada(contexto):
    periodo, estudiante, coord = contexto
    registrar_nota(cliente(coord), estudiante, periodo, "4.5")
    assert not NotificacionAcompanamiento.objects.filter(tipo=ALERTA).exists()
