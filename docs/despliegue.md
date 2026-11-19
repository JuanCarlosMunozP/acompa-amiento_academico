# Despliegue: backend en Render, frontend en Vercel

## Backend Django en Render

El archivo `render.yaml` define un servicio web Docker que construye `backend/Dockerfile`, ejecuta
las migraciones al arrancar y verifica `/api/health/`. Render termina HTTPS en su dominio
`*.onrender.com` y reenvia el trafico al puerto HTTP `PORT` de Django; no se requieren certificados
ni Gunicorn TLS dentro del contenedor. La configuracion Django conserva `SECURE_PROXY_SSL_HEADER`
para reconocer el HTTPS que termina Render.

1. Sube el repositorio a GitHub y en Render crea un Blueprint desde ese repositorio (usa el
   `render.yaml` de la raiz).
2. En la configuracion inicial proporciona `DATABASE_URL` de una base PostgreSQL accesible desde
   Render y un `CORS_ALLOWED_ORIGINS` exacto, por ejemplo `https://tu-frontend.vercel.app`. Los
   secretos `SECRET_KEY` y `MFA_CLAVE_CIFRADO` se generan automaticamente.
3. Para los enlaces de correo configura `VERIFICACION_URL` y `RECUPERACION_URL` con las rutas del
   dominio de Vercel. Configura un proveedor SMTP cuando quieras habilitar envio real de correo.
4. Selecciona el plan del servicio y crea el Blueprint. Espera a que Render marque el servicio
   como Live y anota el dominio generado, por ejemplo `https://tutorias-api.onrender.com`.
5. Verifica `https://<servicio>.onrender.com/api/health/?db=1`; debe responder
   `{"status":"ok","database":"ok"}`. El admin queda en `/admin/`.

## Frontend Expo Web en Vercel

1. Importa el mismo repositorio en Vercel y establece `frontend` como **Root Directory**.
   `frontend/vercel.json` configura `npm run build:web`, publica `dist` y redirige rutas de la SPA
   a `index.html`.
2. En Project Settings > Environment Variables agrega `EXPO_PUBLIC_API_URL` en Production y Preview
   con el valor `https://<servicio>.onrender.com/api`. Esta variable se incorpora durante el build;
   vuelve a desplegar despues de cambiarla.
3. Copia el dominio `*.vercel.app` de produccion a `CORS_ALLOWED_ORIGINS` en Render y redespliega
   el backend. Usa tambien ese dominio en `VERIFICACION_URL` y `RECUPERACION_URL`.
4. Abre el dominio de Vercel. La API del navegador debe apuntar al dominio HTTPS de Render, nunca a
   `0.0.0.0`, `localhost` ni a un puerto interno como `8000`.

## Docker local

El perfil `local-https` mantiene Nginx/HTTPS para el frontend en `http://localhost:8445`
(redirige a `https://localhost:8446`). Django queda en HTTP local en `http://127.0.0.1:8448`;
el Nginx del frontend le reenvia las rutas `/api/` por HTTP dentro de Docker. El HTTPS publico
del backend lo proporciona Render con su certificado administrado.

Para iniciar los servicios locales:

```powershell
docker compose --profile local-https up -d --build
```

Para detenerlos sin borrar la base de datos local:

```powershell
docker compose --profile local-https down
```


## Variables de correo y de identidad

### Desarrollo local con Mailpit

Con Django ejecutándose en Windows y Mailpit publicando SMTP en el equipo local, usa:

```dotenv
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=localhost
EMAIL_PORT=1025
EMAIL_USE_TLS=False
EMAIL_HOST_USER=
EMAIL_HOST_PASSWORD=
```

Abre `http://localhost:8025` y usa el enlace de verificación desde la bandeja de Mailpit. No copies
el cuerpo de correo codificado que pueda imprimirse en una terminal con el backend de consola.
Reinicia Django después de modificar `backend/.env` para que cargue las nuevas variables.

### Docker (cuando API y Mailpit compartan la red de Compose)

Dentro de Docker, `localhost` apunta al contenedor de Django, no al de Mailpit. Configura
`EMAIL_HOST=mailpit` (o el nombre real del servicio SMTP en Compose) y `EMAIL_PORT=1025`; la
consola web de Mailpit puede seguir publicándose en el host como `http://localhost:8025`.

| Variable | Valor |
|---|---|
| `EMAIL_BACKEND` | `django.core.mail.backends.smtp.EmailBackend` |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS` | Datos del proveedor de correo |
| `DEFAULT_FROM_EMAIL` | Remitente, p. ej. `Tutorías <no-responder@colegio.edu.co>` |
| `EMAIL_DOMINIOS_PERMITIDOS` | Dominio institucional, p. ej. `colegio.edu.co` |
| `VERIFICACION_URL`, `RECUPERACION_URL` | Enlaces del correo (ver pendientes) |
| `INSTITUCION_NOMBRE` | Nombre del colegio en los correos |

Sin las variables de correo, los correos solo se imprimen en los registros del servicio y nadie
puede verificar su cuenta ni recuperar su contraseña.

## Pendientes antes de usar con personas reales

- **Enlaces de los correos en el teléfono:** hoy apuntan a `localhost:8081`. Hace falta un enlace
  `https://` que abra la app (enlaces universales) o una página puente.
- **Correo saliente:** la plataforma puede bloquear SMTP; si pasa, usar un proveedor con API
  HTTPS (Resend, Brevo, SendGrid).
- **URL de la API en la app:** recompilar el APK con `EXPO_PUBLIC_API_URL=https://<servicio>.onrender.com/api`
  y con `usesCleartextTraffic: false` en `app.json`.

## Probar la imagen localmente

En Docker local, Django atiende directamente por HTTP en `http://127.0.0.1:8448/`; no hay Nginx,
certificados ni TLS en el contenedor del backend. El Nginx del frontend conserva HTTPS para la
interfaz y reenvia `/api/` al servicio Django por HTTP dentro de la red Docker. En Render, HTTPS
se termina en la plataforma y el contenedor Django tambien recibe HTTP.


```bash
cd backend
docker build -t tutorias-api .
docker run --rm -p 8000:8000 \
  -e SECRET_KEY=cambia-esto -e DATABASE_URL=postgres://usuario:clave@host:5432/base \
  -e ALLOWED_HOSTS=localhost -e SECURE_SSL_REDIRECT=False tutorias-api
```
