"""EP-04: actividades del plan, cierre, seguimiento en curso y consulta por estado."""

# ruff: noqa: F401, F811  (las fixtures compartidas se importan de test_planes)

import datetime

import pytest
from django.utils import timezone

from academico.models import DiaNoHabil
from planes.models import ActividadPlan, PlanRefuerzo

from .test_planes import (
    asignar,
    cliente,
    coord,
    crear,
    crear_plan,
    estudiante,
    habil,
    matematicas,
    periodo,
    tutor_elegible,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def plan_asignado(coord, estudiante, matematicas):
    tutor = tutor_elegible("t@colegio.edu.co", matematicas)
    plan = crear_plan(coord, estudiante, matematicas)
    asignar(coord, plan, tutor)
    return {"id": plan["id"], "tutor": tutor}


DATOS_CIERRE = {"valoracion": "Alcanzó los desempeños.", "nota_final": "4.0"}


def actividad(titulo="Taller de fracciones", dias=5, **extra):
    return {"titulo": titulo, "fecha_limite": habil(dias).isoformat(), **extra}


def agregar(c, plan_id, **extra):
    r = c.post(f"/api/planes/{plan_id}/actividades/", actividad(**extra), format="json")
    assert r.status_code == 201, r.json()
    return r.json()


# ------------------------------------------------------------------ actividades


def test_tutor_responsable_agrega_actividades(plan_asignado):
    c = cliente(plan_asignado["tutor"])
    nueva = agregar(c, plan_asignado["id"], titulo="  Taller  ", descripcion="Página 12")

    assert nueva["titulo"] == "Taller"
    assert nueva["completada"] is False
    assert nueva["vencida"] is False
    assert c.get(f"/api/planes/{plan_asignado['id']}/actividades/").json()[0]["id"] == nueva["id"]


def test_coordinacion_tambien_agrega(coord, plan_asignado):
    agregar(coord, plan_asignado["id"])


def test_estudiante_ve_pero_no_modifica(estudiante, plan_asignado, coord):
    nueva = agregar(coord, plan_asignado["id"])
    est = cliente(estudiante)

    assert len(est.get(f"/api/planes/{plan_asignado['id']}/actividades/").json()) == 1
    r = est.post(f"/api/planes/{plan_asignado['id']}/actividades/", actividad(), format="json")
    assert r.status_code == 403
    r = est.patch(f"/api/actividades/{nueva['id']}/", {"completada": True}, format="json")
    assert r.status_code == 403


def test_otro_tutor_o_estudiante_no_ve_el_plan(plan_asignado, matematicas):
    otro_tutor = tutor_elegible("otro@colegio.edu.co", matematicas)
    ajeno = crear("ajeno@colegio.edu.co")
    for usuario in (otro_tutor, ajeno):
        c = cliente(usuario)
        assert c.get(f"/api/planes/{plan_asignado['id']}/seguimiento/").status_code == 404
        assert c.get(f"/api/planes/{plan_asignado['id']}/actividades/").status_code == 404
        r = c.post(f"/api/planes/{plan_asignado['id']}/actividades/", actividad(), format="json")
        assert r.status_code == 404


@pytest.mark.parametrize(
    ("extra", "campo"),
    [
        ({"titulo": "   "}, "titulo"),
        ({"titulo": "x" * 121}, "titulo"),
        ({"descripcion": "x" * 501}, "descripcion"),
        ({"fecha_limite": "2026-02-30"}, "fecha_limite"),
    ],
)
def test_actividad_invalida(coord, plan_asignado, extra, campo):
    r = coord.post(
        f"/api/planes/{plan_asignado['id']}/actividades/", actividad(**extra), format="json"
    )
    assert r.status_code == 400
    assert campo in r.json()["error"]["details"]


def test_fecha_limite_dentro_del_plan_y_en_dia_habil(coord, plan_asignado):
    plan = PlanRefuerzo.objects.get(pk=plan_asignado["id"])
    fuera = (plan.fecha_fin + datetime.timedelta(days=3)).isoformat()
    r = coord.post(
        f"/api/planes/{plan_asignado['id']}/actividades/",
        {"titulo": "x", "fecha_limite": fuera},
        format="json",
    )
    assert "fecha_limite" in r.json()["error"]["details"]

    sabado = plan.fecha_inicio
    while sabado.weekday() != 5:
        sabado += datetime.timedelta(days=1)
    r = coord.post(
        f"/api/planes/{plan_asignado['id']}/actividades/",
        {"titulo": "x", "fecha_limite": sabado.isoformat()},
        format="json",
    )
    assert "no es un día hábil" in r.json()["error"]["details"]["fecha_limite"][0]

    festivo = habil(8)
    DiaNoHabil.objects.create(fecha=festivo, descripcion="Festivo")
    r = coord.post(
        f"/api/planes/{plan_asignado['id']}/actividades/",
        {"titulo": "x", "fecha_limite": festivo.isoformat()},
        format="json",
    )
    assert r.status_code == 400


def test_no_se_agregan_actividades_a_un_plan_sin_tutor(coord, estudiante, matematicas):
    plan = crear_plan(coord, estudiante, matematicas)
    r = coord.post(f"/api/planes/{plan['id']}/actividades/", actividad(), format="json")
    assert r.status_code == 400


def test_completar_y_reabrir_guarda_la_fecha(plan_asignado):
    c = cliente(plan_asignado["tutor"])
    nueva = agregar(c, plan_asignado["id"])

    r = c.patch(f"/api/actividades/{nueva['id']}/", {"completada": True}, format="json")
    assert r.json()["completada"] is True
    assert r.json()["fecha_completada"] is not None

    r = c.patch(f"/api/actividades/{nueva['id']}/", {"completada": False}, format="json")
    assert r.json()["fecha_completada"] is None


def test_editar_actividad(plan_asignado):
    c = cliente(plan_asignado["tutor"])
    nueva = agregar(c, plan_asignado["id"])
    r = c.patch(f"/api/actividades/{nueva['id']}/", {"titulo": "Nuevo"}, format="json")
    assert r.json()["titulo"] == "Nuevo"


# ------------------------------------------------------------------ progreso y seguimiento


def test_seguimiento_calcula_progreso_y_atraso(coord, plan_asignado):
    sin = coord.get(f"/api/planes/{plan_asignado['id']}/seguimiento/").json()
    assert sin["progreso"] is None  # sin actividades no se inventa un 0 %
    assert sin["atrasado"] is False

    a = agregar(coord, plan_asignado["id"], titulo="Una", dias=3)
    agregar(coord, plan_asignado["id"], titulo="Dos", dias=6)
    coord.patch(f"/api/actividades/{a['id']}/", {"completada": True}, format="json")

    datos = coord.get(f"/api/planes/{plan_asignado['id']}/seguimiento/").json()
    assert datos["actividades_total"] == 2
    assert datos["actividades_completadas"] == 1
    assert datos["progreso"] == 50.0
    assert datos["puede_gestionar"] is True
    assert [x["titulo"] for x in datos["actividades"]] == ["Dos", "Una"]  # pendientes primero

    ActividadPlan.objects.filter(titulo="Dos").update(
        fecha_limite=timezone.localdate() - datetime.timedelta(days=1)
    )
    datos = coord.get(f"/api/planes/{plan_asignado['id']}/seguimiento/").json()
    assert datos["atrasado"] is True
    assert datos["actividades"][0]["vencida"] is True


def test_estudiante_ve_su_seguimiento_sin_poder_gestionar(estudiante, plan_asignado):
    datos = cliente(estudiante).get(f"/api/planes/{plan_asignado['id']}/seguimiento/").json()
    assert datos["puede_gestionar"] is False


# ------------------------------------------------------------------ cierre


def test_cerrar_sin_actividades_pendientes(plan_asignado):
    c = cliente(plan_asignado["tutor"])
    a = agregar(c, plan_asignado["id"])
    c.patch(f"/api/actividades/{a['id']}/", {"completada": True}, format="json")

    r = c.post(
        f"/api/planes/{plan_asignado['id']}/cerrar/",
        {"valoracion": " Logrado ", "nota_final": "4.2"},
        format="json",
    )

    assert r.status_code == 200, r.json()
    assert r.json()["estado"] == "cerrado"
    assert r.json()["fecha_cierre"] == timezone.localdate().isoformat()
    assert r.json()["nota_cierre"] == "Logrado"
    assert r.json()["nota_final"] == "4.20"
    assert r.json()["resultado"] == "logrado"  # deducido de la nota aprobatoria


def test_cerrar_con_pendientes_exige_confirmacion(plan_asignado):
    docente = cliente(plan_asignado["tutor"])
    agregar(docente, plan_asignado["id"])
    r = docente.post(f"/api/planes/{plan_asignado['id']}/cerrar/", DATOS_CIERRE, format="json")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "actividades_pendientes"

    r = docente.post(
        f"/api/planes/{plan_asignado['id']}/cerrar/",
        {**DATOS_CIERRE, "resultado": "parcial", "forzar": True},
        format="json",
    )
    assert r.json()["estado"] == "cerrado"


def test_plan_cerrado_ya_no_cambia(coord, plan_asignado):
    docente = cliente(plan_asignado["tutor"])
    a = agregar(docente, plan_asignado["id"])
    docente.post(
        f"/api/planes/{plan_asignado['id']}/cerrar/",
        {**DATOS_CIERRE, "forzar": True},
        format="json",
    )

    assert (
        docente.post(
            f"/api/planes/{plan_asignado['id']}/cerrar/", DATOS_CIERRE, format="json"
        ).status_code
        == 400
    )
    assert (
        coord.patch(f"/api/actividades/{a['id']}/", {"completada": True}, format="json").status_code
        == 400
    )
    r = coord.post(f"/api/planes/{plan_asignado['id']}/actividades/", actividad(), format="json")
    assert r.status_code == 400


def test_solo_el_docente_responsable_cierra(coord, estudiante, matematicas, plan_asignado):
    cierre = f"/api/planes/{plan_asignado['id']}/cerrar/"
    for quien in (cliente(estudiante), coord):
        assert quien.post(cierre, DATOS_CIERRE, format="json").status_code == 403
    ajeno = cliente(tutor_elegible("otro@colegio.edu.co", matematicas))
    assert ajeno.post(cierre, DATOS_CIERRE, format="json").status_code == 404
    assert PlanRefuerzo.objects.get().estado == "asignado"


def test_plan_pendiente_no_se_cierra(coord, estudiante, matematicas):
    plan = crear_plan(coord, estudiante, matematicas)
    # Sin docente asignado nadie puede cerrarlo: coordinación solo verifica.
    r = coord.post(f"/api/planes/{plan['id']}/cerrar/", DATOS_CIERRE, format="json")
    assert r.status_code == 403


# ------------------------------------------------------------------ consulta por estado


def test_listado_trae_resumen_por_estado_y_progreso(coord, estudiante, matematicas, plan_asignado):
    otra = crear("otra@colegio.edu.co")
    from academico.models import Matricula

    Matricula.objects.create(
        estudiante=otra,
        periodo=PlanRefuerzo.objects.get().periodo,
        grupo=Matricula.objects.get(estudiante=estudiante).grupo,
    )
    crear_plan(coord, otra, matematicas)  # pendiente
    agregar(coord, plan_asignado["id"])

    todos = coord.get("/api/planes/").json()
    assert todos["resumen"] == {"pendiente": 1, "asignado": 1, "cerrado": 0, "cancelado": 0}
    asignados = coord.get("/api/planes/?estado=asignado").json()
    assert asignados["count"] == 1
    assert asignados["resumen"]["pendiente"] == 1  # el resumen no depende del filtro de estado
    assert asignados["results"][0]["actividades_total"] == 1
    assert asignados["results"][0]["progreso"] == 0.0


def test_filtro_de_atrasados(coord, plan_asignado):
    assert coord.get("/api/planes/?atrasado=1").json()["count"] == 0
    ayer = timezone.localdate() - datetime.timedelta(days=1)
    PlanRefuerzo.objects.update(fecha_inicio=ayer - datetime.timedelta(days=5), fecha_fin=ayer)
    assert coord.get("/api/planes/?atrasado=1").json()["count"] == 1
    assert coord.get("/api/planes/?estado=otro").status_code == 400
