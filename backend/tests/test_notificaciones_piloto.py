import datetime

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from academico.models import PeriodoAcademico
from planes.models import (
    NotificacionAcompanamiento,
    PlanRefuerzo,
    PreferenciaNotificacion,
    SesionTutoria,
)
from planes.servicios import notificar_proceso
from usuarios.models import Asignatura, Usuario
from usuarios.roles import Rol

pytestmark = pytest.mark.django_db

CLAVE = "Clave-segura-2026"


def crear(email, rol):
    return Usuario.objects.create_user(
        email, CLAVE, nombres="Nombre", apellidos="Tutoría", email_verificado=True, rol=rol
    )


def cliente(usuario):
    api = APIClient()
    respuesta = api.post(
        "/api/auth/login/", {"email": usuario.email, "password": CLAVE}, format="json"
    )
    assert respuesta.status_code == 200
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {respuesta.json()['access']}")
    return api


@pytest.fixture
def participantes():
    estudiante = crear("estudiante@colegio.edu.co", Rol.ESTUDIANTE)
    tutor = crear("tutor@colegio.edu.co", Rol.TUTOR)
    return estudiante, tutor


def test_preferencias_son_personales_y_se_aplican_a_los_avisos(participantes):
    estudiante, tutor = participantes
    api = cliente(estudiante)
    actuales = api.get("/api/mis-preferencias-notificacion/")
    assert actuales.status_code == 200
    assert all(item["habilitada"] for item in actuales.json())

    respuesta = api.patch(
        "/api/mis-preferencias-notificacion/",
        {"preferencias": [{"tipo": "sesion", "habilitada": False}]},
        format="json",
    )
    assert respuesta.status_code == 200
    assert (
        PreferenciaNotificacion.objects.get(usuario=estudiante, tipo="sesion").habilitada is False
    )
    preferencias_tutor = cliente(tutor).get("/api/mis-preferencias-notificacion/").json()
    assert (
        next(item for item in preferencias_tutor if item["tipo"] == "sesion")["habilitada"] is True
    )

    notificar_proceso(
        [estudiante, tutor],
        tipo=NotificacionAcompanamiento.Tipo.SESION,
        titulo="Sesión",
        mensaje="Aviso de prueba",
    )
    assert not NotificacionAcompanamiento.objects.filter(destinatario=estudiante).exists()
    assert NotificacionAcompanamiento.objects.filter(destinatario=tutor).count() == 1


def test_preferencias_rechazan_tipos_duplicados(participantes):
    estudiante, _ = participantes
    respuesta = cliente(estudiante).patch(
        "/api/mis-preferencias-notificacion/",
        {
            "preferencias": [
                {"tipo": "sesion", "habilitada": False},
                {"tipo": "sesion", "habilitada": True},
            ]
        },
        format="json",
    )
    assert respuesta.status_code == 400


def test_usuario_no_puede_leer_notificacion_ajena(participantes):
    estudiante, tutor = participantes
    aviso = NotificacionAcompanamiento.objects.create(
        destinatario=estudiante,
        tipo=NotificacionAcompanamiento.Tipo.PLAN,
        titulo="Plan",
        mensaje="Aviso propio",
    )

    assert cliente(tutor).post(f"/api/notificaciones/{aviso.pk}/leer/").status_code == 404
    assert aviso.leida is None


def test_usuario_puede_listar_sus_notificaciones_con_destino(participantes):
    estudiante, _ = participantes
    aviso = NotificacionAcompanamiento.objects.create(
        destinatario=estudiante,
        tipo=NotificacionAcompanamiento.Tipo.PLAN,
        titulo="Nuevo plan",
        mensaje="Tienes un plan asignado.",
    )

    respuesta = cliente(estudiante).get("/api/mis-notificaciones/")

    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert datos["no_leidas"] == 1
    assert len(datos["resultados"]) == 1
    resultado = datos["resultados"][0]
    assert resultado["id"] == aviso.pk
    assert resultado["tipo"] == "plan"
    assert resultado["titulo"] == "Nuevo plan"
    assert resultado["mensaje"] == "Tienes un plan asignado."
    assert resultado["creada"]
    assert resultado["leida"] is None
    assert resultado["plan"] is None
    assert resultado["sesion"] is None


def test_recordatorios_son_idempotentes_e_incluyen_fecha_hora_y_modalidad(participantes):
    estudiante, tutor = participantes
    hoy = timezone.localdate()
    periodo = PeriodoAcademico.objects.create(
        nombre="Vigente",
        fecha_inicio=hoy - datetime.timedelta(days=1),
        fecha_fin=hoy + datetime.timedelta(days=30),
    )
    asignatura = Asignatura.objects.get_or_create(nombre="Matemáticas")[0]
    plan = PlanRefuerzo.objects.create(
        estudiante=estudiante,
        periodo=periodo,
        asignatura=asignatura,
        objetivos="Repasar",
        fecha_inicio=hoy,
        fecha_fin=hoy + datetime.timedelta(days=10),
        estado=PlanRefuerzo.Estado.ASIGNADO,
        tutor=tutor,
        creado_por=estudiante,
    )
    inicio = timezone.now() + datetime.timedelta(hours=2)
    sesion = SesionTutoria.objects.create(
        plan=plan,
        tutor=tutor,
        inicio=inicio,
        fin=inicio + datetime.timedelta(hours=1),
        modalidad=SesionTutoria.Modalidad.VIRTUAL,
        enlace_virtual="https://example.edu/reunion",
        creado_por=tutor,
    )
    PreferenciaNotificacion.objects.create(
        usuario=tutor,
        tipo=NotificacionAcompanamiento.Tipo.SESION,
        habilitada=False,
    )

    call_command("enviar_recordatorios_sesiones", verbosity=0)
    call_command("enviar_recordatorios_sesiones", verbosity=0)

    avisos = NotificacionAcompanamiento.objects.filter(
        tipo=NotificacionAcompanamiento.Tipo.SESION,
        sesion=sesion,
        titulo="Recordatorio de tutoría",
    )
    assert avisos.count() == 1
    assert avisos.get().destinatario == estudiante
    assert timezone.localtime(sesion.inicio).strftime("%d/%m/%Y %H:%M") in avisos.get().mensaje
    assert "virtual" in avisos.get().mensaje
