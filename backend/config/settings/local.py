from .base import *  # noqa: F401,F403

DEBUG = True

# En desarrollo se aceptan todos los hosts: el teléfono entra por la IP de tu PC en el wifi, y esa
# IP cambia. En producción (production.py) la lista sigue siendo estricta.
ALLOWED_HOSTS = ["*"]

for _origin in ("http://localhost:8081", "http://localhost:8082"):
    if _origin not in CORS_ALLOWED_ORIGINS:
        CORS_ALLOWED_ORIGINS = [*CORS_ALLOWED_ORIGINS, _origin]

CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^https?://(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|"
    r"192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?$"
] + CORS_ALLOWED_ORIGIN_REGEXES
