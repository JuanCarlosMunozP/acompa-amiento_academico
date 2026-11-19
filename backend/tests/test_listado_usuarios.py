import pytest
from rest_framework.test import APIClient

from usuarios.models import Usuario
from usuarios.roles import Rol

pytestmark = pytest.mark.django_db

CLAVE = "Clave-segura-2026"
URL = "/api/usuarios/"


def crear(email, rol=Rol.ESTUDIANTE, nombres="N", apellidos="A", **extra):
    return Usuario.objects.create_user(
        email,
        CLAVE,
        nombres=nombres,
        apellidos=apellidos,
        email_verificado=True,
        rol=rol,
        **extra,
    )


def cliente(usuario):
    c = APIClient()
    r = c.post("/api/auth/login/", {"email": usuario.email, "password": CLAVE}, format="json")
    c.credentials(HTTP_AUTHORIZATION="Bearer " + r.json()["access"])
    return c


@pytest.fixture
def admin():
    return crear("admin@colegio.edu.co", Rol.ADMINISTRADOR, "Admin", "Zeta")


@pytest.fixture
def datos(admin):
    crear("ana@colegio.edu.co", Rol.ESTUDIANTE, "Ana", "Ruiz")
    crear("luis@colegio.edu.co", Rol.TUTOR, "Luis", "Pérez")
    crear("eva@colegio.edu.co", Rol.TUTOR, "Eva", "Gil")


def emails(r):
    return [u["email"] for u in r.json()["results"]]


def test_requiere_sesion():
    assert APIClient().get(URL).status_code == 401


def test_estudiantes_no_pueden_listar():
    assert cliente(crear("x@colegio.edu.co", Rol.ESTUDIANTE)).get(URL).status_code == 403


def test_tutor_sin_estudiantes_asignados_recibe_un_directorio_vacio():
    tutor = crear("tutor@colegio.edu.co", Rol.TUTOR)
    crear("estudiante@colegio.edu.co", Rol.ESTUDIANTE)

    respuesta = cliente(tutor).get(URL)

    assert respuesta.status_code == 200
    assert respuesta.json()["count"] == 0
    assert respuesta.json()["results"] == []


@pytest.mark.parametrize("rol", [Rol.ADMINISTRADOR, Rol.COORDINADOR])
def test_administrador_y_coordinador_pueden_listar(rol, datos):
    quien = crear("q@colegio.edu.co", rol)
    r = cliente(quien).get(URL)
    assert r.status_code == 200 and r.json()["count"] == 5


def test_cada_elemento_trae_lo_necesario_y_nada_sensible(admin, datos):
    (primero, *_) = cliente(admin).get(URL).json()["results"]
    assert set(primero) == {"id", "email", "nombres", "apellidos", "rol", "rol_nombre", "is_active"}


def test_orden_por_apellido_y_nombre(admin, datos):
    r = cliente(admin).get(URL)
    assert emails(r) == [
        "eva@colegio.edu.co",  # Gil
        "luis@colegio.edu.co",  # Pérez
        "ana@colegio.edu.co",  # Ruiz
        "admin@colegio.edu.co",  # Zeta
    ]


def test_filtro_por_rol(admin, datos):
    r = cliente(admin).get(URL, {"rol": "tutor"})
    assert sorted(emails(r)) == ["eva@colegio.edu.co", "luis@colegio.edu.co"]


def test_rol_invalido_es_400(admin):
    r = cliente(admin).get(URL, {"rol": "superheroe"})
    assert r.status_code == 400 and "rol" in r.json()["error"]["details"]


@pytest.mark.parametrize(
    ("q", "esperado"),
    [
        ("ruiz", ["ana@colegio.edu.co"]),
        ("LUIS", ["luis@colegio.edu.co"]),
        ("eva@", ["eva@colegio.edu.co"]),
        ("  gil  ", ["eva@colegio.edu.co"]),
        ("nadie", []),
    ],
)
def test_busqueda_por_nombre_apellido_o_correo(q, esperado, admin, datos):
    assert emails(cliente(admin).get(URL, {"q": q})) == esperado


def test_la_busqueda_trata_los_comodines_como_texto(admin, datos):
    assert emails(cliente(admin).get(URL, {"q": "%"})) == []


def test_busqueda_y_filtro_se_combinan(admin, datos):
    r = cliente(admin).get(URL, {"q": "colegio", "rol": "estudiante"})
    assert emails(r) == ["ana@colegio.edu.co"]


def test_paginacion(admin):
    for i in range(25):
        crear(f"u{i:02}@colegio.edu.co", apellidos=f"A{i:02}")
    c = cliente(admin)
    p1 = c.get(URL).json()
    assert p1["count"] == 26 and len(p1["results"]) == 20 and p1["next"]
    p2 = c.get(URL, {"page": 2}).json()
    assert len(p2["results"]) == 6 and p2["next"] is None
    assert c.get(URL, {"page": 99}).status_code == 404


def test_tamano_de_pagina_con_tope(admin):
    for i in range(60):
        crear(f"u{i:02}@colegio.edu.co")
    r = cliente(admin).get(URL, {"page_size": 500}).json()
    assert len(r["results"]) == 50
