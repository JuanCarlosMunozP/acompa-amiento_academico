import os

from .base import *  # noqa: F401,F403

DEBUG = False

# El proxy de la plataforma (Render, etc.) termina el HTTPS y reenvía por HTTP. Sin esta
# cabecera Django cree que toda petición es insegura y SECURE_SSL_REDIRECT redirige en bucle.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = config("SECURE_SSL_REDIRECT", default=True, cast=bool)  # noqa: F405
SECURE_HSTS_SECONDS = config("SECURE_HSTS_SECONDS", default=2592000, cast=int)  # noqa: F405
# Anti-phishing: en producción los enlaces de los correos deben ser https.
ENLACES_EXIGIR_HTTPS = True
DISPOSITIVOS_VERIFICACION = config("DISPOSITIVOS_VERIFICACION", default=True, cast=bool)  # noqa: F405
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# La plataforma publica el servicio en un host que ya conoce: se permite sin configurarlo a mano.
for _variable in ("RENDER_EXTERNAL_HOSTNAME",):
    _host = os.environ.get(_variable)
    if _host and _host not in ALLOWED_HOSTS:  # noqa: F405
        ALLOWED_HOSTS = [*ALLOWED_HOSTS, _host]  # noqa: F405

# Railway publica el servicio en RAILWAY_PUBLIC_DOMAIN y su verificación de salud llega con el
# host healthcheck.railway.app. Este último solo se acepta cuando realmente se corre en Railway.
_railway_hosts = []
if os.environ.get("RAILWAY_PUBLIC_DOMAIN"):
    _railway_hosts.append(os.environ["RAILWAY_PUBLIC_DOMAIN"])
if os.environ.get("RAILWAY_ENVIRONMENT"):
    _railway_hosts.append("healthcheck.railway.app")
ALLOWED_HOSTS = [*ALLOWED_HOSTS, *(h for h in _railway_hosts if h not in ALLOWED_HOSTS)]  # noqa: F405


# Las verificaciones de salud llegan por HTTP: no pueden ser redirigidas a HTTPS.
SECURE_REDIRECT_EXEMPT = [r"^api/health/$"]

# Archivos estáticos (el admin de Django) servidos por la propia app con WhiteNoise.
MIDDLEWARE = [  # noqa: F405
    MIDDLEWARE[0],  # noqa: F405
    "whitenoise.middleware.WhiteNoiseMiddleware",
    *MIDDLEWARE[1:],  # noqa: F405
]
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

# Los errores 500 deben quedar en la salida estándar (los logs de la plataforma). Sin esto, con
# DEBUG apagado Django no escribe nada y no hay forma de diagnosticar un fallo en producción.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"consola": {"class": "logging.StreamHandler"}},
    "loggers": {"django.request": {"handlers": ["consola"], "level": "ERROR", "propagate": False}},
}
