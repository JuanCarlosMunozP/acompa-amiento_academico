"""HU-03.04 motor de reglas académicas (con pruebas de umbrales) y HU-03.05 matriz de desempeño."""

import datetime
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from academico.models import Matricula, PeriodoAcademico
from seguimiento.models import Asistencia, ReglaAcademica, Resultado, TrabajoPendiente
from seguimiento.servicios import evaluar_datos, porcentaje_asistencia, promedio
from usuarios.models import Asignatura, Grado, Grupo, Usuario
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


def detalles(r):
    return r.json()["error"]["details"]


@pytest.fixture
def admin():
    return cliente(crear("admin@colegio.edu.co", Rol.ADMINISTRADOR))


@pytest.fixture
def coord():
    return cliente(crear("coord@colegio.edu.co", Rol.COORDINADOR))


@pytest.fixture
def periodo():
    hoy = timezone.localdate()
    return PeriodoAcademico.objects.create(
        nombre="Vigente",
        fecha_inicio=hoy - datetime.timedelta(days=60),
        fecha_fin=hoy + datetime.timedelta(days=60),
    )


@pytest.fixture
def grupo():
    return Grupo.objects.create(grado=Grado.objects.create(nombre="Sexto", orden=6), nombre="A")


def matricular(email, periodo, grupo, apellidos="A"):
    u = crear(email, apellidos=apellidos)
    Matricula.objects.create(estudiante=u, periodo=periodo, grupo=grupo)
    return u


def nota(u, periodo, valor, asignatura="Matemáticas"):
    Resultado.objects.create(
        estudiante=u,
        periodo=periodo,
        asignatura=Asignatura.objects.get(nombre=asignatura),
        valor=Decimal(valor),
    )


def asistencias(u, estados):
    dia = timezone.localdate() - datetime.timedelta(days=1)
    for estado in estados:
        Asistencia.objects.create(estudiante=u, fecha=dia, estado=estado)
        dia -= datetime.timedelta(days=1)


def pendientes(u, periodo, n):
    for i in range(n):
        TrabajoPendiente.objects.create(
            estudiante=u,
            asignatura=Asignatura.objects.get(nombre="Inglés"),
            periodo=periodo,
            descripcion=f"Trabajo {i}",
            fecha_limite=timezone.localdate(),
        )


# ============================== reglas iniciales y su administración


def test_la_migracion_deja_las_reglas_iniciales_activas():
    reglas = {r.nombre: (r.tipo, r.umbral, r.severidad) for r in ReglaAcademica.objects.all()}
    assert reglas["Nota en riesgo"] == ("nota_baja", Decimal("3.00"), "riesgo")
    assert reglas["Asistencia crítica"] == ("asistencia_baja", Decimal("70.00"), "critico")
    assert reglas["Trabajos pendientes en atención"][1] == Decimal("2.00")
    assert ReglaAcademica.objects.count() == 9 and not ReglaAcademica.objects.filter(activa=False)


def test_el_administrador_crea_edita_y_desactiva_reglas(admin):
    r = admin.post(
        "/api/reglas/",
        {"nombre": "Nota muy baja", "tipo": "nota_baja", "umbral": "2.5", "severidad": "critico"},
        format="json",
    )
    assert r.status_code == 201 and r.json()["activa"] is True
    pk = r.json()["id"]
    assert (
        admin.patch(f"/api/reglas/{pk}/", {"umbral": "2.8"}, format="json").json()["umbral"]
        == "2.80"
    )
    assert (
        admin.patch(f"/api/reglas/{pk}/", {"activa": False}, format="json").json()["activa"]
        is False
    )
    assert admin.delete(f"/api/reglas/{pk}/").status_code == 405  # se desactivan, no se borran


@pytest.mark.parametrize(
    ("tipo", "umbral", "valido"),
    [
        ("nota_baja", "0.99", False),
        ("nota_baja", "1", True),
        ("nota_baja", "5", True),
        ("nota_baja", "5.01", False),
        ("asistencia_baja", "0", False),
        ("asistencia_baja", "100", True),
        ("asistencia_baja", "100.5", False),
        ("trabajos_pendientes", "0", False),
        ("trabajos_pendientes", "1", True),
        ("trabajos_pendientes", "2.5", False),
        ("trabajos_pendientes", "51", False),
    ],
)
def test_el_umbral_debe_tener_sentido_segun_el_tipo(admin, tipo, umbral, valido):
    r = admin.post(
        "/api/reglas/",
        {"nombre": f"{tipo} {umbral}", "tipo": tipo, "umbral": umbral, "severidad": "riesgo"},
        format="json",
    )
    assert (r.status_code == 201) is valido
    if not valido:
        assert "umbral" in detalles(r)


def test_validaciones_basicas_de_una_regla(admin):
    base = {"nombre": "X", "tipo": "nota_baja", "umbral": "3", "severidad": "riesgo"}
    for cambio in (
        {"nombre": "  "},
        {"tipo": "inventado"},
        {"severidad": "alarma"},
        {"umbral": "abc"},
    ):
        assert admin.post("/api/reglas/", {**base, **cambio}, format="json").status_code == 400


def test_cambiar_el_tipo_de_una_regla_revalida_su_umbral(admin):
    regla = ReglaAcademica.objects.get(nombre="Nota en riesgo")  # umbral 3 válido para notas
    r = admin.patch(f"/api/reglas/{regla.pk}/", {"tipo": "asistencia_baja"}, format="json")
    assert r.status_code == 200  # 3 % también está entre 1 y 100
    r = admin.patch(
        f"/api/reglas/{regla.pk}/", {"tipo": "nota_baja", "umbral": "80"}, format="json"
    )
    assert r.status_code == 400


def test_filtrar_reglas(admin):
    ReglaAcademica.objects.filter(nombre="Nota crítica").update(activa=False)
    assert len(admin.get("/api/reglas/", {"tipo": "asistencia_baja"}).json()) == 3
    assert [r["nombre"] for r in admin.get("/api/reglas/", {"activa": "false"}).json()] == [
        "Nota crítica"
    ]
    assert admin.get("/api/reglas/", {"tipo": "otra"}).status_code == 400


def test_la_coordinacion_ve_las_reglas_pero_no_las_cambia(coord):
    assert coord.get("/api/reglas/").status_code == 200
    assert coord.post("/api/reglas/", {}, format="json").status_code == 403
    assert coord.patch("/api/reglas/1/", {"umbral": "1"}, format="json").status_code == 403


def test_tutores_y_estudiantes_no_acceden_a_las_reglas():
    for rol in (Rol.TUTOR, Rol.ESTUDIANTE):
        assert (
            cliente(crear(f"{rol.value}@colegio.edu.co", rol)).get("/api/reglas/").status_code
            == 403
        )
    assert APIClient().get("/api/reglas/").status_code == 401


# ============================== HU-03.04.T4 pruebas de umbrales (puras)


def regla(tipo, umbral, severidad, nombre=None, activa=True):
    return ReglaAcademica(
        pk=hash((tipo, umbral)) % 10_000,
        nombre=nombre or f"{tipo}<{umbral}",
        tipo=tipo,
        umbral=Decimal(umbral),
        severidad=severidad,
        activa=activa,
    )


def datos(notas=None, conteo=None, trabajos=0):
    return {
        "notas": {k: Decimal(v) for k, v in (notas or {}).items()},
        "conteo": conteo or {},
        "trabajos": trabajos,
    }


NOTA3 = regla("nota_baja", "3.00", "riesgo")


@pytest.mark.parametrize(
    ("nota", "alerta"),
    [("2.99", True), ("3.00", False), ("3.01", False), ("1.00", True), ("5.00", False)],
)
def test_umbral_de_nota_el_limite_exacto_no_activa_la_regla(nota, alerta):
    alertas, estado = evaluar_datos([NOTA3], datos(notas={"Matemáticas": nota}))
    assert bool(alertas) is alerta
    assert estado == ("riesgo" if alerta else "sin_alertas")


@pytest.mark.parametrize(
    ("conteo", "alerta"),
    [
        ({"presente": 79, "ausente": 21}, True),  # 79 %
        ({"presente": 80, "ausente": 20}, False),  # justo 80 %: no es menor
        ({"presente": 81, "ausente": 19}, False),
        ({"presente": 0, "ausente": 5}, True),
    ],
)
def test_umbral_de_asistencia_el_limite_exacto_no_activa_la_regla(conteo, alerta):
    r = regla("asistencia_baja", "80", "riesgo")
    assert bool(evaluar_datos([r], datos(conteo=conteo))[0]) is alerta


@pytest.mark.parametrize(("pendientes", "alerta"), [(0, False), (3, False), (4, True), (9, True)])
def test_umbral_de_trabajos_se_activa_desde_el_umbral_inclusive(pendientes, alerta):
    r = regla("trabajos_pendientes", "4", "riesgo")
    assert bool(evaluar_datos([r], datos(trabajos=pendientes))[0]) is alerta


def test_sin_registros_de_asistencia_no_hay_alerta_de_asistencia():
    r = regla("asistencia_baja", "80", "riesgo")
    assert evaluar_datos([r], datos())[0] == []
    assert evaluar_datos([r], datos(conteo={"excusa": 10}))[0] == []  # solo excusas: sin dato


def test_varias_reglas_del_mismo_tipo_informan_solo_la_mas_grave():
    reglas = [
        regla("nota_baja", "3.50", "atencion"),
        regla("nota_baja", "3.00", "riesgo"),
        regla("nota_baja", "2.00", "critico"),
    ]
    for nota, esperado in [("3.40", "atencion"), ("2.90", "riesgo"), ("1.50", "critico")]:
        alertas, estado = evaluar_datos(reglas, datos(notas={"Matemáticas": nota}))
        assert [a["severidad"] for a in alertas] == [esperado] == [estado]


def test_una_regla_desactivada_no_se_evalua():
    inactiva = regla("nota_baja", "3.00", "riesgo", activa=False)
    assert evaluar_datos([inactiva], datos(notas={"Matemáticas": "1.0"})) == ([], "sin_alertas")


def test_el_estado_es_el_de_la_alerta_mas_grave_y_las_alertas_vienen_ordenadas():
    reglas = [
        regla("nota_baja", "3.00", "riesgo"),
        regla("asistencia_baja", "70", "critico"),
        regla("trabajos_pendientes", "2", "atencion"),
    ]
    alertas, estado = evaluar_datos(
        reglas,
        datos(notas={"Matemáticas": "2.5"}, conteo={"presente": 6, "ausente": 4}, trabajos=3),
    )
    assert estado == "critico"
    assert [a["severidad"] for a in alertas] == ["critico", "riesgo", "atencion"]


def test_cada_asignatura_en_riesgo_genera_su_propia_alerta():
    alertas, _ = evaluar_datos(
        [NOTA3], datos(notas={"Matemáticas": "2.0", "Física": "2.5", "Inglés": "4.5"})
    )
    assert [a["asignatura"] for a in alertas] == ["Física", "Matemáticas"]


def test_funciones_de_calculo():
    assert promedio({"a": Decimal("4"), "b": Decimal("3")}) == Decimal("3.50")
    assert promedio({}) is None
    assert porcentaje_asistencia({"presente": 1, "tarde": 1, "ausente": 1, "excusa": 5}) == Decimal(
        "66.7"
    )
    assert porcentaje_asistencia({}) is None


# =============================================================== HU-03.04.T3 explicación


def test_cada_alerta_explica_que_se_midio_contra_que_umbral_y_que_regla_la_marco():
    reglas = [
        regla("nota_baja", "3.00", "riesgo", "Nota en riesgo"),
        regla("asistencia_baja", "80", "riesgo", "Asistencia en riesgo"),
        regla("trabajos_pendientes", "2", "atencion", "Trabajos en atención"),
    ]
    alertas, _ = evaluar_datos(
        reglas,
        datos(notas={"Matemáticas": "2.80"}, conteo={"presente": 7, "ausente": 3}, trabajos=3),
    )
    por_tipo = {a["tipo"]: a["explicacion"] for a in alertas}
    assert por_tipo["nota_baja"] == (
        "La nota de Matemáticas (2.8) es menor que 3, el límite de la regla «Nota en riesgo»."
    )
    assert por_tipo["asistencia_baja"] == (
        "Su asistencia (70 %) es menor que 80 %, el límite de la regla «Asistencia en riesgo»."
    )
    assert por_tipo["trabajos_pendientes"] == (
        "Tiene 3 trabajo(s) sin entregar; la regla «Trabajos en atención» se activa desde 2."
    )


def test_la_alerta_incluye_los_datos_para_mostrarla():
    alertas, _ = evaluar_datos([NOTA3], datos(notas={"Física": "2.0"}))
    a = alertas[0]
    assert (a["asignatura"], a["valor"], a["umbral"], a["severidad"]) == (
        "Física",
        Decimal("2.0"),
        Decimal("3.00"),
        "riesgo",
    )


# =============================================================== HU-03.04.T2 evaluación por API


def test_evaluacion_de_un_estudiante_con_explicaciones(coord, periodo, grupo):
    u = matricular("ana@colegio.edu.co", periodo, grupo)
    nota(u, periodo, "2.5")
    nota(u, periodo, "4.5", "Física")
    asistencias(u, ["presente"] * 7 + ["ausente"] * 3)
    pendientes(u, periodo, 2)
    r = coord.get(f"/api/estudiantes/{u.pk}/evaluacion/")
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["estado"] == "riesgo"
    assert cuerpo["medidas"]["promedio"] == "3.50"
    assert cuerpo["medidas"]["asistencia"]["porcentaje"] == "70.0"
    assert cuerpo["medidas"]["trabajos_pendientes"] == 2
    tipos = {a["tipo"]: a for a in cuerpo["alertas"]}
    assert (
        tipos["nota_baja"]["asignatura"] == "Matemáticas"
        and "2.5" in tipos["nota_baja"]["explicacion"]
    )
    assert tipos["asistencia_baja"]["severidad"] == "riesgo"  # 70 no es menor que 70 (crítica)
    assert tipos["trabajos_pendientes"]["severidad"] == "atencion"


def test_un_estudiante_sin_problemas_queda_sin_alertas(coord, periodo, grupo):
    u = matricular("ana@colegio.edu.co", periodo, grupo)
    nota(u, periodo, "4.5")
    asistencias(u, ["presente"] * 10)
    cuerpo = coord.get(f"/api/estudiantes/{u.pk}/evaluacion/").json()
    assert cuerpo["estado"] == "sin_alertas" and cuerpo["alertas"] == []


def test_un_estudiante_sin_datos_no_genera_alertas_falsas(coord, periodo, grupo):
    u = matricular("ana@colegio.edu.co", periodo, grupo)
    cuerpo = coord.get(f"/api/estudiantes/{u.pk}/evaluacion/").json()
    assert cuerpo["estado"] == "sin_alertas" and cuerpo["medidas"]["promedio"] is None
    assert cuerpo["medidas"]["asistencia"]["porcentaje"] is None


def test_cambiar_un_umbral_cambia_la_evaluacion_sin_tocar_codigo(coord, admin, periodo, grupo):
    u = matricular("ana@colegio.edu.co", periodo, grupo)
    nota(u, periodo, "3.2")
    assert coord.get(f"/api/estudiantes/{u.pk}/evaluacion/").json()["estado"] == "atencion"
    regla_atencion = ReglaAcademica.objects.get(nombre="Nota en atención")
    admin.patch(f"/api/reglas/{regla_atencion.pk}/", {"umbral": "3.1"}, format="json")
    assert coord.get(f"/api/estudiantes/{u.pk}/evaluacion/").json()["estado"] == "sin_alertas"


def test_las_notas_de_otro_periodo_no_afectan(coord, periodo, grupo):
    u = matricular("ana@colegio.edu.co", periodo, grupo)
    anterior = PeriodoAcademico.objects.create(
        nombre="Anterior",
        fecha_inicio=periodo.fecha_inicio - datetime.timedelta(days=200),
        fecha_fin=periodo.fecha_inicio - datetime.timedelta(days=100),
    )
    Matricula.objects.create(estudiante=u, periodo=anterior, grupo=grupo)
    nota(u, anterior, "1.5")
    assert coord.get(f"/api/estudiantes/{u.pk}/evaluacion/").json()["estado"] == "sin_alertas"
    assert (
        coord.get(f"/api/estudiantes/{u.pk}/evaluacion/", {"periodo": anterior.pk}).json()["estado"]
        == "critico"
    )


def test_el_estudiante_ve_su_propia_evaluacion_con_explicacion(periodo, grupo):
    u = matricular("ana@colegio.edu.co", periodo, grupo)
    nota(u, periodo, "1.8")
    cuerpo = cliente(u).get("/api/mi-evaluacion/").json()
    assert cuerpo["estado"] == "critico" and "1.8" in cuerpo["alertas"][0]["explicacion"]


def test_la_evaluacion_ajena_no_se_ve_sin_permiso(periodo, grupo):
    u = matricular("ana@colegio.edu.co", periodo, grupo)
    otro = cliente(matricular("otro@colegio.edu.co", periodo, grupo))
    tutor = cliente(crear("t@colegio.edu.co", Rol.TUTOR))
    for c in (otro, tutor):
        assert c.get(f"/api/estudiantes/{u.pk}/evaluacion/").status_code == 403
    assert (
        cliente(crear("t2@colegio.edu.co", Rol.TUTOR)).get("/api/mi-evaluacion/").status_code == 403
    )


def test_evaluacion_sin_periodo_vigente_pide_indicarlo(coord):
    u = crear("ana@colegio.edu.co")
    assert coord.get(f"/api/estudiantes/{u.pk}/evaluacion/").status_code == 400
    assert coord.get(f"/api/estudiantes/{u.pk}/evaluacion/", {"periodo": 99999}).status_code == 400
    assert coord.get("/api/estudiantes/999999/evaluacion/").status_code == 404


# =============================================================== HU-03.05 matriz de desempeño


@pytest.fixture
def escenario(periodo, grupo):
    """Cuatro estudiantes en estados distintos."""
    sano = matricular("sano@colegio.edu.co", periodo, grupo, "Alvarez")
    nota(sano, periodo, "4.8")
    asistencias(sano, ["presente"] * 10)
    atencion = matricular("atencion@colegio.edu.co", periodo, grupo, "Benitez")
    nota(atencion, periodo, "3.3")
    riesgo = matricular("riesgo@colegio.edu.co", periodo, grupo, "Castro")
    nota(riesgo, periodo, "2.7")
    critico = matricular("critico@colegio.edu.co", periodo, grupo, "Diaz")
    nota(critico, periodo, "1.5")
    pendientes(critico, periodo, 6)
    return sano, atencion, riesgo, critico


def correos(r):
    return [f["email"].split("@")[0] for f in r.json()["results"]]


def test_la_matriz_ordena_de_lo_mas_grave_a_lo_menos_grave(coord, escenario):
    r = coord.get("/api/matriz-desempeno/")
    assert r.status_code == 200
    assert correos(r) == ["critico", "riesgo", "atencion", "sano"]
    assert [f["estado"] for f in r.json()["results"]] == [
        "critico",
        "riesgo",
        "atencion",
        "sin_alertas",
    ]


def test_la_matriz_trae_las_medidas_de_cada_estudiante(coord, escenario):
    fila = {
        f["email"].split("@")[0]: f for f in coord.get("/api/matriz-desempeno/").json()["results"]
    }
    sano, critico = fila["sano"], fila["critico"]
    assert sano["promedio"] == "4.80" and sano["asistencia"] == "100.0" and sano["alertas"] == 0
    assert critico["promedio"] == "1.50" and critico["trabajos_pendientes"] == 6
    assert critico["alertas"] == 2 and critico["grupo"] == "Sexto A"
    assert fila["atencion"]["asistencia"] is None  # sin registros: no se inventa un 0 %


def test_el_resumen_cuenta_cuantos_hay_en_cada_estado(coord, escenario):
    cuerpo = coord.get("/api/matriz-desempeno/").json()
    assert cuerpo["resumen"] == {"sin_alertas": 1, "atencion": 1, "riesgo": 1, "critico": 1}
    assert cuerpo["count"] == 4


def test_filtrar_la_matriz_por_estado_conserva_el_resumen_completo(coord, escenario):
    cuerpo = coord.get("/api/matriz-desempeno/", {"estado": "riesgo"}).json()
    assert [f["estado"] for f in cuerpo["results"]] == ["riesgo"] and cuerpo["count"] == 1
    assert cuerpo["resumen"]["critico"] == 1  # el tablero sigue mostrando todos los conteos
    assert coord.get("/api/matriz-desempeno/", {"estado": "sin_alertas"}).json()["count"] == 1
    assert coord.get("/api/matriz-desempeno/", {"estado": "inventado"}).status_code == 400


def test_filtrar_la_matriz_por_grupo_grado_y_busqueda(coord, escenario, periodo, grupo):
    otro_grupo = Grupo.objects.create(
        grado=Grado.objects.create(nombre="Octavo", orden=8), nombre="B"
    )
    extra = matricular("extra@colegio.edu.co", periodo, otro_grupo, "Zapata")
    nota(extra, periodo, "1.2")
    assert correos(coord.get("/api/matriz-desempeno/", {"grupo": otro_grupo.pk})) == ["extra"]
    assert coord.get("/api/matriz-desempeno/", {"grado": grupo.grado.pk}).json()["count"] == 4
    assert correos(coord.get("/api/matriz-desempeno/", {"q": "castro"})) == ["riesgo"]
    assert coord.get("/api/matriz-desempeno/", {"grupo": "x"}).status_code == 400


def test_la_matriz_solo_incluye_matriculas_activas_del_periodo(coord, escenario, periodo, grupo):
    Matricula.objects.filter(estudiante__email="critico@colegio.edu.co").update(estado="retirada")
    assert "critico" not in correos(coord.get("/api/matriz-desempeno/"))


def test_la_matriz_pagina_y_no_hace_una_consulta_por_estudiante(
    coord, periodo, grupo, django_assert_max_num_queries
):
    for i in range(30):
        u = matricular(f"u{i:02}@colegio.edu.co", periodo, grupo, f"Apellido{i:02}")
        nota(u, periodo, "1.5")  # por debajo de 2: crítico
    with django_assert_max_num_queries(14):
        r = coord.get("/api/matriz-desempeno/")
    assert r.status_code == 200 and r.json()["count"] == 30 and len(r.json()["results"]) == 20
    assert r.json()["resumen"]["critico"] == 30
    assert len(coord.get("/api/matriz-desempeno/", {"page": 2}).json()["results"]) == 10


def test_la_matriz_sin_periodo_vigente_pide_indicarlo(coord):
    r = coord.get("/api/matriz-desempeno/")
    assert r.status_code == 400 and "periodo" in detalles(r)


def test_la_matriz_es_solo_para_coordinacion(escenario):
    for rol in (Rol.TUTOR, Rol.ESTUDIANTE):
        assert (
            cliente(crear(f"{rol.value}@x.edu.co", rol)).get("/api/matriz-desempeno/").status_code
            == 403
        )
    assert APIClient().get("/api/matriz-desempeno/").status_code == 401
