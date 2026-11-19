from django.test import Client
from rest_framework.test import APIClient


def test_root_redirige_a_health():
    response = Client().get("/")
    assert response.status_code == 302
    assert response["Location"] == "/api/health/"


def test_favicon_devuelve_sin_contenido():
    response = Client().get("/favicon.ico")
    assert response.status_code == 204
    assert not response.content


def test_health_ok():
    r = APIClient().get("/api/health/")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_indice_api_enumera_rutas_registradas():
    r = APIClient().get("/api/")
    assert r.status_code == 200
    rutas = {ruta["path"] for ruta in r.json()["routes"]}
    assert "/api/health/" in rutas
    assert "/api/auth/login/" in rutas


def test_indice_auth_muestra_rutas_de_autenticacion():
    r = APIClient().get("/api/auth/")
    assert r.status_code == 200
    rutas = {ruta["path"] for ruta in r.json()["routes"]}
    assert "/api/auth/login/" in rutas
    assert "/api/auth/registro/" in rutas


def test_indice_auth_sin_barra_final_redirige():
    r = Client().get("/api/auth", follow=False)
    assert r.status_code == 301
    assert r["Location"] == "/api/auth/"


def test_ruta_inexistente_devuelve_error_json(settings):
    settings.DEBUG = False
    r = APIClient().get("/api/no-existe/")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


def test_cors_permite_origen_del_cliente():
    r = APIClient().get("/api/health/", HTTP_ORIGIN="http://localhost:8081")
    assert r["Access-Control-Allow-Origin"] == "http://localhost:8081"


def test_cors_rechaza_origen_desconocido():
    r = APIClient().get("/api/health/", HTTP_ORIGIN="http://malo.example")
    assert "Access-Control-Allow-Origin" not in r
