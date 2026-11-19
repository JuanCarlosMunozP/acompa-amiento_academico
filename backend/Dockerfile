# Imagen de la API para Render (Dockerfile).
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DJANGO_SETTINGS_MODULE=config.settings.production

WORKDIR /app

COPY requirements/ requirements/
RUN pip install --no-cache-dir -r requirements/prod.txt \
    # MFA (TOTP + QR): si alguna dependencia no carga, el build falla aquí y no en producción.
    && python -c "import pyotp, qrcode, png, cryptography; from qrcode.image.pure import PyPNGImage"

COPY . .

# Genera los estáticos del admin. Las variables son solo de relleno para el build:
# los valores reales llegan al ejecutar el contenedor.
RUN SECRET_KEY=solo-para-el-build DATABASE_URL=postgres://u:p@localhost/db \
    python manage.py collectstatic --noinput

# entrypoint.sh debe tener finales de línea Unix aunque se edite en Windows.
RUN sed -i 's/\r$//' entrypoint.sh \
    && chmod +x entrypoint.sh \
    && useradd --create-home app \
    && chown -R app /app
USER app

EXPOSE 8000
# Migra, crea el administrador inicial si hay variables y arranca (la plataforma define PORT).
CMD ["./entrypoint.sh"]
