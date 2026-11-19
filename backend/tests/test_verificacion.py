import pytest
from django.core import mail
from django.core.signing import TimestampSigner
from rest_framework.test import APIClient

from usuarios.models import Usuario
from usuarios.servicios import generar_token_verificacion

pytestmark = pytest.mark.django_db

VERIFICAR = "/api/auth/verificar-correo/"
REENVIAR = "/api/auth/reenviar-verificacion/"
CLAVE = "Clave-segura-2026"


@pytest.fixture
def usuario():
    return Usuario.objects.create_user("ana@colegio.edu.co", CLAVE, nombres="Ana", apellidos="Ruiz")


def verificar(token):
    return APIClient().post(VERIFICAR, {"token": token}, format="json")


def login():
    return APIClient().post(
        "/api/auth/login/", {"email": "ana@colegio.edu.co", "password": CLAVE}, format="json"
    )


def test_token_valido_verifica_el_correo(usuario):
    r = verificar(generar_token_verificacion(usuario))
    assert r.status_code == 200
    assert r.json() == {"email": "ana@colegio.edu.co", "email_verificado": True}
    usuario.refresh_from_db()
    assert usuario.email_verificado


def test_verificar_dos_veces_es_idempotente(usuario):
    token = generar_token_verificacion(usuario)
    assert verificar(token).status_code == 200
    assert verificar(token).status_code == 200


def test_flujo_completo_registro_verificacion_login():
    c = APIClient()
    r = c.post(
        "/api/auth/registro/",
        {
            "email": "eva@colegio.edu.co",
            "nombres": "Eva",
            "apellidos": "Gil",
            "password": CLAVE,
            "password_confirmacion": CLAVE,
        },
        format="json",
    )
    assert r.status_code == 201
    datos = {"email": "eva@colegio.edu.co", "password": CLAVE}

    # Antes de verificar no puede entrar.
    assert c.post("/api/auth/login/", datos, format="json").status_code == 403

    token = mail.outbox[0].body.split("token=")[1].split()[0]
    assert verificar(token).status_code == 200

    r = c.post("/api/auth/login/", datos, format="json")
    assert r.status_code == 200 and r.json()["access"]


def test_login_funciona_tras_verificar(usuario):
    assert login().status_code == 403
    verificar(generar_token_verificacion(usuario))
    assert login().status_code == 200


def test_token_basura_es_invalido():
    r = verificar("token-falso")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "token_invalido"


def test_token_vencido(usuario, settings):
    settings.VERIFICACION_MAX_AGE = -1
    r = verificar(generar_token_verificacion(usuario))
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "token_expirado"


def test_token_de_otro_proposito_no_sirve(usuario):
    otro = TimestampSigner(salt="otro.proposito").sign(str(usuario.pk))
    assert verificar(otro).json()["error"]["code"] == "token_invalido"


def test_token_de_usuario_borrado_es_invalido(usuario):
    token = generar_token_verificacion(usuario)
    usuario.delete()
    assert verificar(token).json()["error"]["code"] == "token_invalido"


def test_token_con_correo_cambiado_es_invalido(usuario):
    token = generar_token_verificacion(usuario)
    usuario.email = "otro@colegio.edu.co"
    usuario.save()
    assert verificar(token).json()["error"]["code"] == "token_invalido"
    usuario.refresh_from_db()
    assert not usuario.email_verificado


def test_token_obligatorio():
    r = APIClient().post(VERIFICAR, {}, format="json")
    assert r.status_code == 400
    assert "token" in r.json()["error"]["details"]


def test_verificar_el_correo_no_cambia_el_rol_ni_otros_campos(usuario):
    verificar(generar_token_verificacion(usuario))
    usuario.refresh_from_db()
    assert usuario.rol == "estudiante" and usuario.is_active and not usuario.is_staff


# --- reenvío ---


def test_reenvio_envia_correo_a_cuenta_sin_verificar(usuario):
    r = APIClient().post(REENVIAR, {"email": "ANA@colegio.edu.co"}, format="json")
    assert r.status_code == 200
    assert len(mail.outbox) == 1 and mail.outbox[0].to == ["ana@colegio.edu.co"]


def test_reenvio_no_envia_si_ya_esta_verificada(usuario):
    usuario.email_verificado = True
    usuario.save()
    APIClient().post(REENVIAR, {"email": usuario.email}, format="json")
    assert len(mail.outbox) == 0


def test_reenvio_responde_igual_si_la_cuenta_no_existe(usuario):
    existente = APIClient().post(REENVIAR, {"email": usuario.email}, format="json")
    inexistente = APIClient().post(REENVIAR, {"email": "nadie@colegio.edu.co"}, format="json")
    assert existente.status_code == inexistente.status_code == 200
    assert existente.json() == inexistente.json()


def test_reenvio_tiene_limite(usuario, monkeypatch):
    from usuarios.views import ReenvioThrottle

    monkeypatch.setattr(ReenvioThrottle, "THROTTLE_RATES", {"reenvio": "2/hour"})
    codigos = [
        APIClient().post(REENVIAR, {"email": usuario.email}, format="json").status_code
        for _ in range(3)
    ]
    assert codigos == [200, 200, 429]
