"""Cierre con valoración y nota (1,0–5,0), contadores, bloqueo y consulta del estudiante."""

# ruff: noqa: F401, F811  (las fixtures compartidas se importan de test_planes)
import datetime

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from academico.models import Matricula
from planes.models import PlanRefuerzo

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
from .test_planes_seguimiento import actividad, agregar, plan_asignado

pytestmark = pytest.mark.django_db


VALORACION = {"valoracion": "Buen trabajo", "nota_final": "4.0"}


def cerrar(c, plan_id, **datos):
    return c.post(f"/api/planes/{plan_id}/cerrar/", datos, format="json")


# ------------------------------------------------------------------ cierre con nota y resultado


def test_valoracion_y_nota_son_obligatorias_y_el_resultado_valido(plan_asignado):
    docente = cliente(plan_asignado["tutor"])
    r = cerrar(docente, plan_asignado["id"])
    assert r.status_code == 400
    assert {"valoracion", "nota_final"} <= set(r.json()["error"]["details"])
    r = cerrar(docente, plan_asignado["id"], resultado="excelente", **VALORACION)
    assert r.status_code == 400
    assert "resultado" in r.json()["error"]["details"]
    assert PlanRefuerzo.objects.get().estado == "asignado"


@pytest.mark.parametrize("resultado", ["logrado", "parcial", "no_logrado"])
def test_cierra_con_cada_resultado(plan_asignado, resultado):
    docente = cliente(plan_asignado["tutor"])
    r = cerrar(
        docente,
        plan_asignado["id"],
        resultado=resultado,
        **{**VALORACION, "valoracion": " Buen trabajo "},
    )

    assert r.status_code == 200, r.json()
    assert r.json()["estado"] == "cerrado"
    assert r.json()["resultado"] == resultado
    assert r.json()["nota_cierre"] == "Buen trabajo"
    assert r.json()["nota_final"] == "4.00"
    assert r.json()["fecha_cierre"] == timezone.localdate().isoformat()


@pytest.mark.parametrize(("nota", "esperado"), [("2.9", "no_logrado"), ("3.0", "logrado")])
def test_el_resultado_se_deduce_de_la_nota_aprobatoria(plan_asignado, nota, esperado):
    r = cerrar(
        cliente(plan_asignado["tutor"]), plan_asignado["id"], valoracion="x", nota_final=nota
    )
    assert r.status_code == 200, r.json()
    assert r.json()["resultado"] == esperado


@pytest.mark.parametrize("nota", ["0.9", "5.1", "-1", "abc"])
def test_la_nota_debe_estar_entre_1_y_5(plan_asignado, nota):
    r = cerrar(
        cliente(plan_asignado["tutor"]), plan_asignado["id"], valoracion="x", nota_final=nota
    )
    assert r.status_code == 400
    assert "nota_final" in r.json()["error"]["details"]
    assert PlanRefuerzo.objects.get().estado == "asignado"


def test_la_valoracion_tiene_limite(plan_asignado):
    r = cerrar(
        cliente(plan_asignado["tutor"]), plan_asignado["id"], valoracion="x" * 501, nota_final="4"
    )
    assert r.status_code == 400
    assert "valoracion" in r.json()["error"]["details"]


def test_la_base_impide_un_plan_cerrado_sin_resultado(plan_asignado):
    with pytest.raises(IntegrityError), transaction.atomic():
        PlanRefuerzo.objects.filter(pk=plan_asignado["id"]).update(estado="cerrado")


# ------------------------------------------------------------------ bloqueo tras el cierre


def test_un_plan_cerrado_queda_bloqueado(coord, estudiante, matematicas, plan_asignado):
    a = agregar(coord, plan_asignado["id"])
    otro = tutor_elegible("otro@colegio.edu.co", matematicas)
    cerrar(cliente(plan_asignado["tutor"]), plan_asignado["id"], forzar=True, **VALORACION)
    pid = plan_asignado["id"]

    assert PlanRefuerzo.objects.get().admite_cambios is False
    r = coord.post(f"/api/planes/{pid}/actividades/", actividad(), format="json")
    assert r.status_code == 400
    assert (
        coord.patch(f"/api/actividades/{a['id']}/", {"completada": True}, format="json").status_code
        == 400
    )
    assert (
        coord.patch(f"/api/planes/{pid}/", {"objetivos": "Otro"}, format="json").status_code == 400
    )
    assert asignar(coord, {"id": pid}, otro).status_code == 400
    assert coord.post(f"/api/planes/{pid}/cancelar/").status_code == 400
    assert cerrar(cliente(plan_asignado["tutor"]), pid, **VALORACION).status_code == 400
    # El plan sigue consultable.
    assert coord.get(f"/api/planes/{pid}/seguimiento/").status_code == 200


def test_el_tutor_responsable_tambien_queda_bloqueado(plan_asignado):
    c = cliente(plan_asignado["tutor"])
    cerrar(c, plan_asignado["id"], resultado="parcial", forzar=True, **VALORACION)

    r = c.post(f"/api/planes/{plan_asignado['id']}/actividades/", actividad(), format="json")
    assert r.status_code == 400


# ------------------------------------------------------------------ contadores


def _plan_cerrado(estudiante, periodo, asignatura, tutor, resultado):
    return PlanRefuerzo.objects.create(
        estudiante=estudiante,
        periodo=periodo,
        asignatura=asignatura,
        objetivos="x",
        fecha_inicio=habil(1),
        fecha_fin=habil(9),
        estado="cerrado",
        tutor=tutor,
        resultado=resultado,
        fecha_cierre=timezone.localdate(),
    )


def test_contadores_en_cero_sin_inventar_la_tasa(coord):
    datos = coord.get("/api/planes/contadores/").json()
    assert datos["total"] == 0
    assert datos["en_curso"] == 0
    assert datos["tasa_recuperacion"] is None  # sin cerrados no hay tasa, no 0 %


def test_contadores_y_recuperados(coord, estudiante, matematicas, periodo, plan_asignado):
    tutor = plan_asignado["tutor"]
    grupo = Matricula.objects.get(estudiante=estudiante).grupo
    for i, resultado in enumerate(["logrado", "logrado", "parcial", "no_logrado"]):
        otro = crear(f"e{i}@colegio.edu.co")
        Matricula.objects.create(estudiante=otro, periodo=periodo, grupo=grupo)
        _plan_cerrado(otro, periodo, matematicas, tutor, resultado)
    pendiente = crear("pend@colegio.edu.co")
    Matricula.objects.create(estudiante=pendiente, periodo=periodo, grupo=grupo)
    crear_plan(coord, pendiente, matematicas)
    PlanRefuerzo.objects.filter(pk=plan_asignado["id"]).update(
        fecha_inicio=habil(1) - datetime.timedelta(days=9),
        fecha_fin=timezone.localdate() - datetime.timedelta(days=1),
    )

    datos = coord.get("/api/planes/contadores/").json()

    assert datos["periodo"] == periodo.pk
    assert datos["total"] == 6
    assert datos["pendientes"] == 1
    assert datos["en_curso"] == 1
    assert datos["atrasados"] == 1
    assert datos["cerrados"] == 4
    assert datos["recuperados"] == 2
    assert datos["parciales"] == 1
    assert datos["no_logrados"] == 1
    assert datos["tasa_recuperacion"] == 50.0


def test_contadores_solo_para_coordinacion_y_filtro_invalido(estudiante, plan_asignado, coord):
    assert cliente(estudiante).get("/api/planes/contadores/").status_code == 403
    assert cliente(plan_asignado["tutor"]).get("/api/planes/contadores/").status_code == 403
    assert coord.get("/api/planes/contadores/?periodo=abc").status_code == 400


# ------------------------------------------------------------------ consulta del estudiante


def test_el_estudiante_consulta_solo_su_plan_con_el_resultado(estudiante, plan_asignado):
    cerrar(
        cliente(plan_asignado["tutor"]),
        plan_asignado["id"],
        resultado="logrado",
        valoracion="Superado",
        nota_final="4.5",
    )
    est = cliente(estudiante)

    propios = est.get("/api/mis-planes/").json()
    assert [p["resultado"] for p in propios] == ["logrado"]
    detalle = est.get(f"/api/planes/{plan_asignado['id']}/seguimiento/").json()
    assert detalle["nota_cierre"] == "Superado"
    assert detalle["puede_gestionar"] is False

    ajeno = cliente(crear("ajeno@colegio.edu.co"))
    assert ajeno.get("/api/mis-planes/").json() == []
    assert ajeno.get(f"/api/planes/{plan_asignado['id']}/seguimiento/").status_code == 404
    assert est.get("/api/planes/").status_code == 403  # no ve el listado general
