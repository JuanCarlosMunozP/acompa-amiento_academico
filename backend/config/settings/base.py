from datetime import timedelta
from pathlib import Path

import dj_database_url
from decouple import Csv, config

BASE_DIR = Path(__file__).resolve().parent.parent.parent

SECRET_KEY = config("SECRET_KEY")
DEBUG = config("DEBUG", default=False, cast=bool)
ALLOWED_HOSTS = config("ALLOWED_HOSTS", default="localhost,127.0.0.1", cast=Csv())

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "usuarios",
    "academico",
    "seguimiento",
    "planes",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "common.seguridad.CabecerasSeguridadMiddleware",
    "common.seguridad.FiltroPeticionesMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# DATABASE_URL con esquema postgres://usuario:clave@host:puerto/base
DATABASES = {
    "default": dj_database_url.config(
        env="DATABASE_URL",
        default=config("DATABASE_URL"),
        conn_max_age=60,
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "es-co"
TIME_ZONE = "America/Bogota"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_ROOT = config("MEDIA_ROOT", default=BASE_DIR / "media")
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "usuarios.Usuario"

# CORS: orígenes permitidos del cliente (Expo web / dev server)
CORS_ALLOWED_ORIGINS = config(
    "CORS_ALLOWED_ORIGINS",
    default="http://localhost:8081",
    cast=Csv(),
)
CORS_ALLOWED_ORIGIN_REGEXES = config("CORS_ALLOWED_ORIGIN_REGEXES", default="", cast=Csv())

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["common.renderers.JSONRendererApi"],
    "EXCEPTION_HANDLER": "common.exceptions.api_exception_handler",
    # Límite global por IP/usuario contra fuerza bruta y scraping; los endpoints sensibles
    # (login, registro, recuperación) añaden sus propios límites más estrictos.
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": config("THROTTLE_ANON", default="60/minute"),
        "user": config("THROTTLE_USER", default="240/minute"),
        "login": config("THROTTLE_LOGIN", default="10/minute"),
        "login_ip": config("THROTTLE_LOGIN_IP", default="300/minute"),
        "registro": config("THROTTLE_REGISTRO", default="5/hour"),
        "reenvio": config("THROTTLE_REENVIO", default="5/hour"),
        "recuperacion": config("THROTTLE_RECUPERACION", default="5/hour"),
        "mfa": config("THROTTLE_MFA", default="10/minute"),
    },
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "usuarios.jwt.JWTConDispositivo",
    ],
    # Denegar por defecto: los endpoints públicos declaran AllowAny de forma explícita.
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
}

# Contraseñas: Argon2 como hash principal; PBKDF2 solo para verificar hashes antiguos.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

# Sesión (JWT).
# El refresh token rota en cada uso: su vida es la ventana de inactividad. Si el cliente no
# renueva en JWT_INACTIVIDAD_MINUTOS, la sesión muere; si está activo, se renueva sola.
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=config("JWT_ACCESS_MINUTOS", default=15, cast=int)),
    "REFRESH_TOKEN_LIFETIME": timedelta(
        minutes=config("JWT_INACTIVIDAD_MINUTOS", default=30, cast=int)
    ),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

# Recuperación de contraseña: el enlace caduca y sirve una sola vez.
PASSWORD_RESET_TIMEOUT = config("RECUPERACION_MAX_SEGUNDOS", default=60 * 60, cast=int)
# Si es False, el registro no exige verificar el correo: la cuenta nace verificada, no se envía
# correo y el cliente inicia sesión de inmediato (útil mientras no haya un servicio de correo).
REGISTRO_VERIFICA_CORREO = config("REGISTRO_VERIFICA_CORREO", default=True, cast=bool)
# Enlace del cliente al que llega el usuario desde el correo; recibe ?uid=...&token=...
RECUPERACION_URL = config("RECUPERACION_URL", default="http://localhost:8081/nueva-contrasena")

# Control de intentos de inicio de sesión
LOGIN_MAX_INTENTOS = config("LOGIN_MAX_INTENTOS", default=5, cast=int)
LOGIN_BLOQUEO_MINUTOS = config("LOGIN_BLOQUEO_MINUTOS", default=15, cast=int)

# Autenticación multifactor (TOTP con QR, compatible con Google/Microsoft Authenticator, Authy...)
# Nombre que verá el usuario en su app autenticadora.
MFA_EMISOR = config("MFA_EMISOR", default="Acompañamiento Académico")
# Clave que cifra los secretos TOTP en la base de datos. Vacía = se deriva de SECRET_KEY
# (entonces rotar SECRET_KEY invalida los secretos y habría que reconfigurar el MFA).
MFA_CLAVE_CIFRADO = config("MFA_CLAVE_CIFRADO", default="")
# Vigencia del paso intermedio entre contraseña correcta y código MFA.
MFA_DESAFIO_SEGUNDOS = config("MFA_DESAFIO_SEGUNDOS", default=300, cast=int)
# Pasos de 30 s que se toleran hacia atrás/adelante por diferencia de reloj.
MFA_VENTANA_PASOS = config("MFA_VENTANA_PASOS", default=1, cast=int)

# Dispositivos registrados: un dispositivo nuevo debe verificarse (MFA o código al correo) y
# las sesiones quedan atadas a él. Activo por defecto solo en producción.
DISPOSITIVOS_VERIFICACION = config("DISPOSITIVOS_VERIFICACION", default=False, cast=bool)
DISPOSITIVOS_MAX = config("DISPOSITIVOS_MAX", default=5, cast=int)
DISPOSITIVO_CODIGO_MINUTOS = config("DISPOSITIVO_CODIGO_MINUTOS", default=10, cast=int)
DISPOSITIVO_CODIGO_INTENTOS = config("DISPOSITIVO_CODIGO_INTENTOS", default=5, cast=int)

# Registro y verificación de correo
# Dominios de correo institucional permitidos (vacío = cualquier dominio, solo en local)
EMAIL_DOMINIOS_PERMITIDOS = config("EMAIL_DOMINIOS_PERMITIDOS", default="", cast=Csv())
# Enlace del cliente al que llega el usuario desde el correo; recibe ?token=...
VERIFICACION_URL = config("VERIFICACION_URL", default="http://localhost:8081/verificar-correo")
VERIFICACION_MAX_AGE = config("VERIFICACION_MAX_AGE", default=60 * 60 * 24, cast=int)  # segundos

# Django 6.1 usa MAILERS; ambos flujos de correo usan esta configuración común.
_email_backend = config("EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend")
MAILERS = {
    "default": {
        "BACKEND": _email_backend,
        "OPTIONS": (
            {
                "host": config("EMAIL_HOST", default="localhost"),
                "port": config("EMAIL_PORT", default=587, cast=int),
                "username": config("EMAIL_HOST_USER", default=""),
                "password": config("EMAIL_HOST_PASSWORD", default=""),
                "use_tls": config("EMAIL_USE_TLS", default=True, cast=bool),
                "use_ssl": config("EMAIL_USE_SSL", default=False, cast=bool),
                "timeout": config("EMAIL_TIMEOUT", default=15, cast=int),
            }
            if _email_backend.endswith("smtp.EmailBackend")
            else {}
        ),
    }
}


DEFAULT_FROM_EMAIL = config(
    "DEFAULT_FROM_EMAIL", default="Acompañamiento Académico <no-responder@localhost>"
)

# Identidad de la institución en los correos (colores provisionales hasta tener el manual de marca)
INSTITUCION_NOMBRE = config("INSTITUCION_NOMBRE", default="Colegio")
INSTITUCION_COLOR = config("INSTITUCION_COLOR", default="#1F3A8A")


# --- Seguridad (XSS, clickjacking, inyección, phishing) ---------------------------------------
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"

# Tamaño máximo del cuerpo y número máximo de campos: frena cargas abusivas (DoS).
DATA_UPLOAD_MAX_MEMORY_SIZE = config("DATA_UPLOAD_MAX_MEMORY_SIZE", default=1024 * 1024, cast=int)
DATA_UPLOAD_MAX_NUMBER_FIELDS = 200


# Anti-phishing: los enlaces de los correos (recuperación, verificación) solo pueden apuntar a
# estos hosts. Por defecto: el cliente autorizado en CORS y los hosts propios del servicio.
# Si el frontend vive en otro dominio, agrégalo en HOSTS_ENLACES_CONFIABLES.
def _hosts_de(urls):
    from urllib.parse import urlsplit

    return {(urlsplit(u).hostname or "").lower() for u in urls}


HOSTS_ENLACES_CONFIABLES = sorted(
    {
        h
        for h in (
            *config("HOSTS_ENLACES_CONFIABLES", default="", cast=Csv()),
            *_hosts_de(CORS_ALLOWED_ORIGINS),
            *[h for h in ALLOWED_HOSTS if h != "*"],
        )
        if h
    }
)
