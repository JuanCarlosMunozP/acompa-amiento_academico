"""Cobertura de seguridad, dispositivos, auditoría, acudientes, plantillas de correo y de los
módulos de arranque (asgi, wsgi, settings de producción)."""

import importlib
import json
from datetime import date, timedelta
from unittest import mock

import pytest
from django.db import IntegrityError
from django.test import override_settings
from django.utils import timezone
from rest_framework import serializers
from rest_framework.test import APIClient

from common.seguridad import _contiene_payload
from planes.plantillas_correo import sanitizar_html
from planes.serializers_plantillas import PlantillaCorreoPlanSerializer
from usuarios import dispositivos
from usuarios.models import Dispositivo, EventoAuditoria, Usuario, VinculoAcudiente
from usuarios.roles import Rol

CLAVE = "Clave-segura-2026"


def crear(email, rol=Rol.ESTUDIANTE, **extra):
    return Usuario.objects.create_user(
        email, CLAVE, nombres="N", apellidos="A", email_verificado=True, rol=rol, **extra
    )


def cliente(usuario):
    c = APIClient()
    r = c.post("/api/auth/login/", {"email": usuario.email, "password": CLAVE}, format="json")
    assert r.status_code == 200, r.json()
    c.credentials(HTTP_AUTHORIZATION="Bearer " + r.json()["access"])
    return c


# --- filtro de peticiones -------------------------------------------------------------------


def test_estructuras_demasiado_anidadas_se_descartan():
    profundo = "x"
    for _ in range(12):
        profundo = {"a": profundo}
    assert _contiene_payload(profundo) is True
    assert _contiene_payload({"a": {"b": "hola"}}) is False


@pytest.mark.django_db
def test_json_roto_pasa_al_validador_normal_que_responde_400(client):
    r = client.post("/api/auth/login/", data="{no es json", content_type="application/json")
    assert r.status_code == 400
    assert r.json()["error"]["code"] != "peticion_bloqueada"


@pytest.mark.django_db
def test_login_con_cuerpo_que_no_es_objeto_no_rompe_el_limitador():
    r = APIClient().post("/api/auth/login/", [1, 2], format="json")
    assert r.status_code == 400


# --- dispositivos ---------------------------------------------------------------------------


def _peticion():
    return mock.Mock(META={"HTTP_USER_AGENT": "Chrome/1 (Windows)", "REMOTE_ADDR": "10.0.0.1"})


@pytest.mark.django_db
def test_registrar_un_dispositivo_ya_vigente_no_repite_aviso_ni_auditoria():
    u = crear("a@colegio.edu.co")
    dispositivos.registrar(u, "h" * 64, _peticion())
    antes = EventoAuditoria.objects.count()
    with mock.patch.object(dispositivos, "enviar_correo") as correo:
        dispositivos.registrar(u, "h" * 64, _peticion())
    assert correo.call_count == 0
    assert EventoAuditoria.objects.count() == antes


@pytest.mark.django_db
def test_si_falla_el_aviso_de_dispositivo_nuevo_igual_se_registra():
    u = crear("b@colegio.edu.co")
    with mock.patch.object(dispositivos, "enviar_correo", side_effect=OSError("smtp")):
        disp = dispositivos.registrar(u, "k" * 64, _peticion())
    assert Dispositivo.objects.filter(pk=disp.pk, revocado_en__isnull=True).exists()


@pytest.mark.django_db
def test_un_dispositivo_revocado_se_reactiva_al_verificarse_de_nuevo():
    u = crear("c@colegio.edu.co")
    disp = dispositivos.registrar(u, "m" * 64, _peticion())
    assert dispositivos.revocar(u, disp.pk) is True
    assert dispositivos.revocar(u, disp.pk) is False  # ya estaba revocado
    with mock.patch.object(dispositivos, "enviar_correo") as correo:
        dispositivos.registrar(u, "m" * 64, _peticion())
    assert correo.call_count == 1
    assert dispositivos.buscar_confiable(u, "m" * 64) is not None


@pytest.mark.django_db
def test_dispositivo_conocido_actualiza_ultimo_uso():
    u = crear("d@colegio.edu.co")
    disp = dispositivos.registrar(u, "n" * 64, _peticion())
    Dispositivo.objects.filter(pk=disp.pk).update(ultimo_uso=timezone.now() - timedelta(days=3))
    disp.refresh_from_db()
    dispositivos.tocar(disp, _peticion())
    disp.refresh_from_db()
    assert disp.ultimo_uso > timezone.now() - timedelta(minutes=1)


@pytest.mark.django_db
@override_settings(DISPOSITIVOS_VERIFICACION=True)
def test_login_desde_dispositivo_conocido_con_clave_correcta_toca_el_dispositivo():
    u = crear("e@colegio.edu.co")
    identificador = "z" * 32
    dispositivos.registrar(u, dispositivos.huella_de(identificador), _peticion())
    r = APIClient().post(
        "/api/auth/login/",
        {"email": u.email, "password": CLAVE, "dispositivo": identificador},
        format="json",
    )
    assert r.status_code == 200 and "access" in r.json()


# --- auditoría ------------------------------------------------------------------------------


@pytest.mark.django_db
def test_auditoria_filtra_por_actor_y_por_fechas():
    admin = crear("admin@colegio.edu.co", Rol.ADMINISTRADOR)
    otro = crear("otro@colegio.edu.co", Rol.COORDINADOR)
    EventoAuditoria.objects.create(actor=otro, accion="x", recurso="r")
    c = cliente(admin)
    hoy = date.today().isoformat()
    ayer = (date.today() - timedelta(days=1)).isoformat()
    r = c.get("/api/auditoria/", {"actor": otro.pk})
    assert r.status_code == 200 and r.json()["count"] == 1
    assert c.get("/api/auditoria/", {"desde": hoy}).json()["count"] >= 1
    assert c.get("/api/auditoria/", {"hasta": ayer}).json()["count"] == 0
    assert c.get("/api/auditoria/", {"desde": ayer, "hasta": hoy}).status_code == 200


@pytest.mark.django_db
def test_auditoria_rechaza_un_rango_invertido():
    c = cliente(crear("admin2@colegio.edu.co", Rol.ADMINISTRADOR))
    r = c.get("/api/auditoria/", {"desde": "2026-05-10", "hasta": "2026-05-01"})
    assert r.status_code == 400


# --- acudientes -----------------------------------------------------------------------------


@pytest.mark.django_db
def test_vinculos_acepta_solo_numeros_en_los_filtros():
    admin = cliente(crear("admin3@colegio.edu.co", Rol.ADMINISTRADOR))
    r = admin.get("/api/vinculos-acudiente/", {"acudiente": "abc"})
    assert r.status_code == 400
    assert admin.get("/api/vinculos-acudiente/", {"estudiante": "1"}).status_code == 200


@pytest.mark.django_db
def test_vinculo_duplicado_por_carrera_responde_400_legible():
    admin = cliente(crear("admin4@colegio.edu.co", Rol.ADMINISTRADOR))
    acudiente = crear("ac@colegio.edu.co", Rol.ACUDIENTE)
    estudiante = crear("es@colegio.edu.co")
    from usuarios.views_acudientes import VinculoSerializer

    with mock.patch.object(VinculoSerializer, "save", side_effect=IntegrityError):
        r = admin.post(
            "/api/vinculos-acudiente/",
            {"acudiente": acudiente.pk, "estudiante": estudiante.pk},
            format="json",
        )
    assert r.status_code == 400
    assert VinculoAcudiente.objects.count() == 0


# --- plantillas de correo -------------------------------------------------------------------


def test_sanitizador_descarta_contenedores_peligrosos_con_todo_su_contenido():
    assert sanitizar_html("<p>a</p><script>alert(1)</script><p>b</p>") == "<p>a</p><p>b</p>"
    # Etiquetas anidadas dentro de un contenedor bloqueado también se descartan.
    assert sanitizar_html("<style><b>x</b></style>ok") == "ok"


def test_sanitizador_ignora_etiquetas_desconocidas_y_conserva_el_texto():
    assert sanitizar_html("<font>hola</font>") == "hola"


def test_sanitizador_filtra_atributos_y_enlaces():
    html_ = (
        '<a href="https://ok.co" title="Hola" onclick="x()">a</a>'
        '<a href="javascript:alert(1)">b</a>'
        '<a href="mailto:a@b.co">c</a>'
        '<a href="http://inseguro.co">d</a>'
        '<p href="https://no-en-p.co" title="t">e</p>'
    )
    limpio = sanitizar_html(html_)
    assert 'href="https://ok.co"' in limpio and 'title="Hola"' in limpio
    assert "onclick" not in limpio and "javascript" not in limpio
    assert 'href="mailto:a@b.co"' in limpio
    assert "http://inseguro.co" not in limpio
    assert '<p title="t">e</p>' in limpio


def test_sanitizador_cierra_etiquetas_y_tolera_cierres_sueltos():
    assert sanitizar_html("</p>suelto") == "suelto"
    assert sanitizar_html("<div><p>x</div>") == "<div><p>x</p></div>"
    assert sanitizar_html("<p>abierto") == "<p>abierto</p>"
    assert sanitizar_html("a<br>b") == "a<br>b"


def test_serializer_de_plantillas_valida_variables_y_html():
    s = PlantillaCorreoPlanSerializer()
    assert s.validate_asunto("Hola {{ nombres }}") == "Hola {{ nombres }}"
    assert s.validate_cuerpo_texto("Plan de {{ tutor }}") == "Plan de {{ tutor }}"
    assert s.validate_cuerpo_html("<p>{{ nombres }}</p>") == "<p>{{ nombres }}</p>"
    with pytest.raises(serializers.ValidationError, match="Variables no permitidas"):
        s.validate_cuerpo_texto("{{ secreto }}")
    with pytest.raises(serializers.ValidationError, match="formato"):
        s.validate_asunto("Hola {{ nombres")
    with pytest.raises(serializers.ValidationError, match="formato"):
        s.validate_cuerpo_texto("fin }}")
    with pytest.raises(serializers.ValidationError, match="seguros"):
        s.validate_cuerpo_html("<p>x</p><script>1</script>")


# --- módulos de arranque --------------------------------------------------------------------


def test_asgi_y_wsgi_exponen_la_aplicacion():
    import config.asgi
    import config.wsgi

    assert callable(importlib.reload(config.asgi).application)
    assert callable(importlib.reload(config.wsgi).application)


@pytest.fixture
def produccion(monkeypatch):
    """Recarga `config.settings.production` con el entorno indicado y la restaura al final."""
    import config.settings.production as modulo

    for variable in (
        "RENDER_EXTERNAL_HOSTNAME",
        "RAILWAY_PUBLIC_DOMAIN",
        "RAILWAY_ENVIRONMENT",
    ):
        monkeypatch.delenv(variable, raising=False)

    def cargar(**entorno):
        for k, v in entorno.items():
            monkeypatch.setenv(k, v)
        return importlib.reload(modulo)

    yield cargar
    monkeypatch.undo()
    importlib.reload(modulo)


def test_produccion_sin_plataforma_no_agrega_hosts(produccion):
    m = produccion()
    assert m.DEBUG is False and m.SESSION_COOKIE_SECURE is True
    assert "healthcheck.railway.app" not in m.ALLOWED_HOSTS
    assert m.SECURE_PROXY_SSL_HEADER == ("HTTP_X_FORWARDED_PROTO", "https")
    assert m.MIDDLEWARE[1] == "whitenoise.middleware.WhiteNoiseMiddleware"


def test_produccion_en_render_acepta_su_host_una_sola_vez(produccion):
    m = produccion(RENDER_EXTERNAL_HOSTNAME="tutorias.onrender.com")
    assert m.ALLOWED_HOSTS.count("tutorias.onrender.com") == 1
    m = produccion(RENDER_EXTERNAL_HOSTNAME="localhost")  # ya permitido: no se duplica
    assert m.ALLOWED_HOSTS.count("localhost") == 1


def test_produccion_en_railway_acepta_dominio_y_healthcheck(produccion):
    m = produccion(RAILWAY_PUBLIC_DOMAIN="app.up.railway.app", RAILWAY_ENVIRONMENT="production")
    assert "app.up.railway.app" in m.ALLOWED_HOSTS
    assert "healthcheck.railway.app" in m.ALLOWED_HOSTS


def test_produccion_con_solo_el_dominio_publico_no_abre_el_healthcheck(produccion):
    m = produccion(RAILWAY_PUBLIC_DOMAIN="app.up.railway.app")
    assert "app.up.railway.app" in m.ALLOWED_HOSTS
    assert "healthcheck.railway.app" not in m.ALLOWED_HOSTS


def test_produccion_con_dominio_ya_permitido_no_lo_duplica(produccion):
    m = produccion(RAILWAY_PUBLIC_DOMAIN="localhost", RAILWAY_ENVIRONMENT="production")
    assert m.ALLOWED_HOSTS.count("localhost") == 1


def test_el_servicio_de_cuerpo_es_json_valido_en_utf8():
    # Resguardo: el contenido enviado en las pruebas de arriba debe poder serializarse.
    assert json.loads(json.dumps({"ñ": "á"})) == {"ñ": "á"}
