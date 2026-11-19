"""EP-03: notas (HU-03.01), asistencia (HU-03.02) y trabajos sin entregar (HU-03.03)."""

import datetime
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from academico.models import DiaNoHabil, Matricula, PeriodoAcademico
from seguimiento.models import Asistencia, CambioNota, Resultado, TrabajoPendiente
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
def coord():
    return cliente(crear("coord@colegio.edu.co", Rol.COORDINADOR))


@pytest.fixture
def tutor():
    return cliente(crear("tutor@colegio.edu.co", Rol.TUTOR))


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


@pytest.fixture
def ana(grupo, periodo):
    u = crear("ana@colegio.edu.co", nombres="Ana", apellidos="Ruiz")
    Matricula.objects.create(estudiante=u, periodo=periodo, grupo=grupo)
    return u


def mate():
    return Asignatura.objects.get(nombre="Matemáticas")


def fisica():
    return Asignatura.objects.get(nombre="Física")


def nueva_nota(c, estudiante, periodo, valor="3.5", asignatura=None):
    return c.post(
        "/api/notas/",
        {
            "estudiante": estudiante.pk,
            "asignatura": (asignatura or mate()).pk,
            "periodo": periodo.pk,
            "valor": valor,
        },
        format="json",
    )


# =============================================================== HU-03.01 notas


def test_la_coordinacion_registra_una_nota(coord, ana, periodo):
    r = nueva_nota(coord, ana, periodo, "4.25")
    assert r.status_code == 201
    cuerpo = r.json()
    assert cuerpo["valor"] == "4.25" and cuerpo["estudiante_nombre"] == "Ana Ruiz"
    assert cuerpo["asignatura_nombre"] == "Matemáticas" and cuerpo["periodo_nombre"] == "Vigente"
    assert Resultado.objects.get().registrado_por.email == "coord@colegio.edu.co"


@pytest.mark.parametrize("valor", ["1", "1.00", "3", "5", "5.00", "2.75"])
def test_notas_validas_dentro_de_la_escala(coord, ana, periodo, valor):
    assert nueva_nota(coord, ana, periodo, valor).status_code == 201


@pytest.mark.parametrize("valor", ["0", "0.99", "5.01", "6", "-1", "abc", "", "3.555"])
def test_notas_fuera_de_la_escala_o_mal_escritas(coord, ana, periodo, valor):
    r = nueva_nota(coord, ana, periodo, valor)
    assert r.status_code == 400 and "valor" in detalles(r)
    assert Resultado.objects.count() == 0


def test_una_nota_por_estudiante_asignatura_y_periodo(coord, ana, periodo):
    nueva_nota(coord, ana, periodo)
    r = nueva_nota(coord, ana, periodo, "4")
    assert r.status_code == 400 and "Edítala" in detalles(r)["valor"][0]
    assert nueva_nota(coord, ana, periodo, "4", fisica()).status_code == 201  # otra asignatura


def test_exige_matricula_activa_en_el_periodo(coord, periodo, grupo):
    sin_matricula = crear("sin@colegio.edu.co")
    r = nueva_nota(coord, sin_matricula, periodo)
    assert r.status_code == 400 and "matrícula" in detalles(r)["estudiante"][0]
    retirado = crear("ret@colegio.edu.co")
    m = Matricula.objects.create(estudiante=retirado, periodo=periodo, grupo=grupo)
    Matricula.objects.filter(pk=m.pk).update(estado="retirada")
    assert nueva_nota(coord, retirado, periodo).status_code == 400


def test_solo_estudiantes_y_asignaturas_activas(coord, ana, periodo):
    tutor_usuario = crear("t@colegio.edu.co", Rol.TUTOR)
    assert nueva_nota(coord, tutor_usuario, periodo).status_code == 400
    Asignatura.objects.filter(nombre="Química").update(activa=False)
    quimica = Asignatura.objects.get(nombre="Química")
    assert nueva_nota(coord, ana, periodo, asignatura=quimica).status_code == 400


def test_solo_coordinacion_registra_notas(ana, periodo, tutor):
    estudiante = cliente(ana)
    for c in (tutor, estudiante):
        assert nueva_nota(c, ana, periodo).status_code == 403
        assert c.get("/api/notas/").status_code == 403
    assert APIClient().post("/api/notas/", {}, format="json").status_code == 401


def test_listar_notas_con_filtros(coord, ana, periodo, grupo):
    luis = crear("luis@colegio.edu.co", apellidos="Pérez")
    Matricula.objects.create(estudiante=luis, periodo=periodo, grupo=grupo)
    nueva_nota(coord, ana, periodo)
    nueva_nota(coord, ana, periodo, "4", fisica())
    nueva_nota(coord, luis, periodo, "2.5")
    assert coord.get("/api/notas/").json()["count"] == 3
    assert coord.get("/api/notas/", {"estudiante": ana.pk}).json()["count"] == 2
    assert coord.get("/api/notas/", {"asignatura": fisica().pk}).json()["count"] == 1
    assert coord.get("/api/notas/", {"periodo": periodo.pk}).json()["count"] == 3
    assert coord.get("/api/notas/", {"estudiante": "x"}).status_code == 400


# --- HU-03.01.T3: edición con historial ---


def test_corregir_una_nota_exige_motivo_y_deja_historial(coord, ana, periodo):
    nota = nueva_nota(coord, ana, periodo, "2.8").json()
    r = coord.patch(
        f"/api/notas/{nota['id']}/",
        {"valor": "3.2", "motivo": "Error de digitación"},
        format="json",
    )
    assert r.status_code == 200 and r.json()["valor"] == "3.20"
    (cambio,) = CambioNota.objects.all()
    assert (cambio.valor_anterior, cambio.valor_nuevo) == (Decimal("2.80"), Decimal("3.20"))
    assert (
        cambio.motivo == "Error de digitación"
        and cambio.cambiado_por.email == "coord@colegio.edu.co"
    )


def test_la_correccion_sin_motivo_o_con_motivo_vacio_se_rechaza(coord, ana, periodo):
    nota = nueva_nota(coord, ana, periodo).json()
    url = f"/api/notas/{nota['id']}/"
    assert coord.patch(url, {"valor": "4"}, format="json").status_code == 400
    assert coord.patch(url, {"valor": "4", "motivo": "  "}, format="json").status_code == 400
    assert coord.patch(url, {"valor": "4", "motivo": "ok"}, format="json").status_code == 400
    assert Resultado.objects.get().valor == Decimal("3.50") and CambioNota.objects.count() == 0


def test_la_correccion_respeta_la_escala_y_no_acepta_el_mismo_valor(coord, ana, periodo):
    nota = nueva_nota(coord, ana, periodo, "3.5").json()
    url = f"/api/notas/{nota['id']}/"
    assert (
        coord.patch(url, {"valor": "6", "motivo": "Error de escala"}, format="json").status_code
        == 400
    )
    r = coord.patch(url, {"valor": "3.5", "motivo": "Sin cambios reales"}, format="json")
    assert r.status_code == 400 and CambioNota.objects.count() == 0


def test_el_historial_lista_todas_las_correcciones_de_la_mas_reciente_a_la_mas_antigua(
    coord, ana, periodo
):
    nota = nueva_nota(coord, ana, periodo, "2.0").json()
    url = f"/api/notas/{nota['id']}/"
    coord.patch(url, {"valor": "3.0", "motivo": "Primera corrección"}, format="json")
    coord.patch(url, {"valor": "3.5", "motivo": "Segunda corrección"}, format="json")
    historial = coord.get(f"{url}historial/").json()
    assert [h["valor_nuevo"] for h in historial] == ["3.50", "3.00"]
    assert historial[0]["cambiado_por_email"] == "coord@colegio.edu.co"
    assert coord.get("/api/notas/999999/historial/").status_code == 404


def test_el_historial_sobrevive_si_se_borra_a_quien_corrigio(coord, ana, periodo):
    nota = nueva_nota(coord, ana, periodo).json()
    coord.patch(
        f"/api/notas/{nota['id']}/", {"valor": "4", "motivo": "Corrección válida"}, format="json"
    )
    Usuario.objects.filter(email="coord@colegio.edu.co").delete()
    assert CambioNota.objects.get().cambiado_por is None


def test_solo_coordinacion_corrige_notas(coord, ana, periodo, tutor):
    nota = nueva_nota(coord, ana, periodo).json()
    for c in (tutor, cliente(ana)):
        r = c.patch(
            f"/api/notas/{nota['id']}/", {"valor": "5", "motivo": "Quiero más nota"}, format="json"
        )
        assert r.status_code == 403
        assert c.get(f"/api/notas/{nota['id']}/historial/").status_code == 403
    assert Resultado.objects.get().valor == Decimal("3.50")


def test_el_estudiante_ve_sus_notas_y_su_promedio(coord, ana, periodo):
    nueva_nota(coord, ana, periodo, "4.0")
    nueva_nota(coord, ana, periodo, "3.0", fisica())
    r = cliente(ana).get("/api/mis-notas/")
    assert r.status_code == 200
    assert r.json()["promedio"] == "3.50" and len(r.json()["notas"]) == 2


def test_cada_estudiante_ve_solo_sus_notas(coord, ana, periodo, grupo):
    otro = crear("otro@colegio.edu.co")
    Matricula.objects.create(estudiante=otro, periodo=periodo, grupo=grupo)
    nueva_nota(coord, otro, periodo, "5")
    assert cliente(ana).get("/api/mis-notas/").json()["notas"] == []


def test_mis_notas_sin_periodo_vigente_pide_indicarlo():
    r = cliente(crear("sinperiodo@colegio.edu.co")).get("/api/mis-notas/")
    assert r.status_code == 400 and "periodo" in detalles(r)


def test_mis_notas_es_solo_para_estudiantes(coord, tutor):
    assert coord.get("/api/mis-notas/").status_code == 403
    assert tutor.get("/api/mis-notas/").status_code == 403


# =============================================================== HU-03.02 asistencia

LUNES = None


def un_lunes_pasado():
    dia = timezone.localdate() - datetime.timedelta(days=3)
    while dia.weekday() != 0:
        dia -= datetime.timedelta(days=1)
    return dia


def url_asistencia(grupo, fecha):
    return f"/api/asistencia/grupo/{grupo.pk}/{fecha.isoformat()}/"


def tomar(c, grupo, fecha, *pares):
    registros = [{"estudiante": e.pk, "estado": s} for e, s in pares]
    return c.put(url_asistencia(grupo, fecha), {"registros": registros}, format="json")


def test_la_lista_del_grupo_muestra_a_los_matriculados_sin_asistencia_tomada(tutor, ana, grupo):
    r = tutor.get(url_asistencia(grupo, un_lunes_pasado()))
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["habil"] is True and cuerpo["grupo"] == "Sexto A"
    assert cuerpo["estudiantes"] == [
        {"estudiante": ana.pk, "nombre": "Ana Ruiz", "email": "ana@colegio.edu.co", "estado": None}
    ]


def test_se_toma_la_asistencia_del_grupo_y_queda_registrada(tutor, ana, grupo):
    luis = crear("luis@colegio.edu.co", apellidos="Pérez")
    Matricula.objects.create(estudiante=luis, periodo=PeriodoAcademico.actual(), grupo=grupo)
    dia = un_lunes_pasado()
    r = tomar(tutor, grupo, dia, (ana, "presente"), (luis, "ausente"))
    assert r.status_code == 200 and r.json()["guardados"] == 2
    estados = {e["email"]: e["estado"] for e in r.json()["estudiantes"]}
    assert estados == {"ana@colegio.edu.co": "presente", "luis@colegio.edu.co": "ausente"}
    assert (
        Asistencia.objects.get(estudiante=ana, fecha=dia).registrado_por.email
        == "tutor@colegio.edu.co"
    )


def test_volver_a_tomar_la_asistencia_corrige_sin_duplicar(tutor, ana, grupo):
    dia = un_lunes_pasado()
    tomar(tutor, grupo, dia, (ana, "ausente"))
    tomar(tutor, grupo, dia, (ana, "excusa"))
    assert Asistencia.objects.filter(estudiante=ana, fecha=dia).count() == 1
    assert Asistencia.objects.get(estudiante=ana, fecha=dia).estado == "excusa"


def test_no_se_toma_asistencia_en_dias_no_habiles(tutor, ana, grupo):
    sabado = un_lunes_pasado() - datetime.timedelta(days=2)
    r = tomar(tutor, grupo, sabado, (ana, "presente"))
    assert r.status_code == 400 and "fin de semana" in detalles(r)["fecha"][0]
    festivo = un_lunes_pasado() + datetime.timedelta(days=1)
    DiaNoHabil.objects.create(fecha=festivo, descripcion="Festivo")
    r = tomar(tutor, grupo, festivo, (ana, "presente"))
    assert r.status_code == 400 and "Festivo" in detalles(r)["fecha"][0]
    assert Asistencia.objects.count() == 0


def test_la_lista_de_un_dia_no_habil_se_puede_consultar_pero_avisa(tutor, ana, grupo):
    sabado = un_lunes_pasado() - datetime.timedelta(days=2)
    cuerpo = tutor.get(url_asistencia(grupo, sabado)).json()
    assert cuerpo["habil"] is False and cuerpo["motivo"] == "fin de semana"


def test_no_se_toma_asistencia_de_fechas_futuras(tutor, ana, grupo):
    futuro = timezone.localdate() + datetime.timedelta(days=1)
    r = tomar(tutor, grupo, futuro, (ana, "presente"))
    assert r.status_code == 400 and "futura" in detalles(r)["fecha"][0]


def test_la_fecha_debe_caer_en_un_periodo_academico(tutor, ana, grupo):
    r = tutor.get(url_asistencia(grupo, datetime.date(2001, 3, 5)))
    assert r.status_code == 400 and "periodo" in detalles(r)["fecha"][0]


def test_fecha_mal_escrita_o_grupo_inexistente(tutor, grupo):
    assert tutor.get(f"/api/asistencia/grupo/{grupo.pk}/ayer/").status_code == 400
    assert tutor.get(url_asistencia(Grupo(pk=999999), un_lunes_pasado())).status_code == 404


def test_solo_se_registran_estudiantes_matriculados_en_ese_grupo(tutor, ana, grupo):
    ajeno = crear("ajeno@colegio.edu.co")
    r = tomar(tutor, grupo, un_lunes_pasado(), (ana, "presente"), (ajeno, "presente"))
    assert r.status_code == 400 and str(ajeno.pk) in detalles(r)["registros"][0]
    assert Asistencia.objects.count() == 0  # todo o nada


def test_la_lista_no_puede_estar_vacia_ni_repetir_estudiantes_ni_traer_estados_invalidos(
    tutor, ana, grupo
):
    dia = un_lunes_pasado()
    assert (
        tutor.put(url_asistencia(grupo, dia), {"registros": []}, format="json").status_code == 400
    )
    assert tomar(tutor, grupo, dia, (ana, "presente"), (ana, "ausente")).status_code == 400
    assert tomar(tutor, grupo, dia, (ana, "dormido")).status_code == 400


def test_un_estudiante_retirado_no_aparece_en_la_lista(tutor, ana, grupo):
    Matricula.objects.filter(estudiante=ana).update(estado="retirada")
    assert tutor.get(url_asistencia(grupo, un_lunes_pasado())).json()["estudiantes"] == []


def test_toma_de_asistencia_solo_para_docentes_y_coordinacion(ana, grupo):
    est = cliente(ana)
    dia = un_lunes_pasado()
    assert est.get(url_asistencia(grupo, dia)).status_code == 403
    assert tomar(est, grupo, dia, (ana, "presente")).status_code == 403
    assert APIClient().get(url_asistencia(grupo, dia)).status_code == 401


# --- HU-03.02.T2: porcentaje ---


def registrar(grupo, estudiante, estados):
    """Registra una serie de estados en días hábiles consecutivos hacia atrás."""
    dia = timezone.localdate() - datetime.timedelta(days=1)
    for estado in estados:
        while dia.weekday() >= 5:
            dia -= datetime.timedelta(days=1)
        Asistencia.objects.create(estudiante=estudiante, fecha=dia, estado=estado)
        dia -= datetime.timedelta(days=1)


@pytest.mark.parametrize(
    ("estados", "esperado"),
    [
        (["presente"] * 9 + ["ausente"], "90.0"),
        (["presente"] * 3 + ["ausente"], "75.0"),
        (["presente", "tarde", "ausente", "ausente"], "50.0"),
        (["presente", "excusa", "excusa"], "100.0"),  # las excusas no restan
        (["ausente", "excusa"], "0.0"),
        (["presente"] * 2 + ["ausente"], "66.7"),  # redondeo a un decimal
    ],
)
def test_calculo_del_porcentaje_de_asistencia(coord, ana, grupo, estados, esperado):
    registrar(grupo, ana, estados)
    r = coord.get(f"/api/estudiantes/{ana.pk}/asistencia/")
    assert r.status_code == 200 and r.json()["porcentaje"] == esperado
    assert r.json()["total"] == len(estados)


def test_el_resumen_cuenta_cada_estado_y_lista_los_registros(coord, ana, grupo):
    registrar(grupo, ana, ["presente", "tarde", "ausente", "excusa"])
    cuerpo = coord.get(f"/api/estudiantes/{ana.pk}/asistencia/").json()
    assert (cuerpo["presentes"], cuerpo["tardes"], cuerpo["ausentes"], cuerpo["excusas"]) == (
        1,
        1,
        1,
        1,
    )
    assert (
        len(cuerpo["registros"]) == 4
        and cuerpo["registros"][0]["fecha"] > cuerpo["registros"][-1]["fecha"]
    )


def test_sin_registros_el_porcentaje_es_nulo_y_no_cero(coord, ana):
    cuerpo = coord.get(f"/api/estudiantes/{ana.pk}/asistencia/").json()
    assert cuerpo["porcentaje"] is None and cuerpo["total"] == 0


def test_solo_cuentan_las_fechas_del_periodo_consultado(coord, ana, periodo):
    Asistencia.objects.create(
        estudiante=ana, fecha=periodo.fecha_inicio - datetime.timedelta(days=30), estado="ausente"
    )
    registrar(None, ana, ["presente"])
    assert coord.get(f"/api/estudiantes/{ana.pk}/asistencia/").json()["porcentaje"] == "100.0"


def test_el_estudiante_ve_su_propia_asistencia(ana, grupo):
    registrar(grupo, ana, ["presente", "ausente"])
    assert cliente(ana).get("/api/mi-asistencia/").json()["porcentaje"] == "50.0"


def test_la_asistencia_de_un_estudiante_la_ven_solo_coordinacion(ana, tutor):
    assert tutor.get(f"/api/estudiantes/{ana.pk}/asistencia/").status_code == 403
    assert cliente(ana).get(f"/api/estudiantes/{ana.pk}/asistencia/").status_code == 403


# =============================================================== HU-03.03 trabajos sin entregar


def url_trabajos(e):
    return f"/api/estudiantes/{e.pk}/trabajos/"


def nuevo_trabajo(c, e, **extra):
    datos = {
        "asignatura": mate().pk,
        "descripcion": "Taller de fracciones",
        "fecha_limite": (timezone.localdate() - datetime.timedelta(days=2)).isoformat(),
        **extra,
    }
    return c.post(url_trabajos(e), datos, format="json")


def test_el_docente_registra_un_trabajo_pendiente_en_la_ficha(tutor, ana):
    r = nuevo_trabajo(tutor, ana)
    assert r.status_code == 201
    assert r.json()["entregado"] is False and r.json()["vencido"] is True
    assert r.json()["asignatura_nombre"] == "Matemáticas"
    assert TrabajoPendiente.objects.get().registrado_por.email == "tutor@colegio.edu.co"


def test_un_trabajo_con_fecha_futura_no_esta_vencido(tutor, ana):
    futuro = (timezone.localdate() + datetime.timedelta(days=5)).isoformat()
    assert nuevo_trabajo(tutor, ana, fecha_limite=futuro).json()["vencido"] is False


def test_validaciones_del_registro_de_trabajos(tutor, ana):
    assert nuevo_trabajo(tutor, ana, descripcion="  ").status_code == 400
    assert nuevo_trabajo(tutor, ana, fecha_limite="mañana").status_code == 400
    assert nuevo_trabajo(tutor, ana, asignatura=999999).status_code == 400
    assert tutor.post(url_trabajos(ana), {}, format="json").status_code == 400


def test_el_estudiante_debe_estar_matriculado_en_el_periodo(tutor):
    sin_matricula = crear("sin@colegio.edu.co")
    PeriodoAcademico.objects.create(
        nombre="P",
        fecha_inicio=timezone.localdate() - datetime.timedelta(days=5),
        fecha_fin=timezone.localdate() + datetime.timedelta(days=5),
    )
    r = nuevo_trabajo(tutor, sin_matricula)
    assert r.status_code == 400 and "matrícula" in detalles(r)["periodo"][0]


def test_sin_periodo_vigente_hay_que_indicarlo(tutor, grupo):
    est = crear("x@colegio.edu.co")
    assert nuevo_trabajo(tutor, est).status_code == 400


def test_marcar_entregado_registra_la_fecha_y_se_puede_reabrir(tutor, ana):
    trabajo = nuevo_trabajo(tutor, ana).json()
    r = tutor.patch(f"/api/trabajos/{trabajo['id']}/", {"entregado": True}, format="json")
    assert r.status_code == 200 and r.json()["entregado"] is True
    assert (
        r.json()["fecha_entrega"] == timezone.localdate().isoformat()
        and r.json()["vencido"] is False
    )
    r = tutor.patch(f"/api/trabajos/{trabajo['id']}/", {"entregado": False}, format="json")
    assert r.json()["fecha_entrega"] is None


def test_listar_los_trabajos_del_estudiante_con_filtros(tutor, ana):
    a = nuevo_trabajo(tutor, ana).json()
    nuevo_trabajo(tutor, ana, descripcion="Guía 2")
    tutor.patch(f"/api/trabajos/{a['id']}/", {"entregado": True}, format="json")
    assert len(tutor.get(url_trabajos(ana)).json()) == 2
    assert [
        t["descripcion"] for t in tutor.get(url_trabajos(ana), {"entregado": "false"}).json()
    ] == ["Guía 2"]
    assert len(tutor.get(url_trabajos(ana), {"entregado": "true"}).json()) == 1
    assert tutor.get(url_trabajos(ana), {"entregado": "tal vez"}).status_code == 400


def test_los_trabajos_pendientes_aparecen_en_la_ficha_del_estudiante(tutor, ana, coord):
    nuevo_trabajo(tutor, ana)
    trabajo2 = nuevo_trabajo(tutor, ana, descripcion="Guía 2").json()
    assert cliente(ana).get("/api/mi-ficha/").json()["trabajos_pendientes"] == 2
    tutor.patch(f"/api/trabajos/{trabajo2['id']}/", {"entregado": True}, format="json")
    assert cliente(ana).get("/api/mi-ficha/").json()["trabajos_pendientes"] == 1
    assert coord.get(f"/api/estudiantes/{ana.pk}/ficha/").json()["trabajos_pendientes"] == 1
    assert coord.get("/api/estudiantes/").json()["results"][0]["trabajos_pendientes"] == 1


def test_el_estudiante_ve_sus_trabajos_pero_no_los_registra(ana, tutor):
    nuevo_trabajo(tutor, ana)
    est = cliente(ana)
    assert len(est.get("/api/mis-trabajos/").json()) == 1
    assert est.post(url_trabajos(ana), {}, format="json").status_code == 403
    assert est.patch("/api/trabajos/1/", {"entregado": True}, format="json").status_code == 403


def test_los_trabajos_de_un_estudiante_no_se_ven_en_los_de_otro(tutor, ana, grupo, periodo):
    otro = crear("otro@colegio.edu.co")
    Matricula.objects.create(estudiante=otro, periodo=periodo, grupo=grupo)
    nuevo_trabajo(tutor, ana)
    assert tutor.get(url_trabajos(otro)).json() == []
    assert cliente(otro).get("/api/mis-trabajos/").json() == []


def test_trabajos_solo_para_estudiantes_existentes(tutor):
    assert tutor.get("/api/estudiantes/999999/trabajos/").status_code == 404
    docente = crear("d@colegio.edu.co", Rol.TUTOR)
    assert tutor.get(url_trabajos(docente)).status_code == 404
