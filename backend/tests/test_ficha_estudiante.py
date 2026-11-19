"""HU-01.06.T2: ficha del estudiante (consulta, asignación de grupo y listado)."""

import pytest
from rest_framework.test import APIClient

from usuarios.models import Grado, Grupo, PerfilEstudiante, Usuario
from usuarios.roles import Rol

pytestmark = pytest.mark.django_db

CLAVE = "Clave-segura-2026"


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


@pytest.fixture
def admin():
    return crear("admin@colegio.edu.co", Rol.ADMINISTRADOR)


@pytest.fixture
def coordinador():
    return crear("coord@colegio.edu.co", Rol.COORDINADOR)


@pytest.fixture
def sexto():
    return Grado.objects.create(nombre="Sexto", orden=6)


@pytest.fixture
def sexto_a(sexto):
    return Grupo.objects.create(grado=sexto, nombre="A")


@pytest.fixture
def ana():
    return crear("ana@colegio.edu.co", nombres="Ana", apellidos="Ruiz")


def ficha(u):
    return f"/api/estudiantes/{u.pk}/ficha/"


# --- catálogo de grados ---


def test_grados_requiere_sesion():
    assert APIClient().get("/api/grados/").status_code == 401


def test_grados_lista_solo_lo_activo_con_sus_grupos(ana, sexto, sexto_a):
    Grupo.objects.create(grado=sexto, nombre="B", activo=False)
    Grado.objects.create(nombre="Séptimo", orden=7, activo=False)
    septimo = Grado.objects.create(nombre="Octavo", orden=8)
    r = cliente(ana).get("/api/grados/")
    assert r.status_code == 200
    assert r.json() == [
        {"id": sexto.pk, "nombre": "Sexto", "grupos": [{"id": sexto_a.pk, "nombre": "A"}]},
        {"id": septimo.pk, "nombre": "Octavo", "grupos": []},
    ]


# --- mi ficha ---


def test_el_estudiante_ve_su_ficha_sin_grupo_al_inicio(ana):
    r = cliente(ana).get("/api/mi-ficha/")
    assert r.status_code == 200
    assert r.json() == {
        "id": ana.perfil_estudiante.pk,
        "usuario": {
            "id": ana.pk,
            "email": "ana@colegio.edu.co",
            "nombres": "Ana",
            "apellidos": "Ruiz",
        },
        "grado": None,
        "grupo": None,
        "trabajos_pendientes": 0,
    }


def test_la_ficha_muestra_grado_y_grupo_cuando_se_asignan(ana, sexto_a):
    perfil = ana.perfil_estudiante
    perfil.grupo = sexto_a
    perfil.save()
    cuerpo = cliente(ana).get("/api/mi-ficha/").json()
    assert cuerpo["grado"] == {"id": sexto_a.grado.pk, "nombre": "Sexto"}
    assert cuerpo["grupo"]["nombre"] == "A" and cuerpo["grupo"]["grado"]["nombre"] == "Sexto"


def test_mi_ficha_requiere_sesion_y_rol_estudiante():
    assert APIClient().get("/api/mi-ficha/").status_code == 401
    for rol in (Rol.TUTOR, Rol.COORDINADOR, Rol.ADMINISTRADOR):
        assert (
            cliente(crear(f"{rol.value}@colegio.edu.co", rol)).get("/api/mi-ficha/").status_code
            == 403
        )


def test_si_al_estudiante_le_falta_la_ficha_se_crea_al_consultar(ana):
    PerfilEstudiante.objects.filter(usuario=ana).delete()
    assert cliente(ana).get("/api/mi-ficha/").status_code == 200
    assert PerfilEstudiante.objects.filter(usuario=ana).count() == 1


def test_el_estudiante_no_puede_cambiarse_el_grupo(ana, sexto_a):
    c = cliente(ana)
    assert c.patch("/api/mi-ficha/", {"grupo": sexto_a.pk}, format="json").status_code == 405
    assert c.patch(ficha(ana), {"grupo": sexto_a.pk}, format="json").status_code == 403
    assert PerfilEstudiante.objects.get(usuario=ana).grupo is None


# --- ficha vista y editada por coordinación ---


@pytest.mark.parametrize("rol", ["admin", "coordinador"])
def test_administrador_y_coordinador_asignan_el_grupo(rol, ana, sexto_a, admin, coordinador):
    quien = admin if rol == "admin" else coordinador
    r = cliente(quien).patch(ficha(ana), {"grupo": sexto_a.pk}, format="json")
    assert r.status_code == 200
    assert r.json()["grupo"]["id"] == sexto_a.pk and r.json()["grado"]["nombre"] == "Sexto"
    assert PerfilEstudiante.objects.get(usuario=ana).grupo == sexto_a


def test_se_puede_cambiar_de_grupo_y_quitarlo(ana, sexto, sexto_a, admin):
    sexto_b = Grupo.objects.create(grado=sexto, nombre="B")
    c = cliente(admin)
    c.patch(ficha(ana), {"grupo": sexto_a.pk}, format="json")
    assert (
        c.patch(ficha(ana), {"grupo": sexto_b.pk}, format="json").json()["grupo"]["nombre"] == "B"
    )
    r = c.patch(ficha(ana), {"grupo": None}, format="json")
    assert r.status_code == 200 and r.json()["grupo"] is None and r.json()["grado"] is None


def test_no_se_asigna_un_grupo_inexistente_o_inactivo(ana, sexto, admin):
    inactivo = Grupo.objects.create(grado=sexto, nombre="Z", activo=False)
    c = cliente(admin)
    for valor in (999999, inactivo.pk):
        r = c.patch(ficha(ana), {"grupo": valor}, format="json")
        assert r.status_code == 400 and "grupo" in r.json()["error"]["details"]
    assert PerfilEstudiante.objects.get(usuario=ana).grupo is None


def test_no_se_asigna_un_grupo_de_un_grado_inactivo(ana, admin):
    grado = Grado.objects.create(nombre="Antiguo", orden=1, activo=False)
    grupo = Grupo.objects.create(grado=grado, nombre="A")
    assert cliente(admin).patch(ficha(ana), {"grupo": grupo.pk}, format="json").status_code == 400


def test_el_grupo_es_obligatorio_y_debe_ser_numero(ana, admin):
    c = cliente(admin)
    assert c.patch(ficha(ana), {}, format="json").status_code == 400
    assert c.patch(ficha(ana), {"grupo": "A"}, format="json").status_code == 400


def test_un_grupo_inactivo_no_afecta_a_quien_ya_estaba_en_el_(ana, sexto_a, admin):
    cliente(admin).patch(ficha(ana), {"grupo": sexto_a.pk}, format="json")
    sexto_a.activo = False
    sexto_a.save()
    # Sigue viendo su ficha con el grupo que tenía.
    assert cliente(ana).get("/api/mi-ficha/").json()["grupo"]["nombre"] == "A"


def test_solo_coordinacion_ve_la_ficha_de_otros(ana, admin):
    otro = crear("otro@colegio.edu.co")
    tutor = crear("t@colegio.edu.co", Rol.TUTOR)
    assert cliente(admin).get(ficha(ana)).status_code == 200
    assert cliente(otro).get(ficha(ana)).status_code == 403
    assert cliente(tutor).get(ficha(ana)).status_code == 403
    assert APIClient().get(ficha(ana)).status_code == 401


def test_la_ficha_solo_existe_para_estudiantes(admin):
    tutor = crear("t@colegio.edu.co", Rol.TUTOR)
    c = cliente(admin)
    assert c.get(ficha(tutor)).status_code == 404
    assert c.get("/api/estudiantes/999999/ficha/").status_code == 404


def test_borrar_el_grupo_de_un_estudiante_esta_protegido(ana, sexto_a, admin):
    cliente(admin).patch(ficha(ana), {"grupo": sexto_a.pk}, format="json")
    from django.db.models import ProtectedError

    with pytest.raises(ProtectedError):
        sexto_a.delete()


# --- listado de estudiantes ---


@pytest.fixture
def estudiantes(sexto, sexto_a, admin):
    sexto_b = Grupo.objects.create(grado=sexto, nombre="B")
    octavo = Grado.objects.create(nombre="Octavo", orden=8)
    octavo_a = Grupo.objects.create(grado=octavo, nombre="A")
    datos = [
        ("ana@colegio.edu.co", "Ana", "Ruiz", sexto_a),
        ("luis@colegio.edu.co", "Luis", "Pérez", sexto_b),
        ("eva@colegio.edu.co", "Eva", "Gil", octavo_a),
        ("sol@colegio.edu.co", "Sol", "Díaz", None),
    ]
    for email, n, a, g in datos:
        u = crear(email, nombres=n, apellidos=a)
        PerfilEstudiante.objects.filter(usuario=u).update(grupo=g)
    return sexto, sexto_a, sexto_b, octavo, octavo_a


def correos(r):
    return [f["usuario"]["email"] for f in r.json()["results"]]


def test_listar_estudiantes_ordenados_por_apellido(admin, estudiantes):
    r = cliente(admin).get("/api/estudiantes/")
    assert r.status_code == 200 and r.json()["count"] == 4
    assert correos(r) == [
        "sol@colegio.edu.co",
        "eva@colegio.edu.co",
        "luis@colegio.edu.co",
        "ana@colegio.edu.co",
    ]


def test_filtrar_por_grado_y_por_grupo(admin, estudiantes):
    sexto, sexto_a, _, octavo, _ = estudiantes
    c = cliente(admin)
    assert sorted(correos(c.get("/api/estudiantes/", {"grado": sexto.pk}))) == [
        "ana@colegio.edu.co",
        "luis@colegio.edu.co",
    ]
    assert correos(c.get("/api/estudiantes/", {"grupo": sexto_a.pk})) == ["ana@colegio.edu.co"]
    assert correos(c.get("/api/estudiantes/", {"grado": octavo.pk})) == ["eva@colegio.edu.co"]


def test_filtrar_estudiantes_sin_grupo_y_con_grupo(admin, estudiantes):
    c = cliente(admin)
    assert correos(c.get("/api/estudiantes/", {"sin_grupo": "true"})) == ["sol@colegio.edu.co"]
    assert c.get("/api/estudiantes/", {"sin_grupo": "false"}).json()["count"] == 3
    assert c.get("/api/estudiantes/").json()["count"] == 4  # un booleano ausente no filtra


def test_buscar_estudiantes_y_combinar_filtros(admin, estudiantes):
    sexto = estudiantes[0]
    c = cliente(admin)
    assert correos(c.get("/api/estudiantes/", {"q": "gil"})) == ["eva@colegio.edu.co"]
    assert correos(
        c.get("/api/estudiantes/", {"q": "colegio", "grado": sexto.pk, "sin_grupo": "false"})
    ) == [
        "luis@colegio.edu.co",
        "ana@colegio.edu.co",
    ]


def test_el_listado_solo_incluye_estudiantes_activos(admin, estudiantes):
    Usuario.objects.filter(email="ana@colegio.edu.co").update(is_active=False)
    Usuario.objects.filter(email="luis@colegio.edu.co").update(rol=Rol.TUTOR)
    assert "ana@colegio.edu.co" not in correos(cliente(admin).get("/api/estudiantes/"))
    assert "luis@colegio.edu.co" not in correos(cliente(admin).get("/api/estudiantes/"))


def test_el_listado_es_solo_para_coordinacion(estudiantes):
    est = Usuario.objects.get(email="ana@colegio.edu.co")
    assert cliente(est).get("/api/estudiantes/").status_code == 403
    assert APIClient().get("/api/estudiantes/").status_code == 401


def test_filtros_invalidos_son_400(admin):
    c = cliente(admin)
    assert c.get("/api/estudiantes/", {"grado": "x"}).status_code == 400
    assert c.get("/api/estudiantes/", {"sin_grupo": "tal vez"}).status_code == 400


def test_el_listado_no_hace_una_consulta_por_estudiante(
    admin, estudiantes, django_assert_max_num_queries
):
    c = cliente(admin)
    with django_assert_max_num_queries(8):
        assert c.get("/api/estudiantes/").status_code == 200
