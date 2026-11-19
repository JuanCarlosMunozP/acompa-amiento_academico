import pytest
from django.core import mail
from django.core.signing import BadSignature
from rest_framework.test import APIClient

from usuarios.models import Rol, Usuario
from usuarios.servicios import leer_token_verificacion

pytestmark = pytest.mark.django_db

URL = "/api/auth/registro/"
DATOS = {
    "email": "ana@colegio.edu.co",
    "nombres": "Ana",
    "apellidos": "Ruiz",
    "password": "Clave-segura-2026",
    "password_confirmacion": "Clave-segura-2026",
}


def post(**cambios):
    return APIClient().post(URL, {**DATOS, **cambios}, format="json")


def test_registro_exitoso_crea_estudiante_sin_verificar_y_envia_correo():
    r = post()
    assert r.status_code == 201
    assert "password" not in r.json()
    u = Usuario.objects.get(email="ana@colegio.edu.co")
    assert u.rol == Rol.ESTUDIANTE and not u.email_verificado
    assert u.check_password(DATOS["password"])
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["ana@colegio.edu.co"]
    token = mail.outbox[0].body.split("token=")[1].split()[0]
    assert leer_token_verificacion(token)["uid"] == u.pk


def test_el_cliente_no_puede_elegir_rol():
    r = post(rol="administrador", email_verificado=True)
    assert r.status_code == 201
    u = Usuario.objects.get(email="ana@colegio.edu.co")
    assert u.rol == Rol.ESTUDIANTE and not u.email_verificado


def test_correo_duplicado_sin_distinguir_mayusculas():
    assert post().status_code == 201
    r = post(email="ANA@colegio.edu.co")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "validation_error"
    assert "email" in r.json()["error"]["details"]


def test_contrasenas_distintas():
    r = post(password_confirmacion="otra")
    assert r.status_code == 400
    assert "password_confirmacion" in r.json()["error"]["details"]


def test_contrasena_debil():
    r = post(password="12345678", password_confirmacion="12345678")
    assert r.status_code == 400
    assert "password" in r.json()["error"]["details"]


def test_dominio_no_institucional_rechazado(settings):
    settings.EMAIL_DOMINIOS_PERMITIDOS = ["colegio.edu.co"]
    r = post(email="ana@gmail.com")
    assert r.status_code == 400
    assert "email" in r.json()["error"]["details"]
    assert post().status_code == 201


def test_campos_obligatorios():
    r = APIClient().post(URL, {}, format="json")
    assert r.status_code == 400
    assert {"email", "nombres", "apellidos", "password"} <= set(r.json()["error"]["details"])


def test_token_alterado_es_invalido():
    with pytest.raises(BadSignature):
        leer_token_verificacion("token-falso")
