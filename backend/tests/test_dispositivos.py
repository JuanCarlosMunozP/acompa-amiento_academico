"""Dispositivos registrados: el usuario legítimo siempre entra (verificando un dispositivo nuevo);
quien solo tiene la contraseña no obtiene sesión; las sesiones mueren al revocar el dispositivo."""

import re
from datetime import timedelta

import pyotp
import pytest
from django.core import mail
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from usuarios import dispositivos, mfa
from usuarios.models import DesafioDispositivo, Dispositivo, Usuario

pytestmark = [
    pytest.mark.django_db,
    pytest.mark.usefixtures("activar_dispositivos"),
]

CLAVE = "Clave-segura-2026"
EMAIL = "ana@colegio.edu.co"
LOGIN = "/api/auth/login/"
VERIFICAR = "/api/auth/dispositivo/verificar/"
LISTA = "/api/auth/dispositivos/"
DISP_A = "a" * 32
DISP_B = "b" * 32


@pytest.fixture
def activar_dispositivos():
    with override_settings(DISPOSITIVOS_VERIFICACION=True):
        yield


@pytest.fixture
def usuario():
    return Usuario.objects.create_user(
        EMAIL, CLAVE, nombres="Ana", apellidos="Ruiz", email_verificado=True
    )


def login(dispositivo=DISP_A, password=CLAVE, email=EMAIL):
    datos = {"email": email, "password": password}
    if dispositivo is not None:
        datos["dispositivo"] = dispositivo
    return APIClient().post(LOGIN, datos, format="json")


def codigo_del_correo():
    cuerpo = next(m.body for m in reversed(mail.outbox) if "código" in m.subject.lower())
    return re.search(r"\n\s+(\d{6})\n", cuerpo).group(1)


def entrar_con_dispositivo_nuevo(dispositivo=DISP_A):
    r = login(dispositivo)
    assert r.json()["dispositivo_nuevo"] is True
    r = APIClient().post(
        VERIFICAR,
        {"desafio_token": r.json()["desafio_token"], "codigo": codigo_del_correo()},
        format="json",
    )
    assert r.status_code == 200
    return r.json()


def cliente_de(sesion):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {sesion['access']}")
    return c


# --- Dispositivo nuevo: se verifica, no se bloquea ---


def test_dispositivo_nuevo_pide_codigo_al_correo_y_no_entrega_tokens(usuario):
    r = login()
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["dispositivo_nuevo"] is True and cuerpo["correo"] == "a***@colegio.edu.co"
    assert "access" not in cuerpo and "refresh" not in cuerpo
    assert len(mail.outbox) == 1 and mail.outbox[0].to == [EMAIL]


def test_con_el_codigo_correcto_el_usuario_legitimo_entra_y_queda_registrado(usuario):
    sesion = entrar_con_dispositivo_nuevo()
    assert sesion["access"] and sesion["usuario"]["email"] == EMAIL
    assert Dispositivo.objects.filter(usuario=usuario, revocado_en__isnull=True).count() == 1
    assert any("nuevo dispositivo" in m.subject.lower() for m in mail.outbox)
    assert cliente_de(sesion).get("/api/auth/me/").status_code == 200


def test_dispositivo_conocido_entra_directo_sin_codigo(usuario):
    entrar_con_dispositivo_nuevo()
    mail.outbox.clear()
    r = login()
    assert r.status_code == 200 and r.json()["access"]
    assert mail.outbox == []


def test_modo_incognito_equivale_a_dispositivo_nuevo_y_se_permite_verificando(usuario):
    """Ventana de incógnito = identificador nuevo: no se bloquea, se verifica por correo."""
    entrar_con_dispositivo_nuevo(DISP_A)
    sesion = entrar_con_dispositivo_nuevo(DISP_B)
    assert cliente_de(sesion).get("/api/auth/me/").status_code == 200
    assert Dispositivo.objects.filter(usuario=usuario).count() == 2


def test_codigo_incorrecto_no_da_acceso(usuario):
    token = login().json()["desafio_token"]
    r = APIClient().post(VERIFICAR, {"desafio_token": token, "codigo": "000000"}, format="json")
    assert r.status_code == 401 and "access" not in r.json()
    assert r.json()["error"]["code"] == "codigo_dispositivo_invalido"
    assert not Dispositivo.objects.exists()


def test_cinco_codigos_erroneos_invalidan_el_desafio_incluso_con_el_correcto(usuario):
    token = login().json()["desafio_token"]
    correcto = codigo_del_correo()
    for i in range(5):
        # Un código distinto del correcto en cada intento.
        malo = f"{(int(correcto) + 1 + i) % 1_000_000:06d}"
        APIClient().post(VERIFICAR, {"desafio_token": token, "codigo": malo}, format="json")
    r = APIClient().post(VERIFICAR, {"desafio_token": token, "codigo": correcto}, format="json")
    assert r.status_code == 401


def test_el_codigo_sirve_una_sola_vez(usuario):
    token = login().json()["desafio_token"]
    codigo = codigo_del_correo()
    assert APIClient().post(VERIFICAR, {"desafio_token": token, "codigo": codigo}, format="json")
    r = APIClient().post(VERIFICAR, {"desafio_token": token, "codigo": codigo}, format="json")
    assert r.status_code == 401


def test_el_codigo_vencido_no_sirve(usuario):
    token = login().json()["desafio_token"]
    codigo = codigo_del_correo()
    DesafioDispositivo.objects.update(expira=timezone.now() - timedelta(minutes=1))
    r = APIClient().post(VERIFICAR, {"desafio_token": token, "codigo": codigo}, format="json")
    assert r.status_code == 401


def test_pedir_otro_codigo_invalida_el_anterior(usuario):
    primero = login().json()["desafio_token"]
    codigo_viejo = codigo_del_correo()
    login()
    r = APIClient().post(
        VERIFICAR, {"desafio_token": primero, "codigo": codigo_viejo}, format="json"
    )
    assert r.status_code == 401


def test_token_de_desafio_manipulado_se_rechaza(usuario):
    token = login().json()["desafio_token"]
    r = APIClient().post(
        VERIFICAR, {"desafio_token": token + "x", "codigo": "123456"}, format="json"
    )
    assert r.status_code == 401


# --- Quien solo tiene la contraseña no entra ---


def test_atacante_con_la_clave_robada_no_obtiene_sesion(usuario):
    entrar_con_dispositivo_nuevo(DISP_A)  # el usuario real ya usa su dispositivo
    r = login(DISP_B)  # el atacante, con otro identificador
    assert "access" not in r.json() and r.json()["dispositivo_nuevo"] is True
    r = APIClient().post(
        VERIFICAR, {"desafio_token": r.json()["desafio_token"], "codigo": "123456"}, format="json"
    )
    assert r.status_code == 401


def test_sin_identificador_de_dispositivo_no_hay_sesion(usuario):
    for valor in (None, "", "corto", "con espacios en el identificador!!", "x" * 200):
        r = login(valor)
        assert r.status_code in (400, 401), valor
        assert "access" not in r.json()


def test_credenciales_malas_no_revelan_nada_del_dispositivo(usuario):
    r = login(password="mala")
    assert r.status_code == 401 and not mail.outbox


# --- Con MFA: el código TOTP registra el dispositivo ---


def activar_mfa(usuario):
    secreto = mfa.iniciar_configuracion(usuario)["secreto"]
    usuario.refresh_from_db()
    usuario.mfa_activo = True
    usuario.save(update_fields=["mfa_activo"])
    return secreto


def test_cuenta_con_mfa_registra_el_dispositivo_al_verificar_el_codigo(usuario):
    secreto = activar_mfa(usuario)
    r = login()
    assert r.json()["mfa_requerido"] is True and "access" not in r.json()
    ok = APIClient().post(
        "/api/auth/mfa/verificar/",
        {"mfa_token": r.json()["mfa_token"], "codigo": pyotp.TOTP(secreto).now()},
        format="json",
    )
    assert ok.status_code == 200 and ok.json()["access"]
    assert Dispositivo.objects.filter(usuario=usuario).count() == 1
    assert not any("código para verificar" in m.subject.lower() for m in mail.outbox)


# --- Sesiones atadas al dispositivo ---


def test_revocar_un_dispositivo_mata_su_access_y_su_refresh(usuario):
    sesion = entrar_con_dispositivo_nuevo(DISP_A)
    c = cliente_de(sesion)
    pk = Dispositivo.objects.get().pk
    # Otro dispositivo del mismo usuario revoca al primero.
    otra = entrar_con_dispositivo_nuevo(DISP_B)
    assert cliente_de(otra).delete(f"{LISTA}{pk}/").status_code == 204
    assert c.get("/api/auth/me/").status_code == 401
    r = APIClient().post("/api/auth/refresh/", {"refresh": sesion["refresh"]}, format="json")
    assert r.status_code == 401
    assert cliente_de(otra).get("/api/auth/me/").status_code == 200


def test_el_dispositivo_revocado_vuelve_a_poder_entrar_verificandose(usuario):
    sesion = entrar_con_dispositivo_nuevo(DISP_A)
    cliente_de(sesion).delete(f"{LISTA}{Dispositivo.objects.get().pk}/")
    assert login(DISP_A).json()["dispositivo_nuevo"] is True
    assert cliente_de(entrar_con_dispositivo_nuevo(DISP_A)).get("/api/auth/me/").status_code == 200


def test_el_refresh_sigue_funcionando_con_el_dispositivo_vigente(usuario):
    sesion = entrar_con_dispositivo_nuevo()
    r = APIClient().post("/api/auth/refresh/", {"refresh": sesion["refresh"]}, format="json")
    assert r.status_code == 200 and r.json()["access"]
    nuevo = cliente_de({"access": r.json()["access"]})
    assert nuevo.get("/api/auth/me/").status_code == 200


def test_listado_marca_el_dispositivo_actual(usuario):
    entrar_con_dispositivo_nuevo(DISP_A)
    sesion_b = entrar_con_dispositivo_nuevo(DISP_B)
    filas = cliente_de(sesion_b).get(LISTA).json()
    assert len(filas) == 2 and sum(f["actual"] for f in filas) == 1
    actual = next(f for f in filas if f["actual"])
    assert "Windows" not in actual["nombre"] or actual["nombre"]


def test_no_se_puede_revocar_el_dispositivo_de_otro_usuario(usuario):
    otro = Usuario.objects.create_user(
        "luis@colegio.edu.co", CLAVE, nombres="Luis", apellidos="Paz", email_verificado=True
    )
    ajeno = Dispositivo.objects.create(usuario=otro, huella="f" * 64, nombre="ajeno")
    sesion = entrar_con_dispositivo_nuevo()
    assert cliente_de(sesion).delete(f"{LISTA}{ajeno.pk}/").status_code == 404
    assert Dispositivo.objects.get(pk=ajeno.pk).revocado_en is None
    assert all(f["nombre"] != "ajeno" for f in cliente_de(sesion).get(LISTA).json())


def test_endpoints_de_dispositivos_exigen_sesion():
    assert APIClient().get(LISTA).status_code == 401
    assert APIClient().delete(f"{LISTA}1/").status_code == 401


@override_settings(DISPOSITIVOS_MAX=2)
def test_tope_de_dispositivos_retira_el_menos_usado_sin_dejar_fuera_al_usuario(usuario):
    entrar_con_dispositivo_nuevo("a" * 32)
    entrar_con_dispositivo_nuevo("b" * 32)
    ultima = entrar_con_dispositivo_nuevo("c" * 32)
    assert Dispositivo.objects.filter(revocado_en__isnull=True).count() == 2
    assert cliente_de(ultima).get("/api/auth/me/").status_code == 200


# --- Función desactivada (compatibilidad) ---


@override_settings(DISPOSITIVOS_VERIFICACION=False)
def test_con_la_funcion_apagada_el_login_sigue_igual(usuario):
    r = login(None)
    assert r.status_code == 200 and r.json()["access"]
    assert not Dispositivo.objects.exists()


# --- Utilidades ---


def test_la_huella_no_expone_el_identificador():
    h = dispositivos.huella_de(DISP_A)
    assert len(h) == 64 and DISP_A not in h
    assert dispositivos.huella_de("corto") is None and dispositivos.huella_de(None) is None


def test_nombre_legible_resume_el_user_agent():
    ua = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
    assert dispositivos.nombre_legible(ua) == "Chrome en Windows"
    assert dispositivos.nombre_legible("") == "Navegador en dispositivo desconocido"
    assert dispositivos.nombre_legible("Firefox/1 (Android)") == "Firefox en Android"


def test_si_el_correo_falla_responde_503_claro_y_no_500(usuario, monkeypatch):
    def falla(*a, **k):
        raise OSError("SMTP caído")

    monkeypatch.setattr(dispositivos, "enviar_correo", falla)
    r = login()
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "correo_no_disponible"
    assert "access" not in r.json()
    assert not Dispositivo.objects.exists()
