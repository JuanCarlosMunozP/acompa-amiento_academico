import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient

from usuarios.models import Asignatura, PerfilTutor, Usuario
from usuarios.roles import Rol

pytestmark = pytest.mark.django_db

CLAVE = "Clave-segura-2026"


def crear(email, rol=Rol.ESTUDIANTE):
    return Usuario.objects.create_user(
        email, CLAVE, nombres="N", apellidos="A", email_verificado=True, rol=rol
    )


@pytest.fixture
def tutor():
    return crear("tutor@colegio.edu.co", Rol.TUTOR)


@pytest.fixture
def admin():
    return crear("admin@colegio.edu.co", Rol.ADMINISTRADOR)


def asignar(admin, usuario, rol):
    c = APIClient()
    r = c.post("/api/auth/login/", {"email": admin.email, "password": CLAVE}, format="json")
    c.credentials(HTTP_AUTHORIZATION="Bearer " + r.json()["access"])
    resp = c.put(f"/api/usuarios/{usuario.pk}/rol/", {"rol": rol}, format="json")
    assert resp.status_code == 200, resp.json()


# --- Asignatura ---


def test_la_migracion_deja_las_asignaturas_base_activas():
    nombres = set(Asignatura.objects.filter(activa=True).values_list("nombre", flat=True))
    assert {"Matemáticas", "Español", "Inglés", "Física", "Química", "Biología"} <= nombres


def test_crear_asignatura_activa_por_defecto():
    a = Asignatura.objects.create(nombre="Robótica")
    assert a.activa and str(a) == "Robótica"


def test_nombre_de_asignatura_unico_sin_distinguir_mayusculas():
    Asignatura.objects.create(nombre="Robótica")
    with pytest.raises(IntegrityError), transaction.atomic():
        Asignatura.objects.create(nombre="ROBÓTICA")
    with pytest.raises(IntegrityError), transaction.atomic():
        Asignatura.objects.create(nombre="matemáticas")  # ya viene de la migración


def test_asignaturas_ordenadas_por_nombre():
    Asignatura.objects.all().delete()
    for n in ["Química", "Biología", "Física"]:
        Asignatura.objects.create(nombre=n)
    assert [a.nombre for a in Asignatura.objects.all()] == ["Biología", "Física", "Química"]


# --- PerfilTutor ---


def test_un_tutor_tiene_perfil_desde_que_se_crea(tutor):
    p = tutor.perfil_tutor
    assert p.usuario == tutor and not p.disponible and p.biografia == ""
    assert PerfilTutor.objects.filter(usuario=tutor).count() == 1


@pytest.mark.parametrize("rol", [Rol.ESTUDIANTE, Rol.COORDINADOR, Rol.ADMINISTRADOR])
def test_solo_los_tutores_pueden_tener_perfil(rol):
    with pytest.raises(ValidationError):
        PerfilTutor.objects.create(usuario=crear("x@colegio.edu.co", rol))


@pytest.mark.parametrize("rol", [Rol.ESTUDIANTE, Rol.COORDINADOR, Rol.ADMINISTRADOR])
def test_los_demas_roles_no_reciben_perfil_de_tutor(rol):
    assert not PerfilTutor.objects.filter(usuario=crear("x@colegio.edu.co", rol)).exists()


def test_un_usuario_tiene_un_solo_perfil(tutor):
    with pytest.raises(IntegrityError), transaction.atomic():
        PerfilTutor.objects.create(usuario=tutor)


def test_guardar_al_usuario_varias_veces_no_duplica_el_perfil(tutor):
    tutor.nombres = "Otro"
    tutor.save()
    tutor.save()
    assert PerfilTutor.objects.filter(usuario=tutor).count() == 1


def test_un_perfil_tiene_varias_asignaturas_y_una_asignatura_varios_tutores(tutor):
    otro = crear("otro@colegio.edu.co", Rol.TUTOR)
    mate = Asignatura.objects.get(nombre="Matemáticas")
    fisica = Asignatura.objects.get(nombre="Física")
    p1, p2 = tutor.perfil_tutor, otro.perfil_tutor
    p1.asignaturas.set([mate, fisica])
    p2.asignaturas.add(mate)

    assert set(p1.asignaturas.all()) == {mate, fisica}
    assert set(mate.tutores.all()) == {p1, p2}


def test_la_biografia_es_opcional_y_tiene_tope(tutor):
    p = tutor.perfil_tutor
    p.biografia = "x" * 1001
    with pytest.raises(ValidationError):
        p.full_clean()
    p.biografia = ""
    p.full_clean()


def test_borrar_al_usuario_borra_su_perfil_pero_no_las_asignaturas(tutor):
    mate = Asignatura.objects.get(nombre="Matemáticas")
    tutor.perfil_tutor.asignaturas.add(mate)
    tutor.delete()
    assert PerfilTutor.objects.count() == 0
    assert Asignatura.objects.filter(pk=mate.pk).exists()


# --- ciclo de vida al cambiar el rol ---


def test_al_asignar_rol_tutor_se_crea_el_perfil_vacio_y_no_disponible(admin):
    est = crear("ana@colegio.edu.co")
    assert not PerfilTutor.objects.filter(usuario=est).exists()
    asignar(admin, est, "tutor")
    perfil = PerfilTutor.objects.get(usuario=est)
    assert not perfil.disponible and perfil.biografia == ""
    assert PerfilTutor.objects.filter(usuario=est).count() == 1


def test_volver_a_asignar_tutor_no_duplica_ni_borra_el_perfil(admin):
    est = crear("ana@colegio.edu.co")
    asignar(admin, est, "tutor")
    perfil = PerfilTutor.objects.get(usuario=est)
    mate = Asignatura.objects.get(nombre="Matemáticas")
    perfil.asignaturas.add(mate)
    asignar(admin, est, "coordinador")
    asignar(admin, est, "tutor")
    assert PerfilTutor.objects.filter(usuario=est).count() == 1
    assert list(PerfilTutor.objects.get(usuario=est).asignaturas.all()) == [mate]


def test_al_quitar_el_rol_tutor_el_perfil_se_conserva_pero_no_disponible(admin, tutor):
    perfil = tutor.perfil_tutor
    perfil.disponible = True
    perfil.save()
    asignar(admin, tutor, "estudiante")
    perfil.refresh_from_db()
    assert perfil.pk and not perfil.disponible


def test_cambiar_entre_roles_que_no_son_tutor_no_toca_perfiles(admin):
    est = crear("ana@colegio.edu.co")
    asignar(admin, est, "coordinador")
    assert not PerfilTutor.objects.exists()


def test_si_falla_la_creacion_del_perfil_no_cambia_el_rol(admin, monkeypatch):
    est = crear("ana@colegio.edu.co")

    def falla(*a, **k):
        raise RuntimeError("fallo")

    monkeypatch.setattr(PerfilTutor.objects, "get_or_create", falla)
    from usuarios.gestion_roles import asignar_rol

    with pytest.raises(RuntimeError):
        asignar_rol(est, Rol.TUTOR, por=admin)
    est.refresh_from_db()
    assert est.rol == Rol.ESTUDIANTE
