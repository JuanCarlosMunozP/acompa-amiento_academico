"""Expediente de nivelación: registro, asignación del docente y notificación."""

import datetime
from unittest import mock

import pytest
from django.core import mail
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework.test import APIClient

from academico.models import Matricula, PeriodoAcademico
from planes.models import AsignacionPlan, PlanRefuerzo, PlantillaCorreoPlan
from usuarios.models import Asignatura, Grado, Grupo, Usuario
from usuarios.roles import Rol

pytestmark = pytest.mark.django_db

CLAVE = "Clave-segura-2026"


def crear(email, rol=Rol.ESTUDIANTE, apellidos="Ape"):
    return Usuario.objects.create_user(
        email, CLAVE, nombres="Nom", apellidos=apellidos, email_verificado=True, rol=rol
    )


def cliente(usuario):
    c = APIClient()
    r = c.post("/api/auth/login/", {"email": usuario.email, "password": CLAVE}, format="json")
    assert r.status_code == 200, r.json()
    c.credentials(HTTP_AUTHORIZATION="Bearer " + r.json()["access"])
    return c


def habil(dias=1):
    d = timezone.localdate() + datetime.timedelta(days=dias)
    while d.weekday() >= 5:
        d += datetime.timedelta(days=1)
    return d


@pytest.fixture
def coord():
    return cliente(crear("coord@colegio.edu.co", Rol.COORDINADOR))


@pytest.fixture
def periodo():
    hoy = timezone.localdate()
    return PeriodoAcademico.objects.create(
        nombre="Vigente",
        fecha_inicio=hoy - datetime.timedelta(days=30),
        fecha_fin=hoy + datetime.timedelta(days=90),
    )


@pytest.fixture
def matematicas():
    return Asignatura.objects.get_or_create(nombre="Matemáticas")[0]


@pytest.fixture
def estudiante(periodo):
    grupo = Grupo.objects.create(grado=Grado.objects.create(nombre="Sexto", orden=6), nombre="A")
    u = crear("est@colegio.edu.co", apellidos="Zapata")
    Matricula.objects.create(estudiante=u, periodo=periodo, grupo=grupo)
    return u


def tutor_elegible(email, asignatura, apellidos="Ape", habilitado=True, disponible=True):
    t = crear(email, Rol.TUTOR, apellidos=apellidos)
    perfil = t.perfil_tutor
    perfil.habilitado = habilitado
    perfil.disponible = disponible
    perfil.save()
    perfil.asignaturas.add(asignatura)
    return t


def cuerpo(estudiante, asignatura, **extra):
    return {
        "estudiante": estudiante.pk,
        "asignatura": asignatura.pk,
        "objetivos": "  Reforzar fracciones  ",
        "desempenos_no_alcanzados": "  Operaciones con fracciones  ",
        "fecha_inicio": habil(1).isoformat(),
        "fecha_fin": habil(20).isoformat(),
        **extra,
    }


def crear_plan(coord, estudiante, asignatura, **extra):
    r = coord.post("/api/planes/", cuerpo(estudiante, asignatura, **extra), format="json")
    assert r.status_code == 201, r.json()
    return r.json()


def asignar(coord, plan, tutor):
    return coord.put(f"/api/planes/{plan['id']}/tutor/", {"tutor": tutor.pk}, format="json")


# ------------------------------------------------------------------ creación


def test_crea_plan_pendiente_con_periodo_vigente(coord, estudiante, matematicas, periodo):
    plan = crear_plan(coord, estudiante, matematicas)

    assert plan["estado"] == "pendiente"
    assert plan["tutor"] is None
    assert plan["periodo"] == periodo.pk
    assert plan["objetivos"] == "Reforzar fracciones"
    assert plan["desempenos_no_alcanzados"] == "Operaciones con fracciones"
    assert plan["estudiante_nombre"] == "Nom Zapata"


def test_rechaza_duplicado_vigente_pero_permite_tras_cancelar(coord, estudiante, matematicas):
    plan = crear_plan(coord, estudiante, matematicas)
    r = coord.post("/api/planes/", cuerpo(estudiante, matematicas), format="json")
    assert r.status_code == 400
    assert "asignatura" in r.json()["error"]["details"]

    assert coord.post(f"/api/planes/{plan['id']}/cancelar/").status_code == 200
    crear_plan(coord, estudiante, matematicas)


def test_sin_matricula_activa_se_rechaza(coord, estudiante, matematicas):
    Matricula.objects.update(estado=Matricula.Estado.RETIRADA)
    r = coord.post("/api/planes/", cuerpo(estudiante, matematicas), format="json")
    assert r.status_code == 400
    assert "estudiante" in r.json()["error"]["details"]


@pytest.mark.parametrize(
    ("campo", "valor"),
    [
        ("objetivos", "   "),
        ("objetivos", "x" * 1001),
        ("desempenos_no_alcanzados", "   "),
        ("desempenos_no_alcanzados", "x" * 1501),
        ("fecha_inicio", "2026-02-30"),
        ("fecha_inicio", "fecha"),
    ],
)
def test_campos_invalidos(coord, estudiante, matematicas, campo, valor):
    r = coord.post("/api/planes/", cuerpo(estudiante, matematicas, **{campo: valor}), format="json")
    assert r.status_code == 400
    assert campo in r.json()["error"]["details"]


def test_fechas_incoherentes(coord, estudiante, matematicas, periodo):
    inicio = habil(5)
    anterior = (inicio - datetime.timedelta(days=1)).isoformat()
    r = coord.post(
        "/api/planes/",
        cuerpo(estudiante, matematicas, fecha_inicio=inicio.isoformat(), fecha_fin=anterior),
        format="json",
    )
    assert "fecha_fin" in r.json()["error"]["details"]

    fuera = (periodo.fecha_fin + datetime.timedelta(days=1)).isoformat()
    r = coord.post("/api/planes/", cuerpo(estudiante, matematicas, fecha_fin=fuera), format="json")
    assert "fecha_fin" in r.json()["error"]["details"]

    antes = (periodo.fecha_inicio - datetime.timedelta(days=1)).isoformat()
    r = coord.post(
        "/api/planes/", cuerpo(estudiante, matematicas, fecha_inicio=antes), format="json"
    )
    assert "fecha_inicio" in r.json()["error"]["details"]


def test_inicio_en_fin_de_semana_se_rechaza(coord, estudiante, matematicas):
    sabado = habil(3)
    while sabado.weekday() != 5:
        sabado += datetime.timedelta(days=1)
    r = coord.post(
        "/api/planes/",
        cuerpo(
            estudiante,
            matematicas,
            fecha_inicio=sabado.isoformat(),
            fecha_fin=habil(40).isoformat(),
        ),
        format="json",
    )
    assert r.status_code == 400
    assert "no es un día hábil" in r.json()["error"]["details"]["fecha_inicio"][0]


def test_asignatura_inactiva_y_usuario_no_estudiante(coord, estudiante, matematicas):
    matematicas.activa = False
    matematicas.save()
    r = coord.post("/api/planes/", cuerpo(estudiante, matematicas), format="json")
    assert r.status_code == 400

    otra = Asignatura.objects.get_or_create(nombre="Física")[0]
    tutor = crear("t@colegio.edu.co", Rol.TUTOR)
    assert coord.post("/api/planes/", cuerpo(tutor, otra), format="json").status_code == 400


def test_sin_periodo_vigente_exige_indicarlo(coord, estudiante, matematicas, periodo):
    PeriodoAcademico.objects.update(fecha_fin=timezone.localdate() - datetime.timedelta(days=1))
    r = coord.post("/api/planes/", cuerpo(estudiante, matematicas), format="json")
    assert r.status_code == 400


def test_editar_solo_mientras_esta_pendiente(coord, estudiante, matematicas):
    plan = crear_plan(coord, estudiante, matematicas)
    r = coord.patch(f"/api/planes/{plan['id']}/", {"objetivos": "Nuevos"}, format="json")
    assert r.status_code == 200
    assert r.json()["objetivos"] == "Nuevos"

    asignar(coord, plan, tutor_elegible("t@colegio.edu.co", matematicas))
    r = coord.patch(f"/api/planes/{plan['id']}/", {"objetivos": "Otro"}, format="json")
    assert r.status_code == 400


def test_listado_con_filtros(coord, estudiante, matematicas):
    crear_plan(coord, estudiante, matematicas)
    r = coord.get(f"/api/planes/?estudiante={estudiante.pk}&estado=pendiente")
    assert r.json()["count"] == 1
    assert coord.get("/api/planes/?estado=cerrado").json()["count"] == 0
    assert coord.get("/api/planes/?estudiante=abc").status_code == 400


@pytest.mark.parametrize("rol", [Rol.ESTUDIANTE, Rol.ACUDIENTE])
def test_estudiante_y_acudiente_no_registran_planes(estudiante, matematicas, rol):
    c = cliente(crear("otro@colegio.edu.co", rol))
    assert c.get("/api/planes/").status_code == 403
    assert c.post("/api/planes/", cuerpo(estudiante, matematicas), format="json").status_code == 403


def test_docente_no_consulta_el_listado_general(matematicas):
    c = cliente(tutor_elegible("t@colegio.edu.co", matematicas))
    assert c.get("/api/planes/").status_code == 403


def test_docente_registra_el_expediente_y_queda_como_responsable(estudiante, matematicas, periodo):
    docente = tutor_elegible("doc@colegio.edu.co", matematicas)
    c = cliente(docente)

    r = c.post("/api/planes/", cuerpo(estudiante, matematicas), format="json")

    assert r.status_code == 201, r.json()
    plan = r.json()
    assert plan["estado"] == "asignado"
    assert plan["tutor"] == docente.pk
    assert plan["docente_nombre"] == plan["tutor_nombre"]
    assert AsignacionPlan.objects.get().asignado_por == docente
    assert [p["id"] for p in c.get("/api/mis-planes/").json()] == [plan["id"]]


def test_docente_edita_desempenos_mientras_acompana(estudiante, matematicas):
    c = cliente(tutor_elegible("doc@colegio.edu.co", matematicas))
    plan = c.post("/api/planes/", cuerpo(estudiante, matematicas), format="json").json()

    r = c.patch(
        f"/api/planes/{plan['id']}/", {"desempenos_no_alcanzados": "Otro desempeño"}, format="json"
    )
    assert r.status_code == 200, r.json()
    assert r.json()["desempenos_no_alcanzados"] == "Otro desempeño"

    ajeno = cliente(tutor_elegible("otro@colegio.edu.co", matematicas))
    assert (
        ajeno.patch(f"/api/planes/{plan['id']}/", {"objetivos": "x"}, format="json").status_code
        == 403
    )
    # Solo coordinación consulta el detalle general del expediente.
    assert c.get(f"/api/planes/{plan['id']}/").status_code == 403


# ------------------------------------------------------------------ tutores elegibles


def test_elegibles_filtra_y_ordena_por_carga(coord, estudiante, matematicas, periodo):
    libre = tutor_elegible("libre@colegio.edu.co", matematicas, apellidos="Zeta")
    ocupado = tutor_elegible("ocupado@colegio.edu.co", matematicas, apellidos="Alfa")
    tutor_elegible("nohab@colegio.edu.co", matematicas, habilitado=False)
    tutor_elegible("nodisp@colegio.edu.co", matematicas, disponible=False)
    tutor_elegible("otra@colegio.edu.co", Asignatura.objects.get_or_create(nombre="Física")[0])
    inactivo = tutor_elegible("inactivo@colegio.edu.co", matematicas)
    inactivo.is_active = False
    inactivo.save()

    PlanRefuerzo.objects.create(
        estudiante=crear("otro-est@colegio.edu.co"),
        periodo=periodo,
        asignatura=matematicas,
        objetivos="x",
        fecha_inicio=habil(1),
        fecha_fin=habil(9),
        estado="asignado",
        tutor=ocupado,
    )
    plan = crear_plan(coord, estudiante, matematicas)

    r = coord.get(f"/api/planes/{plan['id']}/tutores-elegibles/")
    assert [t["id"] for t in r.json()] == [libre.pk, ocupado.pk]
    assert [t["carga"] for t in r.json()] == [0, 1]


# ------------------------------------------------------------------ asignación


def test_asignar_tutor_notifica_a_tutor_y_estudiante(coord, estudiante, matematicas):
    tutor = tutor_elegible("t@colegio.edu.co", matematicas)
    plan = crear_plan(coord, estudiante, matematicas)
    mail.outbox.clear()

    r = asignar(coord, plan, tutor)

    assert r.status_code == 200, r.json()
    datos = r.json()
    assert datos["plan"]["estado"] == "asignado"
    assert datos["plan"]["tutor"] == tutor.pk
    assert datos["notificacion"] == {"tutor": True, "estudiante": True}
    destinos = {m.to[0]: m for m in mail.outbox}
    assert set(destinos) == {tutor.email, estudiante.email}
    assert "Reforzar fracciones" in destinos[tutor.email].body
    assert "Matemáticas" in destinos[estudiante.email].body
    asignacion = AsignacionPlan.objects.get()
    assert asignacion.notificado is True
    assert asignacion.asignado_por.email == "coord@colegio.edu.co"


def test_asignacion_usa_plantilla_editable(coord, estudiante, matematicas):
    tutor = tutor_elegible("t@colegio.edu.co", matematicas)
    plan = crear_plan(coord, estudiante, matematicas)
    PlantillaCorreoPlan.objects.create(
        clave=PlantillaCorreoPlan.Clave.ASIGNACION_TUTOR,
        asunto="Plan de {{ asignatura }}",
        cuerpo_texto="Hola {{ nombres }}: {{ objetivos }}",
        cuerpo_html="<p>{{ estudiante }}</p>",
    )
    mail.outbox.clear()

    respuesta = asignar(coord, plan, tutor)

    correo_tutor = next(mensaje for mensaje in mail.outbox if mensaje.to == [tutor.email])
    assert respuesta.status_code == 200
    assert correo_tutor.subject == "Plan de Matemáticas"
    assert "Hola Nom:" in correo_tutor.body
    assert correo_tutor.alternatives[0].content == "<p>Nom Zapata</p>"


def test_misma_asignacion_es_idempotente(coord, estudiante, matematicas):
    tutor = tutor_elegible("t@colegio.edu.co", matematicas)
    plan = crear_plan(coord, estudiante, matematicas)
    asignar(coord, plan, tutor)
    mail.outbox.clear()

    r = asignar(coord, plan, tutor)

    assert r.json()["cambio"] is False
    assert r.json()["notificacion"] is None
    assert mail.outbox == []
    assert AsignacionPlan.objects.count() == 1


def test_reasignar_deja_historial(coord, estudiante, matematicas):
    uno = tutor_elegible("uno@colegio.edu.co", matematicas)
    dos = tutor_elegible("dos@colegio.edu.co", matematicas)
    plan = crear_plan(coord, estudiante, matematicas)
    asignar(coord, plan, uno)
    asignar(coord, plan, dos)

    detalle = coord.get(f"/api/planes/{plan['id']}/").json()
    assert detalle["tutor"] == dos.pk
    assert [a["tutor"] for a in detalle["asignaciones"]] == [dos.pk, uno.pk]


def test_tutor_no_elegible_se_rechaza(coord, estudiante, matematicas):
    sin_habilitar = tutor_elegible("nohab@colegio.edu.co", matematicas, habilitado=False)
    plan = crear_plan(coord, estudiante, matematicas)

    r = asignar(coord, plan, sin_habilitar)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "tutor_no_elegible"

    assert asignar(coord, plan, estudiante).status_code == 400
    assert PlanRefuerzo.objects.get().estado == "pendiente"


def test_fallo_de_correo_no_deshace_la_asignacion(coord, estudiante, matematicas):
    tutor = tutor_elegible("t@colegio.edu.co", matematicas)
    plan = crear_plan(coord, estudiante, matematicas)

    with mock.patch("planes.servicios.enviar_correo_de_plan", side_effect=OSError("smtp caído")):
        r = asignar(coord, plan, tutor)

    assert r.status_code == 200
    assert r.json()["notificacion"] == {"tutor": False, "estudiante": False}
    assert PlanRefuerzo.objects.get().estado == "asignado"
    assert AsignacionPlan.objects.get().notificado is False


def test_plan_cancelado_no_admite_tutor(coord, estudiante, matematicas):
    tutor = tutor_elegible("t@colegio.edu.co", matematicas)
    plan = crear_plan(coord, estudiante, matematicas)
    coord.post(f"/api/planes/{plan['id']}/cancelar/")

    assert asignar(coord, plan, tutor).status_code == 400
    assert coord.post(f"/api/planes/{plan['id']}/cancelar/").status_code == 400


def test_mis_planes_por_rol(coord, estudiante, matematicas):
    tutor = tutor_elegible("t@colegio.edu.co", matematicas)
    plan = crear_plan(coord, estudiante, matematicas)

    assert cliente(tutor).get("/api/mis-planes/").json() == []  # aún sin asignar
    assert [p["id"] for p in cliente(estudiante).get("/api/mis-planes/").json()] == [plan["id"]]

    asignar(coord, plan, tutor)
    assert [p["id"] for p in cliente(tutor).get("/api/mis-planes/").json()] == [plan["id"]]
    assert cliente(crear("ajeno@colegio.edu.co")).get("/api/mis-planes/").json() == []
    assert coord.get("/api/mis-planes/").status_code == 403


def test_modelo_protege_roles(estudiante, matematicas, periodo):
    tutor = crear("t2@colegio.edu.co", Rol.TUTOR)
    base = {
        "periodo": periodo,
        "asignatura": matematicas,
        "objetivos": "x",
        "fecha_inicio": habil(1),
        "fecha_fin": habil(2),
    }
    with pytest.raises(ValidationError):
        PlanRefuerzo(estudiante=tutor, **base).save()
    with pytest.raises(ValidationError):
        PlanRefuerzo(estudiante=estudiante, tutor=estudiante, **base).save()
