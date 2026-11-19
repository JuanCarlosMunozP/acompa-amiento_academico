from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from usuarios.models import Usuario

pytestmark = pytest.mark.django_db

URL = "/api/auth/login/"
CLAVE = "Clave-segura-2026"


@pytest.fixture
def usuario():
    return Usuario.objects.create_user(
        "ana@colegio.edu.co", CLAVE, nombres="Ana", apellidos="Ruiz", email_verificado=True
    )


def login(email="ana@colegio.edu.co", password=CLAVE):
    return APIClient().post(URL, {"email": email, "password": password}, format="json")


# --- T6: endpoint y emisión de tokens ---


def test_login_exitoso_emite_tokens_y_datos_del_usuario(usuario):
    r = login()
    assert r.status_code == 200
    body = r.json()
    assert body["usuario"]["email"] == "ana@colegio.edu.co"
    assert "password" not in body["usuario"]
    assert AccessToken(body["access"])["user_id"] == str(usuario.pk)
    assert body["refresh"]


def test_el_token_de_acceso_autentica_peticiones(usuario):
    access = login().json()["access"]
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    assert client.get("/api/health/").status_code == 200


def test_refresh_entrega_nuevo_access(usuario):
    refresh = login().json()["refresh"]
    r = APIClient().post("/api/auth/refresh/", {"refresh": refresh}, format="json")
    assert r.status_code == 200 and r.json()["access"]


def test_correo_se_acepta_sin_distinguir_mayusculas(usuario):
    assert login(email="ANA@Colegio.edu.co").status_code == 200


def test_contrasena_incorrecta_y_correo_inexistente_dan_el_mismo_error(usuario):
    a = login(password="mala")
    b = login(email="nadie@colegio.edu.co")
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()
    assert a.json()["error"]["code"] == "credenciales_invalidas"


def test_correo_no_verificado_no_entra():
    Usuario.objects.create_user("luis@colegio.edu.co", CLAVE, nombres="Luis", apellidos="P")
    r = login(email="luis@colegio.edu.co")
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "correo_no_verificado"


def test_correo_no_verificado_con_clave_mala_no_revela_el_estado():
    Usuario.objects.create_user("luis@colegio.edu.co", CLAVE, nombres="Luis", apellidos="P")
    r = login(email="luis@colegio.edu.co", password="mala")
    assert r.status_code == 401


def test_usuario_inactivo_no_entra_y_se_le_explica_por_que(usuario):
    usuario.is_active = False
    usuario.save()
    r = login()
    assert r.status_code == 403 and r.json()["error"]["code"] == "cuenta_desactivada"
    assert login(password="mala").status_code == 401  # con clave errónea no se revela nada


def test_campos_obligatorios():
    r = APIClient().post(URL, {}, format="json")
    assert r.status_code == 400
    assert {"email", "password"} <= set(r.json()["error"]["details"])


def test_login_limita_solicitudes_por_ip():
    client = APIClient()
    respuestas = [client.post(URL, {}, format="json") for _ in range(11)]
    assert [r.status_code for r in respuestas[:10]] == [400] * 10
    assert respuestas[10].status_code == 429


# --- T7: hash y control de intentos ---


def test_la_contrasena_se_guarda_con_hash_argon2(usuario):
    assert usuario.password.startswith("argon2$")
    assert CLAVE not in usuario.password


def test_cinco_fallos_bloquean_la_cuenta_incluso_con_la_clave_correcta(usuario):
    for _ in range(4):
        assert login(password="mala").status_code == 401
    r = login(password="mala")  # quinto fallo
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "cuenta_bloqueada"

    r = login()  # clave correcta, pero bloqueada
    assert r.status_code == 429
    usuario.refresh_from_db()
    assert usuario.intentos_fallidos == 5 and usuario.esta_bloqueado()


def test_el_conteo_de_fallos_se_guarda(usuario):
    login(password="mala")
    login(password="mala")
    usuario.refresh_from_db()
    assert usuario.intentos_fallidos == 2


def test_un_login_correcto_reinicia_el_conteo(usuario):
    login(password="mala")
    login(password="mala")
    assert login().status_code == 200
    usuario.refresh_from_db()
    assert usuario.intentos_fallidos == 0


def test_el_bloqueo_vence_con_el_tiempo(usuario):
    usuario.intentos_fallidos = 5
    usuario.bloqueado_hasta = timezone.now() - timedelta(minutes=1)
    usuario.save()
    assert login().status_code == 200
    usuario.refresh_from_db()
    assert usuario.intentos_fallidos == 0 and usuario.bloqueado_hasta is None


def test_tras_vencer_el_bloqueo_un_fallo_empieza_de_cero(usuario):
    usuario.intentos_fallidos = 5
    usuario.bloqueado_hasta = timezone.now() - timedelta(minutes=1)
    usuario.save()
    assert login(password="mala").status_code == 401
    usuario.refresh_from_db()
    assert usuario.intentos_fallidos == 1 and usuario.bloqueado_hasta is None
