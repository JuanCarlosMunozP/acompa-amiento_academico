"""EP-02: institución y sedes, grados y grupos, asignaturas, periodos y días no hábiles."""

import datetime

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from academico.models import DiaNoHabil, Institucion, Matricula, PeriodoAcademico, Sede
from academico.servicios import es_dia_habil, validar_dia_habil
from usuarios.models import Asignatura, Grado, Grupo, PerfilEstudiante, Usuario
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
    c = cliente(crear("admin@colegio.edu.co", Rol.ADMINISTRADOR))
    institucion = Institucion.obtener()
    institucion.sede_unica = False
    institucion.save(update_fields=["sede_unica"])
    return c


@pytest.fixture
def coordinador():
    return cliente(crear("coord@colegio.edu.co", Rol.COORDINADOR))


@pytest.fixture
def estudiante():
    return cliente(crear("ana@colegio.edu.co"))


@pytest.fixture
def tutor():
    return cliente(crear("t@colegio.edu.co", Rol.TUTOR))


def detalles(r):
    return r.json()["error"]["details"]


# =============================================================== HU-02.01 institución y sedes


def test_la_institucion_requiere_sesion():
    assert APIClient().get("/api/institucion/").status_code == 401


def test_la_institucion_se_crea_sola_con_el_nombre_configurado(estudiante, settings):
    settings.INSTITUCION_NOMBRE = "Colegio San Martín"
    r = estudiante.get("/api/institucion/")
    assert r.status_code == 200 and r.json()["nombre"] == "Colegio San Martín"
    assert Institucion.objects.count() == 1


def test_el_administrador_actualiza_los_datos_institucionales(admin):
    r = admin.patch(
        "/api/institucion/",
        {
            "nombre": "Colegio Nuevo",
            "nit": "900.123.456-7",
            "ciudad": "Bogotá",
            "correo": "info@c.co",
        },
        format="json",
    )
    assert r.status_code == 200 and r.json()["nit"] == "900.123.456-7"
    assert Institucion.obtener().ciudad == "Bogotá"


def test_el_administrador_configura_la_institucion_con_sede_unica(admin):
    r = admin.patch("/api/institucion/", {"sede_unica": True}, format="json")
    assert r.status_code == 200 and r.json()["sede_unica"] is True


@pytest.mark.parametrize("quien", ["coordinador", "tutor", "estudiante"])
def test_los_demas_roles_solo_consultan_la_institucion(quien, request):
    c = request.getfixturevalue(quien)
    assert c.get("/api/institucion/").status_code == 200
    assert c.patch("/api/institucion/", {"nombre": "X"}, format="json").status_code == 403


def test_datos_institucionales_invalidos(admin):
    assert admin.patch("/api/institucion/", {"nombre": ""}, format="json").status_code == 400
    assert (
        admin.patch("/api/institucion/", {"correo": "no-es-correo"}, format="json").status_code
        == 400
    )
    assert Institucion.obtener().nombre  # no se perdió el nombre


def test_la_base_impide_una_segunda_institucion():
    Institucion.obtener()
    with pytest.raises(IntegrityError), transaction.atomic():
        Institucion.objects.create(pk=2, nombre="Otra")


def test_el_administrador_crea_y_lista_sedes(admin, estudiante):
    r = admin.post(
        "/api/sedes/",
        {
            "nombre": "Sede Norte",
            "nit": "900.123",
            "direccion": "Cra 1 # 2-3",
            "ciudad": "Bogotá",
            "correo": "norte@colegio.edu.co",
        },
        format="json",
    )
    assert (
        r.status_code == 201
        and r.json()["activa"] is True
        and r.json()["principal"] is False
        and r.json()["nit"] == "900.123"
        and r.json()["ciudad"] == "Bogotá"
        and r.json()["correo"] == "norte@colegio.edu.co"
    )
    assert [s["nombre"] for s in estudiante.get("/api/sedes/").json()] == ["Sede Norte"]


def test_la_sede_unica_bloquea_una_segunda_sede(admin):
    institucion = Institucion.obtener()
    institucion.sede_unica = True
    institucion.save(update_fields=["sede_unica"])
    primera = admin.post("/api/sedes/", {"nombre": "Central"}, format="json")
    segunda = admin.post("/api/sedes/", {"nombre": "Anexo"}, format="json")

    assert primera.status_code == 201
    assert segunda.status_code == 400 and "sede_unica" in detalles(segunda)


def test_no_se_puede_configurar_sede_unica_si_ya_hay_varias_sedes(admin):
    admin.post("/api/sedes/", {"nombre": "Central"}, format="json")
    admin.post("/api/sedes/", {"nombre": "Anexo"}, format="json")
    r = admin.patch("/api/institucion/", {"sede_unica": True}, format="json")

    assert r.status_code == 400 and "sede_unica" in detalles(r)
    assert Institucion.obtener().sede_unica is False


def test_las_sedes_se_listan_con_la_principal_primero(admin):
    admin.post("/api/sedes/", {"nombre": "Anexo"}, format="json")
    admin.post("/api/sedes/", {"nombre": "Central", "principal": True}, format="json")
    assert [s["nombre"] for s in admin.get("/api/sedes/").json()] == ["Central", "Anexo"]


def test_nombre_de_sede_unico_sin_distinguir_mayusculas(admin):
    admin.post("/api/sedes/", {"nombre": "Norte"}, format="json")
    r = admin.post("/api/sedes/", {"nombre": "NORTE"}, format="json")
    assert r.status_code == 400 and "nombre" in detalles(r)


def test_solo_hay_una_sede_principal(admin):
    a = admin.post("/api/sedes/", {"nombre": "A", "principal": True}, format="json").json()
    b = admin.post("/api/sedes/", {"nombre": "B", "principal": True}, format="json").json()
    assert Sede.objects.get(pk=a["id"]).principal is False
    assert Sede.objects.get(pk=b["id"]).principal is True
    admin.patch(f"/api/sedes/{a['id']}/", {"principal": True}, format="json")
    assert list(Sede.objects.filter(principal=True).values_list("nombre", flat=True)) == ["A"]


def test_la_sede_principal_no_puede_estar_inactiva(admin):
    s = admin.post("/api/sedes/", {"nombre": "A", "principal": True}, format="json").json()
    r = admin.patch(f"/api/sedes/{s['id']}/", {"activa": False}, format="json")
    assert r.status_code == 400 and "activa" in detalles(r)
    assert (
        admin.post(
            "/api/sedes/", {"nombre": "B", "principal": True, "activa": False}, format="json"
        ).status_code
        == 400
    )


def test_se_desactiva_una_sede_y_se_filtra_por_estado(admin):
    s = admin.post("/api/sedes/", {"nombre": "Anexo"}, format="json").json()
    admin.post("/api/sedes/", {"nombre": "Central"}, format="json")
    admin.patch(f"/api/sedes/{s['id']}/", {"activa": False}, format="json")
    assert [x["nombre"] for x in admin.get("/api/sedes/", {"activa": "false"}).json()] == ["Anexo"]
    assert [x["nombre"] for x in admin.get("/api/sedes/", {"activa": "true"}).json()] == ["Central"]
    assert len(admin.get("/api/sedes/").json()) == 2
    assert admin.get("/api/sedes/", {"activa": "quizás"}).status_code == 400


def test_las_sedes_no_se_borran(admin):
    s = admin.post("/api/sedes/", {"nombre": "A"}, format="json").json()
    assert admin.delete(f"/api/sedes/{s['id']}/").status_code == 405
    assert admin.get("/api/sedes/999999/").status_code == 404


@pytest.mark.parametrize("quien", ["coordinador", "tutor", "estudiante"])
def test_solo_el_administrador_modifica_sedes(quien, admin, request):
    c = request.getfixturevalue(quien)
    s = admin.post("/api/sedes/", {"nombre": "A"}, format="json").json()
    assert c.post("/api/sedes/", {"nombre": "B"}, format="json").status_code == 403
    assert c.patch(f"/api/sedes/{s['id']}/", {"nombre": "C"}, format="json").status_code == 403
    assert Sede.objects.get(pk=s["id"]).nombre == "A"


def test_sedes_requiere_sesion():
    assert APIClient().get("/api/sedes/").status_code == 401


# =============================================================== HU-02.02 grados y grupos


def test_el_administrador_crea_un_grado_y_sus_grupos(admin):
    g = admin.post("/api/admin/grados/", {"nombre": "Sexto", "orden": 6}, format="json")
    assert g.status_code == 201 and g.json()["grupos"] == [] and g.json()["activo"] is True
    gr = admin.post("/api/admin/grupos/", {"grado": g.json()["id"], "nombre": "A"}, format="json")
    assert gr.status_code == 201 and gr.json()["grado_nombre"] == "Sexto"
    assert gr.json()["estudiantes"] == 0
    lista = admin.get("/api/admin/grados/").json()
    assert lista[0]["grupos"] == [{"id": gr.json()["id"], "nombre": "A", "activo": True}]


def test_los_grados_se_listan_por_orden_y_incluyen_los_inactivos(admin):
    Grado.objects.create(nombre="Octavo", orden=8)
    Grado.objects.create(nombre="Sexto", orden=6, activo=False)
    nombres = [g["nombre"] for g in admin.get("/api/admin/grados/").json()]
    assert nombres == ["Sexto", "Octavo"]
    assert [g["nombre"] for g in admin.get("/api/admin/grados/", {"activo": "true"}).json()] == [
        "Octavo"
    ]


def test_nombre_de_grado_unico(admin):
    admin.post("/api/admin/grados/", {"nombre": "Sexto", "orden": 6}, format="json")
    r = admin.post("/api/admin/grados/", {"nombre": "SEXTO", "orden": 7}, format="json")
    assert r.status_code == 400 and "nombre" in detalles(r)


def test_se_renombra_y_desactiva_un_grado(admin):
    g = admin.post("/api/admin/grados/", {"nombre": "Sexto", "orden": 6}, format="json").json()
    r = admin.patch(
        f"/api/admin/grados/{g['id']}/", {"nombre": "6.º", "activo": False}, format="json"
    )
    assert r.status_code == 200 and r.json()["nombre"] == "6.º" and r.json()["activo"] is False
    # Al conservar su propio nombre no choca consigo mismo.
    assert (
        admin.patch(f"/api/admin/grados/{g['id']}/", {"nombre": "6.º"}, format="json").status_code
        == 200
    )


def test_el_nombre_del_grupo_se_repite_en_otro_grado_pero_no_en_el_mismo(admin):
    sexto = Grado.objects.create(nombre="Sexto", orden=6)
    septimo = Grado.objects.create(nombre="Séptimo", orden=7)
    assert (
        admin.post(
            "/api/admin/grupos/", {"grado": sexto.pk, "nombre": "A"}, format="json"
        ).status_code
        == 201
    )
    assert (
        admin.post(
            "/api/admin/grupos/", {"grado": septimo.pk, "nombre": "A"}, format="json"
        ).status_code
        == 201
    )
    r = admin.post("/api/admin/grupos/", {"grado": sexto.pk, "nombre": "a"}, format="json")
    assert r.status_code == 400 and "grupo" in str(detalles(r)).lower()


def test_el_grupo_exige_un_grado_existente(admin):
    assert (
        admin.post(
            "/api/admin/grupos/", {"grado": 999999, "nombre": "A"}, format="json"
        ).status_code
        == 400
    )
    assert admin.post("/api/admin/grupos/", {"nombre": "A"}, format="json").status_code == 400


def test_filtrar_grupos_por_grado_y_estado(admin):
    sexto = Grado.objects.create(nombre="Sexto", orden=6)
    septimo = Grado.objects.create(nombre="Séptimo", orden=7)
    Grupo.objects.create(grado=sexto, nombre="A")
    Grupo.objects.create(grado=sexto, nombre="B", activo=False)
    Grupo.objects.create(grado=septimo, nombre="A")
    nombres = lambda r: [f"{g['grado_nombre']} {g['nombre']}" for g in r.json()]  # noqa: E731
    assert nombres(admin.get("/api/admin/grupos/", {"grado": sexto.pk})) == ["Sexto A", "Sexto B"]
    assert nombres(admin.get("/api/admin/grupos/", {"activo": "false"})) == ["Sexto B"]
    assert admin.get("/api/admin/grupos/", {"grado": "x"}).status_code == 400


def test_un_grupo_con_estudiantes_no_cambia_de_grado(admin):
    sexto = Grado.objects.create(nombre="Sexto", orden=6)
    septimo = Grado.objects.create(nombre="Séptimo", orden=7)
    grupo = Grupo.objects.create(grado=sexto, nombre="A")
    est = crear("ana@colegio.edu.co")
    PerfilEstudiante.objects.filter(usuario=est).update(grupo=grupo)
    r = admin.patch(f"/api/admin/grupos/{grupo.pk}/", {"grado": septimo.pk}, format="json")
    assert r.status_code == 400 and "grado" in detalles(r)
    # Sí puede renombrarse y desactivarse.
    assert (
        admin.patch(f"/api/admin/grupos/{grupo.pk}/", {"nombre": "Alfa"}, format="json").status_code
        == 200
    )


def test_el_grupo_cuenta_sus_estudiantes_matriculados(admin):
    grupo = Grupo.objects.create(grado=Grado.objects.create(nombre="Sexto", orden=6), nombre="A")
    periodo = PeriodoAcademico.objects.create(
        nombre="P1", fecha_inicio=datetime.date(2026, 1, 1), fecha_fin=datetime.date(2026, 3, 31)
    )
    Matricula.objects.create(estudiante=crear("a@colegio.edu.co"), periodo=periodo, grupo=grupo)
    retirada = Matricula.objects.create(
        estudiante=crear("b@colegio.edu.co"), periodo=periodo, grupo=grupo
    )
    Matricula.objects.filter(pk=retirada.pk).update(estado="retirada")
    assert admin.get(f"/api/admin/grupos/{grupo.pk}/").json()["estudiantes"] == 1


def test_la_coordinacion_consulta_la_estructura_pero_no_la_modifica(coordinador):
    Grado.objects.create(nombre="Sexto", orden=6)
    assert coordinador.get("/api/admin/grados/").status_code == 200
    assert (
        coordinador.post(
            "/api/admin/grados/", {"nombre": "X", "orden": 1}, format="json"
        ).status_code
        == 403
    )
    assert (
        coordinador.post(
            "/api/admin/grupos/", {"grado": 1, "nombre": "X"}, format="json"
        ).status_code
        == 403
    )


@pytest.mark.parametrize("quien", ["tutor", "estudiante"])
def test_tutores_y_estudiantes_no_acceden_a_la_administracion_de_estructura(quien, request):
    c = request.getfixturevalue(quien)
    for ruta in ("grados", "grupos", "asignaturas"):
        assert c.get(f"/api/admin/{ruta}/").status_code == 403


def test_la_estructura_requiere_sesion():
    for ruta in ("grados", "grupos", "asignaturas"):
        assert APIClient().get(f"/api/admin/{ruta}/").status_code == 401


# =============================================================== HU-02.03 catálogo de asignaturas


def test_el_administrador_crea_renombra_y_desactiva_asignaturas(admin):
    a = admin.post("/api/admin/asignaturas/", {"nombre": "Robótica"}, format="json")
    assert a.status_code == 201 and a.json()["activa"] is True
    pk = a.json()["id"]
    assert (
        admin.patch(
            f"/api/admin/asignaturas/{pk}/", {"nombre": "Robótica I"}, format="json"
        ).status_code
        == 200
    )
    admin.patch(f"/api/admin/asignaturas/{pk}/", {"activa": False}, format="json")
    assert Asignatura.objects.get(pk=pk).activa is False


def test_una_asignatura_desactivada_deja_de_ofrecerse_a_los_tutores(admin, tutor):
    a = Asignatura.objects.create(nombre="Robótica")
    assert "Robótica" in [x["nombre"] for x in tutor.get("/api/asignaturas/").json()]
    admin.patch(f"/api/admin/asignaturas/{a.pk}/", {"activa": False}, format="json")
    assert "Robótica" not in [x["nombre"] for x in tutor.get("/api/asignaturas/").json()]
    # El administrador sigue viéndola en su catálogo completo.
    assert "Robótica" in [x["nombre"] for x in admin.get("/api/admin/asignaturas/").json()]


def test_nombre_de_asignatura_unico_incluso_contra_las_base(admin):
    assert (
        admin.post("/api/admin/asignaturas/", {"nombre": "MATEMÁTICAS"}, format="json").status_code
        == 400
    )
    assert admin.post("/api/admin/asignaturas/", {"nombre": ""}, format="json").status_code == 400


def test_filtrar_asignaturas_por_estado(admin):
    Asignatura.objects.filter(nombre="Química").update(activa=False)
    inactivas = [
        a["nombre"] for a in admin.get("/api/admin/asignaturas/", {"activa": "false"}).json()
    ]
    assert inactivas == ["Química"]


def test_las_asignaturas_del_catalogo_las_modifica_solo_el_administrador(coordinador):
    assert coordinador.get("/api/admin/asignaturas/").status_code == 200
    assert (
        coordinador.post("/api/admin/asignaturas/", {"nombre": "X"}, format="json").status_code
        == 403
    )


# =============================================================== HU-02.04 periodos


def periodo(nombre="2026 - Periodo 1", inicio="2026-01-19", fin="2026-03-27"):
    return {"nombre": nombre, "fecha_inicio": inicio, "fecha_fin": fin}


def test_el_administrador_crea_un_periodo(admin, estudiante):
    r = admin.post("/api/periodos/", periodo(), format="json")
    assert r.status_code == 201 and r.json()["es_actual"] is False
    assert estudiante.get("/api/periodos/").json()[0]["nombre"] == "2026 - Periodo 1"


def test_la_fecha_de_fin_no_puede_ser_anterior_a_la_de_inicio(admin):
    r = admin.post("/api/periodos/", periodo(inicio="2026-03-27", fin="2026-01-19"), format="json")
    assert r.status_code == 400 and "fecha_fin" in detalles(r)


def test_los_periodos_no_se_solapan(admin):
    admin.post("/api/periodos/", periodo(), format="json")
    r = admin.post("/api/periodos/", periodo("P2", "2026-03-01", "2026-05-30"), format="json")
    assert r.status_code == 400 and "2026 - Periodo 1" in detalles(r)["fecha_inicio"][0]
    # Pegado al anterior (el día siguiente) sí es válido; un solo día compartido no.
    assert (
        admin.post(
            "/api/periodos/", periodo("P2", "2026-03-28", "2026-06-05"), format="json"
        ).status_code
        == 201
    )
    assert (
        admin.post(
            "/api/periodos/", periodo("P3", "2026-06-05", "2026-09-01"), format="json"
        ).status_code
        == 400
    )


def test_editar_un_periodo_no_choca_consigo_mismo(admin):
    p = admin.post("/api/periodos/", periodo(), format="json").json()
    r = admin.patch(f"/api/periodos/{p['id']}/", {"fecha_fin": "2026-04-03"}, format="json")
    assert r.status_code == 200 and r.json()["fecha_fin"] == "2026-04-03"


def test_editar_un_periodo_no_puede_invadir_a_otro(admin):
    admin.post("/api/periodos/", periodo(), format="json")
    p2 = admin.post(
        "/api/periodos/", periodo("P2", "2026-04-01", "2026-06-30"), format="json"
    ).json()
    assert (
        admin.patch(
            f"/api/periodos/{p2['id']}/", {"fecha_inicio": "2026-03-01"}, format="json"
        ).status_code
        == 400
    )


def test_nombre_de_periodo_unico(admin):
    admin.post("/api/periodos/", periodo(), format="json")
    r = admin.post(
        "/api/periodos/", periodo("2026 - PERIODO 1", "2027-01-01", "2027-03-01"), format="json"
    )
    assert r.status_code == 400 and "nombre" in detalles(r)


def test_fechas_mal_escritas(admin):
    assert (
        admin.post("/api/periodos/", periodo(inicio="19/01/2026"), format="json").status_code == 400
    )
    assert admin.post("/api/periodos/", {"nombre": "X"}, format="json").status_code == 400


def test_el_periodo_vigente_es_el_que_incluye_hoy(admin, estudiante):
    hoy = timezone.localdate()
    p = PeriodoAcademico.objects.create(
        nombre="Actual",
        fecha_inicio=hoy - datetime.timedelta(days=10),
        fecha_fin=hoy + datetime.timedelta(days=10),
    )
    PeriodoAcademico.objects.create(
        nombre="Pasado",
        fecha_inicio=hoy - datetime.timedelta(days=100),
        fecha_fin=hoy - datetime.timedelta(days=50),
    )
    r = estudiante.get("/api/periodos/actual/")
    assert r.status_code == 200 and r.json()["id"] == p.pk and r.json()["es_actual"] is True
    marcas = {x["nombre"]: x["es_actual"] for x in admin.get("/api/periodos/").json()}
    assert marcas == {"Actual": True, "Pasado": False}


def test_sin_periodo_vigente_responde_404_con_su_propio_codigo(estudiante):
    r = estudiante.get("/api/periodos/actual/")
    assert r.status_code == 404 and r.json()["error"]["code"] == "sin_periodo_actual"


def test_los_periodos_los_crea_solo_el_administrador(coordinador, tutor):
    for c in (coordinador, tutor):
        assert c.post("/api/periodos/", periodo(), format="json").status_code == 403
    assert coordinador.get("/api/periodos/").status_code == 200


def test_la_base_impide_un_periodo_con_fechas_invertidas():
    with pytest.raises(IntegrityError), transaction.atomic():
        PeriodoAcademico.objects.create(
            nombre="X", fecha_inicio=datetime.date(2026, 5, 1), fecha_fin=datetime.date(2026, 4, 1)
        )


# =============================================================== HU-02.06 días no hábiles

LUNES = datetime.date(2026, 10, 12)  # es lunes
SABADO = datetime.date(2026, 10, 17)
DOMINGO = datetime.date(2026, 10, 18)


def test_el_administrador_registra_dias_no_habiles(admin, estudiante):
    r = admin.post(
        "/api/dias-no-habiles/", {"fecha": "2026-12-25", "descripcion": " Navidad "}, format="json"
    )
    assert r.status_code == 201 and r.json()["descripcion"] == "Navidad"
    assert estudiante.get("/api/dias-no-habiles/").json()[0]["fecha"] == "2026-12-25"


def test_una_fecha_no_se_registra_dos_veces(admin):
    admin.post(
        "/api/dias-no-habiles/", {"fecha": "2026-12-25", "descripcion": "Navidad"}, format="json"
    )
    r = admin.post(
        "/api/dias-no-habiles/", {"fecha": "2026-12-25", "descripcion": "Otra"}, format="json"
    )
    assert r.status_code == 400 and "fecha" in detalles(r)


def test_la_descripcion_es_obligatoria(admin):
    assert (
        admin.post(
            "/api/dias-no-habiles/", {"fecha": "2026-12-25", "descripcion": "  "}, format="json"
        ).status_code
        == 400
    )
    assert (
        admin.post("/api/dias-no-habiles/", {"fecha": "2026-12-25"}, format="json").status_code
        == 400
    )


def test_se_corrige_y_se_filtra_por_rango(admin):
    for f, d in [
        ("2026-01-01", "Año nuevo"),
        ("2026-12-08", "Inmaculada"),
        ("2026-12-25", "Navidad"),
    ]:
        admin.post("/api/dias-no-habiles/", {"fecha": f, "descripcion": d}, format="json")
    rango = admin.get(
        "/api/dias-no-habiles/", {"desde": "2026-12-01", "hasta": "2026-12-31"}
    ).json()
    assert [x["descripcion"] for x in rango] == ["Inmaculada", "Navidad"]
    primero = admin.get("/api/dias-no-habiles/").json()[0]
    assert (
        admin.patch(
            f"/api/dias-no-habiles/{primero['id']}/", {"descripcion": "Año Nuevo"}, format="json"
        ).status_code
        == 200
    )
    assert admin.get("/api/dias-no-habiles/", {"desde": "01/12/2026"}).status_code == 400


def test_verificar_un_dia_habil_un_fin_de_semana_y_un_festivo(estudiante):
    DiaNoHabil.objects.create(fecha=datetime.date(2026, 10, 13), descripcion="Festivo")
    ok = estudiante.get("/api/dias-no-habiles/verificar/", {"fecha": LUNES.isoformat()}).json()
    assert ok == {"fecha": "2026-10-12", "habil": True, "motivo": None}
    fin = estudiante.get("/api/dias-no-habiles/verificar/", {"fecha": SABADO.isoformat()}).json()
    assert fin["habil"] is False and fin["motivo"] == "fin de semana"
    festivo = estudiante.get("/api/dias-no-habiles/verificar/", {"fecha": "2026-10-13"}).json()
    assert festivo["habil"] is False and festivo["motivo"] == "Festivo"


def test_verificar_exige_una_fecha_valida(estudiante):
    assert estudiante.get("/api/dias-no-habiles/verificar/").status_code == 400
    assert estudiante.get("/api/dias-no-habiles/verificar/", {"fecha": "ayer"}).status_code == 400


def test_la_validacion_al_programar_rechaza_dias_no_habiles_con_el_motivo():
    from rest_framework.serializers import ValidationError

    DiaNoHabil.objects.create(fecha=datetime.date(2026, 12, 25), descripcion="Navidad")
    assert validar_dia_habil(LUNES) == LUNES
    for fecha, motivo in [
        (datetime.date(2026, 12, 25), "Navidad"),
        (SABADO, "fin de semana"),
        (DOMINGO, "fin de semana"),
    ]:
        with pytest.raises(ValidationError) as error:
            validar_dia_habil(fecha, campo="inicio")
        assert motivo in str(error.value.detail["inicio"][0])
    assert es_dia_habil(LUNES) and not es_dia_habil(SABADO)


def test_los_dias_no_habiles_los_modifica_solo_el_administrador(coordinador, tutor):
    for c in (coordinador, tutor):
        assert (
            c.post(
                "/api/dias-no-habiles/", {"fecha": "2026-12-25", "descripcion": "N"}, format="json"
            ).status_code
            == 403
        )
        assert c.get("/api/dias-no-habiles/").status_code == 200
    assert APIClient().get("/api/dias-no-habiles/").status_code == 401
