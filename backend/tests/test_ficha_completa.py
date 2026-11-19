"""PTA-611: ficha completa del estudiante (datos, evaluación, asistencia, trabajos y planes)."""

import datetime

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from academico.models import Matricula, PeriodoAcademico
from planes.models import PlanRefuerzo
from seguimiento.models import Asistencia, Resultado, TrabajoPendiente
from usuarios.models import Asignatura, Grado, Grupo, Usuario
from usuarios.roles import Rol

pytestmark = pytest.mark.django_db

CLAVE = "Clave-segura-2026"


def crear(email, rol=Rol.ESTUDIANTE):
    return Usuario.objects.create_user(
        email, CLAVE, nombres="Nom", apellidos="Ape", email_verificado=True, rol=rol
    )


def cliente(usuario):
    c = APIClient()
    r = c.post("/api/auth/login/", {"email": usuario.email, "password": CLAVE}, format="json")
    assert r.status_code == 200, r.json()
    c.credentials(HTTP_AUTHORIZATION="Bearer " + r.json()["access"])
    return c


@pytest.fixture
def periodo():
    hoy = timezone.localdate()
    return PeriodoAcademico.objects.create(
        nombre="Vigente",
        fecha_inicio=hoy - datetime.timedelta(days=30),
        fecha_fin=hoy + datetime.timedelta(days=60),
    )


@pytest.fixture
def mate():
    return Asignatura.objects.get_or_create(nombre="Matemáticas")[0]


@pytest.fixture
def estudiante(periodo, mate):
    grupo = Grupo.objects.create(grado=Grado.objects.create(nombre="Sexto", orden=6), nombre="A")
    u = crear("est@colegio.edu.co")
    Matricula.objects.create(estudiante=u, periodo=periodo, grupo=grupo)
    Resultado.objects.create(estudiante=u, asignatura=mate, periodo=periodo, valor="2.50")
    TrabajoPendiente.objects.create(
        estudiante=u,
        asignatura=mate,
        periodo=periodo,
        descripcion="Taller 3",
        fecha_limite=timezone.localdate(),
    )
    for i in range(40):
        Asistencia.objects.create(
            estudiante=u,
            fecha=timezone.localdate() - datetime.timedelta(days=i),
            estado="presente",
        )
    return u


def plan_de(estudiante, periodo, asignatura, tutor=None):
    return PlanRefuerzo.objects.create(
        estudiante=estudiante,
        periodo=periodo,
        asignatura=asignatura,
        objetivos="x",
        fecha_inicio=periodo.fecha_inicio,
        fecha_fin=periodo.fecha_fin,
        estado="asignado" if tutor else "pendiente",
        tutor=tutor,
    )


@pytest.mark.parametrize("rol", [Rol.COORDINADOR, Rol.ADMINISTRADOR])
def test_coordinacion_ve_la_ficha_completa(estudiante, periodo, mate, rol):
    plan_de(estudiante, periodo, mate)
    r = cliente(crear("c@colegio.edu.co", rol)).get(
        f"/api/estudiantes/{estudiante.pk}/ficha-completa/"
    )

    assert r.status_code == 200, r.json()
    datos = r.json()
    assert datos["estudiante"]["grado"] == "Sexto"
    assert datos["estudiante"]["grupo"] == "A"
    assert datos["periodo"]["id"] == periodo.pk
    assert datos["evaluacion"]["estado"] == "riesgo"
    assert datos["evaluacion"]["alertas"]
    assert len(datos["asistencia"]["registros"]) == 30  # recortado para la ficha
    assert [t["descripcion"] for t in datos["trabajos_pendientes"]] == ["Taller 3"]
    assert len(datos["planes"]) == 1


def test_tutor_con_plan_asignado_ve_solo_sus_planes(estudiante, periodo, mate):
    tutor = crear("t@colegio.edu.co", Rol.TUTOR)
    otro = crear("t2@colegio.edu.co", Rol.TUTOR)
    plan_de(estudiante, periodo, mate, tutor=tutor)
    fisica = Asignatura.objects.get_or_create(nombre="Física")[0]
    plan_de(estudiante, periodo, fisica, tutor=otro)

    r = cliente(tutor).get(f"/api/estudiantes/{estudiante.pk}/ficha-completa/")

    assert r.status_code == 200
    assert [p["asignatura_nombre"] for p in r.json()["planes"]] == ["Matemáticas"]


def test_tutor_sin_plan_con_ese_estudiante_recibe_403(estudiante, periodo, mate):
    tutor = crear("t@colegio.edu.co", Rol.TUTOR)
    plan_de(estudiante, periodo, mate)  # pendiente: aún sin tutor
    c = cliente(tutor)

    assert c.get(f"/api/estudiantes/{estudiante.pk}/ficha-completa/").status_code == 403


def test_estudiante_no_accede(estudiante):
    c = cliente(estudiante)
    assert c.get(f"/api/estudiantes/{estudiante.pk}/ficha-completa/").status_code == 403


def test_usuario_que_no_es_estudiante_da_404(estudiante):
    coord = crear("c@colegio.edu.co", Rol.COORDINADOR)
    r = cliente(coord).get(f"/api/estudiantes/{coord.pk}/ficha-completa/")
    assert r.status_code == 404


def test_sin_matricula_en_el_periodo_no_inventa_datos(periodo):
    huerfano = crear("h@colegio.edu.co")
    r = cliente(crear("c@colegio.edu.co", Rol.COORDINADOR)).get(
        f"/api/estudiantes/{huerfano.pk}/ficha-completa/"
    )
    assert r.status_code == 200
    assert r.json()["estudiante"]["grupo"] is None
    assert r.json()["evaluacion"]["estado"] == "sin_alertas"
    assert r.json()["planes"] == []
