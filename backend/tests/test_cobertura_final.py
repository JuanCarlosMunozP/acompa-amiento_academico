"""Cierra los huecos de cobertura: evaluación posterior, informes de acompañamiento, serializers,
sanitizador de HTML, comandos de datos de demostración y ramas menores de varias vistas."""

# ruff: noqa: F401, F811  (las fixtures compartidas se importan de otros módulos de prueba)
import datetime
from decimal import Decimal

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from academico.models import Matricula, PeriodoAcademico
from planes.models import PlanRefuerzo, SesionTutoria
from planes.plantillas_correo import sanitizar_html
from seguimiento import alertas
from seguimiento.models import Asistencia, EvaluacionPosterior, ReglaAcademica, Resultado
from seguimiento.serializers import (
    EvaluacionPosteriorSerializer,
    ReglaSerializer,
    TrabajoSerializer,
)
from usuarios.models import Asignatura, Grado, Grupo
from usuarios.roles import Rol

from .test_planes import cliente as cliente_planes
from .test_planes import crear as crear_planes
from .test_planes import estudiante as estudiante_planes
from .test_planes import matematicas, periodo as periodo_planes
from .test_seguimiento_notas_asistencia import (
    ana,
    cliente,
    coord,
    crear,
    fisica,
    grupo,
    mate,
    nueva_nota,
    periodo,
    tutor,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def docente(ana):
    return crear("docente@colegio.edu.co", Rol.TUTOR)


def plan_cerrado(ana, periodo, docente, asignatura=None, estado="cerrado", resultado="logrado"):
    hoy = timezone.localdate()
    return PlanRefuerzo.objects.create(
        estudiante=ana,
        periodo=periodo,
        asignatura=asignatura or mate(),
        objetivos="Reforzar",
        fecha_inicio=hoy - datetime.timedelta(days=10),
        fecha_fin=hoy,
        estado=estado,
        tutor=docente if estado in ("asignado", "cerrado") else None,
        resultado=resultado if estado == "cerrado" else "",
    )


def evaluar(c, plan, nota="4.0", **extra):
    return c.post(
        "/api/evaluaciones-posteriores/",
        {"plan": plan.pk, "nota_posterior": nota, **extra},
        format="json",
    )


# ----------------------------------------------------------------------------- evaluación posterior


@pytest.mark.parametrize(
    ("inicial", "posterior", "esperado"),
    [("2.0", "3.5", "logrado"), ("2.0", "2.3", "parcial"), ("2.0", "1.5", "no_logrado")],
)
def test_la_evaluacion_posterior_define_el_resultado_del_plan(
    coord, ana, periodo, docente, inicial, posterior, esperado
):
    nueva_nota(coord, ana, periodo, inicial)
    plan = plan_cerrado(ana, periodo, docente)
    r = evaluar(cliente(docente), plan, posterior, observaciones="  Buen avance  ")
    assert r.status_code == 201, r.json()
    plan.refresh_from_db()
    assert plan.resultado == esperado
    assert EvaluacionPosterior.objects.get().observaciones == "Buen avance"


def test_la_evaluacion_posterior_rechaza_casos_invalidos(coord, ana, periodo, docente, grupo):
    c = cliente(docente)
    pendiente = plan_cerrado(ana, periodo, None, estado="pendiente")
    assert evaluar(coord, pendiente).status_code == 400  # no está cerrado
    cerrado = plan_cerrado(ana, periodo, docente, asignatura=fisica())
    assert evaluar(c, cerrado).status_code == 400  # sin nota inicial
    nueva_nota(coord, ana, periodo, "2.0", asignatura=fisica())
    assert evaluar(c, cerrado, "9").status_code == 400  # nota fuera de escala
    assert evaluar(c, cerrado, "4", observaciones="x" * 501).status_code == 400
    assert evaluar(c, cerrado, "4").status_code == 201
    assert evaluar(c, cerrado, "4").status_code == 400  # ya existe


def test_solo_el_tutor_del_plan_registra_su_evaluacion(coord, ana, periodo, docente):
    nueva_nota(coord, ana, periodo, "2.0")
    plan = plan_cerrado(ana, periodo, docente)
    ajeno = crear("ajeno@colegio.edu.co", Rol.TUTOR)
    assert evaluar(cliente(ajeno), plan).status_code == 403
    assert evaluar(coord, plan).status_code == 201  # coordinación sí puede


def test_consulta_de_evaluaciones_posteriores_con_filtros(coord, ana, periodo, docente, grupo):
    nueva_nota(coord, ana, periodo, "2.0")
    plan = plan_cerrado(ana, periodo, docente)
    assert evaluar(coord, plan, "4").status_code == 201
    base = "/api/evaluaciones-posteriores/"
    assert len(coord.get(base).json()) == 1
    assert len(coord.get(base, {"plan": plan.pk}).json()) == 1
    assert len(coord.get(base, {"periodo": periodo.pk}).json()) == 1
    assert len(coord.get(base, {"periodo": periodo.pk, "grupo": grupo.pk}).json()) == 1
    assert coord.get(base, {"periodo": periodo.pk, "grupo": grupo.pk + 99}).json() == []
    assert len(coord.get(base, {"asignatura": mate().pk}).json()) == 1
    assert coord.get(base, {"asignatura": fisica().pk}).json() == []
    assert coord.get(base, {"plan": "abc"}).status_code == 400
    propio = cliente(docente)
    assert len(propio.get(base).json()) == 1
    assert len(propio.get(base, {"plan": plan.pk}).json()) == 1
    ajeno = cliente(crear("ajeno@colegio.edu.co", Rol.TUTOR))
    assert ajeno.get(base).json() == []
    assert ajeno.get(base, {"plan": plan.pk}).status_code == 403


# ----------------------------------------------------------------------------- informes


def _escenario_informes(coord, ana, periodo, docente, grupo):
    nueva_nota(coord, ana, periodo, "2.0")
    nueva_nota(coord, ana, periodo, "4.5", asignatura=fisica())
    hoy = timezone.localdate()
    Asistencia.objects.create(estudiante=ana, fecha=hoy, estado="presente")
    Asistencia.objects.create(estudiante=ana, fecha=hoy - datetime.timedelta(days=1), estado="ausente")
    plan = plan_cerrado(ana, periodo, docente)
    assert evaluar(coord, plan, "4").status_code == 201
    asignado = plan_cerrado(ana, periodo, docente, asignatura=fisica(), estado="asignado")
    SesionTutoria.objects.create(
        plan=asignado,
        tutor=docente,
        inicio=timezone.now() - datetime.timedelta(days=1),
        fin=timezone.now() - datetime.timedelta(days=1) + datetime.timedelta(minutes=50),
        modalidad="presencial",
        lugar="Aula",
    )
    # Un plan sin tutor no cuenta en el informe por tutores.
    plan_cerrado(ana, periodo, None, estado="pendiente")
    # Una recuperación que no alcanza el umbral no suma como efectiva.
    artes = Asignatura.objects.create(nombre="Artes de prueba")
    nueva_nota(coord, ana, periodo, "2.0", asignatura=artes)
    assert evaluar(coord, plan_cerrado(ana, periodo, docente, asignatura=artes), "2.1").status_code == 201
    # Un plan asignado de alguien sin matrícula activa no cuenta como plan en curso del grupo.
    sin_matricula = crear("sin-mat@colegio.edu.co", nombres="Sin", apellidos="Mat")
    plan_cerrado(sin_matricula, periodo, docente, asignatura=fisica(), estado="asignado")
    # Un estudiante sin planes ni notas.
    otro = crear("otro@colegio.edu.co", nombres="Otro", apellidos="Est")
    Matricula.objects.create(estudiante=otro, periodo=periodo, grupo=grupo)
    return plan


def test_informe_de_acompanamiento_resume_el_periodo(coord, ana, periodo, docente, grupo):
    _escenario_informes(coord, ana, periodo, docente, grupo)
    r = coord.get("/api/informes-acompanamiento/")
    assert r.status_code == 200, r.json()
    cuerpo = r.json()
    assert cuerpo["cards"]["estudiantes"] == Matricula.objects.filter(periodo=periodo).count()
    assert cuerpo["cards"]["recuperaciones_efectivas"] == 1
    assert cuerpo["cards"]["planes_en_curso"] == 1
    assert cuerpo["grupos"][0]["presentes"] == 1 and cuerpo["grupos"][0]["ausentes"] == 1
    assert cuerpo["tutores"][0]["planes"] == 4 and cuerpo["tutores"][0]["sesiones"] == 1
    assert {m["asignatura"] for m in cuerpo["asignaturas"]} == {"Matemáticas", "Física", "Artes de prueba"}
    assert cuerpo["filtros"]["tutores"] and cuerpo["filtros"]["grupos"]


def test_informe_de_acompanamiento_acepta_filtros(coord, ana, periodo, docente, grupo):
    _escenario_informes(coord, ana, periodo, docente, grupo)
    params = {"periodo": periodo.pk, "grupo": grupo.pk, "asignatura": mate().pk, "tutor": docente.pk}
    r = coord.get("/api/informes-acompanamiento/", params)
    assert r.status_code == 200 and r.json()["cards"]["estudiantes"] == 1
    # El tutor solo ve a sus propios estudiantes.
    assert cliente(docente).get("/api/informes-acompanamiento/").status_code == 403


@pytest.mark.parametrize(
    "exportar", ["grupos", "asistencia", "asignaturas", "tutores", "recuperaciones"]
)
def test_informe_se_exporta_a_csv(coord, ana, periodo, docente, grupo, exportar):
    _escenario_informes(coord, ana, periodo, docente, grupo)
    r = coord.get("/api/informes-acompanamiento/", {"exportar": exportar})
    assert r.status_code == 200
    assert r["Content-Type"].startswith("text/csv")
    assert f"informe-{exportar}-{periodo.pk}.csv" in r["Content-Disposition"]
    assert r.content.decode("utf-8-sig").count("\n") >= 2


def test_exportacion_invalida_y_periodo_inexistente(coord, ana, periodo):
    assert coord.get("/api/informes-acompanamiento/", {"exportar": "otro"}).status_code == 400
    assert coord.get("/api/informes-acompanamiento/", {"periodo": 99999}).status_code == 400


def test_el_csv_neutraliza_formulas(ana, periodo):
    from seguimiento.views import _segura_csv

    assert _segura_csv("=1+1") == "'=1+1"
    assert _segura_csv(None) == ""
    assert _segura_csv("normal") == "normal"


def test_informe_sin_matriculas_devuelve_cero(coord, periodo):
    r = coord.get("/api/informes-acompanamiento/")
    assert r.status_code == 200 and r.json()["cards"]["estudiantes"] == 0


# ----------------------------------------------------------------------------- notas, asistencia y trabajos


def test_consulta_de_una_nota_y_trabajos_con_filtros(coord, ana, periodo):
    nota_id = nueva_nota(coord, ana, periodo, "3.0").json()["id"]
    assert coord.get(f"/api/notas/{nota_id}/").json()["valor"] == "3.00"
    creado = coord.post(
        f"/api/estudiantes/{ana.pk}/trabajos/",
        {
            "asignatura": mate().pk,
            "descripcion": "  Taller  ",
            "fecha_limite": str(timezone.localdate()),
        },
        format="json",
    )
    assert creado.status_code == 201, creado.json()
    tid = creado.json()["id"]
    lista = coord.get(f"/api/estudiantes/{ana.pk}/trabajos/", {"periodo": periodo.pk})
    assert len(lista.json()) == 1
    r = coord.patch(f"/api/trabajos/{tid}/", {"entregado": True}, format="json")
    assert r.json()["fecha_entrega"] == str(timezone.localdate())
    r = coord.patch(f"/api/trabajos/{tid}/", {"entregado": False}, format="json")
    assert r.json()["fecha_entrega"] is None
    r = coord.patch(f"/api/trabajos/{tid}/", {"descripcion": "Otro"}, format="json")
    assert r.json()["descripcion"] == "Otro"
    assert coord.get(f"/api/trabajos/{tid}/").json()["descripcion"] == "Otro"


def test_asistencia_sin_periodo_vigente_no_publica_alertas(coord, grupo):
    ana = crear("vieja@colegio.edu.co")
    ayer = timezone.localdate() - datetime.timedelta(days=400)
    while ayer.weekday() >= 5:
        ayer -= datetime.timedelta(days=1)
    antiguo = PeriodoAcademico.objects.create(
        nombre="Pasado",
        fecha_inicio=ayer - datetime.timedelta(days=30),
        fecha_fin=ayer + datetime.timedelta(days=30),
    )
    Matricula.objects.create(estudiante=ana, periodo=antiguo, grupo=grupo)
    r = coord.put(
        f"/api/asistencia/grupo/{grupo.pk}/{ayer}/",
        {"registros": [{"estudiante": ana.pk, "estado": "presente"}]},
        format="json",
    )
    assert r.status_code == 200, r.json()


# ----------------------------------------------------------------------------- serializers


def test_serializers_de_seguimiento_validan_y_resuelven_grupo(ana, grupo, periodo):
    s = TrabajoSerializer()
    with pytest.raises(Exception):
        s.validate_descripcion("   ")
    r = ReglaSerializer()
    with pytest.raises(Exception):
        r.validate_nombre("  ")
    regla = ReglaSerializer(
        data={"nombre": "x", "tipo": "trabajos_pendientes", "umbral": "2.5", "severidad": "media"}
    )
    assert not regla.is_valid()
    sin_tipo = ReglaSerializer(data={"nombre": "x"}, partial=True)
    assert sin_tipo.is_valid() or "nombre" not in sin_tipo.errors

    hoy = timezone.localdate()
    plan = PlanRefuerzo.objects.create(
        estudiante=ana,
        periodo=periodo,
        asignatura=mate(),
        objetivos="x",
        fecha_inicio=hoy,
        fecha_fin=hoy,
    )
    evaluacion = EvaluacionPosterior(
        plan=plan, nota_inicial=Decimal("2"), nota_posterior=Decimal("4")
    )
    assert EvaluacionPosteriorSerializer().get_grupo_nombre(evaluacion) == "Sexto A"
    Matricula.objects.filter(estudiante=ana).delete()
    assert EvaluacionPosteriorSerializer().get_grupo_nombre(evaluacion) == "Sin grupo"


def test_publicar_alertas_nunca_propaga_un_fallo(ana, periodo, monkeypatch):
    def falla(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(alertas, "evaluar_estudiante", falla)
    assert alertas.publicar_alertas(ana, periodo) == 0


# ----------------------------------------------------------------------------- HTML de plantillas


def test_sanitizador_descarta_bloques_peligrosos_y_cierra_etiquetas():
    html = '<script><strong>x</strong>alert(1)</script><p>Hola <strong>mundo</p><a href="https://a.co" title="t">l</a>'
    limpio = sanitizar_html(html)
    assert "script" not in limpio and "alert" not in limpio
    assert "<strong>mundo</strong></p>" in limpio
    assert 'href="https://a.co"' in limpio
    assert sanitizar_html("<p>abierto<em>sin cerrar") == "<p>abierto<em>sin cerrar</em></p>"
    assert sanitizar_html("</strong>suelto") == "suelto"
    assert sanitizar_html("<object><p>oculto</p></object>visible") == "visible"
    assert 'href=' not in sanitizar_html('<a href="javascript:alert(1)">x</a>')


# ----------------------------------------------------------------------------- académico y planes


def test_matriculas_se_filtran_por_estado_y_se_consultan(coord, ana, periodo):
    admin = cliente(crear("admin@colegio.edu.co", Rol.ADMINISTRADOR))
    m = Matricula.objects.get(estudiante=ana)
    lista = admin.get("/api/matriculas/", {"estado": "activa"})
    assert lista.status_code == 200
    assert admin.get("/api/matriculas/", {"estado": "inventado"}).status_code == 400
    assert admin.get(f"/api/matriculas/{m.pk}/").status_code == 200


def test_la_agenda_es_personal(coord, ana, periodo, docente):
    plan = plan_cerrado(ana, periodo, docente, estado="asignado")
    SesionTutoria.objects.create(
        plan=plan,
        tutor=docente,
        inicio=timezone.now() + datetime.timedelta(days=1),
        fin=timezone.now() + datetime.timedelta(days=1, minutes=50),
        modalidad="presencial",
        lugar="Aula",
    )
    # La agenda es personal: la coordinación no tiene esa capacidad.
    assert coord.get("/api/agenda-sesiones/").status_code == 403
    assert len(cliente(docente).get("/api/agenda-sesiones/").json()) == 1
    assert cliente(ana).get("/api/agenda-sesiones/").status_code == 200


# ----------------------------------------------------------------------------- comandos de demostración


def test_comando_de_demostracion_exige_debug(settings):
    settings.DEBUG = False
    with pytest.raises(CommandError):
        call_command("seed_demo_datos", verbosity=0)
    with pytest.raises(CommandError):
        call_command("seed_demo_informes", verbosity=0)


def test_comando_de_datos_de_demostracion_es_idempotente(settings, capsys):
    settings.DEBUG = True
    call_command("seed_demo_datos", password="Demo-clave-2026", verbosity=0)
    primera = capsys.readouterr().out
    assert "Datos de demostración listos" in primera and "Demo-clave-2026" in primera
    call_command("seed_demo_datos", verbosity=0)
    segunda = capsys.readouterr().out
    assert "Datos de demostración listos" in segunda
    call_command("seed_demo_datos", verbosity=0)  # sin contraseña: genera una al azar si hace falta


def test_comando_de_informes_exige_las_cuentas_de_prueba(settings):
    settings.DEBUG = True
    with pytest.raises(CommandError):
        call_command("seed_demo_informes", verbosity=0)


def test_comando_de_informes_crea_expedientes_y_es_idempotente(settings):
    settings.DEBUG = True
    hoy = datetime.date(2026, 10, 20)
    PeriodoAcademico.objects.create(
        nombre="Periodo 2026 de prueba",
        fecha_inicio=hoy - datetime.timedelta(days=90),
        fecha_fin=hoy + datetime.timedelta(days=90),
    )
    crear("estudiante.prueba@colegio.test", Rol.ESTUDIANTE)
    crear("tutor.prueba@colegio.test", Rol.TUTOR)
    crear("coordinador.prueba@campusucc.edu.co", Rol.COORDINADOR)
    for nombre in ("Ciencias Naturales", "Inglés"):
        Asignatura.objects.get_or_create(nombre=nombre)
    call_command("seed_demo_informes", verbosity=0)
    antes = PlanRefuerzo.objects.count()
    assert antes >= 3
    call_command("seed_demo_informes", verbosity=0)
    assert PlanRefuerzo.objects.count() == antes


def test_evaluaciones_sin_periodo_vigente_se_listan_sin_filtrar_por_periodo(coord):
    assert coord.get("/api/evaluaciones-posteriores/").json() == []


def test_la_sesion_no_puede_terminar_despues_del_fin_del_plan(ana, periodo, docente):
    from planes.serializers import CrearSesionTutoriaSerializer

    hoy = timezone.localdate()
    plan = plan_cerrado(ana, periodo, docente, estado="asignado")
    plan.fecha_inicio = hoy
    plan.fecha_fin = hoy + datetime.timedelta(days=1)
    inicio = timezone.make_aware(
        datetime.datetime.combine(hoy + datetime.timedelta(days=5), datetime.time(10, 0))
    )
    s = CrearSesionTutoriaSerializer(
        data={
            "inicio": inicio.isoformat(),
            "fin": (inicio + datetime.timedelta(minutes=50)).isoformat(),
            "modalidad": "presencial",
            "lugar": "Aula",
        },
        context={"plan": plan},
    )
    assert not s.is_valid()
    assert "fin" in s.errors


def test_comando_de_demostracion_reutiliza_cuentas_existentes(settings):
    from usuarios.models import PerfilEstudiante, PerfilTutor

    settings.DEBUG = True
    call_command("seed_demo_datos", password="Demo-clave-2026", verbosity=0)
    sin_grupo = crear("estudiante.local@tutorias.test", Rol.ESTUDIANTE)
    con_grupo = crear("demo.estudiante@tutorias.local", Rol.ESTUDIANTE)
    PerfilEstudiante.objects.update_or_create(
        usuario=con_grupo, defaults={"grupo": Grupo.objects.first()}
    )
    habilitado = crear("tutor.local@tutorias.test", Rol.TUTOR)
    PerfilTutor.objects.update_or_create(
        usuario=habilitado,
        defaults={"habilitado": True, "disponible": True, "biografia": "Ya tengo biografía"},
    )
    sin_habilitar = crear("demo.tutor@tutorias.local", Rol.TUTOR)
    PerfilTutor.objects.update_or_create(
        usuario=sin_habilitar, defaults={"habilitado": False, "biografia": "Bio previa"}
    )
    ReglaAcademica.objects.all().delete()
    call_command("seed_demo_datos", verbosity=0)
    assert ReglaAcademica.objects.exists()
    assert PerfilEstudiante.objects.get(usuario=sin_grupo).grupo_id is not None
    assert PerfilTutor.objects.get(usuario=habilitado).biografia == "Ya tengo biografía"
