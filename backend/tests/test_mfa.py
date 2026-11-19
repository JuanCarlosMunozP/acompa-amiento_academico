import base64

import pyotp
import pytest
from rest_framework.test import APIClient

from usuarios import mfa
from usuarios.models import CodigoRecuperacionMFA, EventoAuditoria, Usuario

pytestmark = pytest.mark.django_db

CLAVE = "Clave-segura-2026"
EMAIL = "ana@colegio.edu.co"
LOGIN = "/api/auth/login/"
VERIFICAR = "/api/auth/mfa/verificar/"
CONFIGURAR = "/api/auth/mfa/configurar/"
ACTIVAR = "/api/auth/mfa/activar/"
DESACTIVAR = "/api/auth/mfa/desactivar/"
CODIGOS = "/api/auth/mfa/codigos-recuperacion/"
T0 = 1_800_000_000  # instante fijo: el reloj de las pruebas lo mueven ellas


class Reloj:
    def __init__(self):
        self.t = float(T0)

    def __call__(self):
        return self.t

    def avanzar_paso(self, pasos=1):
        self.t += 30 * pasos


@pytest.fixture(autouse=True)
def reloj(monkeypatch):
    r = Reloj()
    monkeypatch.setattr(mfa, "_ahora", r)
    return r


@pytest.fixture
def usuario():
    return Usuario.objects.create_user(
        EMAIL, CLAVE, nombres="Ana", apellidos="Ruiz", email_verificado=True
    )


def codigo_de(secreto, reloj):
    return pyotp.TOTP(secreto).at(reloj.t)


def cliente_de(usuario):
    c = APIClient()
    c.force_authenticate(usuario)
    return c


@pytest.fixture
def con_mfa(usuario, reloj):
    """Usuario con MFA ya activo. Devuelve (usuario, secreto, codigos_recuperacion)."""
    c = cliente_de(usuario)
    secreto = c.post(CONFIGURAR).json()["secreto"]
    r = c.post(ACTIVAR, {"codigo": codigo_de(secreto, reloj)}, format="json")
    assert r.status_code == 200
    reloj.avanzar_paso()  # el código de la activación ya se consumió
    usuario.refresh_from_db()
    return usuario, secreto, r.json()["codigos_recuperacion"]


def login(password=CLAVE):
    return APIClient().post(LOGIN, {"email": EMAIL, "password": password}, format="json")


def verificar(token, codigo):
    return APIClient().post(VERIFICAR, {"mfa_token": token, "codigo": codigo}, format="json")


# --- Alta por QR ---


def test_configurar_devuelve_un_qr_png_y_la_clave_manual(usuario):
    r = cliente_de(usuario).post(CONFIGURAR)
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["qr"].startswith("data:image/png;base64,")
    png = base64.b64decode(cuerpo["qr"].split(",", 1)[1])
    assert png.startswith(b"\x89PNG")
    assert cuerpo["otpauth_uri"].startswith("otpauth://totp/")
    assert "issuer=" in cuerpo["otpauth_uri"] and cuerpo["secreto"] in cuerpo["otpauth_uri"]


def test_el_secreto_se_guarda_cifrado(usuario):
    secreto = cliente_de(usuario).post(CONFIGURAR).json()["secreto"]
    usuario.refresh_from_db()
    assert usuario.mfa_secreto and secreto not in usuario.mfa_secreto
    assert not usuario.mfa_activo  # pendiente hasta confirmar con un código


def test_configurar_exige_sesion():
    assert APIClient().post(CONFIGURAR).status_code == 401


def test_activar_con_codigo_incorrecto_no_activa(usuario):
    c = cliente_de(usuario)
    c.post(CONFIGURAR)
    r = c.post(ACTIVAR, {"codigo": "000000"}, format="json")
    # 400 y no 401: el cliente reintenta los 401 creyendo que el token venció.
    assert r.status_code == 400 and r.json()["error"]["code"] == "codigo_mfa_invalido"
    usuario.refresh_from_db()
    assert not usuario.mfa_activo


def test_activar_sin_generar_el_qr_antes_da_conflicto(usuario):
    r = cliente_de(usuario).post(ACTIVAR, {"codigo": "123456"}, format="json")
    assert r.status_code == 409 and r.json()["error"]["code"] == "mfa_no_iniciado"


def test_activar_con_codigo_valido_entrega_codigos_de_recuperacion(usuario, reloj):
    c = cliente_de(usuario)
    secreto = c.post(CONFIGURAR).json()["secreto"]
    r = c.post(ACTIVAR, {"codigo": codigo_de(secreto, reloj)}, format="json")
    assert r.status_code == 200
    codigos = r.json()["codigos_recuperacion"]
    assert len(codigos) == 8 and len(set(codigos)) == 8
    usuario.refresh_from_db()
    assert usuario.mfa_activo
    # En la base solo queda la huella, nunca el código en claro.
    huellas = set(CodigoRecuperacionMFA.objects.values_list("huella", flat=True))
    assert huellas and not huellas & {c.replace("-", "") for c in codigos}
    assert EventoAuditoria.objects.filter(accion="mfa_activado", actor=usuario).exists()


def test_me_informa_si_el_mfa_esta_activo(con_mfa):
    usuario, _, _ = con_mfa
    assert cliente_de(usuario).get("/api/auth/me/").json()["mfa_activo"] is True


def test_no_se_puede_reconfigurar_con_el_mfa_activo(con_mfa):
    usuario, _, _ = con_mfa
    r = cliente_de(usuario).post(CONFIGURAR)
    assert r.status_code == 409 and r.json()["error"]["code"] == "mfa_ya_activo"


# --- Inicio de sesión en dos pasos ---


def test_sin_mfa_el_login_sigue_igual(usuario):
    cuerpo = login().json()
    assert cuerpo["access"] and "mfa_requerido" not in cuerpo


def test_con_mfa_la_contrasena_sola_no_da_sesion(con_mfa):
    cuerpo = login().json()
    assert cuerpo["mfa_requerido"] is True and cuerpo["mfa_token"]
    assert "access" not in cuerpo and "refresh" not in cuerpo and "usuario" not in cuerpo


def test_con_mfa_una_contrasena_mala_no_entrega_el_desafio(con_mfa):
    r = login(password="mala")
    assert r.status_code == 401 and "mfa_token" not in r.json()


def test_el_codigo_correcto_completa_el_inicio_de_sesion(con_mfa, reloj):
    usuario, secreto, _ = con_mfa
    token = login().json()["mfa_token"]
    r = verificar(token, codigo_de(secreto, reloj))
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["usuario"]["email"] == EMAIL and cuerpo["usuario"]["mfa_activo"] is True
    sesion = APIClient()
    sesion.credentials(HTTP_AUTHORIZATION=f"Bearer {cuerpo['access']}")
    assert sesion.get("/api/auth/me/").status_code == 200


def test_el_codigo_se_acepta_con_espacios(con_mfa, reloj):
    _, secreto, _ = con_mfa
    token = login().json()["mfa_token"]
    codigo = codigo_de(secreto, reloj)
    assert verificar(token, f"{codigo[:3]} {codigo[3:]}").status_code == 200


def test_un_codigo_incorrecto_no_entra(con_mfa):
    token = login().json()["mfa_token"]
    r = verificar(token, "000000")
    assert r.status_code == 401 and r.json()["error"]["code"] == "codigo_mfa_invalido"
    assert "access" not in r.json()


def test_un_codigo_ya_usado_no_sirve_de_nuevo(con_mfa, reloj):
    _, secreto, _ = con_mfa
    codigo = codigo_de(secreto, reloj)
    assert verificar(login().json()["mfa_token"], codigo).status_code == 200
    # Mismo código, aún dentro de su ventana de 30 s: un atacante que lo vio no puede reusarlo.
    r = verificar(login().json()["mfa_token"], codigo)
    assert r.status_code == 401 and r.json()["error"]["code"] == "codigo_mfa_invalido"


def test_un_codigo_de_un_paso_anterior_al_ultimo_tampoco(con_mfa, reloj):
    _, secreto, _ = con_mfa
    viejo = pyotp.TOTP(secreto).at(reloj.t - 30)
    reloj.avanzar_paso()
    assert verificar(login().json()["mfa_token"], codigo_de(secreto, reloj)).status_code == 200
    assert verificar(login().json()["mfa_token"], viejo).status_code == 401


def test_un_codigo_muy_antiguo_o_muy_futuro_se_rechaza(con_mfa, reloj):
    _, secreto, _ = con_mfa
    lejano = pyotp.TOTP(secreto).at(reloj.t + 30 * 5)
    assert verificar(login().json()["mfa_token"], lejano).status_code == 401


def test_cinco_codigos_malos_bloquean_la_cuenta(con_mfa, reloj):
    usuario, secreto, _ = con_mfa
    token = login().json()["mfa_token"]
    for _ in range(4):
        assert verificar(token, "000000").status_code == 401
    r = verificar(token, "000000")
    assert r.status_code == 429 and r.json()["error"]["code"] == "cuenta_bloqueada"
    # Bloqueada: ni siquiera el código correcto entra.
    assert verificar(token, codigo_de(secreto, reloj)).status_code == 429
    assert login().status_code == 429


def test_acertar_la_contrasena_no_reinicia_el_conteo_de_fallos_del_codigo(con_mfa):
    """Sin esto, quien conozca la contraseña tendría intentos ilimitados al segundo factor."""
    usuario, _, _ = con_mfa
    for _ in range(4):
        token = login().json()["mfa_token"]  # contraseña correcta cada vez
        assert verificar(token, "000000").status_code == 401
    usuario.refresh_from_db()
    assert usuario.intentos_fallidos == 4
    token = login().json()["mfa_token"]
    assert verificar(token, "000000").status_code == 429  # el quinto fallo bloquea


def test_el_exito_reinicia_el_conteo(con_mfa, reloj):
    usuario, secreto, _ = con_mfa
    token = login().json()["mfa_token"]
    verificar(token, "000000")
    assert verificar(token, codigo_de(secreto, reloj)).status_code == 200
    usuario.refresh_from_db()
    assert usuario.intentos_fallidos == 0


def test_un_desafio_manipulado_se_rechaza(con_mfa, reloj):
    _, secreto, _ = con_mfa
    token = login().json()["mfa_token"]
    r = verificar(token[:-3] + "xyz", codigo_de(secreto, reloj))
    assert r.status_code == 401 and r.json()["error"]["code"] == "mfa_token_invalido"
    assert verificar("basura", "123456").json()["error"]["code"] == "mfa_token_invalido"


def test_un_desafio_vencido_se_rechaza(con_mfa, reloj, settings):
    _, secreto, _ = con_mfa
    token = login().json()["mfa_token"]
    settings.MFA_DESAFIO_SEGUNDOS = -1
    r = verificar(token, codigo_de(secreto, reloj))
    assert r.status_code == 401 and r.json()["error"]["code"] == "mfa_token_invalido"


def test_el_desafio_no_sirve_como_token_de_acceso(con_mfa):
    token = login().json()["mfa_token"]
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    assert c.get("/api/auth/me/").status_code == 401


def test_el_desafio_de_una_cuenta_desactivada_no_entra(con_mfa, reloj):
    usuario, secreto, _ = con_mfa
    token = login().json()["mfa_token"]
    usuario.is_active = False
    usuario.save()
    r = verificar(token, codigo_de(secreto, reloj))
    assert r.status_code == 403 and r.json()["error"]["code"] == "cuenta_desactivada"


# --- Códigos de recuperación ---


def test_un_codigo_de_recuperacion_permite_entrar_una_sola_vez(con_mfa):
    usuario, _, codigos = con_mfa
    r = verificar(login().json()["mfa_token"], codigos[0])
    assert r.status_code == 200
    assert EventoAuditoria.objects.filter(accion="mfa_codigo_recuperacion_usado").exists()
    assert verificar(login().json()["mfa_token"], codigos[0]).status_code == 401
    # Otro código del juego sigue sirviendo, y se acepta en minúsculas y sin guion.
    assert (
        verificar(login().json()["mfa_token"], codigos[1].lower().replace("-", "")).status_code
        == 200
    )


def test_un_codigo_de_recuperacion_inventado_no_entra(con_mfa):
    assert verificar(login().json()["mfa_token"], "ABCDE-FGHJK").status_code == 401


def test_regenerar_invalida_los_codigos_anteriores(con_mfa, reloj):
    usuario, secreto, viejos = con_mfa
    r = cliente_de(usuario).post(
        CODIGOS, {"password": CLAVE, "codigo": codigo_de(secreto, reloj)}, format="json"
    )
    assert r.status_code == 200
    nuevos = r.json()["codigos_recuperacion"]
    assert len(nuevos) == 8 and not set(nuevos) & set(viejos)
    assert verificar(login().json()["mfa_token"], viejos[0]).status_code == 401
    assert verificar(login().json()["mfa_token"], nuevos[0]).status_code == 200


# --- Desactivar ---


def test_desactivar_exige_la_contrasena(con_mfa, reloj):
    usuario, secreto, _ = con_mfa
    r = cliente_de(usuario).post(
        DESACTIVAR, {"password": "mala", "codigo": codigo_de(secreto, reloj)}, format="json"
    )
    assert r.status_code == 400 and r.json()["error"]["code"] == "contrasena_incorrecta"
    usuario.refresh_from_db()
    assert usuario.mfa_activo and usuario.intentos_fallidos == 1


def test_desactivar_exige_un_codigo_valido(con_mfa):
    usuario, _, _ = con_mfa
    r = cliente_de(usuario).post(DESACTIVAR, {"password": CLAVE, "codigo": "000000"}, format="json")
    assert r.status_code == 400 and r.json()["error"]["code"] == "codigo_mfa_invalido"
    usuario.refresh_from_db()
    assert usuario.mfa_activo


def test_desactivar_quita_el_mfa_y_el_login_vuelve_a_ser_directo(con_mfa, reloj):
    usuario, secreto, _ = con_mfa
    r = cliente_de(usuario).post(
        DESACTIVAR, {"password": CLAVE, "codigo": codigo_de(secreto, reloj)}, format="json"
    )
    assert r.status_code == 200 and r.json() == {"mfa_activo": False}
    usuario.refresh_from_db()
    assert not usuario.mfa_activo and usuario.mfa_secreto == ""
    assert not CodigoRecuperacionMFA.objects.filter(usuario=usuario).exists()
    assert login().json()["access"]
    assert EventoAuditoria.objects.filter(accion="mfa_desactivado").exists()


def test_desactivar_sin_mfa_activo_da_conflicto(usuario):
    r = cliente_de(usuario).post(DESACTIVAR, {"password": CLAVE, "codigo": "123456"}, format="json")
    assert r.status_code == 409 and r.json()["error"]["code"] == "mfa_no_activo"


def test_un_administrador_puede_restablecer_el_mfa_de_quien_perdio_el_telefono(con_mfa):
    usuario, _, _ = con_mfa
    admin = Usuario.objects.create_superuser(
        "root@colegio.edu.co", CLAVE, nombres="R", apellidos="R"
    )
    mfa.restablecer(usuario, por=admin)
    usuario.refresh_from_db()
    assert not usuario.mfa_activo and not CodigoRecuperacionMFA.objects.exists()
    assert EventoAuditoria.objects.filter(accion="mfa_restablecido", actor=admin).exists()
    assert login().json()["access"]


def test_la_clave_de_cifrado_propia_es_independiente_de_secret_key(usuario, settings, reloj):
    settings.MFA_CLAVE_CIFRADO = "otra-clave-larga-y-aleatoria"
    c = cliente_de(usuario)
    secreto = c.post(CONFIGURAR).json()["secreto"]
    assert c.post(ACTIVAR, {"codigo": codigo_de(secreto, reloj)}, format="json").status_code == 200
    settings.MFA_CLAVE_CIFRADO = "clave-distinta"  # con otra clave el secreto no se puede leer
    reloj.avanzar_paso()
    token = login().json()["mfa_token"]
    assert verificar(token, codigo_de(secreto, reloj)).status_code == 401
