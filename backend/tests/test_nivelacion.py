"""Nivelación escolar: acudiente, dudas, entregas y correcciones, verificación y reporte."""

# ruff: noqa: F401, F811  (las fixtures compartidas se importan de test_planes)
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from planes.models import EntregaActividad, NotificacionAcompanamiento, PlanRefuerzo
from usuarios.models import EventoAuditoria, Usuario, VinculoAcudiente
from usuarios.roles import Rol

from .test_planes import (
    cliente,
    coord,
    crear,
    estudiante,
    habil,
    matematicas,
    periodo,
    tutor_elegible,
)
from .test_planes_seguimiento import agregar, plan_asignado

pytestmark = pytest.mark.django_db

VALORACION = {"valoracion": "Alcanzó los desempeños.", "nota_final": "4.0"}


@pytest.fixture(autouse=True)
def _archivos_temporales(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path


@pytest.fixture
def admin():
    return cliente(crear("admin@colegio.edu.co", Rol.ADMINISTRADOR))


@pytest.fixture
def acudiente(estudiante):
    usuario = crear("acudiente@colegio.edu.co", Rol.ACUDIENTE)
    VinculoAcudiente.objects.create(acudiente=usuario, estudiante=estudiante, parentesco="Madre")
    return usuario


def pdf(nombre="taller.pdf", contenido=b"%PDF-1.4 contenido"):
    return SimpleUploadedFile(nombre, contenido, content_type="application/pdf")


def entregar(c, actividad_id, archivo=None, **extra):
    datos = {"archivo": archivo or pdf(), "comentario": "Listo", **extra}
    return c.post(f"/api/actividades/{actividad_id}/entregas/", datos, format="multipart")


def retroalimentar(c, entrega_id, requiere_correccion=False, comentario="Bien"):
    return c.post(
        f"/api/entregas/{entrega_id}/retroalimentacion/",
        {"comentario": comentario, "requiere_correccion": requiere_correccion},
        format="json",
    )


def cerrar(c, plan_id, **extra):
    return c.post(f"/api/planes/{plan_id}/cerrar/", {**VALORACION, **extra}, format="json")


@pytest.fixture
def docente(plan_asignado):
    return cliente(plan_asignado["tutor"])


@pytest.fixture
def actividad(docente, plan_asignado):
    return agregar(docente, plan_asignado["id"])


# ------------------------------------------------------------------ vínculos de acudiente


def test_administrador_vincula_y_retira_acudientes(admin, estudiante):
    acu = crear("acu@colegio.edu.co", Rol.ACUDIENTE)
    datos = {"acudiente": acu.pk, "estudiante": estudiante.pk, "parentesco": "Padre"}

    r = admin.post("/api/vinculos-acudiente/", datos, format="json")
    assert r.status_code == 201, r.json()
    assert r.json()["estudiante_nombre"] == "Nom Zapata"
    assert admin.post("/api/vinculos-acudiente/", datos, format="json").status_code == 400
    assert len(admin.get(f"/api/vinculos-acudiente/?estudiante={estudiante.pk}").json()) == 1
    assert EventoAuditoria.objects.filter(accion="vinculo_acudiente.creado").exists()

    assert admin.delete(f"/api/vinculos-acudiente/{r.json()['id']}/").status_code == 204
    assert VinculoAcudiente.objects.count() == 0


def test_el_vinculo_exige_roles_correctos(admin, estudiante):
    otro_estudiante = crear("otro@colegio.edu.co")
    acu = crear("acu@colegio.edu.co", Rol.ACUDIENTE)
    for datos in (
        {"acudiente": otro_estudiante.pk, "estudiante": estudiante.pk},
        {"acudiente": acu.pk, "estudiante": acu.pk},
    ):
        assert admin.post("/api/vinculos-acudiente/", datos, format="json").status_code == 400
    assert VinculoAcudiente.objects.count() == 0


def test_solo_el_administrador_gestiona_vinculos(coord, estudiante, acudiente):
    assert coord.get("/api/vinculos-acudiente/").status_code == 403
    datos = {"acudiente": acudiente.pk, "estudiante": estudiante.pk}
    assert coord.post("/api/vinculos-acudiente/", datos, format="json").status_code == 403
    assert cliente(acudiente).get("/api/vinculos-acudiente/").status_code == 403
    assert coord.delete("/api/vinculos-acudiente/1/").status_code == 403


def test_el_acudiente_lista_sus_estudiantes_vinculados(estudiante, acudiente):
    r = cliente(acudiente).get("/api/mis-estudiantes-vinculados/")
    assert r.status_code == 200
    assert r.json() == [
        {
            "id": estudiante.pk,
            "nombre": "Nom Zapata",
            "parentesco": "Madre",
            "grado": "Sexto",
            "grupo": "A",
        }
    ]


# ------------------------------------------------------------------ acudiente: solo consulta


def test_el_acudiente_consulta_el_proceso_del_estudiante_vinculado(acudiente, plan_asignado):
    c = cliente(acudiente)
    assert [p["id"] for p in c.get("/api/mis-planes/").json()] == [plan_asignado["id"]]
    datos = c.get(f"/api/planes/{plan_asignado['id']}/seguimiento/").json()
    assert datos["puede_gestionar"] is False


def test_el_acudiente_no_ve_estudiantes_no_vinculados(plan_asignado):
    ajeno = cliente(crear("ajeno@colegio.edu.co", Rol.ACUDIENTE))
    assert ajeno.get("/api/mis-planes/").json() == []
    assert ajeno.get(f"/api/planes/{plan_asignado['id']}/seguimiento/").status_code == 404
    assert ajeno.get(f"/api/planes/{plan_asignado['id']}/dudas/").status_code == 404


def test_el_acudiente_no_modifica_el_plan_ni_las_notas(acudiente, plan_asignado, actividad):
    c = cliente(acudiente)
    pid = plan_asignado["id"]
    assert c.post(f"/api/planes/{pid}/actividades/", {}, format="json").status_code == 403
    assert (
        c.patch(
            f"/api/actividades/{actividad['id']}/", {"completada": True}, format="json"
        ).status_code
        == 403
    )
    assert c.patch(f"/api/planes/{pid}/", {"objetivos": "x"}, format="json").status_code == 403
    assert cerrar(c, pid).status_code == 403
    assert (
        c.post(f"/api/planes/{pid}/dudas/", {"texto": "¿Cómo va?"}, format="json").status_code
        == 403
    )
    assert entregar(c, actividad["id"]).status_code == 403


def test_el_acudiente_inactivo_o_desvinculado_pierde_el_acceso(acudiente, plan_asignado):
    VinculoAcudiente.objects.all().delete()
    c = cliente(acudiente)
    assert c.get("/api/mis-planes/").json() == []
    assert c.get(f"/api/planes/{plan_asignado['id']}/seguimiento/").status_code == 404


# ------------------------------------------------------------------ dudas y aclaraciones


def test_estudiante_pregunta_y_docente_responde(estudiante, acudiente, docente, plan_asignado):
    pid = plan_asignado["id"]
    est = cliente(estudiante)

    pregunta = est.post(f"/api/planes/{pid}/dudas/", {"texto": " ¿Qué página? "}, format="json")
    assert pregunta.status_code == 201, pregunta.json()
    assert pregunta.json()["texto"] == "¿Qué página?"
    assert pregunta.json()["autor_rol"] == "estudiante"
    avisos = NotificacionAcompanamiento.objects.filter(tipo="duda")
    assert [a.destinatario_id for a in avisos] == [plan_asignado["tutor"].pk]

    respuesta = docente.post(
        f"/api/planes/{pid}/dudas/",
        {"texto": "La 12", "respuesta_a": pregunta.json()["id"]},
        format="json",
    )
    assert respuesta.status_code == 201, respuesta.json()
    assert respuesta.json()["respuesta_a"] == pregunta.json()["id"]
    destinatarios = set(
        NotificacionAcompanamiento.objects.filter(titulo="Respuesta del docente").values_list(
            "destinatario_id", flat=True
        )
    )
    assert destinatarios == {estudiante.pk, acudiente.pk}

    # El acudiente y coordinación leen el hilo completo.
    for lector in (cliente(acudiente), est, docente):
        assert [d["texto"] for d in lector.get(f"/api/planes/{pid}/dudas/").json()] == [
            "¿Qué página?",
            "La 12",
        ]


def test_solo_estudiante_y_docente_responsable_escriben_dudas(coord, matematicas, plan_asignado):
    pid = plan_asignado["id"]
    ajeno_est = cliente(crear("ajeno@colegio.edu.co"))
    otro_docente = cliente(tutor_elegible("otro@colegio.edu.co", matematicas))
    assert (
        ajeno_est.post(f"/api/planes/{pid}/dudas/", {"texto": "x"}, format="json").status_code
        == 404
    )
    assert (
        otro_docente.post(f"/api/planes/{pid}/dudas/", {"texto": "x"}, format="json").status_code
        == 404
    )
    # Coordinación ve el expediente pero no participa en el diálogo.
    assert coord.post(f"/api/planes/{pid}/dudas/", {"texto": "x"}, format="json").status_code == 403
    assert coord.get(f"/api/planes/{pid}/dudas/").status_code == 200


def test_las_dudas_se_validan_y_se_cierran_con_el_expediente(estudiante, docente, plan_asignado):
    pid = plan_asignado["id"]
    est = cliente(estudiante)
    assert est.post(f"/api/planes/{pid}/dudas/", {"texto": "   "}, format="json").status_code == 400
    assert (
        est.post(f"/api/planes/{pid}/dudas/", {"texto": "x" * 1001}, format="json").status_code
        == 400
    )
    assert (
        est.post(
            f"/api/planes/{pid}/dudas/", {"texto": "x", "respuesta_a": 999}, format="json"
        ).status_code
        == 400
    )
    cerrar(docente, pid, forzar=True)
    assert est.post(f"/api/planes/{pid}/dudas/", {"texto": "x"}, format="json").status_code == 400


# ------------------------------------------------------------------ entregas y correcciones


def test_ciclo_de_entrega_correccion_y_aceptacion(estudiante, docente, actividad, plan_asignado):
    est = cliente(estudiante)
    aid = actividad["id"]

    primera = entregar(est, aid)
    assert primera.status_code == 201, primera.json()
    assert primera.json()["tipo"] == "entrega"
    assert primera.json()["archivo_nombre"] == "taller.pdf"
    assert [
        a.destinatario_id for a in NotificacionAcompanamiento.objects.filter(tipo="entrega")
    ] == [plan_asignado["tutor"].pk]

    # Hasta que el docente retroalimenta no se acepta otra carga.
    assert entregar(est, aid).status_code == 400

    r = retroalimentar(
        docente, primera.json()["id"], requiere_correccion=True, comentario="Revisa 2"
    )
    assert r.status_code == 201, r.json()
    assert r.json()["requiere_correccion"] is True
    assert retroalimentar(docente, primera.json()["id"]).status_code == 400  # ya retroalimentada

    correccion = entregar(est, aid, pdf("corregido.pdf"))
    assert correccion.status_code == 201, correccion.json()
    assert correccion.json()["tipo"] == "correccion"

    r = retroalimentar(docente, correccion.json()["id"], comentario="Aceptado")
    assert r.status_code == 201
    assert r.json()["requiere_correccion"] is False
    lista = docente.get(f"/api/actividades/{aid}/entregas/").json()
    assert [e["tipo"] for e in lista] == ["entrega", "correccion"]
    assert lista[0]["retroalimentacion"]["comentario"] == "Revisa 2"

    # La actividad queda cumplida y ya no admite más cargas.
    actividades = docente.get(f"/api/planes/{plan_asignado['id']}/actividades/").json()
    assert actividades[0]["completada"] is True
    assert entregar(est, aid).status_code == 400


def test_validacion_de_archivos(estudiante, actividad):
    est = cliente(estudiante)
    aid = actividad["id"]
    assert est.post(f"/api/actividades/{aid}/entregas/", {}, format="multipart").status_code == 400
    assert entregar(est, aid, pdf("virus.exe")).status_code == 400
    assert entregar(est, aid, pdf("sin_extension")).status_code == 400
    grande = SimpleUploadedFile("grande.pdf", b"0" * (20 * 1024 * 1024 + 1))
    assert entregar(est, aid, grande).status_code == 400
    assert EntregaActividad.objects.count() == 0


def test_solo_el_estudiante_del_plan_entrega(coord, docente, matematicas, actividad):
    aid = actividad["id"]
    assert entregar(docente, aid).status_code == 403
    assert entregar(coord, aid).status_code == 403
    assert entregar(cliente(crear("ajeno@colegio.edu.co")), aid).status_code == 404


def test_solo_el_docente_responsable_retroalimenta(
    estudiante, coord, acudiente, matematicas, docente, actividad
):
    entrega = entregar(cliente(estudiante), actividad["id"]).json()
    otro_docente = cliente(tutor_elegible("otro@colegio.edu.co", matematicas))
    assert retroalimentar(otro_docente, entrega["id"]).status_code == 404
    for quien in (cliente(estudiante), coord, cliente(acudiente)):
        assert retroalimentar(quien, entrega["id"]).status_code == 403
    assert (
        docente.post(
            f"/api/entregas/{entrega['id']}/retroalimentacion/", {"comentario": ""}, format="json"
        ).status_code
        == 400
    )


def test_descarga_autorizada_de_entregas(estudiante, acudiente, docente, matematicas, actividad):
    entrega = entregar(
        cliente(estudiante), actividad["id"], pdf(contenido=b"%PDF-contenido")
    ).json()
    url = f"/api/entregas/{entrega['id']}/descargar/"

    for permitido in (cliente(estudiante), cliente(acudiente), docente):
        r = permitido.get(url)
        assert r.status_code == 200
        assert b"".join(r.streaming_content) == b"%PDF-contenido"
        assert r["X-Content-Type-Options"] == "nosniff"
    assert cliente(crear("ajeno@colegio.edu.co")).get(url).status_code == 404
    otro_docente = cliente(tutor_elegible("otro@colegio.edu.co", matematicas))
    assert otro_docente.get(url).status_code == 404


# ------------------------------------------------------------ coordinación: verificación


def test_coordinacion_registra_observaciones_y_el_docente_las_lee(
    coord, estudiante, docente, plan_asignado
):
    pid = plan_asignado["id"]
    r = coord.post(
        f"/api/planes/{pid}/observaciones/", {"texto": " Falta evidencia "}, format="json"
    )
    assert r.status_code == 201, r.json()
    assert r.json()["texto"] == "Falta evidencia"
    assert NotificacionAcompanamiento.objects.filter(
        titulo="Observación de coordinación", destinatario=plan_asignado["tutor"]
    ).exists()

    assert [o["texto"] for o in docente.get(f"/api/planes/{pid}/observaciones/").json()] == [
        "Falta evidencia"
    ]
    # El docente no se auto-registra observaciones; el estudiante no las ve.
    assert (
        docente.post(f"/api/planes/{pid}/observaciones/", {"texto": "x"}, format="json").status_code
        == 403
    )
    assert cliente(estudiante).get(f"/api/planes/{pid}/observaciones/").status_code == 403
    assert (
        coord.post(f"/api/planes/{pid}/observaciones/", {"texto": " "}, format="json").status_code
        == 400
    )


def test_visto_bueno_solo_de_coordinacion_y_tras_el_cierre(coord, docente, plan_asignado):
    pid = plan_asignado["id"]
    url = f"/api/planes/{pid}/visto-bueno/"
    assert coord.post(url).status_code == 400  # aún no está cerrado

    cerrar(docente, pid, forzar=True)
    assert docente.post(url).status_code == 403
    r = coord.post(url)
    assert r.status_code == 200, r.json()
    assert r.json()["visto_bueno"] is True
    assert r.json()["visto_bueno_por_nombre"] == "Nom Ape"
    assert coord.post(url).status_code == 400  # ya registrado
    assert EventoAuditoria.objects.filter(accion="plan.visto_bueno", recurso_id=str(pid)).exists()
    assert NotificacionAcompanamiento.objects.filter(
        titulo="Visto bueno de coordinación", destinatario=plan_asignado["tutor"]
    ).exists()


def test_el_cierre_avisa_a_participantes_y_pide_visto_bueno(
    coord, estudiante, acudiente, docente, plan_asignado
):
    assert cerrar(docente, plan_asignado["id"], forzar=True).status_code == 200
    cierre = NotificacionAcompanamiento.objects.filter(tipo="cierre")
    por_titulo = {}
    for aviso in cierre:
        por_titulo.setdefault(aviso.titulo, set()).add(aviso.destinatario_id)
    assert por_titulo["Plan de nivelación cerrado"] == {
        estudiante.pk,
        acudiente.pk,
        plan_asignado["tutor"].pk,
    }
    assert por_titulo["Expediente pendiente de visto bueno"] == {
        u.pk for u in Usuario.objects.filter(rol__in=[Rol.COORDINADOR, Rol.ADMINISTRADOR])
    }


# ------------------------------------------------------------------ reporte institucional


def test_el_reporte_exige_el_cierre_y_se_audita(coord, docente, plan_asignado):
    pid = plan_asignado["id"]
    assert docente.get(f"/api/planes/{pid}/reporte/").status_code == 400

    cerrar(docente, pid, forzar=True)
    r = docente.get(f"/api/planes/{pid}/reporte/")
    assert r.status_code == 200, r.json()
    datos = r.json()
    assert datos["identificacion"]["estudiante"] == "Nom Zapata"
    assert datos["identificacion"]["grado"] == "Sexto"
    assert datos["identificacion"]["area"] == "Matemáticas"
    assert datos["identificacion"]["docente"] == "Nom Ape"
    assert datos["desempenos_no_alcanzados"] == "Operaciones con fracciones"
    assert datos["resultado"]["nota_final"] == "4.00"
    assert datos["validacion"]["visto_bueno"] is False
    assert coord.get(f"/api/planes/{pid}/reporte/").status_code == 200
    assert EventoAuditoria.objects.filter(accion="reporte.consultado").count() == 2


def test_el_reporte_resume_el_acompanamiento(estudiante, docente, actividad, plan_asignado):
    est = cliente(estudiante)
    est.post(f"/api/planes/{plan_asignado['id']}/dudas/", {"texto": "¿Cómo?"}, format="json")
    primera = entregar(est, actividad["id"]).json()
    retroalimentar(docente, primera["id"], requiere_correccion=True)
    corregida = entregar(est, actividad["id"]).json()
    retroalimentar(docente, corregida["id"])
    cerrar(docente, plan_asignado["id"])

    datos = docente.get(f"/api/planes/{plan_asignado['id']}/reporte/").json()

    assert datos["acompanamiento"] == {
        "dudas": 1,
        "entregas": 1,
        "correcciones": 1,
        "retroalimentaciones": 2,
    }
    assert datos["actividades"][0]["completada"] is True


def test_el_reporte_solo_lo_ven_docente_responsable_y_coordinacion(
    estudiante, acudiente, matematicas, docente, plan_asignado
):
    pid = plan_asignado["id"]
    cerrar(docente, pid, forzar=True)
    url = f"/api/planes/{pid}/reporte/"
    assert cliente(estudiante).get(url).status_code == 403
    assert cliente(acudiente).get(url).status_code == 403
    assert cliente(tutor_elegible("otro@colegio.edu.co", matematicas)).get(url).status_code == 404


def test_el_reporte_imprimible_trae_firmas_visto_bueno_y_escapa_el_contenido(
    coord, docente, plan_asignado
):
    pid = plan_asignado["id"]
    cerrar(docente, pid, nota_final="3.5", forzar=True)
    coord.post(f"/api/planes/{pid}/observaciones/", {"texto": "<b>ok</b>"}, format="json")
    coord.post(f"/api/planes/{pid}/visto-bueno/")
    # El filtro de peticiones ya rechaza `<script>` por la API; aquí se comprueba que la plantilla
    # escapa lo que llegue a la base de datos por otra vía (defensa en profundidad).
    PlanRefuerzo.objects.filter(pk=pid).update(nota_cierre="<script>alert(1)</script> Logrado")

    r = docente.get(f"/api/planes/{pid}/reporte/?formato=html")

    assert r.status_code == 200
    assert r["Content-Type"].startswith("text/html")
    assert "default-src 'none'" in r["Content-Security-Policy"]
    html = r.content.decode()
    assert "Firma del docente" in html
    assert "Visto bueno y firma de coordinación" in html
    assert "Nom Zapata" in html and "Matemáticas" in html
    assert "Operaciones con fracciones" in html
    assert "3,5" in html or "3.5" in html
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html
    assert "<b>ok</b>" not in html
    assert "Registrado en el sistema" in html


# ------------------------------------------------------------------ encuentros sin valoración


def _sesion_terminada(plan_asignado):
    from datetime import timedelta

    from django.utils import timezone

    from planes.models import SesionTutoria

    fin = timezone.now() - timedelta(hours=1)
    return SesionTutoria.objects.create(
        plan_id=plan_asignado["id"],
        tutor=plan_asignado["tutor"],
        inicio=fin - timedelta(minutes=50),
        fin=fin,
        modalidad="presencial",
        lugar="Aula",
    )


def test_la_asistencia_se_registra_sin_valoracion_con_estrellas(plan_asignado, estudiante):
    sesion = _sesion_terminada(plan_asignado)

    r = cliente(estudiante).patch(
        f"/api/sesiones/{sesion.pk}/asistencia/",
        {"estado": "presente", "calificacion": 5, "comentario": "Excelente"},
        format="json",
    )

    assert r.status_code == 200, r.json()
    cuerpo = r.json()
    assert cuerpo["asistencia"] == "presente" and cuerpo["estado"] == "realizada"
    assert "valoracion" not in cuerpo


def test_el_desempeno_del_docente_no_incluye_calificaciones(plan_asignado):
    _sesion_terminada(plan_asignado)

    r = cliente(plan_asignado["tutor"]).get("/api/mi-desempeno-tutorias/")

    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["rol"] == "tutor"
    assert not {"promedio_calificacion", "cantidad_valoraciones", "comentarios"} & set(cuerpo)
