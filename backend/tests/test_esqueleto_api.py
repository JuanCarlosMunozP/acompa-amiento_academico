"""Esqueleto de la API (T4): salud, CORS y formato de errores."""

import pytest
from django.db import OperationalError
from django.test import Client, RequestFactory
from rest_framework.test import APIClient

from common.exceptions import not_found, server_error

ORIGEN_OK = "http://localhost:8081"


# --- salud ---


@pytest.mark.django_db
def test_salud_con_base_de_datos():
    r = APIClient().get("/api/health/?db=1")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "database": "ok"}


def test_salud_sin_pedir_la_base_no_la_consulta():
    # Sin la marca `django_db`, cualquier consulta a la base lanzaría un error en esta prueba.
    assert APIClient().get("/api/health/").json() == {"status": "ok"}


def test_salud_responde_503_si_la_base_no_esta_disponible(monkeypatch):
    def sin_conexion(*args, **kwargs):
        raise OperationalError("no se pudo conectar: host=10.0.0.5 password=secreta")

    monkeypatch.setattr("common.views.connection.cursor", sin_conexion)
    r = APIClient().get("/api/health/?db=1")

    assert r.status_code == 503
    assert r.json() == {"status": "error", "database": "unavailable"}
    assert "secreta" not in r.content.decode()  # no se filtran detalles internos


def test_salud_no_acepta_otros_metodos():
    r = APIClient().post("/api/health/", {}, format="json")
    assert r.status_code == 405
    assert r.json()["error"]["code"] == "method_not_allowed"


# --- CORS ---


def test_preflight_permite_el_origen_del_cliente_y_los_encabezados_de_la_sesion():
    r = APIClient().options(
        "/api/auth/login/",
        HTTP_ORIGIN=ORIGEN_OK,
        HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
        HTTP_ACCESS_CONTROL_REQUEST_HEADERS="authorization,content-type",
    )
    assert r.status_code == 200
    assert r["Access-Control-Allow-Origin"] == ORIGEN_OK
    assert "POST" in r["Access-Control-Allow-Methods"]
    permitidos = r["Access-Control-Allow-Headers"].lower()
    assert "authorization" in permitidos and "content-type" in permitidos


def test_preflight_de_un_origen_desconocido_no_recibe_permiso():
    r = APIClient().options(
        "/api/auth/login/",
        HTTP_ORIGIN="http://malo.example",
        HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
    )
    assert "Access-Control-Allow-Origin" not in r


def test_preflight_permite_el_origen_de_expo_en_la_red_local():
    for origen in ("http://192.168.1.40:8081", "http://192.168.1.40:8082"):
        r = APIClient().options(
            "/api/auth/login/",
            HTTP_ORIGIN=origen,
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="authorization,content-type",
        )
        assert r.status_code == 200
        assert r["Access-Control-Allow-Origin"] == origen


def test_los_errores_tambien_llevan_la_cabecera_cors():
    # Si no, el navegador ocultaría el mensaje de error al cliente web.
    r = APIClient().get("/api/auth/me/", HTTP_ORIGIN=ORIGEN_OK)
    assert r.status_code == 401
    assert r["Access-Control-Allow-Origin"] == ORIGEN_OK


# --- formato único de errores ---


def test_404_tiene_el_formato_de_errores():
    r = APIClient().get("/api/no-existe/")
    assert r.status_code == 404
    assert r.json() == {"error": {"code": "not_found", "message": "Recurso no encontrado."}}


def test_los_manejadores_404_y_500_estan_conectados_en_las_urls_reales():
    import config.urls

    assert config.urls.handler404 == "common.exceptions.not_found"
    assert config.urls.handler500 == "common.exceptions.server_error"


def test_funcion_server_error_responde_500_con_el_formato_de_errores():
    r = server_error(RequestFactory().get("/"))
    assert r.status_code == 500
    assert b'"server_error"' in r.content


def test_funcion_not_found_responde_404_con_el_formato_de_errores():
    r = not_found(RequestFactory().get("/"), None)
    assert r.status_code == 404 and b'"not_found"' in r.content


@pytest.mark.urls("tests.urls_error")
def test_un_error_inesperado_devuelve_500_en_json_sin_filtrar_detalles(settings):
    settings.DEBUG = False
    r = Client(raise_request_exception=False).get("/api/prueba/falla/")

    assert r.status_code == 500
    assert r.json() == {"error": {"code": "server_error", "message": "Error interno del servidor."}}
    assert "dato-interno" not in r.content.decode()  # nada del traceback llega al cliente


@pytest.mark.urls("tests.urls_error")
def test_la_ruta_de_prueba_sana_funciona_para_descartar_falsos_positivos():
    assert Client().get("/api/prueba/ok/").json() == {"ok": True}


def test_en_desarrollo_la_api_responde_a_la_ip_de_la_red_local():
    # El teléfono entra por la IP del PC (p. ej. 192.168.x.x), que cambia con la red.
    r = APIClient().get("/api/health/", HTTP_HOST="192.168.80.16:8000")
    assert r.status_code == 200
