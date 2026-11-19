"""Materiales de una sesión: subida, validaciones, ruta de almacenamiento y descarga autenticada."""

# ruff: noqa: F401, F811  (las fixtures compartidas se importan de test_planes)
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from planes.models import MaterialSesion, NotificacionAcompanamiento, SesionTutoria
from usuarios.models import VinculoAcudiente
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
from .test_planes_seguimiento import plan_asignado

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _archivos_temporales(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path


@pytest.fixture
def sesion(plan_asignado):
    inicio = timezone.now() + timedelta(days=1)
    return SesionTutoria.objects.create(
        plan_id=plan_asignado["id"],
        tutor=plan_asignado["tutor"],
        inicio=inicio,
        fin=inicio + timedelta(minutes=50),
        modalidad="presencial",
        lugar="Aula",
    )


def archivo(nombre="guia.pdf", contenido=b"%PDF-1.4 guia de estudio"):
    return SimpleUploadedFile(nombre, contenido, content_type="application/pdf")


def subir(c, sesion, **datos):
    datos.setdefault("archivo", archivo())
    return c.post(f"/api/sesiones/{sesion.pk}/materiales/", datos, format="multipart")


def test_el_docente_responsable_comparte_un_material(sesion, plan_asignado, estudiante, settings):
    r = subir(
        cliente(plan_asignado["tutor"]),
        sesion,
        titulo="  Guía de fracciones ",
        descripcion="Cap. 2",
    )

    assert r.status_code == 201, r.json()
    material = MaterialSesion.objects.get(pk=r.json()["id"])
    assert r.json()["titulo"] == "Guía de fracciones"
    assert material.subido_por == plan_asignado["tutor"]
    # La ruta usa material_sesion_upload_path: carpeta por sesión y solo el nombre del archivo.
    assert material.archivo.name == f"materiales_sesiones/{sesion.pk}/guia.pdf"
    assert (settings.MEDIA_ROOT / material.archivo.name).read_bytes().startswith(b"%PDF")
    aviso = NotificacionAcompanamiento.objects.get(
        destinatario=estudiante, tipo=NotificacionAcompanamiento.Tipo.MATERIAL
    )
    assert "Guía de fracciones" in aviso.mensaje


def test_sin_titulo_se_usa_el_nombre_del_archivo(sesion, plan_asignado):
    r = subir(cliente(plan_asignado["tutor"]), sesion)

    assert r.status_code == 201
    assert r.json()["titulo"] == "guia.pdf"


def test_el_nombre_con_rutas_no_sale_de_la_carpeta_de_la_sesion(sesion, plan_asignado):
    r = subir(cliente(plan_asignado["tutor"]), sesion, archivo=archivo("../../fuera.pdf"))

    assert r.status_code == 201
    nombre = MaterialSesion.objects.get(pk=r.json()["id"]).archivo.name
    assert nombre == f"materiales_sesiones/{sesion.pk}/fuera.pdf"


def test_coordinacion_tambien_puede_compartir(sesion, coord):
    assert subir(coord, sesion).status_code == 201


def test_el_estudiante_no_puede_compartir_materiales(sesion, estudiante):
    r = subir(cliente(estudiante), sesion)

    assert r.status_code == 403
    assert not MaterialSesion.objects.exists()


def test_un_docente_ajeno_no_ve_la_sesion(sesion, matematicas):
    otro = tutor_elegible("otro@colegio.edu.co", matematicas)

    assert subir(cliente(otro), sesion).status_code == 404


def test_validaciones_del_archivo(sesion, plan_asignado):
    c = cliente(plan_asignado["tutor"])

    sin_archivo = c.post(f"/api/sesiones/{sesion.pk}/materiales/", {}, format="multipart")
    assert sin_archivo.status_code == 400
    assert "archivo" in sin_archivo.json()["error"]["details"]

    ejecutable = subir(c, sesion, archivo=archivo("virus.exe", b"MZ"))
    assert ejecutable.status_code == 400
    assert "Formato no permitido" in ejecutable.json()["error"]["details"]["archivo"][0]

    sin_extension = subir(c, sesion, archivo=archivo("sinextension", b"x"))
    assert sin_extension.status_code == 400

    grande = subir(c, sesion, archivo=archivo("grande.pdf", b"0" * (20 * 1024 * 1024 + 1)))
    assert grande.status_code == 400
    assert "20 MB" in grande.json()["error"]["details"]["archivo"][0]
    assert not MaterialSesion.objects.exists()


def test_no_se_comparten_materiales_en_una_sesion_cancelada(sesion, plan_asignado):
    sesion.estado = SesionTutoria.Estado.CANCELADA
    sesion.save(update_fields=["estado"])

    r = subir(cliente(plan_asignado["tutor"]), sesion)

    assert r.status_code == 400
    assert not MaterialSesion.objects.exists()


def test_el_material_aparece_en_la_sesion_del_plan(sesion, plan_asignado, estudiante):
    subir(cliente(plan_asignado["tutor"]), sesion, titulo="Guía")

    r = cliente(estudiante).get(f"/api/planes/{plan_asignado['id']}/sesiones/")

    assert r.status_code == 200
    assert [m["titulo"] for m in r.json()[0]["materiales"]] == ["Guía"]


def _descargar(c, sesion, material_id):
    return c.get(f"/api/sesiones/{sesion.pk}/materiales/{material_id}/descargar/")


def test_descarga_autenticada_para_quien_ve_el_plan(sesion, plan_asignado, estudiante):
    material_id = subir(cliente(plan_asignado["tutor"]), sesion).json()["id"]

    r = _descargar(cliente(estudiante), sesion, material_id)

    assert r.status_code == 200
    assert b"".join(r.streaming_content).startswith(b"%PDF-1.4 guia")
    assert r["X-Content-Type-Options"] == "nosniff"
    assert "attachment" in r["Content-Disposition"] and "guia.pdf" in r["Content-Disposition"]


def test_el_acudiente_vinculado_descarga_y_uno_ajeno_no(sesion, plan_asignado, estudiante):
    material_id = subir(cliente(plan_asignado["tutor"]), sesion).json()["id"]
    vinculado = crear("madre@colegio.edu.co", Rol.ACUDIENTE)
    VinculoAcudiente.objects.create(acudiente=vinculado, estudiante=estudiante)
    ajeno = crear("ajeno@colegio.edu.co", Rol.ACUDIENTE)

    assert _descargar(cliente(vinculado), sesion, material_id).status_code == 200
    assert _descargar(cliente(ajeno), sesion, material_id).status_code == 404


def test_otro_estudiante_y_anonimo_no_descargan(sesion, plan_asignado):
    material_id = subir(cliente(plan_asignado["tutor"]), sesion).json()["id"]
    otro = cliente(crear("otro.estudiante@colegio.edu.co", Rol.ESTUDIANTE))

    assert _descargar(otro, sesion, material_id).status_code == 404
    from rest_framework.test import APIClient

    assert _descargar(APIClient(), sesion, material_id).status_code == 401


def test_el_material_no_se_descarga_por_otra_sesion(sesion, plan_asignado, estudiante):
    material_id = subir(cliente(plan_asignado["tutor"]), sesion).json()["id"]
    inicio = timezone.now() + timedelta(days=2)
    otra = SesionTutoria.objects.create(
        plan_id=plan_asignado["id"],
        tutor=plan_asignado["tutor"],
        inicio=inicio,
        fin=inicio + timedelta(minutes=50),
        modalidad="presencial",
        lugar="Aula",
    )

    assert _descargar(cliente(estudiante), otra, material_id).status_code == 404
