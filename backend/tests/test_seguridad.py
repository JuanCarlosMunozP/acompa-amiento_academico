import json

import pytest
from django.core import mail
from django.test import override_settings

from common.seguridad import enlace_confiable, validar_enlaces_correo
from usuarios.correo import enviar_correo


@pytest.mark.django_db
@pytest.mark.parametrize(
    "texto",
    [
        "<script>alert(1)</script>",
        '<img src=x onerror="alert(1)">',
        "javascript:alert(1)",
        "' OR 1=1 --",
        "x' UNION SELECT password FROM usuarios_usuario--",
        "a'; DROP TABLE usuarios_usuario",
    ],
)
def test_bloquea_payloads_en_el_cuerpo(client, texto):
    r = client.post(
        "/api/auth/login/",
        data=json.dumps({"email": texto, "password": "x"}),
        content_type="application/json",
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "peticion_bloqueada"


@pytest.mark.django_db
def test_bloquea_payloads_en_la_query_string(client):
    r = client.get("/api/health/", {"q": "<script>alert(1)</script>"})
    assert r.status_code == 400


@pytest.mark.django_db
def test_la_contrasena_puede_llevar_cualquier_caracter(client):
    r = client.post(
        "/api/auth/login/",
        data=json.dumps({"email": "a@b.co", "password": "<'--Clave\"#1>"}),
        content_type="application/json",
    )
    assert r.status_code != 400 or r.json()["error"]["code"] != "peticion_bloqueada"


@pytest.mark.django_db
def test_texto_normal_no_se_bloquea(client):
    r = client.get("/api/health/", {"q": "Matemáticas: derivadas y límites (2.º periodo)"})
    assert r.status_code == 200


def test_cabeceras_de_seguridad_en_la_api(client):
    r = client.get("/api/health/")
    assert "default-src 'none'" in r["Content-Security-Policy"]
    assert r["X-Content-Type-Options"] == "nosniff"
    assert r["X-Frame-Options"] == "DENY"
    assert "no-store" in r["Cache-Control"]
    assert "camera=()" in r["Permissions-Policy"]


def test_validar_enlaces_rechaza_hosts_ajenos_y_credenciales():
    confiables = ["tutorias.edu.co"]
    ok = {"a": "https://tutorias.edu.co/nueva-contrasena"}
    assert validar_enlaces_correo(ok, confiables, exigir_https=True) == []
    for url in (
        "https://tutorias-edu.co.evil.com/x",
        "https://evil.com@tutorias.edu.co/x",
        "javascript:alert(1)",
        "http://tutorias.edu.co/x",
    ):
        assert validar_enlaces_correo({"a": url}, confiables, exigir_https=True), url


@override_settings(HOSTS_ENLACES_CONFIABLES=["localhost"], ENLACES_EXIGIR_HTTPS=False)
def test_no_envia_correos_con_enlaces_de_phishing():
    assert enlace_confiable("http://localhost:8081/nueva-contrasena?uid=1&token=a")
    with pytest.raises(ValueError):
        enviar_correo(
            "Asunto",
            "recuperacion",
            {"enlace": "https://sitio-falso.example/login", "nombres": "A", "correo": "a@b.co"},
            "a@b.co",
        )
    assert mail.outbox == []
