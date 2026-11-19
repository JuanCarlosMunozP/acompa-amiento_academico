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


def asig(nombre):
    return Asignatura.objects.get(nombre=nombre)


@pytest.fixture
def tutor():
    u = crear("tutor@colegio.edu.co", Rol.TUTOR, "Luis", "Pérez")
    PerfilTutor.objects.filter(usuario=u).update(habilitado=True)  # ya habilitado por coordinación
    return u


@pytest.fixture
def admin():
    return crear("admin@colegio.edu.co", Rol.ADMINISTRADOR)


# --- catálogo de asignaturas ---


def test_asignaturas_requiere_sesion():
    assert APIClient().get("/api/asignaturas/").status_code == 401


def test_asignaturas_lista_solo_las_activas(tutor):
    Asignatura.objects.filter(nombre="Química").update(activa=False)
    r = cliente(tutor).get("/api/asignaturas/")
    nombres = [a["nombre"] for a in r.json()]
    assert r.status_code == 200 and "Matemáticas" in nombres and "Química" not in nombres
    assert set(r.json()[0]) == {"id", "nombre"}


# --- consultar el propio perfil ---


def test_el_tutor_consulta_su_perfil(tutor):
    r = cliente(tutor).get(MI_PERFIL)
    assert r.status_code == 200
    assert r.json() == {
        "id": tutor.perfil_tutor.pk,
        "usuario": {
            "id": tutor.pk,
            "email": "tutor@colegio.edu.co",
            "nombres": "Luis",
            "apellidos": "Pérez",
        },
        "biografia": "",
        "asignaturas": [],
        "disponible": False,
        "habilitado": True,
        "fecha_habilitacion": None,
    }


def test_requiere_sesion():
    assert APIClient().get(MI_PERFIL).status_code == 401
    assert APIClient().patch(MI_PERFIL, {}, format="json").status_code == 401


@pytest.mark.parametrize("rol", [Rol.ESTUDIANTE, Rol.COORDINADOR, Rol.ADMINISTRADOR])
def test_quien_no_es_tutor_no_tiene_perfil_de_tutor(rol):
    quien = crear("x@colegio.edu.co", rol)
    c = cliente(quien)
    assert c.get(MI_PERFIL).status_code == 403
    assert c.patch(MI_PERFIL, {"biografia": "x"}, format="json").status_code == 403
    assert not PerfilTutor.objects.filter(usuario=quien).exists()


def test_si_a_un_tutor_le_falta_el_perfil_se_crea_al_consultar(tutor):
    PerfilTutor.objects.filter(usuario=tutor).delete()  # p. ej. cuenta anterior a los perfiles
    assert cliente(tutor).get(MI_PERFIL).status_code == 200
    assert PerfilTutor.objects.filter(usuario=tutor).count() == 1


# --- actualizar ---


def test_actualiza_biografia_asignaturas_y_disponibilidad(tutor):
    mate, fisica = asig("Matemáticas"), asig("Física")
    r = cliente(tutor).patch(
        MI_PERFIL,
        {
            "biografia": "Licenciado en física.",
            "asignaturas": [mate.pk, fisica.pk],
            "disponible": True,
        },
        format="json",
    )
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["biografia"] == "Licenciado en física." and cuerpo["disponible"] is True
    assert {a["nombre"] for a in cuerpo["asignaturas"]} == {"Matemáticas", "Física"}

    perfil = PerfilTutor.objects.get(usuario=tutor)
    assert perfil.biografia == "Licenciado en física." and perfil.disponible
    assert set(perfil.asignaturas.all()) == {mate, fisica}


def test_el_cambio_queda_guardado_al_volver_a_consultar(tutor):
    c = cliente(tutor)
    c.patch(MI_PERFIL, {"biografia": "Hola", "asignaturas": [asig("Inglés").pk]}, format="json")
    r = c.get(MI_PERFIL).json()
    assert r["biografia"] == "Hola" and [a["nombre"] for a in r["asignaturas"]] == ["Inglés"]


def test_solo_cambia_lo_que_se_envia(tutor):
    c = cliente(tutor)
    c.patch(
        MI_PERFIL,
        {"biografia": "Original", "asignaturas": [asig("Inglés").pk], "disponible": True},
        format="json",
    )
    r = c.patch(MI_PERFIL, {"biografia": "Nueva"}, format="json").json()
    assert r["biografia"] == "Nueva" and r["disponible"] is True
    assert [a["nombre"] for a in r["asignaturas"]] == ["Inglés"]


def test_enviar_una_lista_vacia_quita_las_asignaturas_y_exige_dejar_de_estar_disponible(tutor):
    c = cliente(tutor)
    c.patch(MI_PERFIL, {"asignaturas": [asig("Inglés").pk], "disponible": True}, format="json")
    r = c.patch(MI_PERFIL, {"asignaturas": []}, format="json")
    assert r.status_code == 400 and "disponible" in r.json()["error"]["details"]
    r = c.patch(MI_PERFIL, {"asignaturas": [], "disponible": False}, format="json")
    assert r.status_code == 200 and r.json()["asignaturas"] == []


def test_no_puede_estar_disponible_sin_asignaturas(tutor):
    r = cliente(tutor).patch(MI_PERFIL, {"disponible": True}, format="json")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "validation_error"
    assert "disponible" in r.json()["error"]["details"]
    assert not PerfilTutor.objects.get(usuario=tutor).disponible


def test_una_peticion_invalida_no_cambia_nada(tutor):
    c = cliente(tutor)
    c.patch(MI_PERFIL, {"biografia": "Original"}, format="json")
    r = c.patch(MI_PERFIL, {"biografia": "Cambio", "asignaturas": [999999]}, format="json")
    assert r.status_code == 400
    assert PerfilTutor.objects.get(usuario=tutor).biografia == "Original"


def test_asignatura_inexistente_o_inactiva(tutor):
    Asignatura.objects.filter(nombre="Química").update(activa=False)
    c = cliente(tutor)
    for ids in ([999999], [asig("Química").pk]):
        r = c.patch(MI_PERFIL, {"asignaturas": ids}, format="json")
        assert r.status_code == 400 and "asignaturas" in r.json()["error"]["details"]


def test_asignaturas_repetidas_se_guardan_una_sola_vez(tutor):
    pk = asig("Inglés").pk
    r = cliente(tutor).patch(MI_PERFIL, {"asignaturas": [pk, pk, pk]}, format="json")
    assert r.status_code == 200 and len(r.json()["asignaturas"]) == 1


def test_biografia_con_tope_de_1000_caracteres(tutor):
    c = cliente(tutor)
    assert c.patch(MI_PERFIL, {"biografia": "x" * 1000}, format="json").status_code == 200
    r = c.patch(MI_PERFIL, {"biografia": "x" * 1001}, format="json")
    assert r.status_code == 400 and "biografia" in r.json()["error"]["details"]


def test_la_biografia_se_limpia_de_espacios(tutor):
    r = cliente(tutor).patch(MI_PERFIL, {"biografia": "   hola   "}, format="json")
    assert r.json()["biografia"] == "hola"


def test_tipos_incorrectos_son_400(tutor):
    c = cliente(tutor)
    assert c.patch(MI_PERFIL, {"asignaturas": "uno"}, format="json").status_code == 400
    assert c.patch(MI_PERFIL, {"asignaturas": ["a"]}, format="json").status_code == 400
    assert c.patch(MI_PERFIL, {"disponible": "quizás"}, format="json").status_code == 400


def test_no_se_pueden_modificar_campos_ajenos_al_perfil(tutor):
    r = cliente(tutor).patch(
        MI_PERFIL, {"rol": "administrador", "usuario": {"email": "otro@x.co"}}, format="json"
    )
    assert r.status_code == 200
    tutor.refresh_from_db()
    assert tutor.rol == Rol.TUTOR and tutor.email == "tutor@colegio.edu.co"


def test_un_tutor_solo_modifica_su_propio_perfil(tutor):
    otro = crear("otro@colegio.edu.co", Rol.TUTOR)
    cliente(tutor).patch(MI_PERFIL, {"biografia": "Mía"}, format="json")
    assert PerfilTutor.objects.get(usuario=otro).biografia == ""


def test_put_no_esta_permitido(tutor):
    assert cliente(tutor).put(MI_PERFIL, {"biografia": "x"}, format="json").status_code == 405


# --- ver y listar tutores (asignación institucional) ---


@pytest.fixture
def tutores():
    t1 = crear("luis@colegio.edu.co", Rol.TUTOR, "Luis", "Pérez")
    t2 = crear("eva@colegio.edu.co", Rol.TUTOR, "Eva", "Gil")
    t3 = crear("ana@colegio.edu.co", Rol.TUTOR, "Ana", "Zúñiga")
    PerfilTutor.objects.filter(usuario__in=[t1, t2, t3]).update(habilitado=True)
    for t, materias, disp in [
        (t1, ["Matemáticas", "Física"], True),
        (t2, ["Matemáticas"], False),
        (t3, ["Inglés"], True),
    ]:
        c = cliente(t)
        c.patch(MI_PERFIL, {"asignaturas": [asig(m).pk for m in materias]}, format="json")
        c.patch(MI_PERFIL, {"disponible": disp}, format="json")
    return t1, t2, t3


def correos(r):
    return [p["usuario"]["email"] for p in r.json()["results"]]


@pytest.mark.parametrize("rol", [Rol.ADMINISTRADOR, Rol.COORDINADOR])
def test_administrador_y_coordinador_ven_el_perfil_de_un_tutor(rol, tutor):
    quien = crear("q@colegio.edu.co", rol)
    r = cliente(quien).get(f"/api/tutores/{tutor.pk}/perfil/")
    assert r.status_code == 200 and r.json()["usuario"]["email"] == "tutor@colegio.edu.co"


@pytest.mark.parametrize("rol", [Rol.ESTUDIANTE, Rol.TUTOR])
def test_estudiantes_y_tutores_no_ven_perfiles_ajenos(rol, tutor):
    quien = crear("q@colegio.edu.co", rol)
    assert cliente(quien).get(f"/api/tutores/{tutor.pk}/perfil/").status_code == 403
    assert cliente(quien).get("/api/tutores/").status_code == 403


def test_perfil_de_alguien_que_no_es_tutor_o_no_existe_es_404(admin):
    est = crear("ana@colegio.edu.co")
    c = cliente(admin)
    assert c.get(f"/api/tutores/{est.pk}/perfil/").status_code == 404
    assert c.get("/api/tutores/999999/perfil/").status_code == 404


def test_listar_tutores_ordenados_por_apellido(admin, tutores):
    r = cliente(admin).get("/api/tutores/")
    assert r.status_code == 200 and r.json()["count"] == 3
    assert correos(r) == ["eva@colegio.edu.co", "luis@colegio.edu.co", "ana@colegio.edu.co"]
    assert [
        a["nombre"] for a in r.json()["results"][1]["asignaturas"]
    ] and "disponible" in r.json()["results"][0]


def test_filtrar_tutores_por_asignatura(admin, tutores):
    r = cliente(admin).get("/api/tutores/", {"asignatura": asig("Matemáticas").pk})
    assert correos(r) == ["eva@colegio.edu.co", "luis@colegio.edu.co"]


def test_sin_filtro_de_disponibilidad_salen_todos(admin, tutores):
    # Un booleano ausente en la URL no debe tomarse como `disponible=false`.
    assert cliente(admin).get("/api/tutores/").json()["count"] == 3


def test_filtrar_tutores_por_disponibilidad(admin, tutores):
    c = cliente(admin)
    assert correos(c.get("/api/tutores/", {"disponible": "true"})) == [
        "luis@colegio.edu.co",
        "ana@colegio.edu.co",
    ]
    assert correos(c.get("/api/tutores/", {"disponible": "false"})) == ["eva@colegio.edu.co"]


def test_filtros_combinados_y_busqueda(admin, tutores):
    c = cliente(admin)
    r = c.get("/api/tutores/", {"asignatura": asig("Matemáticas").pk, "disponible": "true"})
    assert correos(r) == ["luis@colegio.edu.co"]
    assert correos(c.get("/api/tutores/", {"q": "gil"})) == ["eva@colegio.edu.co"]


def test_un_tutor_con_varias_asignaturas_no_sale_repetido(admin, tutores):
    r = cliente(admin).get("/api/tutores/", {"asignatura": asig("Física").pk})
    assert correos(r) == ["luis@colegio.edu.co"] and r.json()["count"] == 1


def test_parametros_invalidos_son_400(admin):
    c = cliente(admin)
    assert c.get("/api/tutores/", {"asignatura": "abc"}).status_code == 400
    assert c.get("/api/tutores/", {"disponible": "tal vez"}).status_code == 400


def test_no_lista_a_quien_ya_no_es_tutor_ni_a_cuentas_inactivas(admin, tutores):
    t1, t2, _ = tutores
    Usuario.objects.filter(pk=t1.pk).update(rol=Rol.ESTUDIANTE)
    Usuario.objects.filter(pk=t2.pk).update(is_active=False)
    assert correos(cliente(admin).get("/api/tutores/")) == ["ana@colegio.edu.co"]


def test_el_listado_no_hace_una_consulta_por_tutor(admin, tutores, django_assert_max_num_queries):
    c = cliente(admin)
    with django_assert_max_num_queries(8):
        assert c.get("/api/tutores/").status_code == 200
