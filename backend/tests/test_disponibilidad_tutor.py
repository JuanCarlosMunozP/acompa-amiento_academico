"""Disponibilidad semanal y bloqueos del tutor: lectura, reemplazo, validaciones y la regla de no
invalidar sesiones futuras ya agendadas."""

# ruff: noqa: F401, F811  (las fixtures compartidas se importan de test_planes)
from datetime import timedelta

import pytest
from django.utils import timezone

from planes.models import SesionTutoria
from usuarios.models import BloqueoDisponibilidadTutor, HorarioDisponibilidadTutor

from .test_planes import (
    cliente,
    coord,
    crear,
    estudiante,
    habil,
    matematicas,
    periodo,
    tutor_elegible,
)
from .test_planes_seguimiento import plan_asignado

pytestmark = pytest.mark.django_db

URL = "/api/perfil-tutor/disponibilidad/"


def horario(dia, ini="08:00:00", fin="12:00:00"):
    return {"dia_semana": dia, "hora_inicio": ini, "hora_fin": fin}


def bloqueo(fecha, ini="09:00:00", fin="10:00:00", motivo="Reunión"):
    return {"fecha": fecha, "hora_inicio": ini, "hora_fin": fin, "motivo": motivo}


def guardar(c, horarios=(), bloqueos=()):
    return c.put(URL, {"horarios": list(horarios), "bloqueos": list(bloqueos)}, format="json")


@pytest.fixture
def tutor(plan_asignado):
    return plan_asignado["tutor"]


@pytest.fixture
def sesion_manana(plan_asignado, tutor):
    """Sesión programada mañana a las 10:00 (hora local) de 50 minutos."""
    inicio = (timezone.localtime() + timedelta(days=1)).replace(
        hour=10, minute=0, second=0, microsecond=0
    )
    return SesionTutoria.objects.create(
        plan_id=plan_asignado["id"],
        tutor=tutor,
        inicio=inicio,
        fin=inicio + timedelta(minutes=50),
        modalidad="presencial",
        lugar="Aula",
    )


# --- lectura y reemplazo ---


def test_un_tutor_sin_disponibilidad_recibe_listas_vacias(tutor):
    r = cliente(tutor).get(URL)
    assert r.status_code == 200
    assert r.json() == {"horarios": [], "bloqueos": []}


def test_el_tutor_guarda_y_lee_su_disponibilidad(tutor):
    c = cliente(tutor)
    r = guardar(c, [horario(0), horario(2, "14:00:00", "16:00:00")], [bloqueo("2030-05-06")])
    assert r.status_code == 200
    cuerpo = c.get(URL).json()
    assert len(cuerpo["horarios"]) == 2 and cuerpo["bloqueos"][0]["motivo"] == "Reunión"
    assert HorarioDisponibilidadTutor.objects.count() == 2
    assert BloqueoDisponibilidadTutor.objects.count() == 1


def test_guardar_reemplaza_lo_anterior(tutor):
    c = cliente(tutor)
    guardar(c, [horario(0), horario(1)], [bloqueo("2030-05-06")])
    r = guardar(c, [horario(4)])
    assert [h["dia_semana"] for h in r.json()["horarios"]] == [4]
    assert r.json()["bloqueos"] == []
    assert HorarioDisponibilidadTutor.objects.count() == 1


def test_vaciar_la_disponibilidad_es_valido_sin_sesiones_futuras(tutor):
    c = cliente(tutor)
    guardar(c, [horario(0)])
    assert guardar(c).status_code == 200
    assert c.get(URL).json()["horarios"] == []


# --- validaciones ---


def test_horarios_del_mismo_dia_no_pueden_cruzarse(tutor):
    r = guardar(
        cliente(tutor), [horario(1, "08:00:00", "10:00:00"), horario(1, "09:00:00", "11:00:00")]
    )
    assert r.status_code == 400


def test_horarios_consecutivos_o_de_otro_dia_si_se_permiten(tutor):
    r = guardar(
        cliente(tutor),
        [horario(1, "08:00:00", "10:00:00"), horario(1, "10:00:00", "12:00:00"), horario(2)],
    )
    assert r.status_code == 200


def test_bloqueos_de_una_fecha_no_pueden_cruzarse(tutor):
    r = guardar(
        cliente(tutor),
        bloqueos=[
            bloqueo("2030-05-06", "09:00:00", "11:00:00"),
            bloqueo("2030-05-06", "10:00:00", "12:00:00"),
        ],
    )
    assert r.status_code == 400


def test_bloqueos_en_fechas_distintas_si_se_permiten(tutor):
    r = guardar(cliente(tutor), bloqueos=[bloqueo("2030-05-06"), bloqueo("2030-05-07")])
    assert r.status_code == 200


@pytest.mark.parametrize(
    "mal",
    [
        horario(0, "12:00:00", "12:00:00"),
        horario(0, "13:00:00", "08:00:00"),
        horario(7),
        horario(-1),
    ],
)
def test_horarios_invalidos_se_rechazan(tutor, mal):
    assert guardar(cliente(tutor), [mal]).status_code == 400


def test_bloqueo_con_fin_anterior_al_inicio_se_rechaza(tutor):
    r = guardar(cliente(tutor), bloqueos=[bloqueo("2030-05-06", "11:00:00", "09:00:00")])
    assert r.status_code == 400


def test_faltan_campos_obligatorios(tutor):
    assert cliente(tutor).put(URL, {}, format="json").status_code == 400


# --- permisos ---


def test_solo_el_tutor_gestiona_su_disponibilidad(coord, estudiante):
    # `coord` ya es un cliente autenticado; `estudiante` es un usuario.
    for c in (coord, cliente(estudiante)):
        assert c.get(URL).status_code == 403
        assert guardar(c, [horario(0)]).status_code == 403


def test_sin_sesion_responde_401():
    from rest_framework.test import APIClient

    assert APIClient().get(URL).status_code == 401
    assert APIClient().put(URL, {}, format="json").status_code == 401


# --- regla: no invalidar sesiones futuras agendadas ---


def test_no_se_puede_quitar_la_disponibilidad_de_una_sesion_futura(tutor, sesion_manana):
    inicio = timezone.localtime(sesion_manana.inicio)
    otro_dia = (inicio.weekday() + 1) % 7
    r = guardar(cliente(tutor), [horario(otro_dia)])
    assert r.status_code == 400
    assert "sesión futura" in str(r.json())


def test_horario_que_cubre_la_sesion_futura_se_acepta(tutor, sesion_manana):
    inicio = timezone.localtime(sesion_manana.inicio)
    r = guardar(cliente(tutor), [horario(inicio.weekday(), "08:00:00", "12:00:00")])
    assert r.status_code == 200


def test_horario_que_no_cubre_toda_la_sesion_se_rechaza(tutor, sesion_manana):
    inicio = timezone.localtime(sesion_manana.inicio)
    # La sesión termina a las 10:50; el horario cierra a las 10:30.
    r = guardar(cliente(tutor), [horario(inicio.weekday(), "08:00:00", "10:30:00")])
    assert r.status_code == 400


def test_un_bloqueo_sobre_la_sesion_futura_se_rechaza(tutor, sesion_manana):
    inicio = timezone.localtime(sesion_manana.inicio)
    r = guardar(
        cliente(tutor),
        [horario(inicio.weekday(), "08:00:00", "12:00:00")],
        [bloqueo(inicio.date().isoformat(), "10:15:00", "10:45:00")],
    )
    assert r.status_code == 400


def test_un_bloqueo_fuera_de_la_sesion_se_acepta(tutor, sesion_manana):
    inicio = timezone.localtime(sesion_manana.inicio)
    r = guardar(
        cliente(tutor),
        [horario(inicio.weekday(), "08:00:00", "12:00:00")],
        [bloqueo(inicio.date().isoformat(), "11:00:00", "12:00:00")],
    )
    assert r.status_code == 200


def test_las_sesiones_canceladas_no_impiden_cambiar_la_disponibilidad(tutor, sesion_manana):
    SesionTutoria.objects.filter(pk=sesion_manana.pk).update(estado=SesionTutoria.Estado.CANCELADA)
    assert guardar(cliente(tutor), []).status_code == 200


def test_las_sesiones_ya_pasadas_no_impiden_cambiar_la_disponibilidad(tutor, sesion_manana):
    ayer = timezone.now() - timedelta(days=2)
    SesionTutoria.objects.filter(pk=sesion_manana.pk).update(
        inicio=ayer, fin=ayer + timedelta(minutes=50)
    )
    assert guardar(cliente(tutor), []).status_code == 200
