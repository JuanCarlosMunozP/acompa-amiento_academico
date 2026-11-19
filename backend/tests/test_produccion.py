"""Comprueba la configuración de producción en un proceso aparte (otros settings)."""

import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

API_DIR = Path(__file__).resolve().parent.parent

SCRIPT = textwrap.dedent(
    """
    import json
    import django
    from django.test import Client

    django.setup()
    from django.conf import settings

    # Como llega una petición real a Render: el proxy habla HTTPS y reenvía por HTTP.
    def pedir(ruta, https=True, host="tutorias-api.onrender.com"):
        extra = {"HTTP_X_FORWARDED_PROTO": "https"} if https else {}
        r = Client().get(ruta, HTTP_HOST=host, **extra)
        return r.status_code

    admin_css = "/static/admin/css/base.css"
    print(json.dumps({
        "debug": settings.DEBUG,
        "https": pedir("/api/health/"),
        "http_redirige": pedir("/api/auth/me/", https=False),
        "health_http": pedir("/api/health/", https=False),
        "railway_host": pedir("/api/health/", host="miapp.up.railway.app"),
        "railway_healthcheck": pedir(
            "/api/health/", https=False, host="healthcheck.railway.app"
        ),
        "host_ajeno": pedir("/api/health/", host="otro-sitio.example"),
        "estatico": pedir(admin_css),
        "middleware": settings.MIDDLEWARE[:3],
        "hsts": settings.SECURE_HSTS_SECONDS,
    }))
    """
)


def correr(**env_extra):
    env = {
        **os.environ,
        "DJANGO_SETTINGS_MODULE": "config.settings.production",
        "SECRET_KEY": "clave-de-prueba-" + "x" * 50,
        "RENDER_EXTERNAL_HOSTNAME": "tutorias-api.onrender.com",
        **env_extra,
    }
    proceso = subprocess.run(
        [sys.executable, "-c", SCRIPT], cwd=API_DIR, env=env, capture_output=True, text=True
    )
    assert proceso.returncode == 0, proceso.stderr
    return json.loads(proceso.stdout.strip().splitlines()[-1])


@pytest.fixture(scope="module")
def estaticos():
    """Genera los archivos estáticos como lo hace el comando de build."""
    env = {
        **os.environ,
        "DJANGO_SETTINGS_MODULE": "config.settings.production",
        "SECRET_KEY": "x" * 60,
    }
    r = subprocess.run(
        [sys.executable, "manage.py", "collectstatic", "--noinput"],
        cwd=API_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stderr


def test_la_configuracion_de_produccion_funciona_detras_del_proxy_de_render(estaticos):
    r = correr()
    assert r["debug"] is False
    assert r["https"] == 200  # sin la cabecera del proxy sería un bucle de redirecciones
    assert r["http_redirige"] == 301  # el tráfico sin cifrar se manda a HTTPS
    assert r["health_http"] == 200  # salvo la verificación de salud, que llega por HTTP
    assert r["estatico"] == 200  # el admin conserva sus estilos


def test_solo_acepta_el_host_publico_del_servicio(estaticos):
    assert correr()["host_ajeno"] == 400


RAILWAY = {
    "RAILWAY_PUBLIC_DOMAIN": "miapp.up.railway.app",
    "RAILWAY_ENVIRONMENT": "production",
}


def test_en_railway_acepta_su_dominio_publico_y_su_verificacion_de_salud(estaticos):
    r = correr(**RAILWAY)
    assert r["railway_host"] == 200
    assert r["railway_healthcheck"] == 200  # por HTTP y con el host healthcheck.railway.app


def test_fuera_de_railway_esos_hosts_se_rechazan(estaticos):
    r = correr()
    assert r["railway_host"] == 400
    assert r["railway_healthcheck"] == 400


def test_whitenoise_va_justo_despues_de_la_seguridad(estaticos):
    middleware = correr()["middleware"]
    assert middleware[0] == "django.middleware.security.SecurityMiddleware"
    assert middleware[1] == "whitenoise.middleware.WhiteNoiseMiddleware"


def test_el_arranque_falla_si_la_clave_secreta_esta_vacia():
    env = {
        **os.environ,
        "DJANGO_SETTINGS_MODULE": "config.settings.production",
        "SECRET_KEY": "",
    }
    proceso = subprocess.run(
        [sys.executable, "manage.py", "check"],
        cwd=API_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    assert proceso.returncode != 0
    assert "SECRET_KEY" in proceso.stderr
