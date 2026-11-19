"""HU-01.07: habilitación institucional del tutor (acción y listado)."""

import pytest
from rest_framework.test import APIClient

from usuarios.models import Asignatura, PerfilTutor, Usuario
from usuarios.roles import Rol

pytestmark = pytest.mark.django_db

CLAVE = "Clave-segura-2026"
MI_PERFIL = "/api/perfil-tutor/"


def crear(email, rol=Rol.ESTUDIANTE, nombres="N", apellidos="A", **extra):
    return Usuario.objects.create_user(
        email, CLAVE, nombres=nombres, apellidos=apellidos, email_verificado=True, rol=rol, **extra
    )


def cliente(usuario):
    c = APIClient()
    r = c.post("/api/auth/login/", {"email": usuario.email, "password": CLAVE}, format="json")
    assert r.status_code == 200, r.json()
    c.credentials(HTTP_AUTHORIZATION="Bearer " + r.json()["access"])
    return c


def url(tutor):
    return f"/api/tutores/{tutor.pk}/habilitacion/"


@pytest.fixture
def tutor():
    return crear("tutor@colegio.edu.co", Rol.TUTOR, "Luis", "Pérez")


@pytest.fixture
def admin():
    return crear("admin@colegio.edu.co", Rol.ADMINISTRADOR)


@pytest.fixture
def coordinador():
    return crear("coord@colegio.edu.co", Rol.COORDINADOR)


def habilitar(quien, tutor, valor=True):
    return cliente(quien).put(url(tutor), {"habilitado": valor}, format="json")


# --- el estado inicial ---


def test_un_tutor_nuevo_queda_pendiente_de_habilitacion(tutor):
    perfil = tutor.perfil_tutor
    assert perfil.habilitado is False and perfil.habilitado_por is None
    assert perfil.fecha_habilitacion is None


def test_el_tutor_ve_su_estado_de_habilitacion_pero_no_puede_cambiarlo(tutor):
    c = cliente(tutor)
    assert c.get(MI_PERFIL).json()["habilitado"] is False
    c.patch(MI_PERFIL, {"habilitado": True}, format="json")  # se ignora
    assert PerfilTutor.objects.get(usuario=tutor).habilitado is False


# --- T1: la acción de habilitar ---


@pytest.mark.parametrize("rol", ["admin", "coordinador"])
def test_administrador_y_coordinador_habilitan(rol, tutor, admin, coordinador):
    quien = admin if rol == "admin" else coordinador
    r = habilitar(quien, tutor)
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["habilitado"] is True and cuerpo["fecha_habilitacion"]
    perfil = PerfilTutor.objects.get(usuario=tutor)
    assert perfil.habilitado and perfil.habilitado_por == quien and perfil.fecha_habilitacion


@pytest.mark.parametrize("rol", [Rol.ESTUDIANTE, Rol.TUTOR])
def test_estudiantes_y_tutores_no_pueden_habilitar(rol, tutor):
    quien = crear("q@colegio.edu.co", rol)
    assert habilitar(quien, tutor).status_code == 403
    assert PerfilTutor.objects.get(usuario=tutor).habilitado is False


def test_un_tutor_no_puede_habilitarse_a_si_mismo(tutor):
    assert habilitar(tutor, tutor).status_code == 403


def test_requiere_sesion(tutor):
    assert APIClient().put(url(tutor), {"habilitado": True}, format="json").status_code == 401


def test_solo_se_habilita_a_tutores(admin):
    est = crear("ana@colegio.edu.co")
    assert habilitar(admin, est).status_code == 404
    assert (
        cliente(admin)
        .put("/api/tutores/999999/habilitacion/", {"habilitado": True}, format="json")
        .status_code
        == 404
    )


def test_el_valor_es_obligatorio_y_booleano(tutor, admin):
    c = cliente(admin)
    assert c.put(url(tutor), {}, format="json").status_code == 400
    assert c.put(url(tutor), {"habilitado": "quizás"}, format="json").status_code == 400


def test_habilitar_dos_veces_es_idempotente_y_conserva_quien_y_cuando(tutor, admin, coordinador):
    habilitar(admin, tutor)
    primera = PerfilTutor.objects.get(usuario=tutor).fecha_habilitacion
    assert habilitar(coordinador, tutor).status_code == 200
    perfil = PerfilTutor.objects.get(usuario=tutor)
    assert perfil.habilitado_por == admin and perfil.fecha_habilitacion == primera


def test_retirar_la_habilitacion_quita_la_disponibilidad(tutor, admin):
    perfil = tutor.perfil_tutor
    perfil.disponible = True
    perfil.save()
    perfil.habilitado = True
    perfil.save()
    r = habilitar(admin, tutor, False)
    assert r.status_code == 200 and r.json()["habilitado"] is False
    perfil.refresh_from_db()
    assert not perfil.habilitado and not perfil.disponible
    assert perfil.habilitado_por is None and perfil.fecha_habilitacion is None


def test_el_tutor_conserva_su_perfil_y_asignaturas_al_retirarle_la_habilitacion(tutor, admin):
    tutor.perfil_tutor.asignaturas.add(Asignatura.objects.get(nombre="Inglés"))
    habilitar(admin, tutor)
    habilitar(admin, tutor, False)
    assert tutor.perfil_tutor.asignaturas.count() == 1


def test_si_a_un_tutor_le_falta_el_perfil_se_crea_al_habilitar(tutor, admin):
    PerfilTutor.objects.filter(usuario=tutor).delete()
    assert habilitar(admin, tutor).status_code == 200
    assert PerfilTutor.objects.get(usuario=tutor).habilitado


# --- sin habilitación no hay disponibilidad ---


def test_un_tutor_no_habilitado_no_puede_ponerse_disponible(tutor):
    c = cliente(tutor)
    c.patch(MI_PERFIL, {"asignaturas": [Asignatura.objects.get(nombre="Inglés").pk]}, format="json")
    r = c.patch(MI_PERFIL, {"disponible": True}, format="json")
    assert r.status_code == 400
    assert "habilitado" in r.json()["error"]["details"]["disponible"][0]
    assert PerfilTutor.objects.get(usuario=tutor).disponible is False


def test_habilitado_el_tutor_si_puede_ponerse_disponible(tutor, admin):
    habilitar(admin, tutor)
    c = cliente(tutor)
    ingles = Asignatura.objects.get(nombre="Inglés").pk
    r = c.patch(MI_PERFIL, {"asignaturas": [ingles], "disponible": True}, format="json")
    assert r.status_code == 200 and r.json()["disponible"] is True


# --- T2: listado (pendientes de habilitación) ---


@pytest.fixture
def tutores(admin):
    t1 = crear("luis@colegio.edu.co", Rol.TUTOR, "Luis", "Pérez")
    t2 = crear("eva@colegio.edu.co", Rol.TUTOR, "Eva", "Gil")
    t3 = crear("ana@colegio.edu.co", Rol.TUTOR, "Ana", "Zúñiga")
    habilitar(admin, t1)
    return t1, t2, t3


def correos(r):
    return [p["usuario"]["email"] for p in r.json()["results"]]


def test_listar_pendientes_de_habilitacion(admin, tutores):
    r = cliente(admin).get("/api/tutores/", {"habilitado": "false"})
    assert correos(r) == ["eva@colegio.edu.co", "ana@colegio.edu.co"]


def test_listar_los_habilitados(admin, tutores):
    r = cliente(admin).get("/api/tutores/", {"habilitado": "true"})
    assert correos(r) == ["luis@colegio.edu.co"]
    assert r.json()["results"][0]["habilitado"] is True


def test_sin_filtro_de_habilitacion_salen_todos(admin, tutores):
    assert cliente(admin).get("/api/tutores/").json()["count"] == 3


def test_el_coordinador_tambien_ve_el_listado(coordinador, tutores):
    assert cliente(coordinador).get("/api/tutores/", {"habilitado": "false"}).json()["count"] == 2


def test_habilitado_se_combina_con_busqueda_y_disponibilidad(admin, tutores):
    c = cliente(admin)
    assert correos(c.get("/api/tutores/", {"habilitado": "false", "q": "gil"})) == [
        "eva@colegio.edu.co"
    ]
    assert c.get("/api/tutores/", {"habilitado": "true", "disponible": "true"}).json()["count"] == 0


def test_filtro_habilitado_invalido_es_400(admin):
    assert cliente(admin).get("/api/tutores/", {"habilitado": "tal vez"}).status_code == 400
