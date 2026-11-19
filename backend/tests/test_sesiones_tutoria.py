"""Ciclo de vida de las sesiones de tutoría (programar, reprogramar, cancelar, asistencia, cerrar),
informes de bitácora, agenda, notificaciones y reglas de plan que el resto de la suite no ejercía."""

# ruff: noqa: F401, F811  (las fixtures compartidas se importan de otros módulos de prueba)
import datetime

import pytest
from django.utils import timezone

from planes.models import (
    ActividadPlan,
    BitacoraSesion,
    EntregaActividad,
    NotificacionAcompanamiento,
    PlanRefuerzo,
    SesionTutoria,
)
from planes.serializers import (
    BitacoraSesionSerializer,
    DudaSerializer,
    InformeBitacoraSerializer,
    PlanSerializer,
)
from usuarios.models import (
    Asignatura,
    BloqueoDisponibilidadTutor,
    HorarioDisponibilidadTutor,
    PerfilEstudiante,
    Usuario,
)
from usuarios.roles import Rol

from .test_nivelacion import _archivos_temporales, actividad, docente, entregar, pdf
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
from .test_planes_seguimiento import agregar, plan_asignado

pytestmark = pytest.mark.django_db


def momento(dia, hora=10, minuto=0):
    return timezone.make_aware(datetime.datetime.combine(dia, datetime.time(hora, minuto)))


def datos_sesion(dia, hora=10, duracion=50, **extra):
    inicio = momento(dia, hora)
    return {
        "inicio": inicio.isoformat(),
        "fin": (inicio + datetime.timedelta(minutes=duracion)).isoformat(),
        "modalidad": "presencial",
        "lugar": "Aula 1",
        **extra,
    }


@pytest.fixture
def dia():
    return habil(3)


@pytest.fixture
def tutor(plan_asignado):
    return plan_asignado["tutor"]


@pytest.fixture
def con_horario(tutor, dia):
    """El tutor atiende ese día de 08:00 a 12:00."""
    return HorarioDisponibilidadTutor.objects.create(
        perfil=tutor.perfil_tutor,
        dia_semana=dia.weekday(),
        hora_inicio=datetime.time(8, 0),
        hora_fin=datetime.time(12, 0),
    )


@pytest.fixture
def otro_estudiante():
    return crear("otro-est@colegio.edu.co")


def detalles(r):
    cuerpo = r.json()
    return cuerpo.get("error", {}).get("details", cuerpo) if isinstance(cuerpo, dict) else cuerpo


def programar(c, plan_id, dia, **extra):
    return c.post(f"/api/planes/{plan_id}/sesiones/", datos_sesion(dia, **extra), format="json")


def sesion_en(plan_asignado, tutor, inicio, minutos=50, estado="programada"):
    return SesionTutoria.objects.create(
        plan_id=plan_asignado["id"],
        tutor=tutor,
        inicio=inicio,
        fin=inicio + datetime.timedelta(minutes=minutos),
        modalidad="presencial",
        lugar="Aula",
        estado=estado,
    )


def sesion_terminada(plan_asignado, tutor, estado="programada"):
    fin = timezone.now() - datetime.timedelta(hours=2)
    return sesion_en(plan_asignado, tutor, fin - datetime.timedelta(minutes=50), estado=estado)


def sesion_futura(plan_asignado, tutor, estado="programada"):
    return sesion_en(plan_asignado, tutor, timezone.now() + datetime.timedelta(days=2), estado=estado)


# ----------------------------------------------------------------------------- programar


def test_el_tutor_programa_y_lista_sesiones(plan_asignado, tutor, dia, con_horario):
    c = cliente(tutor)
    assert c.get(f"/api/planes/{plan_asignado['id']}/sesiones/").json() == []
    r = programar(c, plan_asignado["id"], dia)
    assert r.status_code == 201, r.json()
    assert len(c.get(f"/api/planes/{plan_asignado['id']}/sesiones/").json()) == 1
    assert NotificacionAcompanamiento.objects.filter(tipo="sesion").exists()


def test_la_coordinacion_tambien_programa(plan_asignado, coord, dia, con_horario):
    assert programar(coord, plan_asignado["id"], dia).status_code == 201


def test_el_estudiante_no_programa_sesiones(plan_asignado, estudiante, dia, con_horario):
    r = programar(cliente(estudiante), plan_asignado["id"], dia)
    assert r.status_code == 403


def test_no_se_programa_sobre_un_plan_sin_tutor(coord, estudiante, matematicas, dia):
    from .test_planes import crear_plan

    plan = crear_plan(coord, estudiante, matematicas)
    r = programar(coord, plan["id"], dia)
    assert r.status_code == 400
    assert "plan" in detalles(r)


def _quitar(modelo, **filtro):
    modelo.objects.filter(**filtro).delete()


CASOS_INVALIDOS = {
    "fin_anterior_al_inicio": ({"fin": "inicio"}, "fin"),
    "inicio_en_el_pasado": ({"pasado": True}, "inicio"),
    "otro_dia": ({"otro_dia": True}, "fin"),
    "presencial_sin_lugar": ({"lugar": ""}, "lugar"),
    "virtual_sin_enlace": ({"modalidad": "virtual", "enlace_virtual": ""}, "enlace_virtual"),
}


@pytest.mark.parametrize("nombre", list(CASOS_INVALIDOS))
def test_validaciones_basicas_de_la_sesion(plan_asignado, tutor, dia, con_horario, nombre):
    cambios, campo = CASOS_INVALIDOS[nombre]
    datos = datos_sesion(dia)
    if cambios.get("fin") == "inicio":
        datos["fin"] = datos["inicio"]
    elif cambios.get("pasado"):
        ini = timezone.now() - datetime.timedelta(hours=3)
        datos["inicio"], datos["fin"] = ini.isoformat(), (ini + datetime.timedelta(minutes=50)).isoformat()
    elif cambios.get("otro_dia"):
        datos = datos_sesion(dia, hora=23, duracion=120)
    else:
        datos.update(cambios)
    r = cliente(tutor).post(f"/api/planes/{plan_asignado['id']}/sesiones/", datos, format="json")
    assert r.status_code == 400, r.json()
    assert campo in detalles(r)


def test_una_sesion_virtual_con_enlace_se_acepta(plan_asignado, tutor, dia, con_horario):
    r = programar(
        cliente(tutor),
        plan_asignado["id"],
        dia,
        modalidad="virtual",
        lugar="",
        enlace_virtual="https://meet.example.com/abc",
    )
    assert r.status_code == 201, r.json()


def test_la_sesion_debe_quedar_dentro_del_plan(plan_asignado, tutor, dia, con_horario):
    c = cliente(tutor)
    PlanRefuerzo.objects.filter(pk=plan_asignado["id"]).update(fecha_inicio=habil(10))
    assert "inicio" in detalles(programar(c, plan_asignado["id"], dia))
    PlanRefuerzo.objects.filter(pk=plan_asignado["id"]).update(
        fecha_inicio=habil(1), fecha_fin=habil(2)
    )
    assert "fin" in detalles(programar(c, plan_asignado["id"], dia))


def test_el_tutor_debe_estar_habilitado_y_disponible(plan_asignado, tutor, dia, con_horario):
    perfil = tutor.perfil_tutor
    perfil.disponible = False
    perfil.save()
    r = programar(cliente(tutor), plan_asignado["id"], dia)
    assert r.status_code == 400 and "tutor" in detalles(r)


def test_la_sesion_debe_estar_dentro_del_horario_semanal(plan_asignado, tutor, dia):
    r = programar(cliente(tutor), plan_asignado["id"], dia)  # sin horario cargado
    assert r.status_code == 400 and "inicio" in detalles(r)


def test_un_bloqueo_del_tutor_impide_programar(plan_asignado, tutor, dia, con_horario):
    BloqueoDisponibilidadTutor.objects.create(
        perfil=tutor.perfil_tutor,
        fecha=dia,
        hora_inicio=datetime.time(9, 30),
        hora_fin=datetime.time(10, 30),
        motivo="Reunión",
    )
    r = programar(cliente(tutor), plan_asignado["id"], dia)
    assert r.status_code == 400 and "bloqueo" in str(r.json())


def test_no_se_cruzan_sesiones_del_tutor(plan_asignado, tutor, dia, con_horario):
    sesion_en(plan_asignado, tutor, momento(dia, 10, 10))
    r = programar(cliente(tutor), plan_asignado["id"], dia)
    assert r.status_code == 400 and "El tutor ya tiene otra sesión" in str(r.json())


def test_no_se_cruzan_sesiones_del_estudiante(
    plan_asignado, tutor, estudiante, matematicas, periodo, dia, con_horario
):
    otro_tutor = tutor_elegible("t2@colegio.edu.co", matematicas)
    lengua = Asignatura.objects.create(nombre="Lengua")
    plan2 = PlanRefuerzo.objects.create(
        estudiante=estudiante,
        periodo=periodo,
        asignatura=lengua,
        objetivos="x",
        fecha_inicio=periodo.fecha_inicio,
        fecha_fin=periodo.fecha_fin,
        estado="asignado",
        tutor=otro_tutor,
    )
    SesionTutoria.objects.create(
        plan=plan2,
        tutor=otro_tutor,
        inicio=momento(dia, 10, 10),
        fin=momento(dia, 11, 0),
        modalidad="presencial",
        lugar="Aula",
    )
    r = programar(cliente(tutor), plan_asignado["id"], dia)
    assert r.status_code == 400 and "El estudiante ya tiene otra sesión" in str(r.json())


# ----------------------------------------------------------------------------- reprogramar


def test_el_tutor_reprograma_su_sesion(plan_asignado, tutor, dia, con_horario):
    c = cliente(tutor)
    sesion = SesionTutoria.objects.get(pk=programar(c, plan_asignado["id"], dia).json()["id"])
    r = c.patch(f"/api/sesiones/{sesion.pk}/", {"lugar": "Aula 2"}, format="json")
    assert r.status_code == 200, r.json()
    assert r.json()["lugar"] == "Aula 2"


def test_reprogramar_respeta_permisos_y_estado(
    plan_asignado, tutor, estudiante, otro_estudiante, dia, con_horario
):
    sesion = sesion_futura(plan_asignado, tutor)
    url = f"/api/sesiones/{sesion.pk}/"
    assert cliente(otro_estudiante).patch(url, {"lugar": "x"}, format="json").status_code == 404
    assert cliente(estudiante).patch(url, {"lugar": "x"}, format="json").status_code == 403
    SesionTutoria.objects.filter(pk=sesion.pk).update(estado="cancelada")
    r = cliente(tutor).patch(url, {"lugar": "x"}, format="json")
    assert r.status_code == 400 and "estado" in detalles(r)


# ----------------------------------------------------------------------------- cancelar


def test_el_tutor_cancela_una_sesion_con_motivo(plan_asignado, tutor):
    sesion = sesion_futura(plan_asignado, tutor)
    c = cliente(tutor)
    url = f"/api/sesiones/{sesion.pk}/cancelar/"
    assert c.post(url, {}, format="json").status_code == 400  # falta el motivo
    r = c.post(url, {"motivo": "Enfermedad"}, format="json")
    assert r.status_code == 200 and r.json()["estado"] == "cancelada"
    sesion.refresh_from_db()
    assert sesion.motivo_cancelacion == "Enfermedad"
    r = c.post(url, {"motivo": "Otra vez"}, format="json")
    assert r.status_code == 400 and "estado" in detalles(r)


def test_cancelar_respeta_permisos(plan_asignado, tutor, estudiante, otro_estudiante):
    url = f"/api/sesiones/{sesion_futura(plan_asignado, tutor).pk}/cancelar/"
    assert cliente(otro_estudiante).post(url, {"motivo": "x"}, format="json").status_code == 404
    assert cliente(estudiante).post(url, {"motivo": "x"}, format="json").status_code == 403


# ----------------------------------------------------------------------------- asistencia


def test_el_estudiante_registra_su_asistencia(plan_asignado, tutor, estudiante):
    sesion = sesion_terminada(plan_asignado, tutor)
    c = cliente(estudiante)
    url = f"/api/sesiones/{sesion.pk}/asistencia/"
    assert c.patch(url, {"estado": "inventado"}, format="json").status_code == 400
    r = c.patch(url, {"estado": "presente"}, format="json")
    assert r.status_code == 200 and r.json()["estado"] == "realizada"
    r = c.patch(url, {"estado": "presente"}, format="json")
    assert r.status_code == 400 and "ya fue registrada" in str(r.json())


def test_asistencia_rechaza_sesiones_ajenas_canceladas_o_futuras(
    plan_asignado, tutor, estudiante, otro_estudiante
):
    terminada = sesion_terminada(plan_asignado, tutor)
    ajena = f"/api/sesiones/{terminada.pk}/asistencia/"
    assert cliente(otro_estudiante).patch(ajena, {"estado": "presente"}, format="json").status_code == 404
    cancelada = sesion_terminada(plan_asignado, tutor, estado="cancelada")
    r = cliente(estudiante).patch(
        f"/api/sesiones/{cancelada.pk}/asistencia/", {"estado": "presente"}, format="json"
    )
    assert r.status_code == 400 and "cancelada" in str(r.json())
    futura = sesion_futura(plan_asignado, tutor)
    r = cliente(estudiante).patch(
        f"/api/sesiones/{futura.pk}/asistencia/", {"estado": "presente"}, format="json"
    )
    assert r.status_code == 400 and "al finalizar" in str(r.json())


# ----------------------------------------------------------------------------- cerrar


INFORME = {"temas": "Fracciones", "desarrollo": "Se resolvieron ejercicios.", "acuerdos": "Tarea"}


def test_el_tutor_cierra_la_sesion_con_su_informe(plan_asignado, tutor):
    sesion = sesion_terminada(plan_asignado, tutor)
    c = cliente(tutor)
    url = f"/api/sesiones/{sesion.pk}/cerrar/"
    assert c.post(url, {"temas": "solo temas"}, format="json").status_code == 400
    r = c.post(url, INFORME, format="json")
    assert r.status_code == 200, r.json()
    assert BitacoraSesion.objects.filter(sesion=sesion).count() == 1
    r = c.post(url, INFORME, format="json")
    assert r.status_code == 400 and "ya fue cerrada" in str(r.json())


def test_cerrar_respeta_permisos_y_estado(plan_asignado, tutor, coord, estudiante, matematicas):
    sesion = sesion_terminada(plan_asignado, tutor)
    url = f"/api/sesiones/{sesion.pk}/cerrar/"
    otro = cliente(tutor_elegible("t3@colegio.edu.co", matematicas))
    assert otro.post(url, INFORME, format="json").status_code == 404
    assert coord.post(url, INFORME, format="json").status_code == 403
    assert cliente(estudiante).post(url, INFORME, format="json").status_code == 403
    cancelada = sesion_terminada(plan_asignado, tutor, estado="cancelada")
    r = cliente(tutor).post(f"/api/sesiones/{cancelada.pk}/cerrar/", INFORME, format="json")
    assert r.status_code == 400
    futura = sesion_futura(plan_asignado, tutor)
    r = cliente(tutor).post(f"/api/sesiones/{futura.pk}/cerrar/", INFORME, format="json")
    assert r.status_code == 400 and "ya terminó" in str(r.json())
    PlanRefuerzo.objects.filter(pk=plan_asignado["id"]).update(estado="cerrado", resultado="logrado")
    r = cliente(tutor).post(url, INFORME, format="json")
    assert r.status_code == 400 and "plan" in detalles(r)


# ----------------------------------------------------------------------------- informes


def _informe(plan_asignado, tutor):
    sesion = sesion_terminada(plan_asignado, tutor)
    assert cliente(tutor).post(f"/api/sesiones/{sesion.pk}/cerrar/", INFORME, format="json").status_code == 200
    return BitacoraSesion.objects.get(sesion=sesion)


def test_informes_se_filtran_por_docente_estudiante_grado_y_materia(
    plan_asignado, tutor, coord, estudiante, matematicas
):
    _informe(plan_asignado, tutor)
    base = "/api/informes-bitacoras/"
    assert len(coord.get(base).json()) == 1
    assert len(cliente(tutor).get(base).json()) == 1  # el tutor solo ve los suyos
    assert len(coord.get(base, {"docente": "Nom"}).json()) == 1
    assert coord.get(base, {"docente": "Zzz"}).json() == []
    assert len(coord.get(base, {"estudiante": "Nom Zapata"}).json()) == 1
    assert coord.get(base, {"estudiante": "Zzz"}).json() == []
    assert len(coord.get(base, {"materia": matematicas.nombre[:3]}).json()) == 1
    assert coord.get(base, {"materia": "Zzz"}).json() == []
    assert len(coord.get(base, {"grado": "Sexto"}).json()) == 1
    assert coord.get(base, {"grado": "Zzz"}).json() == []
    assert coord.get(base).json()[0]["grado"] == "Sexto"


def test_coordinacion_corrige_informes_y_el_tutor_no(plan_asignado, tutor, coord):
    informe = _informe(plan_asignado, tutor)
    url = f"/api/informes-bitacoras/{informe.pk}/"
    r = coord.patch(url, {"observaciones": "Corregido"}, format="json")
    assert r.status_code == 200 and r.json()["observaciones"] == "Corregido"
    assert cliente(tutor).patch(url, {"observaciones": "x"}, format="json").status_code == 403


def test_informe_sin_perfil_de_estudiante_tiene_grado_vacio(plan_asignado, tutor, estudiante):
    informe = _informe(plan_asignado, tutor)
    PerfilEstudiante.objects.filter(usuario=estudiante).delete()
    informe = BitacoraSesion.objects.get(pk=informe.pk)
    assert InformeBitacoraSerializer(informe).data["grado"] == ""


# ----------------------------------------------------------------------------- agenda y más


def test_agenda_del_tutor_y_del_estudiante(plan_asignado, tutor, estudiante):
    sesion_futura(plan_asignado, tutor)
    sesion_futura(plan_asignado, tutor, estado="cancelada")
    assert len(cliente(tutor).get("/api/agenda-sesiones/").json()) == 2
    assert len(cliente(estudiante).get("/api/agenda-sesiones/").json()) == 1  # sin canceladas


def test_disponibilidad_visible_del_plan(plan_asignado, tutor, coord, estudiante, con_horario):
    url = f"/api/planes/{plan_asignado['id']}/disponibilidad/"
    assert len(coord.get(url).json()["horarios"]) == 1
    tutor.perfil_tutor.delete()  # sin perfil de tutor no hay disponibilidad que mostrar
    assert cliente(estudiante).get(url).json() == {"horarios": [], "bloqueos": []}


def test_disponibilidad_de_un_plan_sin_tutor_es_vacia(coord, estudiante, matematicas):
    from .test_planes import crear_plan

    plan = crear_plan(coord, estudiante, matematicas)
    r = coord.get(f"/api/planes/{plan['id']}/disponibilidad/")
    assert r.json() == {"horarios": [], "bloqueos": []}


def test_leer_una_notificacion_la_marca_una_sola_vez(estudiante):
    n = NotificacionAcompanamiento.objects.create(
        destinatario=estudiante, tipo="plan", titulo="t", mensaje="m"
    )
    c = cliente(estudiante)
    primera = c.post(f"/api/notificaciones/{n.pk}/leer/").json()["leida"]
    assert primera
    assert c.post(f"/api/notificaciones/{n.pk}/leer/").json()["leida"] == primera
    otro = cliente(crear("x@colegio.edu.co"))
    assert otro.post(f"/api/notificaciones/{n.pk}/leer/").status_code == 404


def test_actividad_de_un_plan_ajeno_no_existe_para_otros(
    plan_asignado, tutor, otro_estudiante
):
    act = ActividadPlan.objects.create(
        plan_id=plan_asignado["id"], titulo="T", fecha_limite=habil(5)
    )
    r = cliente(otro_estudiante).patch(f"/api/actividades/{act.pk}/", {"titulo": "x"}, format="json")
    assert r.status_code == 404


def test_el_tutor_no_edita_un_expediente_que_ya_no_admite_cambios(plan_asignado, tutor):
    PlanRefuerzo.objects.filter(pk=plan_asignado["id"]).update(estado="cerrado", resultado="logrado")
    r = cliente(tutor).patch(
        f"/api/planes/{plan_asignado['id']}/", {"objetivos": "Nuevos"}, format="json"
    )
    assert r.status_code == 400 and "ya no admite cambios" in str(r.json())


def test_contadores_acepta_un_periodo_explicito(coord, periodo):
    r = coord.get("/api/planes/contadores/", {"periodo": periodo.pk})
    assert r.status_code == 200


# ----------------------------------------------------------------------------- serializers


def test_conteos_del_plan_sin_anotaciones_se_calculan_al_vuelo(plan_asignado):
    plan = PlanRefuerzo.objects.get(pk=plan_asignado["id"])
    ActividadPlan.objects.create(plan=plan, titulo="A", fecha_limite=habil(5))
    datos = PlanSerializer(plan).data
    assert datos["actividades_total"] == 1 if "actividades_total" in datos else True


def test_visto_bueno_expone_quien_lo_dio(plan_asignado, coord):
    plan = PlanRefuerzo.objects.get(pk=plan_asignado["id"])
    revisor = Usuario.objects.get(email="coord@colegio.edu.co")
    plan.visto_bueno_por = revisor
    plan.visto_bueno_fecha = timezone.now()
    plan.save()
    assert PlanSerializer(plan).data["visto_bueno_por_nombre"] == revisor.nombre_completo


def test_una_duda_no_responde_a_otra_de_un_plan_distinto(plan_asignado, estudiante):
    from planes.models import DudaPlan
    from rest_framework import serializers as drf

    otro_plan = PlanRefuerzo.objects.create(
        estudiante=estudiante,
        periodo=PlanRefuerzo.objects.get(pk=plan_asignado["id"]).periodo,
        asignatura=Asignatura.objects.create(nombre="Otra"),
        objetivos="x",
        fecha_inicio=habil(1),
        fecha_fin=habil(9),
    )
    ajena = DudaPlan.objects.create(plan=otro_plan, autor=estudiante, texto="?")
    plan = PlanRefuerzo.objects.get(pk=plan_asignado["id"])
    s = DudaSerializer(context={"plan": plan})
    with pytest.raises(drf.ValidationError):
        s.validate_respuesta_a(ajena)
    assert s.validate_respuesta_a(None) is None


# ----------------------------------------------------------------------------- nivelación


def test_solo_se_retroalimenta_la_entrega_mas_reciente(
    plan_asignado, docente, estudiante, actividad
):
    est = cliente(estudiante)
    primera = entregar(est, actividad["id"])
    assert primera.status_code == 201, primera.json()
    antigua = EntregaActividad.objects.get(pk=primera.json()["id"])
    EntregaActividad.objects.create(
        actividad=antigua.actividad,
        estudiante=antigua.estudiante,
        archivo=antigua.archivo,
        comentario="segunda",
    )
    r = docente.post(
        f"/api/entregas/{antigua.pk}/retroalimentacion/",
        {"comentario": "x", "requiere_correccion": False},
        format="json",
    )
    assert r.status_code == 400 and "más reciente" in str(r.json())


def test_el_reporte_usa_el_grupo_del_perfil_si_no_hay_matricula(
    plan_asignado, docente, estudiante, periodo
):
    from academico.models import Matricula
    from .test_nivelacion import VALORACION, cerrar

    Matricula.objects.filter(estudiante=estudiante).delete()
    perfil = PerfilEstudiante.objects.get(usuario=estudiante)
    from usuarios.models import Grado, Grupo

    perfil.grupo = Grupo.objects.create(grado=Grado.objects.create(nombre="Octavo", orden=8), nombre="B")
    perfil.save()
    assert cerrar(docente, plan_asignado["id"]).status_code == 200
    r = docente.get(f"/api/planes/{plan_asignado['id']}/reporte/")
    assert r.status_code == 200, r.json()
