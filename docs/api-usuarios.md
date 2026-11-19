# API de usuarios y acceso

Base: `/api`. Los errores usan `{"error": {"code", "message", "details"?}}`.
Los endpoints marcados con 🔒 requieren `Authorization: Bearer <access>`.

## Cuenta y sesión

| Método y ruta | Descripción | Errores frecuentes |
|---|---|---|
| `POST /auth/registro/` | Crea una cuenta de estudiante y envía el correo de verificación. | 400 `validation_error` |
| `POST /auth/verificar-correo/` `{token}` | Verifica el correo con el token del enlace. | 400 `token_invalido`, `token_expirado` |
| `POST /auth/reenviar-verificacion/` `{email}` | Reenvía la verificación. Responde igual exista o no la cuenta. Límite por IP. | 429 |
| `POST /auth/login/` `{email, password}` | Devuelve `access`, `refresh` y `usuario`. 5 fallos bloquean 15 min. **Si la cuenta tiene MFA activo** no emite sesión: devuelve `{mfa_requerido: true, mfa_token}` (ver [Verificación en dos pasos](#verificación-en-dos-pasos-mfa)). | 401 `credenciales_invalidas`, 403 `correo_no_verificado`, 403 `cuenta_desactivada` (solo tras acertar la contraseña), 429 `cuenta_bloqueada` |
| `POST /auth/refresh/` `{refresh}` | Renueva la sesión (el refresh rota en cada uso). | 401 |
| `POST /auth/logout/` `{refresh}` | Invalida el refresh. Idempotente. | — |
| 🔒 `GET /auth/me/` | Datos del usuario autenticado. | 401 |
| 🔒 `PATCH /auth/me/` `{nombres?, apellidos?}` | Edita sus datos personales (se limpian los espacios; máx. 150 caracteres). El correo, el rol y el estado **no** se pueden cambiar aquí. | 400 `validation_error`, 401 |

**Los endpoints públicos ignoran la cabecera `Authorization`**: un access vencido no impide registrarse, iniciar sesión, recuperar la contraseña ni cerrar sesión. Una prueba lo vigila.

Cerrar sesión (`POST /auth/logout/`) solo invalida el refresh del dispositivo: las sesiones de otros dispositivos siguen. El access ya emitido deja de servir cuando vence (15 min).

La sesión vence tras `JWT_INACTIVIDAD_MINUTOS` (30) sin renovarse; el access dura 15 min.

## Verificación en dos pasos (MFA)

**Para qué sirve:** proteger la plataforma (datos académicos de estudiantes, planes, informes) frente al robo de contraseñas — phishing, reutilización de claves, filtraciones. Con MFA, conocer la contraseña **no basta**: hace falta además el teléfono del usuario, que genera un código de 6 dígitos cada 30 s (TOTP, RFC 6238; Google Authenticator, Microsoft Authenticator, Authy…). Es opcional por usuario y se activa desde **Mi perfil → Verificación en dos pasos**, escaneando un código QR.

| Método y ruta | Descripción | Errores frecuentes |
|---|---|---|
| `POST /auth/mfa/verificar/` `{mfa_token, codigo}` | 2.º paso del login: canjea el desafío + un código (de la app o de recuperación) por `access`, `refresh` y `usuario`. Público; límite por IP. | 401 `codigo_mfa_invalido`, 401 `mfa_token_invalido` (vence a los 5 min), 429 `cuenta_bloqueada` |
| 🔒 `POST /auth/mfa/configurar/` | Genera un secreto nuevo (pendiente) y devuelve `qr` (PNG en data URI), `otpauth_uri` y `secreto` (clave manual). | 409 `mfa_ya_activo` |
| 🔒 `POST /auth/mfa/activar/` `{codigo}` | Confirma el alta con un código de la app. Devuelve `codigos_recuperacion` (8, **se muestran una sola vez**). | 400 `codigo_mfa_invalido`, 409 `mfa_no_iniciado` |
| 🔒 `POST /auth/mfa/desactivar/` `{password, codigo}` | Quita el MFA. Exige contraseña **y** código vigente. | 400 `contrasena_incorrecta`, `codigo_mfa_invalido`, 409 `mfa_no_activo` |
| 🔒 `POST /auth/mfa/codigos-recuperacion/` `{password, codigo}` | Invalida los códigos anteriores y entrega 8 nuevos. | igual que desactivar |

`GET /auth/me/` y el `usuario` del login incluyen `mfa_activo`. Los errores de las operaciones con sesión van como **400** (no 401) porque el cliente reintenta los 401 creyendo que el token venció.

**Defensas:**

- El `mfa_token` es un desafío firmado de 5 min que solo prueba "la contraseña fue correcta"; no sirve como token de acceso.
- El secreto TOTP se guarda **cifrado** (Fernet, clave `MFA_CLAVE_CIFRADO`; si está vacía se deriva de `SECRET_KEY`). Los códigos de recuperación solo guardan su huella HMAC.
- Cada código sirve **una vez** (anti-replay por paso de 30 s); se tolera ±1 paso de desfase de reloj (`MFA_VENTANA_PASOS`).
- Los códigos erróneos suman al **mismo bloqueo** que las contraseñas (5 fallos → 15 min). Acertar la contraseña no reinicia ese conteo cuando hay MFA, para que no se pueda adivinar el código con intentos ilimitados. Además hay un límite por IP/usuario (`THROTTLE_MFA`, 10/min).
- Desactivar el MFA o regenerar códigos exige contraseña y código: una sesión robada no puede quitar la protección.
- Auditoría (`EventoAuditoria`): `mfa_activado`, `mfa_desactivado`, `mfa_codigos_regenerados`, `mfa_codigo_recuperacion_usado`, `mfa_restablecido`.
- **Pérdida del teléfono y de los códigos:** un administrador usa la acción *Restablecer verificación en dos pasos* en el admin de Django (queda auditada).
- Recuperar la contraseña por correo **no** desactiva el MFA (si no, quien controle el correo se saltaría el segundo factor).

## Recuperación de contraseña

| Método y ruta | Descripción | Errores frecuentes |
|---|---|---|
| `POST /auth/recuperar/` `{email}` | Envía el correo con el enlace (HTML + texto). Responde igual exista o no la cuenta. Límite por IP. | 429 |
| `POST /auth/recuperar/confirmar/` `{uid, token, password, password_confirmacion}` | Cambia la contraseña. El enlace sirve **una sola vez** y vence a la hora. Levanta el bloqueo y cierra las demás sesiones. | 400 `enlace_invalido`, `validation_error` |

La plantilla del correo está en `backend/usuarios/templates/usuarios/correo/` (`recuperacion.html` y
`.txt`, sobre `base.html`). Nombre y color de la institución: `INSTITUCION_NOMBRE`,
`INSTITUCION_COLOR`.

## Roles institucionales

Roles: `estudiante` (por defecto), `tutor`, `coordinador`, `administrador`. El catálogo vive en
`backend/usuarios/roles.py` y la base de datos rechaza valores fuera de él.

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `GET /roles/` | cualquier usuario | Catálogo: `codigo`, `nombre`, `descripcion`. |
| 🔒 `GET /usuarios/{id}/rol/` | la propia persona, coordinador o administrador | Rol del usuario. 403 si es de otra persona. |
| 🔒 `PUT /usuarios/{id}/rol/` `{rol}` | solo administrador | Asigna el rol y registra el cambio (`CambioRol`). |
| 🔒 `GET /usuarios/?q=&rol=&page=` | administrador, coordinador o tutor | Rectoría/coordinación: listado institucional. Tutor: solo estudiantes activos con planes asignados a su cargo. Lista paginada (20 por página, máx. 50 con `page_size`) con búsqueda por nombre, apellido o correo. |

Reglas de asignación:
- Un administrador **no puede cambiar su propio rol** (403 `no_puedes_cambiar_tu_rol`).
- Asignar el rol que ya tiene es válido y no genera historial.
- El cambio aplica de inmediato: el rol se lee de la base en cada petición.
- El registro público siempre crea estudiantes; el rol nunca viene del cliente.
- El registro genera un aviso interno de bienvenida para el estudiante y alerta a administración/coordinación sobre la nueva cuenta.
- El historial se consulta en el admin de Django (solo lectura).

## Estado de la cuenta (activar y desactivar)

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `GET /usuarios/{id}/estado/` | administrador o coordinador | `{id, email, activo}`. |
| 🔒 `PUT /usuarios/{id}/estado/` `{activo, motivo?}` | solo administrador | Activa o desactiva la cuenta y deja registro (`CambioEstado`: quién, cuándo y por qué). |

Reglas:
- **Nadie puede desactivar su propia cuenta** (403 `no_puedes_cambiar_tu_estado`).
- Al **desactivar**: se cierran todas sus sesiones (el access deja de servir y el refresh se
  invalida), y si es tutor queda no disponible (conserva su habilitación).
- Una cuenta desactivada **no inicia sesión** (403 `cuenta_desactivada`, solo después de acertar
  la contraseña para no delatar qué cuentas existen) ni recibe correos de verificación o recuperación.
- Reactivar no devuelve las sesiones viejas: la persona vuelve a iniciar sesión.
- `GET /usuarios/?activo=true|false` filtra el listado.

## Habilitación institucional de tutores

Un tutor nuevo queda **pendiente**: la institución debe habilitarlo antes de que pueda marcarse
disponible. Las decisiones sobre qué es un "tutor" (docente) y quién habilita las tomó el equipo de
desarrollo (ver pendientes de confirmar con el cliente).

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `PUT /tutores/{id}/habilitacion/` `{habilitado}` | administrador o coordinador | Habilita o retira la habilitación. Guarda quién y cuándo. |
| 🔒 `GET /tutores/?habilitado=false` | administrador o coordinador | **Listado de pendientes de habilitación** (`true` = habilitados). |

- Sin habilitación, `PATCH /perfil-tutor/` con `disponible: true` responde 400.
- Retirar la habilitación deja al tutor no disponible y conserva su perfil y asignaturas.
- Habilitar dos veces no cambia quién ni cuándo habilitó por primera vez.

## Autorización por rol

- **Denegar por defecto:** toda la API exige sesión (`DEFAULT_PERMISSION_CLASSES = IsAuthenticated`).
  Los endpoints públicos declaran `AllowAny` de forma explícita y la lista completa está en
  `tests/test_autorizacion.py` (`PUBLICOS`): una prueba falla si aparece un endpoint abierto que
  no esté ahí.
- **Restringir por rol:** `usuarios/permisos.py` ofrece `rol_requerido(*roles)` y los atajos
  `EsAdministrador`, `EsAdministradorOCoordinador` y `EsTutor`:

  ```python
  @api_view(["POST"])
  @permission_classes([rol_requerido(Rol.TUTOR, Rol.ADMINISTRADOR)])
  def mi_vista(request): ...
  ```
- El rol se lee de la base en cada petición, no del token: degradar un rol o desactivar una
  cuenta surte efecto de inmediato, aunque el token siga vigente.
- Sin sesión responde 401 (`not_authenticated`); con sesión pero sin el rol, 403
  (`permission_denied`) con un mensaje que nombra los roles permitidos.

## Perfil del tutor

Modelos en `backend/usuarios/models.py`:
- `Asignatura`: `nombre` (único sin distinguir mayúsculas) y `activa`. Se desactiva, no se borra.
  La migración `0007` carga 8 materias base (Matemáticas, Español, Inglés, Ciencias Naturales,
  Ciencias Sociales, Física, Química y Biología); se editan desde el panel de administración.
- `PerfilTutor`: uno por usuario con rol tutor (`biografia` hasta 1000 caracteres,
  `asignaturas` y `disponible`). Guardarlo para alguien que no es tutor lanza `ValidationError`.

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `GET /asignaturas/` | cualquier usuario | Asignaturas activas (`id`, `nombre`). |
| 🔒 `GET /perfil-tutor/` | tutor | Su propio perfil. |
| 🔒 `PATCH /perfil-tutor/` `{biografia?, asignaturas?, disponible?}` | tutor | Actualiza solo los campos enviados. `asignaturas` es una lista de ids. |
| 🔒 `GET /tutores/?q=&asignatura=&disponible=&page=` | administrador o coordinador | Tutores activos, paginados y ordenados por apellido. |
| 🔒 `GET /tutores/{id}/perfil/` | administrador o coordinador | Perfil de un tutor (404 si no es tutor). |

Reglas del `PATCH`:
- Para `disponible: true` hace falta al menos una asignatura (400 en `details.disponible`).
- Las asignaturas deben existir y estar activas; los ids repetidos se guardan una vez.
- Una petición inválida no cambia nada (todo ocurre en una transacción).
- El tutor solo modifica su propio perfil; cualquier otro campo enviado se ignora.

## Perfil del estudiante, grado y grupo

- `Grado` (`nombre` único sin distinguir mayúsculas, `orden`, `activo`) y `Grupo` (pertenece a un
  grado; el nombre no se repite dentro del grado). No se pueden borrar si tienen grupos o
  estudiantes. Se crean desde el panel de administración: no hay datos iniciales porque dependen
  de cada colegio.
- `PerfilEstudiante`: uno por usuario con rol estudiante, con su `grupo` (opcional hasta que
  coordinación se lo asigne). El **grado se obtiene del grupo** (`perfil.grado`), así nunca hay un
  grado y un grupo que no correspondan.

### Ficha del estudiante

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `GET /grados/` | cualquier usuario | Grados activos con sus grupos activos. |
| 🔒 `GET /mi-ficha/` | estudiante | Su ficha: datos, `grado` y `grupo` (solo lectura). |
| 🔒 `GET /estudiantes/?q=&grado=&grupo=&sin_grupo=&page=` | administrador o coordinador | Estudiantes activos, paginados. `sin_grupo=true` lista a quienes aún no tienen grupo. |
| 🔒 `GET /estudiantes/{id}/ficha/` | administrador o coordinador | Ficha de un estudiante (404 si no es estudiante). |
| 🔒 `PATCH /estudiantes/{id}/ficha/` `{grupo: id \| null}` | administrador o coordinador | Asigna o quita el grupo. El grupo y su grado deben estar activos. |

El estudiante no puede cambiarse el grupo: lo asigna coordinación.

## Ciclo de vida de los perfiles

Una señal (`usuarios/signals.py`) garantiza que **todo tutor tiene `PerfilTutor` y todo estudiante
`PerfilEstudiante`**, sin importar cómo se creó la cuenta o se cambió el rol (registro, API, panel
de administración o consola):
- Al asignar el rol **tutor** se crea su perfil vacío y **no disponible**.
- Al **quitarle** el rol de tutor el perfil se conserva con sus asignaturas, pero pasa a no
  disponible. Si vuelve a ser tutor recupera el mismo perfil.
- El perfil de estudiante (y su grupo) se conserva aunque la persona cambie de rol.
- La migración `0007` creó los perfiles que faltaban para las cuentas existentes.
