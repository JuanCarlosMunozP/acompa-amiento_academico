import importlib

import pytest
from django.apps import apps as apps_reales
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from rest_framework.test import APIClient

from usuarios.models import Asignatura, Grado, Grupo, PerfilEstudiante, PerfilTutor, Usuario
from usuarios.roles import Rol

pytestmark = pytest.mark.django_db

CLAVE = "Clave-segura-2026"


def crear(email, rol=Rol.ESTUDIANTE):
    return Usuario.objects.create_user(
        email, CLAVE, nombres="N", apellidos="A", email_verificado=True, rol=rol
    )


@pytest.fixture
def sexto():
    return Grado.objects.create(nombre="Sexto", orden=6)


@pytest.fixture
def grupo(sexto):
    return Grupo.objects.create(grado=sexto, nombre="A")


def asignar(admin, usuario, rol):
    c = APIClient()
    r = c.post("/api/auth/login/", {"email": admin.email, "password": CLAVE}, format="json")
    c.credentials(HTTP_AUTHORIZATION="Bearer " + r.json()["access"])
    assert c.put(f"/api/usuarios/{usuario.pk}/rol/", {"rol": rol}, format="json").status_code == 200


# --- Grado y Grupo ---


def test_grado_y_su_representacion(sexto):
    assert str(sexto) == "Sexto" and sexto.activo


def test_nombre_de_grado_unico_sin_distinguir_mayusculas(sexto):
    with pytest.raises(IntegrityError), transaction.atomic():
        Grado.objects.create(nombre="SEXTO", orden=1)


def test_los_grados_se_ordenan_por_orden_y_no_por_nombre():
    for nombre, orden in [("Undécimo", 11), ("Sexto", 6), ("Noveno", 9)]:
        Grado.objects.create(nombre=nombre, orden=orden)
    assert [g.nombre for g in Grado.objects.all()] == ["Sexto", "Noveno", "Undécimo"]


def test_grupo_se_muestra_con_su_grado(grupo):
    assert str(grupo) == "Sexto A" and grupo.activo


def test_el_nombre_del_grupo_es_unico_dentro_del_grado(sexto, grupo):
    with pytest.raises(IntegrityError), transaction.atomic():
        Grupo.objects.create(grado=sexto, nombre="a")


def test_el_mismo_nombre_de_grupo_se_puede_repetir_en_otro_grado(grupo):
    septimo = Grado.objects.create(nombre="Séptimo", orden=7)
    assert Grupo.objects.create(grado=septimo, nombre="A").pk


def test_un_grado_con_grupos_no_se_puede_borrar(sexto, grupo):
    with pytest.raises(ProtectedError):
        sexto.delete()


def test_los_grupos_se_ordenan_por_grado_y_nombre():
    octavo = Grado.objects.create(nombre="Octavo", orden=8)
    sexto = Grado.objects.create(nombre="Sexto", orden=6)
    for g, n in [(octavo, "A"), (sexto, "B"), (sexto, "A")]:
        Grupo.objects.create(grado=g, nombre=n)
    assert [str(x) for x in Grupo.objects.all()] == ["Sexto A", "Sexto B", "Octavo A"]


# --- PerfilEstudiante ---


def test_un_estudiante_tiene_perfil_desde_que_se_crea_sin_grupo():
    est = crear("ana@colegio.edu.co")
    assert est.perfil_estudiante.grupo is None and est.perfil_estudiante.grado is None


def test_el_registro_publico_crea_el_perfil_del_estudiante():
    r = APIClient().post(
        "/api/auth/registro/",
        {
            "email": "nuevo@colegio.edu.co",
            "nombres": "N",
            "apellidos": "A",
            "password": CLAVE,
            "password_confirmacion": CLAVE,
        },
        format="json",
    )
    assert r.status_code == 201
    assert PerfilEstudiante.objects.filter(usuario__email="nuevo@colegio.edu.co").count() == 1


def test_el_estudiante_se_relaciona_con_grupo_y_el_grado_sale_del_grupo(grupo):
    perfil = crear("ana@colegio.edu.co").perfil_estudiante
    perfil.grupo = grupo
    perfil.save()
    perfil.refresh_from_db()
    assert perfil.grupo == grupo
    assert perfil.grado == grupo.grado and perfil.grado.nombre == "Sexto"


def test_se_listan_los_estudiantes_de_un_grupo_y_de_un_grado(grupo):
    otro_grupo = Grupo.objects.create(grado=grupo.grado, nombre="B")
    for email, g in [
        ("a@colegio.edu.co", grupo),
        ("b@colegio.edu.co", grupo),
        ("c@colegio.edu.co", otro_grupo),
    ]:
        p = crear(email).perfil_estudiante
        p.grupo = g
        p.save()
    assert grupo.estudiantes.count() == 2
    assert PerfilEstudiante.objects.filter(grupo__grado=grupo.grado).count() == 3


def test_un_grupo_con_estudiantes_no_se_puede_borrar(grupo):
    p = crear("ana@colegio.edu.co").perfil_estudiante
    p.grupo = grupo
    p.save()
    with pytest.raises(ProtectedError):
        grupo.delete()


def test_borrar_al_estudiante_borra_su_perfil_pero_no_el_grupo(grupo):
    est = crear("ana@colegio.edu.co")
    est.perfil_estudiante.grupo = grupo
    est.perfil_estudiante.save()
    est.delete()
    assert PerfilEstudiante.objects.count() == 0 and Grupo.objects.filter(pk=grupo.pk).exists()


@pytest.mark.parametrize("rol", [Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR])
def test_solo_los_estudiantes_pueden_tener_perfil_de_estudiante(rol):
    with pytest.raises(ValidationError):
        PerfilEstudiante.objects.create(usuario=crear("x@colegio.edu.co", rol))


@pytest.mark.parametrize("rol", [Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR])
def test_los_demas_roles_no_reciben_perfil_de_estudiante(rol):
    assert not PerfilEstudiante.objects.filter(usuario=crear("x@colegio.edu.co", rol)).exists()


def test_un_usuario_tiene_un_solo_perfil_de_estudiante():
    est = crear("ana@colegio.edu.co")
    with pytest.raises(IntegrityError), transaction.atomic():
        PerfilEstudiante.objects.create(usuario=est)


# --- ciclo de vida al cambiar el rol ---


def test_un_estudiante_que_pasa_a_tutor_conserva_su_perfil_y_recibe_el_de_tutor(grupo):
    admin = crear("admin@colegio.edu.co", Rol.ADMINISTRADOR)
    est = crear("ana@colegio.edu.co")
    est.perfil_estudiante.grupo = grupo
    est.perfil_estudiante.save()

    asignar(admin, est, "tutor")

    assert PerfilTutor.objects.filter(usuario=est).count() == 1
    assert PerfilEstudiante.objects.get(usuario=est).grupo == grupo  # no se pierde su grupo


def test_quien_vuelve_a_ser_estudiante_recupera_el_mismo_perfil(grupo):
    admin = crear("admin@colegio.edu.co", Rol.ADMINISTRADOR)
    est = crear("ana@colegio.edu.co")
    est.perfil_estudiante.grupo = grupo
    est.perfil_estudiante.save()
    asignar(admin, est, "tutor")
    asignar(admin, est, "estudiante")
    assert PerfilEstudiante.objects.filter(usuario=est).count() == 1
    assert PerfilEstudiante.objects.get(usuario=est).grupo == grupo


def test_un_tutor_al_que_se_le_da_rol_de_estudiante_recibe_perfil_de_estudiante():
    admin = crear("admin@colegio.edu.co", Rol.ADMINISTRADOR)
    tutor = crear("t@colegio.edu.co", Rol.TUTOR)
    assert not PerfilEstudiante.objects.filter(usuario=tutor).exists()
    asignar(admin, tutor, "estudiante")
    assert PerfilEstudiante.objects.filter(usuario=tutor).exists()


def test_cambiar_el_rol_desde_el_panel_de_administracion_tambien_crea_el_perfil():
    # El panel guarda con .save(): la señal cubre ese camino además de la API.
    u = crear("ana@colegio.edu.co", Rol.COORDINADOR)
    u.rol = Rol.TUTOR
    u.save()
    assert PerfilTutor.objects.filter(usuario=u).exists()


# --- migración de datos ---


def _migracion():
    return importlib.import_module("usuarios.migrations.0007_datos_iniciales")


def test_la_migracion_crea_los_perfiles_que_faltan_y_no_duplica():
    est = crear("ana@colegio.edu.co")
    tutor = crear("t@colegio.edu.co", Rol.TUTOR)
    # Cuentas anteriores a que existieran los perfiles:
    PerfilEstudiante.objects.filter(usuario=est).delete()
    PerfilTutor.objects.filter(usuario=tutor).delete()

    _migracion().crear_datos_iniciales(apps_reales, None)
    _migracion().crear_datos_iniciales(apps_reales, None)  # idempotente

    assert PerfilEstudiante.objects.filter(usuario=est).count() == 1
    assert PerfilTutor.objects.filter(usuario=tutor).count() == 1


def test_la_migracion_no_duplica_ni_pisa_las_asignaturas_existentes():
    Asignatura.objects.filter(nombre="Física").update(nombre="FÍSICA", activa=False)
    _migracion().crear_datos_iniciales(apps_reales, None)
    fisica = Asignatura.objects.filter(nombre__iexact="Física")
    assert fisica.count() == 1 and fisica.get().activa is False


def test_registro_sin_verificacion_de_correo_crea_la_cuenta_verificada_y_no_envia_correo(
    settings, mailoutbox
):
    settings.REGISTRO_VERIFICA_CORREO = False
    r = APIClient().post(
        "/api/auth/registro/",
        {
            "email": "directo@colegio.edu.co",
            "nombres": "D",
            "apellidos": "R",
            "password": CLAVE,
            "password_confirmacion": CLAVE,
        },
        format="json",
    )
    assert r.status_code == 201
    assert r.json()["email_verificado"] is True
    assert mailoutbox == []
