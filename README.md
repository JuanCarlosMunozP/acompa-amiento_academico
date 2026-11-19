# Plataforma de Tutorías Académicas

Monorepo con dos componentes:

| Carpeta     | Tecnología                      | Descripción                                   |
|-------------|---------------------------------|-----------------------------------------------|
| `backend/`  | Django + Django REST Framework  | API REST (apps por dominio en la raíz de `backend/`) |
| `frontend/` | React Native (Expo + TypeScript)| Aplicación móvil                              |
| `docs/`     | Markdown                        | Documentación y decisiones técnicas           |

## Estructura

```
Plataforma_tutorias_academicas/
├── backend/
│   ├── config/            # Proyecto Django
│   │   └── settings/      # base.py, local.py, production.py
│   ├── usuarios/          # App de usuarios, roles y perfiles (una app por dominio, en la raíz)
│   ├── common/            # Utilidades compartidas (errores, salud)
│   ├── requirements/      # base.txt, dev.txt, prod.txt
│   ├── tests/             # Pruebas de la API
│   ├── manage.py, pytest.ini, ruff.toml
│   ├── Dockerfile, entrypoint.sh, railway.toml    # Despliegue
│   └── .env.example       # Variables de entorno (copiar a .env)
├── frontend/
│   ├── src/
│   │   ├── api/           # Cliente HTTP y servicios por recurso
│   │   ├── components/    # Componentes reutilizables
│   │   ├── screens/       # Pantallas
│   │   ├── navigation/    # Navegadores y rutas
│   │   ├── hooks/         # Hooks personalizados
│   │   ├── store/         # Estado global (sesión)
│   │   ├── theme/         # Colores, tipografía, espaciado
│   │   ├── utils/         # Funciones auxiliares
│   │   └── types/         # Tipos TypeScript
│   ├── assets/            # Imágenes, fuentes
│   ├── Dockerfile, nginx.conf, .dockerignore  # Web estática con Nginx
│   ├── __tests__/         # Pruebas de las pantallas
│   └── .env.example       # Variables de entorno (copiar a .env)
├── scripts/               # setup, dev-api, dev-client, setup-db, build-apk, deploy-railway (.ps1)
└── docs/                  # Definición de hecho, API de usuarios, despliegue
```

## Mapa de módulos

Este índice describe los módulos de aplicación mantenidos por el equipo. Las migraciones
de `backend/<app>/migrations/` son artefactos versionados generados por Django; los casos
de prueba están en `backend/tests/` y `frontend/__tests__/`.

### Backend

#### Configuración y utilidades compartidas

| Módulo | Responsabilidad |
|---|---|
| `backend/config/asgi.py` | Expone la aplicación ASGI para servidores asíncronos. |
| `backend/config/wsgi.py` | Expone la aplicación WSGI para servidores tradicionales. |
| `backend/config/urls.py` | Enruta las solicitudes hacia las aplicaciones y endpoints raíz. |
| `backend/config/settings/base.py` | Configuración común de Django, aplicaciones, middleware y servicios. |
| `backend/config/settings/local.py` | Ajustes para desarrollo local. |
| `backend/config/settings/production.py` | Ajustes seguros para despliegues de producción. |
| `backend/manage.py` | Punto de entrada para comandos administrativos de Django. |
| `backend/common/crud.py` | Operaciones reutilizables para recursos CRUD. |
| `backend/common/exceptions.py` | Excepciones compartidas de la API. |
| `backend/common/renderers.py` | Formato de representación de respuestas de la API. |
| `backend/common/seguridad.py` | Utilidades y reglas compartidas de seguridad. |
| `backend/common/views.py` | Endpoint público de salud y verificación opcional de PostgreSQL. |

#### Dominio académico

| Módulo | Responsabilidad |
|---|---|
| `backend/academico/models.py` | Modelos de la estructura académica y sus relaciones. |
| `backend/academico/serializers.py` | Validación y representación de datos académicos de la API. |
| `backend/academico/servicios.py` | Reglas de negocio y operaciones del dominio académico. |
| `backend/academico/admin.py` | Registro y configuración de modelos académicos en Django Admin. |
| `backend/academico/apps.py` | Configuración de la aplicación Django académica. |
| `backend/academico/urls.py` | Rutas de los recursos académicos. |
| `backend/academico/views.py` | Vistas/endpoints para administrar estructura y recursos académicos. |

#### Planes de acompañamiento

| Módulo | Responsabilidad |
|---|---|
| `backend/planes/models.py` | Modelos de planes, sesiones, informes y notificaciones asociadas. |
| `backend/planes/serializers.py` | Validación y representación de planes y datos relacionados. |
| `backend/planes/serializers_plantillas.py` | Validación de plantillas de correo usadas por los planes. |
| `backend/planes/servicios.py` | Reglas de negocio y acciones de planes, sesiones y notificaciones. |
| `backend/planes/plantillas_correo.py` | Construcción del contenido de los correos de planes. |
| `backend/planes/admin.py` | Registro y configuración de modelos de planes en Django Admin. |
| `backend/planes/apps.py` | Configuración de la aplicación Django de planes. |
| `backend/planes/urls.py` | Rutas de planes, sesiones e informes. |
| `backend/planes/views.py` | Vistas/endpoints de consulta y gestión de planes de acompañamiento. |
| `backend/planes/views_plantillas.py` | Vistas/endpoints para administrar plantillas de correo. |
| `backend/planes/management/commands/enviar_recordatorios_sesiones.py` | Envía recordatorios de sesiones según las reglas del dominio. |
| `backend/planes/management/commands/seed_demo_informes.py` | Carga datos de demostración para informes. |

#### Seguimiento académico

| Módulo | Responsabilidad |
|---|---|
| `backend/seguimiento/models.py` | Modelos de seguimiento de tutorías y actividad académica. |
| `backend/seguimiento/serializers.py` | Validación y representación de datos de seguimiento. |
| `backend/seguimiento/servicios.py` | Operaciones de negocio para el seguimiento. |
| `backend/seguimiento/alertas.py` | Determina y gestiona alertas relacionadas con el seguimiento. |
| `backend/seguimiento/admin.py` | Registro y configuración de modelos de seguimiento en Django Admin. |
| `backend/seguimiento/apps.py` | Configuración de la aplicación Django de seguimiento. |
| `backend/seguimiento/urls.py` | Rutas de los recursos de seguimiento. |
| `backend/seguimiento/views.py` | Vistas/endpoints de seguimiento, notas y asistencia. |

Los archivos `__init__.py` de `backend/config/`, `backend/config/settings/` y las
aplicaciones declaran los paquetes Python; no agregan lógica de negocio.

#### Usuarios, autenticación y permisos

| Módulo | Responsabilidad |
|---|---|
| `backend/usuarios/models.py` | Modelo de usuario, perfil y datos asociados a las cuentas. |
| `backend/usuarios/roles.py` | Catálogo de roles y constantes del dominio. |
| `backend/usuarios/permisos.py` | Políticas de autorización reutilizables para la API. |
| `backend/usuarios/serializers.py` | Validación y representación de usuarios y solicitudes de autenticación. |
| `backend/usuarios/autenticacion.py` | Lógica de inicio de sesión y emisión de credenciales. |
| `backend/usuarios/mfa.py` | Verificación en dos pasos (TOTP con QR): alta, desafío de login, códigos de recuperación y anti-replay. |
| `backend/usuarios/views_mfa.py` | Endpoints `/auth/mfa/*` (verificar, configurar, activar, desactivar, códigos de recuperación). |
| `backend/usuarios/recuperacion.py` | Flujo de recuperación y actualización de contraseña. |
| `backend/usuarios/correo.py` | Envío y composición de mensajes de correo de usuario. |
| `backend/usuarios/servicios.py` | Operaciones de negocio compartidas para usuarios. |
| `backend/usuarios/excepciones.py` | Excepciones propias del dominio de usuarios. |
| `backend/usuarios/auditoria.py` | Registro de eventos de auditoría de usuarios y permisos. |
| `backend/usuarios/gestion_estado.py` | Cambios y reglas del estado de las cuentas. |
| `backend/usuarios/gestion_roles.py` | Asignación y actualización de roles de usuario. |
| `backend/usuarios/gestion_tutores.py` | Habilitación y gestión del perfil de tutores. |
| `backend/usuarios/signals.py` | Reacciones del dominio a eventos del ciclo de vida de modelos. |
| `backend/usuarios/admin.py` | Registro y configuración de usuarios en Django Admin. |
| `backend/usuarios/apps.py` | Configuración de la aplicación Django de usuarios. |
| `backend/usuarios/urls.py` | Rutas de autenticación y operaciones generales de usuario. |
| `backend/usuarios/urls_estudiantes.py` | Rutas de gestión de estudiantes. |
| `backend/usuarios/urls_roles.py` | Rutas de consulta y asignación de roles. |
| `backend/usuarios/urls_tutores.py` | Rutas de gestión de tutores. |
| `backend/usuarios/views.py` | Vistas/endpoints de registro, sesión, verificación, recuperación y perfil propio. |
| `backend/usuarios/views_auditoria.py` | Vistas/endpoints de consulta de auditoría. |
| `backend/usuarios/views_estudiantes.py` | Vistas/endpoints administrativos de estudiantes. |
| `backend/usuarios/views_roles.py` | Vistas/endpoints de roles y administración de usuarios. |
| `backend/usuarios/views_tutores.py` | Vistas/endpoints de administración de tutores. |

### Frontend (React Native / Expo)

#### Arranque, navegación y estado

| Módulo | Responsabilidad |
|---|---|
| `frontend/index.ts` | Registra el punto de entrada de la aplicación Expo. |
| `frontend/src/App.tsx` | Compone proveedores globales, control de inactividad y navegación raíz. |
| `frontend/src/navigation/RootNavigator.tsx` | Define las rutas y el flujo de navegación de la aplicación. |
| `frontend/src/navigation/ref.ts` | Expone la referencia de navegación para uso fuera de componentes. |
| `frontend/src/store/session.tsx` | Mantiene la sesión, el usuario autenticado y las acciones asociadas. |
| `frontend/src/hooks/useCarga.ts` | Encapsula el estado común de carga, datos y errores asíncronos. |

#### Cliente de API

| Módulo | Responsabilidad |
|---|---|
| `frontend/src/api/client.ts` | Configura el cliente HTTP común y su comportamiento base. |
| `frontend/src/api/authFetch.ts` | Realiza solicitudes autenticadas y gestiona credenciales de sesión. |
| `frontend/src/api/auth.ts` | Operaciones de registro, inicio/cierre de sesión (incluye el 2.º paso MFA) y recuperación. |
| `frontend/src/api/mfa.ts` | Alta, baja y códigos de recuperación de la verificación en dos pasos. |
| `frontend/src/api/academico.ts` | Solicitudes de estructura, catálogos y datos académicos. |
| `frontend/src/api/perfil.ts` | Lectura y actualización de los perfiles personales. |
| `frontend/src/api/planes.ts` | Solicitudes de planes, sesiones e informes de acompañamiento. |
| `frontend/src/api/plantillas.ts` | Operaciones de plantillas de correo. |
| `frontend/src/api/seguimiento.ts` | Solicitudes de seguimiento, asistencia y alertas. |
| `frontend/src/api/tutores.ts` | Operaciones relacionadas con tutores y disponibilidad. |
| `frontend/src/api/usuarios.ts` | Operaciones administrativas de usuarios y roles. |

#### Componentes reutilizables

| Módulo | Responsabilidad |
|---|---|
| `frontend/src/components/Aviso.tsx` | Presenta avisos y mensajes de estado. |
| `frontend/src/components/Button.tsx` | Botón reutilizable con variantes visuales y estados. |
| `frontend/src/components/Chip.tsx` | Etiqueta compacta para valores y filtros. |
| `frontend/src/components/EmbeddedScreenFrame.tsx` | Aloja una pantalla dentro de un marco adaptable. |
| `frontend/src/components/EstadoBadge.tsx` | Representa visualmente estados de dominio. |
| `frontend/src/components/FormModal.tsx` | Estructura modal reutilizable para formularios. |
| `frontend/src/components/InactividadGate.tsx` | Controla el flujo cuando la sesión queda inactiva. |
| `frontend/src/components/ModalLayoutContext.ts` | Comparte el contexto de diseño y distribución de modales. |
| `frontend/src/components/Screen.tsx` | Proporciona la estructura común de una pantalla. |
| `frontend/src/components/SwitchField.tsx` | Campo reutilizable de selección booleana. |
| `frontend/src/components/TextField.tsx` | Campo de texto reutilizable para formularios. |

#### Pantallas y vistas

| Módulo | Responsabilidad |
|---|---|
| `frontend/src/screens/HomeScreen.tsx` | Selecciona y muestra el inicio correspondiente al usuario y su rol. |
| `frontend/src/screens/LoginScreen.tsx` | Formulario de inicio de sesión. |
| `frontend/src/screens/RegistroScreen.tsx` | Formulario de creación de cuenta. |
| `frontend/src/screens/auth/NuevaContrasenaScreen.tsx` | Permite establecer una contraseña nueva. |
| `frontend/src/screens/auth/RecuperarContrasenaScreen.tsx` | Solicita el correo de recuperación de contraseña. |
| `frontend/src/screens/auth/RegistroExitoScreen.tsx` | Confirma el registro y orienta sobre el siguiente paso. |
| `frontend/src/screens/auth/VerificarCorreoScreen.tsx` | Confirma el estado y las acciones de verificación del correo. |
| `frontend/src/screens/academica/AsistenciaScreen.tsx` | Consulta y gestiona asistencia académica. |
| `frontend/src/screens/academica/CatalogoScreen.tsx` | Administra catálogos académicos. |
| `frontend/src/screens/academica/EstructuraScreen.tsx` | Administra los componentes de la estructura académica. |
| `frontend/src/screens/academica/FichaEstudianteScreen.tsx` | Presenta la ficha académica de un estudiante. |
| `frontend/src/screens/academica/GestionAcademicaScreen.tsx` | Agrupa herramientas de gestión académica. |
| `frontend/src/screens/academica/InstitucionScreen.tsx` | Consulta y administra los datos institucionales y sedes. |
| `frontend/src/screens/academica/PeriodosScreen.tsx` | Administra períodos académicos. |
| `frontend/src/screens/academica/PlantillasCorreoScreen.tsx` | Administra las plantillas de correo institucionales. |
| `frontend/src/screens/academica/ReglasAcademicasScreen.tsx` | Configura reglas académicas. |
| `frontend/src/screens/academica/TableroScreen.tsx` | Muestra indicadores y resúmenes académicos. |
| `frontend/src/screens/dashboard/HomeDashboardPanels.tsx` | Organiza los paneles del tablero de inicio. |
| `frontend/src/screens/dashboard/HomeMainContent.tsx` | Presenta el contenido principal del inicio. |
| `frontend/src/screens/dashboard/HomeResponsiveLayout.tsx` | Adapta el inicio a distintos tamaños de pantalla. |
| `frontend/src/screens/dashboard/HomeStudentPanel.tsx` | Presenta el panel de inicio específico del estudiante. |
| `frontend/src/screens/informes/InformeBitacoraCard.tsx` | Presenta una tarjeta de informe de bitácora. |
| `frontend/src/screens/informes/InformesScreen.tsx` | Consulta y organiza informes. |
| `frontend/src/screens/informes/InformesStyles.ts` | Define estilos compartidos por las vistas de informes. |
| `frontend/src/screens/informes/InformeTablas.tsx` | Presenta tablas de datos de informes. |
| `frontend/src/screens/notificaciones/CentroNotificacionesPanel.tsx` | Presenta el panel del centro de notificaciones. |
| `frontend/src/screens/perfil/DatosPersonalesScreen.tsx` | Consulta y actualiza datos personales. |
| `frontend/src/screens/perfil/SeguridadMfa.tsx` | Activa con código QR, renueva códigos de recuperación y desactiva la verificación en dos pasos. |
| `frontend/src/screens/perfil/MiFichaScreen.tsx` | Muestra la ficha del usuario autenticado. |
| `frontend/src/screens/perfil/PerfilTutorScreen.tsx` | Consulta y administra el perfil del tutor. |
| `frontend/src/screens/planes/PlanDetalleScreen.tsx` | Presenta el detalle de un plan de acompañamiento. |
| `frontend/src/screens/planes/PlanesScreen.tsx` | Lista y gestiona planes de acompañamiento. |
| `frontend/src/screens/planes/PlanRefuerzoScreen.tsx` | Consulta y gestiona planes de refuerzo. |
| `frontend/src/screens/tutorias/AgendaScreen.tsx` | Presenta la agenda de tutorías. |
| `frontend/src/screens/tutorias/AsistenciaTutoriaScreen.tsx` | Registra y consulta la asistencia a tutorías. |
| `frontend/src/screens/tutorias/DisponibilidadTutorScreen.tsx` | Consulta y administra la disponibilidad del tutor. |
| `frontend/src/screens/tutorias/ProgramarSesionScreen.tsx` | Programa sesiones de tutoría. |
| `frontend/src/screens/usuarios/AsignarRolScreen.tsx` | Permite asignar o modificar roles de usuario. |

#### Presentación, tipos y utilidades

| Módulo | Responsabilidad |
|---|---|
| `frontend/src/theme/index.ts` | Define tokens de color, tipografía y espaciado de la interfaz. |
| `frontend/src/types/roles.ts` | Declara los tipos compartidos para roles de usuario. |
| `frontend/src/utils/config.ts` | Resuelve la configuración de ejecución del cliente. |
| `frontend/src/utils/errores.ts` | Normaliza errores de API para mostrarlos en la interfaz. |

### Scripts de desarrollo y despliegue

| Módulo | Responsabilidad |
|---|---|
| `scripts/setup.ps1` | Prepara dependencias y archivos de entorno locales. |
| `scripts/setup-local-cert.ps1` | Genera el certificado HTTPS local de Nginx con mkcert. |
| `scripts/setup-db.ps1` | Prepara la base PostgreSQL local y aplica migraciones. |
| `scripts/dev-api.ps1` | Inicia la API local con la configuración de desarrollo. |
| `scripts/dev-client.ps1` | Inicia el cliente Expo en web o móvil. |
| `scripts/build-apk.ps1` | Construye el paquete Android de la aplicación. |
| `scripts/deploy-railway.ps1` | Ejecuta el flujo de despliegue a Railway. |
| `scripts/watch-deploy-railway.ps1` | Supervisa el resultado del despliegue en Railway. |

El contenedor del backend se define en `backend/Dockerfile`: instala dependencias de
producción, recopila estáticos de Django, ejecuta el proceso con un usuario sin privilegios
y delega migraciones e inicio al `backend/entrypoint.sh`.

## Convenciones

- **Base de datos:** PostgreSQL. La API se configura con una única variable
  `DATABASE_URL` con esquema `postgres://` (ver `backend/.env.example`).
- Las migraciones viven en cada app Django (`backend/<app>/migrations/`);
  no hay SQL manual del esquema.
- Cada historia de usuario (HU) se implementa en su app en `backend/` y su
  carpeta de pantallas/servicios correspondiente en `frontend/src/`.

## Puesta en marcha (Windows / PowerShell)

Requisitos: Python 3.12+, Node 20+ y PostgreSQL (con `psql` en el PATH).

```powershell
.\scripts\setup.ps1        # dependencias + crea backend\.env y frontend\.env
.\scripts\setup-db.ps1     # crea el rol y la base tutorias_db y migra (pide la clave de postgres)
.\scripts\dev-api.ps1      # migra y levanta la API en :8001
.\scripts\dev-client.ps1   # abre solo la web en :8081
.\scripts\dev-client.ps1 mobile # abre Expo Go/Metro para móvil en :8082
```

### Backend local con Docker

Alternativamente, puedes ejecutar el backend y sus dependencias en Docker Desktop, sin conectar
la API a Railway ni instalar PostgreSQL localmente. Primero asegúrate de que `backend\.env` existe
(créalo con `.\scripts\setup.ps1` si hace falta) y que Docker Desktop está iniciado:

```powershell
docker compose --profile local-https up -d --build
docker compose ps
```

La aplicacion usa `https://localhost:8446/api/`; comprueba el estado en
`https://localhost:8446/api/health/?db=1`. El acceso directo local a Django es HTTP en `http://127.0.0.1:8448/`. Mailpit esta en
`http://localhost:8026`. PostgreSQL conserva sus datos en `postgres_data`.

#### Frontend web local con HTTPS

Para uso local se genera un certificado autofirmado persistente en volúmenes Docker. No se necesita instalar mkcert.

Comando: docker compose --profile local-https up -d --build

Abre `http://localhost:8445` para redirigir al frontend HTTPS, o `https://localhost:8446`
directamente. Django atiende por HTTP en `http://127.0.0.1:8448/`; el frontend reenvia `/api/`
al backend por HTTP dentro de la red Docker. No hay Nginx ni certificados en el contenedor Django.
El HTTPS local del frontend usa un certificado autofirmado; Render administra el HTTPS publico
del backend fuera del contenedor.

Para detener también el frontend:

```powershell
docker compose --profile local-https down
```

Para detener los servicios sin borrar los datos:

```powershell
docker compose down
```

No uses `docker compose down -v` salvo que quieras borrar también la base de datos local. Para
ver los registros del backend ejecuta `docker compose logs -f backend`.

La base debe existir y el usuario indicado en `backend\.env` debe tener permiso para crear tablas en
`public`. Si la base ya existe y `migrate` devuelve `permission denied for schema public`, ejecuta
como propietario o administrador en esa base `GRANT CREATE ON SCHEMA public TO tutorias_user;`.
`dev-api.ps1` no inicia el servidor en `:8001` si las migraciones fallan.

Los comandos de Django deben usar el entorno virtual de `backend`. Para activarlo manualmente en
PowerShell, ejecuta `.\backend\.venv\Scripts\Activate.ps1` desde la raíz del proyecto, o
`.\.venv\Scripts\Activate.ps1` desde `backend/`. También puedes ejecutar comandos sin activarlo con
`backend\.venv\Scripts\python.exe backend\manage.py check` desde la raíz. Si falta alguna dependencia,
vuelve a ejecutar `.\scripts\setup.ps1` desde la raíz del proyecto.

También puedes iniciar el cliente directamente desde `frontend/` con `npm run web` (web) o
`npm run mobile` (móvil). En web, recarga la página con el navegador o espera la actualización
automática; la tecla `r` de Expo intenta recargar clientes React Native conectados y no el navegador.

### Variables de entorno

| Archivo            | Variable               | Descripción                                   |
|--------------------|------------------------|-----------------------------------------------|
| `backend/.env`         | `SECRET_KEY`           | Clave secreta de Django                       |
|                    | `DEBUG`                | `True` solo en local                          |
|                    | `ALLOWED_HOSTS`        | Hosts permitidos, separados por coma          |
|                    | `DATABASE_URL`         | `postgres://usuario:clave@host:5432/base`     |
|                    | `CORS_ALLOWED_ORIGINS` | Orígenes del cliente                          |
| `frontend/.env`      | `EXPO_PUBLIC_API_URL`  | URL base de la API                            |

Los `.env` no se versionan; los `.env.example` sí.

En desarrollo, el cliente adapta una URL `localhost` a la IP local de Expo para que un teléfono
físico pueda alcanzar la API; el servidor Django debe estar iniciado en el puerto `8001` y ser
accesible en la red local.
El navegador sí aplica CORS, por eso el perfil local de Django permite orígenes de Expo en
`localhost` y en direcciones IPv4 privadas. La app nativa de React Native no aplica CORS.
Las compilaciones de producción deben usar la URL HTTPS pública de la API.

### Base de datos local

```powershell
.\scripts\setup-db.ps1   # crea rol tutorias_user + base tutorias_db y corre las migraciones
```

Herramienta de migraciones: **Django** (`python manage.py makemigrations` / `migrate`),
dentro de `backend/`. `scripts\setup-db.ps1` solo crea rol y base locales; el esquema lo gestionan las migraciones.

## Calidad de código

| Componente | Lint                    | Formato                       | Pruebas                |
|------------|-------------------------|-------------------------------|------------------------|
| `backend/`     | `ruff check .`          | `ruff format .`               | `python -m pytest`     |
| `frontend/`  | `npm run lint`          | `npm run format`              | `npm test`             |

El cliente además tiene `npm run typecheck`. Ejecuta los comandos de `backend/` con el venv activo (`backend\.venv`).
