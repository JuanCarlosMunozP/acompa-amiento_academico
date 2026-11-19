"""HU-02.05: matrícula del estudiante, carga masiva y validación de duplicados."""

import datetime

import pytest
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from academico.models import Matricula, PeriodoAcademico
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
def coordinador():
    return cliente(crear("coord@colegio.edu.co", Rol.COORDINADOR))


@pytest.fixture
def admin():
    return cliente(crear("admin@colegio.edu.co", Rol.ADMINISTRADOR))


@pytest.fixture
def sexto_a():
    return Grupo.objects.create(grado=Grado.objects.create(nombre="Sexto", orden=6), nombre="A")


@pytest.fixture
def vigente():
    hoy = timezone.localdate()
    return PeriodoAcademico.objects.create(
        nombre="Vigente",
        fecha_inicio=hoy - datetime.timedelta(days=30),
        fecha_fin=hoy + datetime.timedelta(days=30),
    )


@pytest.fixture
def pasado():
    hoy = timezone.localdate()
    return PeriodoAcademico.objects.create(
        nombre="Pasado",
        fecha_inicio=hoy - datetime.timedelta(days=200),
        fecha_fin=hoy - datetime.timedelta(days=100),
    )


def detalles(r):
    return r.json()["error"]["details"]


# =============================================================== T1: modelo y matrícula individual


def test_la_coordinacion_matricula_a_un_estudiante(coordinador, sexto_a, vigente):
    est = crear("ana@colegio.edu.co", nombres="Ana", apellidos="Ruiz")
    r = coordinador.post(
        "/api/matriculas/",
        {"estudiante": est.pk, "periodo": vigente.pk, "grupo": sexto_a.pk},
        format="json",
    )
    assert r.status_code == 201
    cuerpo = r.json()
    assert cuerpo["estado"] == "activa" and cuerpo["estudiante_nombre"] == "Ana Ruiz"
    assert cuerpo["grupo_nombre"] == "Sexto A" and cuerpo["periodo_nombre"] == "Vigente"


def test_un_estudiante_solo_se_matricula_una_vez_por_periodo(coordinador, sexto_a, vigente, pasado):
    est = crear("ana@colegio.edu.co")
    datos = {"estudiante": est.pk, "periodo": vigente.pk, "grupo": sexto_a.pk}
    assert coordinador.post("/api/matriculas/", datos, format="json").status_code == 201
    r = coordinador.post("/api/matriculas/", datos, format="json")
    assert r.status_code == 400 and "matriculado" in detalles(r)["estudiante"][0]
    # En otro periodo sí puede matricularse.
    datos["periodo"] = pasado.pk
    assert coordinador.post("/api/matriculas/", datos, format="json").status_code == 201
    assert Matricula.objects.filter(estudiante=est).count() == 2


def test_solo_se_matricula_a_estudiantes_activos(coordinador, sexto_a, vigente):
    tutor = crear("t@colegio.edu.co", Rol.TUTOR)
    inactivo = crear("i@colegio.edu.co", is_active=False)
    for u in (tutor, inactivo):
        r = coordinador.post(
            "/api/matriculas/",
            {"estudiante": u.pk, "periodo": vigente.pk, "grupo": sexto_a.pk},
            format="json",
        )
        assert r.status_code == 400 and "estudiante" in detalles(r)


def test_el_grupo_debe_estar_activo(coordinador, vigente):
    est = crear("ana@colegio.edu.co")
    grado = Grado.objects.create(nombre="Sexto", orden=6)
    inactivo = Grupo.objects.create(grado=grado, nombre="Z", activo=False)
    r = coordinador.post(
        "/api/matriculas/",
        {"estudiante": est.pk, "periodo": vigente.pk, "grupo": inactivo.pk},
        format="json",
    )
    assert r.status_code == 400 and "grupo" in detalles(r)
    grado.activo = False
    grado.save()
    activo = Grupo.objects.create(grado=grado, nombre="A")
    assert (
        coordinador.post(
            "/api/matriculas/",
            {"estudiante": est.pk, "periodo": vigente.pk, "grupo": activo.pk},
            format="json",
        ).status_code
        == 400
    )


def test_la_matricula_del_periodo_vigente_actualiza_el_grupo_de_la_ficha(
    coordinador, sexto_a, vigente
):
    est = crear("ana@colegio.edu.co")
    assert est.perfil_estudiante.grupo is None
    coordinador.post(
        "/api/matriculas/",
        {"estudiante": est.pk, "periodo": vigente.pk, "grupo": sexto_a.pk},
        format="json",
    )
    assert PerfilEstudiante.objects.get(usuario=est).grupo == sexto_a
    assert cliente(est).get("/api/mi-ficha/").json()["grupo"]["nombre"] == "A"


def test_una_matricula_de_un_periodo_pasado_no_toca_la_ficha(coordinador, sexto_a, pasado):
    est = crear("ana@colegio.edu.co")
    coordinador.post(
        "/api/matriculas/",
        {"estudiante": est.pk, "periodo": pasado.pk, "grupo": sexto_a.pk},
        format="json",
    )
    assert PerfilEstudiante.objects.get(usuario=est).grupo is None


def test_se_cambia_de_grupo_y_se_retira_una_matricula(coordinador, sexto_a, vigente):
    otro = Grupo.objects.create(grado=sexto_a.grado, nombre="B")
    est = crear("ana@colegio.edu.co")
    m = coordinador.post(
        "/api/matriculas/",
        {"estudiante": est.pk, "periodo": vigente.pk, "grupo": sexto_a.pk},
        format="json",
    ).json()
    r = coordinador.patch(f"/api/matriculas/{m['id']}/", {"grupo": otro.pk}, format="json")
    assert r.status_code == 200 and r.json()["grupo_nombre"] == "Sexto B"
    assert PerfilEstudiante.objects.get(usuario=est).grupo == otro
    r = coordinador.patch(f"/api/matriculas/{m['id']}/", {"estado": "retirada"}, format="json")
    assert r.status_code == 200 and r.json()["estado"] == "retirada"


def test_una_matricula_no_cambia_de_estudiante_ni_de_periodo(coordinador, sexto_a, vigente, pasado):
    a, b = crear("a@colegio.edu.co"), crear("b@colegio.edu.co")
    m = coordinador.post(
        "/api/matriculas/",
        {"estudiante": a.pk, "periodo": vigente.pk, "grupo": sexto_a.pk},
        format="json",
    ).json()
    assert (
        coordinador.patch(
            f"/api/matriculas/{m['id']}/", {"estudiante": b.pk}, format="json"
        ).status_code
        == 400
    )
    assert (
        coordinador.patch(
            f"/api/matriculas/{m['id']}/", {"periodo": pasado.pk}, format="json"
        ).status_code
        == 400
    )
    assert Matricula.objects.get(pk=m["id"]).estudiante == a


def test_el_modelo_rechaza_matricular_a_quien_no_es_estudiante(sexto_a, vigente):
    from django.core.exceptions import ValidationError

    with pytest.raises(ValidationError):
        Matricula.objects.create(
            estudiante=crear("t@colegio.edu.co", Rol.TUTOR), periodo=vigente, grupo=sexto_a
        )


def test_un_periodo_o_grupo_con_matriculas_no_se_borra(sexto_a, vigente):
    from django.db.models import ProtectedError

    Matricula.objects.create(estudiante=crear("a@colegio.edu.co"), periodo=vigente, grupo=sexto_a)
    with pytest.raises(ProtectedError):
        vigente.delete()
    with pytest.raises(ProtectedError):
        sexto_a.delete()


def test_listar_matriculas_con_filtros_y_paginacion(admin, sexto_a, vigente, pasado):
    otro = Grupo.objects.create(grado=Grado.objects.create(nombre="Octavo", orden=8), nombre="A")
    datos = [("ana", sexto_a, vigente), ("luis", sexto_a, pasado), ("eva", otro, vigente)]
    for n, g, p in datos:
        Matricula.objects.create(
            estudiante=crear(f"{n}@colegio.edu.co", apellidos=n.title()), periodo=p, grupo=g
        )
    correos = lambda r: sorted(m["estudiante_email"] for m in r.json()["results"])  # noqa: E731
    assert admin.get("/api/matriculas/").json()["count"] == 3
    assert correos(admin.get("/api/matriculas/", {"periodo": vigente.pk})) == [
        "ana@colegio.edu.co",
        "eva@colegio.edu.co",
    ]
    assert correos(admin.get("/api/matriculas/", {"grupo": otro.pk})) == ["eva@colegio.edu.co"]
    assert correos(admin.get("/api/matriculas/", {"grado": sexto_a.grado.pk})) == [
        "ana@colegio.edu.co",
        "luis@colegio.edu.co",
    ]
    assert correos(admin.get("/api/matriculas/", {"q": "luis"})) == ["luis@colegio.edu.co"]
    assert admin.get("/api/matriculas/", {"estado": "inventado"}).status_code == 400
    assert admin.get("/api/matriculas/", {"periodo": "x"}).status_code == 400


@pytest.mark.parametrize("rol", [Rol.ESTUDIANTE, Rol.TUTOR])
def test_estudiantes_y_tutores_no_ven_ni_crean_matriculas(rol):
    c = cliente(crear(f"{rol.value}@colegio.edu.co", rol))
    assert c.get("/api/matriculas/").status_code == 403
    assert c.post("/api/matriculas/carga/", {}, format="json").status_code == 403
    assert APIClient().get("/api/matriculas/").status_code == 401


# =============================================================== T2 y T3: carga masiva

ENCABEZADO = "correo,nombres,apellidos,grado,grupo\n"


def cargar(c, periodo, texto, **extra):
    return c.post(
        "/api/matriculas/carga/", {"periodo": periodo.pk, "csv": texto, **extra}, format="json"
    )


def test_carga_masiva_crea_las_cuentas_y_las_matriculas(coordinador, sexto_a, vigente):
    csv = (
        ENCABEZADO + "ana@colegio.edu.co,Ana,Ruiz,Sexto,A\nluis@colegio.edu.co,Luis,Pérez,sexto,a\n"
    )
    r = cargar(coordinador, vigente, csv)
    assert r.status_code == 201
    assert r.json() == {
        "simulacion": False,
        "total": 2,
        "validas": 2,
        "errores": [],
        "cuentas_nuevas": 2,
        "matriculados": 2,
    }
    ana = Usuario.objects.get(email="ana@colegio.edu.co")
    assert ana.rol == Rol.ESTUDIANTE and ana.is_active and not ana.email_verificado
    assert not ana.has_usable_password()  # no puede entrar hasta crear su contraseña
    assert Matricula.objects.filter(periodo=vigente, grupo=sexto_a).count() == 2
    assert PerfilEstudiante.objects.get(usuario=ana).grupo == sexto_a  # periodo vigente


def test_los_estudiantes_cargados_crean_su_contrasena_con_la_recuperacion(
    coordinador, sexto_a, vigente
):
    cargar(coordinador, vigente, ENCABEZADO + "ana@colegio.edu.co,Ana,Ruiz,Sexto,A\n")
    anonimo = APIClient()
    r = anonimo.post(
        "/api/auth/login/", {"email": "ana@colegio.edu.co", "password": "x"}, format="json"
    )
    assert r.status_code == 401
    anonimo.post("/api/auth/recuperar/", {"email": "ana@colegio.edu.co"}, format="json")
    cuerpo = mail.outbox[-1].body
    uid = cuerpo.split("uid=")[1].split("&")[0]
    token = cuerpo.split("token=")[1].split()[0]
    nueva = "Nueva-clave-2026!"
    r = anonimo.post(
        "/api/auth/recuperar/confirmar/",
        {"uid": uid, "token": token, "password": nueva, "password_confirmacion": nueva},
        format="json",
    )
    assert r.status_code == 200
    assert (
        anonimo.post(
            "/api/auth/login/", {"email": "ana@colegio.edu.co", "password": nueva}, format="json"
        ).status_code
        == 200
    )


def test_un_estudiante_existente_se_reutiliza_y_no_se_duplica(coordinador, sexto_a, vigente):
    existente = crear("ana@colegio.edu.co", nombres="Ana", apellidos="Ruiz")
    r = cargar(coordinador, vigente, ENCABEZADO + "ANA@colegio.edu.co,,,Sexto,A\n")
    assert r.status_code == 201 and r.json()["cuentas_nuevas"] == 0
    assert Usuario.objects.filter(email__iexact="ana@colegio.edu.co").count() == 1
    assert Matricula.objects.get(estudiante=existente).grupo == sexto_a


def test_simular_informa_sin_guardar_nada(coordinador, sexto_a, vigente):
    r = cargar(
        coordinador, vigente, ENCABEZADO + "ana@colegio.edu.co,Ana,Ruiz,Sexto,A\n", simular=True
    )
    assert r.status_code == 200 and r.json()["simulacion"] is True and r.json()["validas"] == 1
    assert r.json()["matriculados"] == 0
    assert not Usuario.objects.filter(email="ana@colegio.edu.co").exists()
    assert Matricula.objects.count() == 0


def test_simular_tambien_reporta_los_errores_con_estado_200(coordinador, sexto_a, vigente):
    r = cargar(coordinador, vigente, ENCABEZADO + "no-es-correo,Ana,Ruiz,Sexto,A\n", simular=True)
    assert r.status_code == 200 and len(r.json()["errores"]) == 1


def test_con_errores_no_se_guarda_ninguna_fila(coordinador, sexto_a, vigente):
    csv = ENCABEZADO + "ana@colegio.edu.co,Ana,Ruiz,Sexto,A\nmalo,Luis,Pérez,Sexto,A\n"
    r = cargar(coordinador, vigente, csv)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "carga_invalida"
    informe = r.json()["error"]["details"]
    assert informe["validas"] == 1 and informe["errores"][0]["fila"] == 3
    assert "correo" in informe["errores"][0]["errores"][0].lower()
    assert not Usuario.objects.filter(email="ana@colegio.edu.co").exists()  # todo o nada
    assert Matricula.objects.count() == 0


def errores_de(coordinador, vigente, csv):
    r = cargar(coordinador, vigente, csv, simular=True)
    assert r.status_code == 200, r.json()
    return {e["fila"]: " | ".join(e["errores"]) for e in r.json()["errores"]}


def test_detecta_correos_repetidos_dentro_del_archivo(coordinador, sexto_a, vigente):
    csv = ENCABEZADO + "ana@colegio.edu.co,Ana,Ruiz,Sexto,A\nANA@colegio.edu.co,Ana,Ruiz,Sexto,A\n"
    errores = errores_de(coordinador, vigente, csv)
    assert list(errores) == [3] and "fila 2" in errores[3]


def test_detecta_a_quien_ya_esta_matriculado_en_el_periodo(coordinador, sexto_a, vigente):
    est = crear("ana@colegio.edu.co")
    Matricula.objects.create(estudiante=est, periodo=vigente, grupo=sexto_a)
    errores = errores_de(coordinador, vigente, ENCABEZADO + "ana@colegio.edu.co,,,Sexto,A\n")
    assert "Ya está matriculado" in errores[2]


def test_detecta_grupos_inexistentes_o_inactivos(coordinador, sexto_a, vigente):
    Grupo.objects.create(grado=sexto_a.grado, nombre="Z", activo=False)
    filas = [
        "a@colegio.edu.co,A,A,Sexto,Q",
        "b@colegio.edu.co,B,B,Sexto,Z",
        "c@colegio.edu.co,C,C,Noveno,A",
    ]
    csv = ENCABEZADO + "\n".join(filas) + "\n"
    errores = errores_de(coordinador, vigente, csv)
    assert set(errores) == {2, 3, 4} and all(
        "no existe o no está activo" in e for e in errores.values()
    )


def test_detecta_correos_de_otros_roles_y_cuentas_desactivadas(coordinador, sexto_a, vigente):
    crear("t@colegio.edu.co", Rol.TUTOR)
    crear("i@colegio.edu.co", is_active=False)
    csv = ENCABEZADO + "t@colegio.edu.co,,,Sexto,A\ni@colegio.edu.co,,,Sexto,A\n"
    errores = errores_de(coordinador, vigente, csv)
    assert "rol tutor" in errores[2] and "desactivada" in errores[3]


def test_un_estudiante_nuevo_necesita_nombres_y_apellidos(coordinador, sexto_a, vigente):
    errores = errores_de(coordinador, vigente, ENCABEZADO + "nuevo@colegio.edu.co,,,Sexto,A\n")
    assert "faltan nombres o apellidos" in errores[2]


def test_respeta_el_dominio_institucional(coordinador, sexto_a, vigente, settings):
    settings.EMAIL_DOMINIOS_PERMITIDOS = ["colegio.edu.co"]
    errores = errores_de(coordinador, vigente, ENCABEZADO + "ana@gmail.com,Ana,Ruiz,Sexto,A\n")
    assert "dominio institucional" in errores[2]


def test_un_archivo_con_varios_errores_los_reporta_todos_a_la_vez(coordinador, sexto_a, vigente):
    csv = (
        ENCABEZADO
        + "malo,A,A,Sexto,A\nb@colegio.edu.co,,,Sexto,Z\nok@colegio.edu.co,Ok,Ok,Sexto,A\n"
    )
    r = cargar(coordinador, vigente, csv, simular=True).json()
    assert r["total"] == 3 and r["validas"] == 1 and len(r["errores"]) == 2


def test_acepta_punto_y_coma_como_separador_y_marca_de_orden_de_bytes(
    coordinador, sexto_a, vigente
):
    csv = "﻿Correo;Nombres;Apellidos;Grado;Grupo\nana@colegio.edu.co;Ana;Ruiz;Sexto;A\n"
    assert cargar(coordinador, vigente, csv).status_code == 201


def test_las_columnas_pueden_venir_en_otro_orden_y_con_alias(coordinador, sexto_a, vigente):
    csv = "grupo,grado,email,apellidos,nombres\nA,Sexto,ana@colegio.edu.co,Ruiz,Ana\n"
    assert cargar(coordinador, vigente, csv).status_code == 201


def test_ignora_las_filas_en_blanco(coordinador, sexto_a, vigente):
    csv = ENCABEZADO + "\nana@colegio.edu.co,Ana,Ruiz,Sexto,A\n,,,,\n"
    assert cargar(coordinador, vigente, csv).json()["total"] == 1


def test_archivo_mal_formado(coordinador, sexto_a, vigente):
    for texto in ("", "   ", "correo,nombres\nana@colegio.edu.co,Ana\n"):
        r = cargar(coordinador, vigente, texto)
        assert r.status_code == 400 and "csv" in detalles(r)
    assert (
        "grado, grupo" in detalles(cargar(coordinador, vigente, "correo,nombres\nx,y\n"))["csv"][0]
    )


def test_un_archivo_solo_con_encabezado_no_hace_nada(coordinador, sexto_a, vigente):
    r = cargar(coordinador, vigente, ENCABEZADO)
    assert r.status_code == 201 and r.json()["total"] == 0 and r.json()["matriculados"] == 0


def test_limite_de_filas_por_carga(coordinador, sexto_a, vigente):
    filas = "".join(f"u{i}@colegio.edu.co,N,A,Sexto,A\n" for i in range(1001))
    r = cargar(coordinador, vigente, ENCABEZADO + filas)
    assert r.status_code == 400 and "Máximo 1000" in detalles(r)["csv"][0]


def test_el_periodo_debe_existir(coordinador, sexto_a):
    r = coordinador.post(
        "/api/matriculas/carga/", {"periodo": 999999, "csv": ENCABEZADO}, format="json"
    )
    assert r.status_code == 400 and "periodo" in detalles(r)


def test_cargar_dos_veces_el_mismo_archivo_la_segunda_falla_por_duplicados(
    coordinador, sexto_a, vigente
):
    csv = ENCABEZADO + "ana@colegio.edu.co,Ana,Ruiz,Sexto,A\n"
    assert cargar(coordinador, vigente, csv).status_code == 201
    r = cargar(coordinador, vigente, csv)
    assert (
        r.status_code == 400
        and "Ya está matriculado" in r.json()["error"]["details"]["errores"][0]["errores"][0]
    )
    assert (
        Matricula.objects.count() == 1
        and Usuario.objects.filter(email="ana@colegio.edu.co").count() == 1
    )


def test_la_carga_masiva_no_envia_correos(coordinador, sexto_a, vigente):
    cargar(coordinador, vigente, ENCABEZADO + "ana@colegio.edu.co,Ana,Ruiz,Sexto,A\n")
    assert len(mail.outbox) == 0
