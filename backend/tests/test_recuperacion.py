from datetime import timedelta

import pytest
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from usuarios.models import Usuario

pytestmark = pytest.mark.django_db

SOLICITAR = "/api/auth/recuperar/"
CONFIRMAR = "/api/auth/recuperar/confirmar/"
CLAVE = "Clave-segura-2026"
NUEVA = "Otra-clave-2027!"


@pytest.fixture
def usuario():
    return Usuario.objects.create_user(
        "ana@colegio.edu.co", CLAVE, nombres="Ana", apellidos="Ruiz", email_verificado=True
    )


def solicitar(email="ana@colegio.edu.co"):
    return APIClient().post(SOLICITAR, {"email": email}, format="json")


def enlace_del_correo():
    cuerpo = mail.outbox[-1].body
    uid = cuerpo.split("uid=")[1].split("&")[0]
    token = cuerpo.split("token=")[1].split()[0]
    return uid, token


def confirmar(uid, token, password=NUEVA, confirmacion=None):
    return APIClient().post(
        CONFIRMAR,
        {
            "uid": uid,
            "token": token,
            "password": password,
            "password_confirmacion": confirmacion or password,
        },
        format="json",
    )


def login(password):
    return APIClient().post(
        "/api/auth/login/", {"email": "ana@colegio.edu.co", "password": password}, format="json"
    )


# --- T10: solicitud ---


def test_solicitud_envia_correo_con_enlace(usuario):
    assert solicitar().status_code == 200
    assert len(mail.outbox) == 1 and mail.outbox[0].to == ["ana@colegio.edu.co"]
    uid, token = enlace_del_correo()
    assert uid and token


def test_solicitud_no_revela_si_la_cuenta_existe(usuario):
    a = solicitar()
    b = solicitar("nadie@colegio.edu.co")
    assert a.status_code == b.status_code == 200 and a.json() == b.json()
    assert len(mail.outbox) == 1  # solo la cuenta real recibe correo


def test_solicitud_ignora_cuentas_inactivas(usuario):
    usuario.is_active = False
    usuario.save()
    solicitar()
    assert len(mail.outbox) == 0


def test_solicitud_sin_correo_es_400():
    r = APIClient().post(SOLICITAR, {}, format="json")
    assert r.status_code == 400 and "email" in r.json()["error"]["details"]


def test_solicitud_tiene_limite(usuario, monkeypatch):
    from usuarios.views import RecuperacionThrottle

    monkeypatch.setattr(RecuperacionThrottle, "THROTTLE_RATES", {"recuperacion": "2/hour"})
    assert [solicitar().status_code for _ in range(3)] == [200, 200, 429]


# --- T10: confirmación ---


def test_confirmar_cambia_la_contrasena(usuario):
    solicitar()
    uid, token = enlace_del_correo()
    r = confirmar(uid, token)
    assert r.status_code == 200
    assert login(NUEVA).status_code == 200
    assert login(CLAVE).status_code == 401


def test_confirmar_con_contrasenas_distintas(usuario):
    solicitar()
    uid, token = enlace_del_correo()
    r = confirmar(uid, token, confirmacion="otra")
    assert r.status_code == 400
    assert "password_confirmacion" in r.json()["error"]["details"]
    assert login(CLAVE).status_code == 200  # no cambió


def test_confirmar_con_contrasena_debil(usuario):
    solicitar()
    uid, token = enlace_del_correo()
    r = confirmar(uid, token, password="12345678")
    assert r.status_code == 400 and "password" in r.json()["error"]["details"]
    assert login(CLAVE).status_code == 200
    # El enlace sigue sirviendo tras un intento rechazado por contraseña débil.
    assert confirmar(uid, token).status_code == 200


def test_confirmar_con_token_o_uid_falsos(usuario):
    solicitar()
    uid, token = enlace_del_correo()
    for u, t in [(uid, "token-falso"), ("uid-falso", token), ("", token)]:
        r = confirmar(u, t)
        assert r.status_code == 400
    assert confirmar(uid, "x").json()["error"]["code"] == "enlace_invalido"
    assert login(CLAVE).status_code == 200


def test_el_enlace_de_un_usuario_no_sirve_para_otro(usuario):
    otro = Usuario.objects.create_user("luis@colegio.edu.co", CLAVE, nombres="L", apellidos="P")
    solicitar()
    uid_ana, token_ana = enlace_del_correo()
    from django.utils.encoding import force_bytes
    from django.utils.http import urlsafe_base64_encode

    uid_luis = urlsafe_base64_encode(force_bytes(otro.pk))
    assert confirmar(uid_luis, token_ana).status_code == 400
    assert confirmar(uid_ana, token_ana).status_code == 200


def test_confirmar_campos_obligatorios():
    r = APIClient().post(CONFIRMAR, {}, format="json")
    assert r.status_code == 400
    assert {"uid", "token", "password"} <= set(r.json()["error"]["details"])


# --- T11: un solo uso y expiración ---


def test_el_enlace_sirve_una_sola_vez(usuario):
    solicitar()
    uid, token = enlace_del_correo()
    assert confirmar(uid, token).status_code == 200
    r = confirmar(uid, token, password="Tercera-clave-2028!")
    assert r.status_code == 400 and r.json()["error"]["code"] == "enlace_invalido"
    assert login(NUEVA).status_code == 200  # la contraseña no se volvió a cambiar


def test_un_enlace_nuevo_invalida_el_cambio_de_contrasena_previo(usuario):
    solicitar()
    uid, token_viejo = enlace_del_correo()
    usuario.set_password("Cambiada-por-otra-via-9")
    usuario.save()
    assert confirmar(uid, token_viejo).status_code == 400


def test_el_enlace_vence(usuario, settings):
    solicitar()
    uid, token = enlace_del_correo()
    settings.PASSWORD_RESET_TIMEOUT = -1
    r = confirmar(uid, token)
    assert r.status_code == 400 and r.json()["error"]["code"] == "enlace_invalido"
    assert login(CLAVE).status_code == 200


# --- efectos secundarios de recuperar ---


def test_recuperar_levanta_el_bloqueo_y_verifica_el_correo():
    u = Usuario.objects.create_user("eva@colegio.edu.co", CLAVE, nombres="Eva", apellidos="G")
    u.intentos_fallidos = 5
    u.bloqueado_hasta = timezone.now() + timedelta(minutes=10)
    u.save()
    solicitar("eva@colegio.edu.co")
    uid, token = enlace_del_correo()
    assert confirmar(uid, token).status_code == 200
    u.refresh_from_db()
    assert u.intentos_fallidos == 0 and u.bloqueado_hasta is None and u.email_verificado


def test_recuperar_cierra_las_sesiones_abiertas(usuario):
    refresh = login(CLAVE).json()["refresh"]
    solicitar()
    uid, token = enlace_del_correo()
    confirmar(uid, token)
    r = APIClient().post("/api/auth/refresh/", {"refresh": refresh}, format="json")
    assert r.status_code == 401


# --- T9: sesión ---


def test_me_requiere_autenticacion(usuario):
    assert APIClient().get("/api/auth/me/").status_code == 401


def test_me_devuelve_el_usuario(usuario):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION="Bearer " + login(CLAVE).json()["access"])
    r = c.get("/api/auth/me/")
    assert r.status_code == 200 and r.json()["email"] == "ana@colegio.edu.co"


def test_refresh_rota_el_token_y_el_anterior_deja_de_servir(usuario):
    c = APIClient()
    viejo = login(CLAVE).json()["refresh"]
    r = c.post("/api/auth/refresh/", {"refresh": viejo}, format="json")
    assert r.status_code == 200
    nuevo = r.json()["refresh"]
    assert nuevo != viejo
    assert c.post("/api/auth/refresh/", {"refresh": viejo}, format="json").status_code == 401
    assert c.post("/api/auth/refresh/", {"refresh": nuevo}, format="json").status_code == 200


def test_sesion_inactiva_expira(usuario, settings):
    from datetime import timedelta as td

    from rest_framework_simplejwt.settings import api_settings
    from rest_framework_simplejwt.tokens import RefreshToken

    refresh = RefreshToken.for_user(usuario)
    refresh.set_exp(lifetime=-td(seconds=1))  # ya pasó la ventana de inactividad
    r = APIClient().post("/api/auth/refresh/", {"refresh": str(refresh)}, format="json")
    assert r.status_code == 401
    assert api_settings.ROTATE_REFRESH_TOKENS


def test_la_ventana_de_inactividad_es_de_30_minutos_por_defecto():
    from rest_framework_simplejwt.settings import api_settings

    assert api_settings.REFRESH_TOKEN_LIFETIME == timedelta(minutes=30)
    assert api_settings.ACCESS_TOKEN_LIFETIME == timedelta(minutes=15)


def test_logout_invalida_el_refresh(usuario):
    refresh = login(CLAVE).json()["refresh"]
    c = APIClient()
    assert c.post("/api/auth/logout/", {"refresh": refresh}, format="json").status_code == 204
    assert c.post("/api/auth/refresh/", {"refresh": refresh}, format="json").status_code == 401


def test_logout_es_idempotente_y_tolera_tokens_basura(usuario):
    refresh = login(CLAVE).json()["refresh"]
    c = APIClient()
    c.post("/api/auth/logout/", {"refresh": refresh}, format="json")
    assert c.post("/api/auth/logout/", {"refresh": refresh}, format="json").status_code == 204
    assert c.post("/api/auth/logout/", {"refresh": "basura"}, format="json").status_code == 204
