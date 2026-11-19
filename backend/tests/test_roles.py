import pytest
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient

from usuarios.models import CambioRol, Usuario
from usuarios.roles import DESCRIPCIONES, ROL_POR_DEFECTO, Rol, catalogo

pytestmark = pytest.mark.django_db

CLAVE = "Clave-segura-2026"


def crear(email, rol=Rol.ESTUDIANTE, **extra):
    return Usuario.objects.create_user(
        email, CLAVE, nombres="N", apellidos="A", email_verificado=True, rol=rol, **extra
    )


def cliente(usuario):
    c = APIClient()
    r = c.post("/api/auth/login/", {"email": usuario.email, "password": CLAVE}, format="json")
    assert r.status_code == 200, r.json()
    c.credentials(HTTP_AUTHORIZATION="Bearer " + r.json()["access"])
    return c


@pytest.fixture
def admin():
    return crear("admin@colegio.edu.co", Rol.ADMINISTRADOR)


@pytest.fixture
def estudiante():
    return crear("ana@colegio.edu.co")


def url(usuario):
    return f"/api/usuarios/{usuario.pk}/rol/"


# --- T1: catálogo de roles en el usuario ---


def test_el_catalogo_define_los_roles_institucionales():
    assert [r.value for r in Rol] == [
        "estudiante",
        "acudiente",
        "tutor",
        "coordinador",
        "administrador",
        "superadmin",
    ]


def test_el_rol_tutor_se_presenta_como_docente():
    assert Rol.TUTOR.label == "Docente"


def test_todo_rol_tiene_descripcion():
    assert set(DESCRIPCIONES) == set(Rol)
    assert all(d.strip() for d in DESCRIPCIONES.values())


def test_catalogo_lista_codigo_nombre_y_descripcion():
    items = catalogo()
    assert len(items) == len(Rol)
    assert items[0] == {
        "codigo": "estudiante",
        "nombre": "Estudiante",
        "descripcion": DESCRIPCIONES[Rol.ESTUDIANTE],
    }


def test_un_usuario_nuevo_es_estudiante_por_defecto():
    u = Usuario.objects.create_user("x@colegio.edu.co", CLAVE, nombres="X", apellidos="Y")
    assert u.rol == ROL_POR_DEFECTO == Rol.ESTUDIANTE


def test_la_base_de_datos_rechaza_roles_fuera_del_catalogo():
    u = crear("ana@colegio.edu.co")
    with pytest.raises(IntegrityError), transaction.atomic():
        Usuario.objects.filter(pk=u.pk).update(rol="superheroe")


def test_cada_rol_del_catalogo_se_puede_guardar():
    for i, rol in enumerate(Rol):
        assert crear(f"u{i}@colegio.edu.co", rol).rol == rol


def test_el_registro_publico_siempre_crea_estudiantes():
    r = APIClient().post(
        "/api/auth/registro/",
        {
            "email": "nuevo@colegio.edu.co",
            "nombres": "N",
            "apellidos": "A",
            "password": CLAVE,
            "password_confirmacion": CLAVE,
            "rol": "administrador",
        },
        format="json",
    )
    assert r.status_code == 201 and r.json()["rol"] == "estudiante"


def test_el_superusuario_es_superadministrador():
    u = Usuario.objects.create_superuser("root@colegio.edu.co", CLAVE, nombres="R", apellidos="T")
    assert u.rol == Rol.SUPERADMIN


# --- T2: catálogo por API ---


def test_listar_roles_requiere_sesion():
    assert APIClient().get("/api/roles/").status_code == 401


def test_listar_roles(estudiante):
    r = cliente(estudiante).get("/api/roles/")
    assert r.status_code == 200
    assert [x["codigo"] for x in r.json()] == [x.value for x in Rol]


# --- T2: consultar ---


def test_consultar_requiere_sesion(estudiante):
    assert APIClient().get(url(estudiante)).status_code == 401


def test_cada_persona_consulta_su_propio_rol(estudiante):
    r = cliente(estudiante).get(url(estudiante))
    assert r.status_code == 200
    assert r.json() == {
        "id": estudiante.pk,
        "email": "ana@colegio.edu.co",
        "rol": "estudiante",
        "rol_nombre": "Estudiante",
        "descripcion": DESCRIPCIONES[Rol.ESTUDIANTE],
    }


def test_un_estudiante_no_consulta_el_rol_de_otro(estudiante):
    otro = crear("luis@colegio.edu.co")
    r = cliente(estudiante).get(url(otro))
    assert r.status_code == 403


def test_un_tutor_no_consulta_el_rol_de_otro():
    tutor = crear("t@colegio.edu.co", Rol.TUTOR)
    assert cliente(tutor).get(url(crear("e@colegio.edu.co"))).status_code == 403


@pytest.mark.parametrize("rol", [Rol.ADMINISTRADOR, Rol.COORDINADOR])
def test_administrador_y_coordinador_consultan_el_rol_de_cualquiera(rol, estudiante):
    quien = crear("q@colegio.edu.co", rol)
    r = cliente(quien).get(url(estudiante))
    assert r.status_code == 200 and r.json()["rol"] == "estudiante"


def test_consultar_un_usuario_inexistente(admin):
    r = cliente(admin).get("/api/usuarios/999999/rol/")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


# --- T2: asignar ---


def asignar(c, usuario, rol):
    return c.put(url(usuario), {"rol": rol}, format="json")


def test_el_administrador_asigna_un_rol(admin, estudiante):
    r = asignar(cliente(admin), estudiante, "tutor")
    assert r.status_code == 200
    assert r.json()["rol"] == "tutor" and r.json()["rol_nombre"] == "Docente"
    estudiante.refresh_from_db()
    assert estudiante.rol == Rol.TUTOR


def test_la_asignacion_deja_historial(admin, estudiante):
    asignar(cliente(admin), estudiante, "coordinador")
    (cambio,) = CambioRol.objects.all()
    assert cambio.usuario == estudiante and cambio.cambiado_por == admin
    assert (cambio.rol_anterior, cambio.rol_nuevo) == ("estudiante", "coordinador")


def test_asignar_el_mismo_rol_no_genera_historial(admin, estudiante):
    r = asignar(cliente(admin), estudiante, "estudiante")
    assert r.status_code == 200
    assert CambioRol.objects.count() == 0


@pytest.mark.parametrize("rol", [Rol.ESTUDIANTE, Rol.TUTOR, Rol.COORDINADOR])
def test_los_demas_roles_no_pueden_asignar(rol, estudiante):
    quien = crear("q@colegio.edu.co", rol)
    objetivo = estudiante if quien.pk != estudiante.pk else crear("z@colegio.edu.co")
    r = asignar(cliente(quien), objetivo, "administrador")
    assert r.status_code == 403
    objetivo.refresh_from_db()
    assert objetivo.rol == Rol.ESTUDIANTE


def test_asignar_requiere_sesion(estudiante):
    assert asignar(APIClient(), estudiante, "tutor").status_code == 401


def test_un_administrador_no_cambia_su_propio_rol(admin):
    r = asignar(cliente(admin), admin, "estudiante")
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "no_puedes_cambiar_tu_rol"
    admin.refresh_from_db()
    assert admin.rol == Rol.ADMINISTRADOR and CambioRol.objects.count() == 0


def test_un_administrador_puede_degradar_a_otro_administrador(admin):
    otro = crear("otro@colegio.edu.co", Rol.ADMINISTRADOR)
    assert asignar(cliente(admin), otro, "tutor").status_code == 200


def test_rol_fuera_del_catalogo_es_400(admin, estudiante):
    r = asignar(cliente(admin), estudiante, "superheroe")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "validation_error"
    assert "rol" in r.json()["error"]["details"]


def test_rol_obligatorio(admin, estudiante):
    r = cliente(admin).put(url(estudiante), {}, format="json")
    assert r.status_code == 400 and "rol" in r.json()["error"]["details"]


def test_asignar_a_un_usuario_inexistente(admin):
    r = cliente(admin).put("/api/usuarios/999999/rol/", {"rol": "tutor"}, format="json")
    assert r.status_code == 404


def test_el_cambio_aplica_de_inmediato_sin_volver_a_iniciar_sesion(admin, estudiante):
    c_est = cliente(estudiante)
    assert c_est.get("/api/auth/me/").json()["rol"] == "estudiante"
    asignar(cliente(admin), estudiante, "tutor")
    assert c_est.get("/api/auth/me/").json()["rol"] == "tutor"


def test_el_nuevo_administrador_ya_puede_asignar(admin, estudiante):
    asignar(cliente(admin), estudiante, "administrador")
    otro = crear("luis@colegio.edu.co")
    assert asignar(cliente(estudiante), otro, "tutor").status_code == 200


@pytest.mark.parametrize("metodo", ["post", "patch", "delete"])
def test_otros_metodos_no_estan_permitidos(metodo, admin, estudiante):
    r = getattr(cliente(admin), metodo)(url(estudiante), {"rol": "tutor"}, format="json")
    assert r.status_code == 405
