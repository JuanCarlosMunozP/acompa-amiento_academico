# API de planes de refuerzo (EP-04) y ficha completa

> **Vigente: nivelación escolar.** El producto pasó de tutorías académicas a seguimiento de la
> nivelación de estudiantes con desempeños no alcanzados. Donde este documento diga «tutor» léase
> **Docente**, y «plan» es el **expediente de nivelación**. Los cambios de reglas, roles y endpoints
> (registro por el docente, acudiente, dudas, entregas, nota final, visto bueno, reporte) están en
> [nivelacion-escolar.md](nivelacion-escolar.md), que prevalece sobre las filas de abajo.

Base: `/api`. Todos los endpoints exigen sesión (🔒) y siguen el formato de errores de
[api-usuarios.md](api-usuarios.md). Código en `backend/planes/`.

> **Decisiones de diseño.** Las descripciones de las tareas en Jira no estaban disponibles; las
> reglas de abajo (quién crea, qué se valida, cuándo es elegible un tutor) son decisiones de
> desarrollo pensadas para ajustarse.

## Ciclo de un plan

`pendiente` (creado, sin tutor) → `asignado` (con tutor responsable) → `cerrado`.
`cancelado` se alcanza desde pendiente o asignado. Un estudiante tiene **a lo sumo un plan
vigente** (pendiente o asignado) por asignatura y periodo; tras cancelar o cerrar puede crearse otro.

## Crear y consultar planes

| Método y ruta | Descripción |
|---|---|
| 🔒 `POST /planes/` `{estudiante, asignatura, objetivos, desempenos_no_alcanzados, fecha_inicio, fecha_fin, periodo?}` | Docente, coordinación o administrador registran el expediente. Si lo registra un docente queda asignado a él; si no, queda pendiente de docente. **El estudiante ya no puede solicitarlo.** El periodo por defecto es el vigente. |
| 🔒 `GET /planes/?estudiante=&tutor=&periodo=&asignatura=&estado=&page=` | Listado paginado para administrador o coordinación (20, máx. 50). |
| 🔒 `GET /planes/{id}/` | El plan con su historial de asignaciones (la más reciente primero). |
| 🔒 `PATCH /planes/{id}/` | Edita objetivos y fechas, **solo mientras esté pendiente**. |
| 🔒 `POST /planes/{id}/cancelar/` | Cancela un plan vigente. |

**Validaciones al crear:** estudiante activo con **matrícula activa** en el periodo; asignatura
activa; objetivos obligatorios (máx. 1000 caracteres); fechas dentro del periodo, fin no anterior al
inicio y **inicio en día hábil** (fines de semana y días no hábiles registrados se rechazan con el
motivo); sin plan vigente duplicado.

El estudiante debe tener matrícula activa. Cuando el expediente lo registra coordinación queda
pendiente y se notifica a los responsables institucionales. La pantalla de planes institucional permite abrir la
solicitud y asignar uno de los tutores elegibles. La elegibilidad exige que el tutor esté habilitado,
disponible y enseñe la asignatura; se muestran primero quienes tienen menos planes asignados.

## Asignar tutor y notificar

| Método y ruta | Descripción |
|---|---|
| 🔒 `GET /planes/{id}/tutores-elegibles/` | Tutores que pueden tomar el plan, con su `carga` (planes asignados). |
| 🔒 `PUT /planes/{id}/tutor/` `{tutor}` | Asigna o reasigna. Responde `{plan, cambio, notificacion}`. |

Un tutor es **elegible** si está activo, **habilitado** por la institución, **disponible** y dicta la
asignatura del plan. Van primero los de menor carga y luego por apellidos. Asignar a alguien que no
lo es responde 400 `tutor_no_elegible`.

- Asignar de nuevo al mismo tutor es idempotente: `cambio: false`, sin correos ni historial nuevo.
- Cada asignación o reasignación queda en el historial (`asignaciones`: tutor, quién, cuándo,
  si se avisó al tutor).
- **Notificación:** se envía un correo al tutor y otro al estudiante. Administración y
  coordinación pueden editar las dos plantillas de asignación desde Académica > Plantillas de
  correo; las plantillas de autenticación no se exponen. `notificacion` indica cuáles salieron:
  `{"tutor": true, "estudiante": true}`. **Si el correo falla, la asignación no se deshace**: queda
  hecha, se registra el error en el log y `notificacion` trae `false` en lo que no se envió.

## Actividades y cierre (HU-04.03)

Un plan asignado tiene actividades con su fecha límite. Las registra y marca la **coordinación o el
tutor responsable**; el estudiante las ve pero no las modifica. Quien no tenga nada que ver con el
plan recibe 404.

| Método y ruta | Descripción |
|---|---|
| 🔒 `GET /planes/{id}/actividades/` | Actividades (pendientes primero, por fecha límite), con `vencida`. |
| 🔒 `POST /planes/{id}/actividades/` `{titulo, descripcion?, fecha_limite}` | Agrega una. Solo en planes **asignados**. Título ≤120, descripción ≤500; la fecha límite va **dentro del plan** y en **día hábil**. |
| 🔒 `PATCH /actividades/{id}/` `{completada?, titulo?, descripcion?, fecha_limite?}` | Edita o marca como completada (guarda cuándo) o la reabre. Solo mientras el plan esté asignado. |
| 🔒 `POST /planes/{id}/cerrar/` `{valoracion, nota_final, resultado?, forzar?}` | Solo el docente responsable cierra el expediente asignado. **`valoracion`** (≤500) y **`nota_final`** (1,00 a 5,00) obligatorias; `resultado` (`logrado`, `parcial`, `no_logrado`) se deduce de la nota si no se envía. Guarda `fecha_cierre`. Con actividades sin cumplir responde 400 `actividades_pendientes`; se repite con `forzar: true` para confirmarlo. |

La **fecha de cierre de cada actividad** es su `fecha_limite`; la del plan es `fecha_fin` (la real,
`fecha_cierre`, se guarda al cerrar).

**Bloqueo tras el cierre.** Un plan cerrado (o cancelado) no admite nada más: ni actividades nuevas,
ni marcar o editar las existentes, ni editar el plan, ni cambiar el tutor, ni cerrarlo de nuevo
(400). Sigue siendo consultable. El modelo lo expresa con `PlanRefuerzo.admite_cambios`, que
también consultan las sesiones. Al cerrar o cancelar el plan, las sesiones futuras se cancelan.

## Seguimiento del plan en curso (HU-04.04)

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `GET /planes/{id}/seguimiento/` | coordinación, tutor responsable, estudiante del plan | El plan con sus actividades, `puede_gestionar` y el avance. |

La respuesta de seguimiento incluye también `sesiones`, de modo que el estudiante consulte las
fechas, modalidad y lugar o enlace virtual de sus tutorías.

## Disponibilidad, sesiones y agenda (HU-05.01, HU-05.02, HU-05.03)

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `GET /perfil-tutor/disponibilidad/` | tutor | Consulta sus horarios semanales y bloqueos puntuales. |
| 🔒 `PUT /perfil-tutor/disponibilidad/` `{horarios, bloqueos}` | tutor | Reemplaza horarios y bloqueos. Días: lunes=0 a domingo=6; horas en `HH:MM`; los intervalos de un mismo día no pueden cruzarse. |
| 🔒 `GET /planes/{id}/disponibilidad/` | participante del plan o coordinación | Horarios y bloqueos del tutor asignado. |
| 🔒 `GET /planes/{id}/sesiones/` | participante del plan o coordinación | Sesiones ordenadas por inicio. |
| 🔒 `POST /planes/{id}/sesiones/` `{inicio, fin, modalidad, lugar?, enlace_virtual?, notas?}` | tutor responsable o coordinación | Programa una sesión dentro del plan asignado. |
| 🔒 `GET /agenda-sesiones/` | Tutor o estudiante | Tutor: solo sesiones asignadas a su cuenta. Estudiante: las sesiones programadas o realizadas de sus planes. Rectoría y coordinación no tienen acceso a esta agenda. |
| 🔒 `GET /informes-bitacoras/?docente=&grado=&estudiante=&materia=` | Tutor, rectoría o coordinación | Tutor: únicamente informes que registró y de sesiones que tiene asignadas. Rectoría/coordinación: todos los informes o filtrados por nombre del docente/estudiante, grado o materia; la búsqueda admite coincidencias parciales. |
| 🔒 `PATCH /informes-bitacoras/{id}/` `{temas?, desarrollo?, acuerdos?, observaciones?}` | Rectoría o coordinación | Corrige un informe que documenta una tutoría ya realizada cuando el tutor lo solicita. El tutor solo puede consultar; no puede editar. No crea informes. |
| 🔒 `POST /sesiones/{id}/cerrar/` `{temas, desarrollo, acuerdos?, observaciones?}` | Tutor responsable | Registra una sola bitácora/informe al terminar la sesión. No cambia su estado ni registra la asistencia del estudiante. |
| 🔒 `PATCH /sesiones/{id}/` `{inicio?, fin?, modalidad?, lugar?, enlace_virtual?, notas?}` | tutor responsable o coordinación | Reprograma con las mismas validaciones de disponibilidad y cruces. |
| 🔒 `POST /sesiones/{id}/cancelar/` `{motivo}` | tutor responsable o coordinación | Cancela una sesión programada y guarda el motivo. |
| 🔒 `PATCH /sesiones/{id}/asistencia/` `{estado}` | Estudiante del plan | Al terminar la sesión, registra `presente`, `ausente` o `excusa`; la tutoría pasa a `realizada` y no se puede volver a registrar. |

Una sesión debe ser futura, comenzar y terminar el mismo día, quedar dentro de las fechas del
plan y de un horario semanal del tutor, y no cruzarse con un bloqueo ni con otra sesión del tutor
o del estudiante. Las sesiones virtuales requieren `enlace_virtual`; las presenciales requieren
`lugar`. El calendario del plan muestra estas sesiones al estudiante y al tutor. La agenda expone
el conteo de inasistencias de tutoría del estudiante junto a cada sesión; las justificaciones se
registran por separado y no aumentan ese conteo.

Todo plan trae `actividades_total`, `actividades_completadas`, `progreso` (porcentaje, **`null` sin
actividades**, nunca 0) y `atrasado` (plan asignado con alguna actividad vencida sin cumplir, o con la
`fecha_fin` ya pasada).

**Consulta por estado.** `GET /planes/` acepta `estado=` y `atrasado=1`, y devuelve además
`resumen` con el conteo por estado (con los demás filtros aplicados, aunque se filtre por estado).

## Contadores y recuperados (HU-04.04.T2, HU-04.05.T2)

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `GET /planes/contadores/?periodo=` | administrador o coordinador | `total`, `pendientes`, `en_curso` (asignados), `atrasados`, `cerrados`, `cancelados`, `recuperados` (cerrados con resultado logrado), `parciales`, `no_logrados` y `tasa_recuperacion`. |

El periodo por defecto es el vigente (o todos si no hay uno). `tasa_recuperacion` es el porcentaje de
recuperados entre los cerrados y es `null` si aún no hay cerrados (nunca 0 %).

## Mis planes

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `GET /mis-planes/` | docente, estudiante, acudiente | Docente: los expedientes que tiene **asignados**. Estudiante: los suyos. Acudiente: los de sus estudiantes vinculados. Incluye los cerrados con resultado y nota. |

## Notificaciones dentro del flujo

Las notificaciones se generan al crear una cuenta, solicitar tutoría, asignar un tutor y durante el
acompañamiento. No hay una pantalla independiente en la app: las no leídas aparecen como avisos en
Inicio y se marcan como leídas al confirmarlas.

| Método y ruta | Descripción |
|---|---|
| 🔒 `GET /mis-notificaciones/` | Consulta notificaciones del usuario autenticado y su conteo de no leídas. |
| 🔒 `GET /mis-notificaciones/?tipo=alerta` | Igual, filtrado por tipo (`alerta` = alertas del motor de reglas, dirigidas a coordinación/administración). |
| 🔒 `POST /notificaciones/{id}/leer/` | Marca como leída una notificación propia. |
| 🔒 `GET /mis-preferencias-notificacion/` | Consulta preferencias personales por tipo de aviso. |
| 🔒 `PATCH /mis-preferencias-notificacion/` | Actualiza preferencias personales; no puede modificar las de otra cuenta. |

El comando `python manage.py enviar_recordatorios_sesiones` crea avisos idempotentes para las
tutorías programadas en las siguientes 24 horas. En producción debe programarse periódicamente
(por ejemplo, una vez por hora); cada ejecución omite los avisos desactivados por el usuario.

### Plantillas de asignación de planes

| Método y ruta | Descripción |
|---|---|
| 🔒 `GET /plantillas-correo/` | Coordinación y administración consultan los contenidos editables. |
| 🔒 `PATCH /plantillas-correo/{clave}/` | Coordinación y administración editan asunto, texto y HTML; el servidor registra el cambio en auditoría. |

Las claves son `asignacion_tutor` y `asignacion_estudiante`. Los marcadores permitidos incluyen
`{{ nombres }}`, `{{ estudiante }}`, `{{ tutor }}`, `{{ asignatura }}`, `{{ periodo }}`,
`{{ fecha_inicio }}`, `{{ fecha_fin }}`, `{{ objetivos }}`, `{{ app }}` e `{{ institucion }}`.
El servidor rechaza variables desconocidas, escapa los valores interpolados y limita el HTML a
etiquetas y enlaces seguros.

## Ficha completa del estudiante

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `GET /estudiantes/{id}/ficha-completa/?periodo=` | administrador, coordinador; tutor con plan **asignado** a ese estudiante | Datos, grado y grupo del periodo, evaluación con alertas explicadas, asistencia (últimos 30 registros), trabajos sin entregar y planes. |

Un tutor sin un plan asignado con ese estudiante recibe 403, y solo ve **sus** planes en la ficha.
Sin matrícula en el periodo, grado y grupo vienen `null` y no se inventan datos.

## ValoraciÃ³n y desempeÃ±o personal

| MÃ©todo y ruta | QuiÃ©n | DescripciÃ³n |
|---|---|---|
| 🔒 `GET /mi-desempeno-tutorias/` | tutor o estudiante | Resumen limitado a la cuenta autenticada. El estudiante obtiene sus tutorÃ­as realizadas, asistencias y porcentaje de asistencia. El tutor obtiene sus sesiones realizadas, promedio de estrellas, nÃºmero de valoraciones y hasta diez comentarios. |
| 🔒 `PATCH /sesiones/{id}/asistencia/` `{estado, calificacion?, comentario?}` | Estudiante del plan | Confirma `presente`, `ausente` o `excusa` al finalizar y cambia la tutorÃ­a a `realizada`. Si confirma `presente`, puede enviar una calificaciÃ³n de 1 a 5 y un comentario opcional (mÃ¡x. 1000 caracteres) sobre la metodologÃ­a. Solo puede valorar su propia sesiÃ³n y una vez, en la misma operaciÃ³n que registra asistencia. |

En **Mi perfil**, el estudiante ve solo su resumen personal de tutorÃ­as. En el perfil del tutor, el desempeÃ±o corresponde a las sesiones que le asignaron y a las valoraciones recibidas por su cuenta; no se muestran los informes ni las valoraciones de otros tutores. La pantalla de asistencia pregunta por las estrellas y la metodologÃ­a antes de guardar. La calificaciÃ³n es opcional si el estudiante registra ausencia o excusa.

## Datos de demostracion

En desarrollo local, ejecuta python manage.py seed_demo_informes con DEBUG=true para crear una solicitud pendiente, dos planes asignados, dos informes ficticios y una sesión terminada sin informe para probar el formulario. Los registros se vinculan a las cuentas de prueba y el comando es idempotente.

## En la app

Los filtros institucionales de informes se aplican al pulsar **Buscar informes**: los campos quedan
vacíos después de la búsqueda y los resultados continúan usando los criterios aplicados. **Editar
informe** abre un modal con los campos del registro; rectorÃ­a y coordinaciÃ³n pueden corregirlo, el
tutor solo consultarlo.

- **Tablero de desempeño:** al tocar un estudiante, «Abrir ficha completa».
- **Ficha del estudiante:** secciones de desempeño, asistencia, trabajos y planes; coordinación ve
  «Crear plan de refuerzo» si el estudiante tiene matrícula activa.
- **Plan de refuerzo:** formulario con asignatura, objetivos y fechas (AAAA-MM-DD).
- **Expedientes de nivelación** (Inicio): coordinación verifica los expedientes cerrados, deja observaciones y da el visto bueno.
- **Planes de nivelación** (Inicio): el docente ve sus expedientes y registra nuevos desde el directorio de estudiantes; estudiante y acudiente consultan los propios.
- **Informes de acompanamiento**: tutor registra informes de sesiones terminadas; rectoria y coordinacion consultan todos y filtran por docente, grado, estudiante o materia.
- **Seguimiento del plan:** avance, actividades (marcar/reabrir, agregar), cierre con valoración y nota (y confirmación si
  hay pendientes), dudas, entregas y correcciones, verificación de coordinación y, para coordinación, asignar o cambiar el docente.
