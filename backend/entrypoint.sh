#!/bin/sh
# Arranque del contenedor: migra, crea el primer administrador (opcional) y lanza la API.
set -e

# PostgreSQL puede aceptar conexiones mientras termina una recuperaci\u00f3n. Esperar aqu\u00ed
# evita que un fallo transitorio durante el arranque aborte el contenedor.
INTENTOS_DB="${DB_CONNECT_RETRIES:-12}"
while ! ERROR_DB=$(python -c 'import django; django.setup(); from django.db import connection; connection.ensure_connection()' 2>&1); do
  echo "Detalle: $(echo "$ERROR_DB" | tail -n 1)"
  INTENTOS_DB=$((INTENTOS_DB - 1))
  if [ "$INTENTOS_DB" -le 0 ]; then
    echo "No fue posible conectar con PostgreSQL tras varios intentos."
    exit 1
  fi
  echo "PostgreSQL aún inicia; reintentando conexión ($INTENTOS_DB intentos restantes)..."
  sleep 5
done

python manage.py migrate --noinput


# Si se definen estas variables se crea el administrador inicial. Es seguro dejarlas puestas:
# si ya existe, solo avisa y continúa. Conviene borrar DJANGO_SUPERUSER_PASSWORD después.
#   DJANGO_SUPERUSER_EMAIL, DJANGO_SUPERUSER_PASSWORD,
#   DJANGO_SUPERUSER_NOMBRES, DJANGO_SUPERUSER_APELLIDOS
if [ -n "$DJANGO_SUPERUSER_EMAIL" ] && [ -n "$DJANGO_SUPERUSER_PASSWORD" ]; then
  python manage.py createsuperuser --noinput \
    || echo "Administrador no creado (puede que $DJANGO_SUPERUSER_EMAIL ya exista)."
fi

# Recordatorios de sesiones (HU-07.T4): el comando es idempotente, así que se repite cada
# RECORDATORIOS_INTERVALO_SEGUNDOS (0 lo desactiva).
INTERVALO="${RECORDATORIOS_INTERVALO_SEGUNDOS:-900}"
if [ "$INTERVALO" -gt 0 ]; then
  (
    while true; do
      sleep "$INTERVALO"
      python manage.py enviar_recordatorios_sesiones || echo "Fallo al enviar recordatorios."
    done
  ) &
fi

exec gunicorn config.wsgi:application --bind "0.0.0.0:${PORT:-8000}"
