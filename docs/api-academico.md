# API académica: estructura (EP-02) y seguimiento (EP-03)

Base: `/api`. Todos los endpoints exigen sesión (🔒) y siguen el formato de errores de
[api-usuarios.md](api-usuarios.md). Los valores decimales (notas, promedios, porcentajes) viajan
como **texto** (`"3.50"`) para evitar errores de redondeo.

> **Decisiones de diseño.** Las descripciones de las tareas en Jira no estaban disponibles; los
> criterios de esta guía (escala de notas, umbrales, quién registra qué) son decisiones de
> desarrollo pensadas para ajustarse. Los umbrales son datos (reglas) y se cambian sin tocar código.

## EP-02: estructura académica

Código en `backend/academico/` (más `Grado`, `Grupo` y `Asignatura` de `backend/usuarios/`).

### Institución y sedes

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `GET /institucion/` | cualquier usuario | Datos de la institución (registro único; se crea con `INSTITUCION_NOMBRE`). |
| 🔒 `PATCH /institucion/` | administrador | Nombre, NIT, dirección, ciudad, teléfono y correo. |
| 🔒 `GET /sedes/?activa=` | cualquier usuario | Sedes (la principal primero). |
| 🔒 `POST /sedes/`, `PATCH /sedes/{id}/` | administrador | Crea o edita. Solo una sede es la principal: marcar otra pasa el cargo. La principal debe estar activa. |

Las sedes no se borran: se desactivan.

### Grados, grupos y asignaturas (administración)

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `GET /admin/grados/?activo=` · `POST` · `PATCH /admin/grados/{id}/` | lee: administrador y coordinador; escribe: administrador | Grados con sus grupos. Nombre único sin distinguir mayúsculas. |
| 🔒 `GET /admin/grupos/?grado=&activo=` · `POST` · `PATCH /admin/grupos/{id}/` | ídem | El nombre del grupo no se repite dentro del grado. Un grupo con estudiantes no cambia de grado. Incluye el conteo de estudiantes matriculados. |
| 🔒 `GET /admin/asignaturas/?activa=` · `POST` · `PATCH /admin/asignaturas/{id}/` | ídem | Catálogo completo. Una asignatura desactivada deja de ofrecerse en `GET /asignaturas/`. |

Nada se borra (los catálogos se desactivan) para no romper el historial.

### Periodos académicos

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `GET /periodos/` | cualquier usuario | Periodos, con `es_actual` (incluye hoy). |
| 🔒 `GET /periodos/actual/` | cualquier usuario | El vigente; 404 `sin_periodo_actual` si hoy no hay. |
| 🔒 `POST /periodos/`, `PATCH /periodos/{id}/` | administrador | Fin no anterior al inicio; **los periodos no se solapan** (pegados sí). |

### Matrícula

Una matrícula une estudiante + periodo + grupo; hay **una por estudiante y periodo**. La
matrícula del periodo vigente actualiza el grupo de la ficha del estudiante.

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `GET /matriculas/?periodo=&grupo=&grado=&estudiante=&estado=&q=&page=` | administrador o coordinador | Listado paginado. |
| 🔒 `POST /matriculas/` `{estudiante, periodo, grupo}` | ídem | Matricula a un estudiante activo en un grupo activo. 400 si ya está matriculado en ese periodo. |
| 🔒 `PATCH /matriculas/{id}/` | ídem | Cambia el grupo o el `estado` (`activa`/`retirada`). El estudiante y el periodo no cambian. |
| 🔒 `POST /matriculas/carga/` `{periodo, csv, simular?}` | ídem | **Carga masiva** (abajo). |

**Carga masiva.** El CSV lleva `correo, nombres, apellidos, grado, grupo` (coma o punto y coma, con
o sin BOM; las columnas pueden ir en otro orden). Máximo 1000 filas. Reglas por fila:
correo válido y del dominio institucional (si está configurado); sin repetidos en el archivo; el
grupo existe y está activo; si el correo ya existe debe ser un estudiante activo que **no esté ya
matriculado en ese periodo**; si es nuevo exige nombres y apellidos.
- **Todo o nada:** si alguna fila falla no se guarda ninguna (400 `carga_invalida` con el detalle
  por fila). Con `simular: true` solo informa (200) para corregir antes de cargar.
- Las cuentas nuevas quedan **sin contraseña** y con el correo sin verificar; no se envían
  correos. La persona entra con «¿Olvidaste tu contraseña?».

### Días no hábiles

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `GET /dias-no-habiles/?desde=&hasta=` | cualquier usuario | Fechas registradas (festivos, cierres). |
| 🔒 `POST /dias-no-habiles/`, `PATCH /dias-no-habiles/{id}/` | administrador | Una fecha no se registra dos veces. |
| 🔒 `GET /dias-no-habiles/verificar/?fecha=AAAA-MM-DD` | cualquier usuario | `{habil, motivo}`. Sábados y domingos no son hábiles. |

**Validación al programar.** `academico.servicios.validar_dia_habil(fecha, campo)` rechaza fechas no
hábiles con 400 y el motivo («El 2026-12-25 no es un día hábil (Navidad).»). Ya la usa la toma de
asistencia y está lista para la programación de tutorías.

## EP-03: seguimiento y desempeño

Código en `backend/seguimiento/`. Escala de notas **1,00 a 5,00** (dos decimales).

### Notas

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `POST /notas/` `{estudiante, asignatura, periodo, valor}` | administrador o coordinador | Una nota por estudiante, asignatura y periodo. Exige matrícula activa en el periodo y asignatura activa. |
| 🔒 `GET /notas/?estudiante=&periodo=&asignatura=` | ídem | Listado paginado. |
| 🔒 `PATCH /notas/{id}/` `{valor, motivo}` | ídem | **Corrección**: exige un motivo (mínimo 5 letras) y el valor debe cambiar. Queda en el historial. |
| 🔒 `GET /notas/{id}/historial/` | ídem | Correcciones (valor anterior y nuevo, motivo, quién, cuándo), de la más reciente a la más antigua. |
| 🔒 `GET /mis-notas/?periodo=` | estudiante | Sus notas y su promedio. |

### Asistencia

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `GET /asistencia/grupo/{grupo}/{fecha}/` | tutor, coordinador, administrador | Lista del grupo ese día con lo ya registrado, y si la fecha es hábil. |
| 🔒 `PUT /asistencia/grupo/{grupo}/{fecha}/` `{registros: [{estudiante, estado}]}` | ídem | Toma o corrige (todo o nada). Solo días hábiles, nunca fechas futuras, solo estudiantes con matrícula activa en ese grupo. |
| 🔒 `GET /estudiantes/{id}/asistencia/?periodo=` | administrador o coordinador | Conteos, porcentaje y registros. |
| 🔒 `GET /mi-asistencia/?periodo=` | estudiante | Lo mismo para sí mismo. |

Estados: `presente`, `tarde`, `ausente`, `excusa`. **Porcentaje** = (presentes + tardes) ÷
(presentes + tardes + ausentes). Las ausencias justificadas (`excusa`) no suman ni restan. Sin
registros contables el porcentaje es `null`, nunca 0.

### Trabajos sin entregar

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `POST /estudiantes/{id}/trabajos/` | tutor, coordinador, administrador | Registra un trabajo pendiente (asignatura, descripción, fecha límite; periodo vigente por defecto). Exige matrícula activa. |
| 🔒 `GET /estudiantes/{id}/trabajos/?entregado=&periodo=` | ídem | Trabajos del estudiante, con `vencido`. |
| 🔒 `PATCH /trabajos/{id}/` | ídem | Marca entregado (guarda la fecha) o reabre. |
| 🔒 `GET /mis-trabajos/` | estudiante | Los suyos. |

La **ficha del estudiante** (`/mi-ficha/`, `/estudiantes/{id}/ficha/`) incluye
`trabajos_pendientes`.

### Motor de reglas académicas

Las reglas son datos (`ReglaAcademica`): tipo, umbral y severidad (`atencion` < `riesgo` <
`critico`). La migración carga estas, editables:

| Tipo | Atención | Riesgo | Crítico | Se activa cuando |
|---|---|---|---|---|
| Nota baja (por asignatura) | < 3,5 | < 3,0 | < 2,0 | el valor es **menor que** el umbral |
| Asistencia baja (%) | < 90 | < 80 | < 70 | el valor es **menor que** el umbral |
| Trabajos sin entregar | ≥ 2 | ≥ 4 | ≥ 6 | la cantidad es **igual o mayor** que el umbral |

Si varias reglas del mismo tipo se activan para lo mismo, se informa solo la más grave. El estado
del estudiante es el de su alerta más grave (`sin_alertas` si ninguna). Sin datos no se inventan
alertas (sin notas, o sin registros de asistencia, esa regla no se evalúa).

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `GET /reglas/?tipo=&activa=` | administrador o coordinador | Reglas. |
| 🔒 `POST /reglas/`, `PATCH /reglas/{id}/` | administrador | El umbral se valida según el tipo (notas 1–5, asistencia 1–100, trabajos entero 1–50). Se desactivan, no se borran. |
| 🔒 `GET /estudiantes/{id}/evaluacion/?periodo=` | administrador o coordinador | Medidas, estado y alertas **con su explicación**. |
| 🔒 `GET /mi-evaluacion/?periodo=` | estudiante | Lo mismo para sí mismo. |

Cada alerta explica qué se midió contra qué umbral y qué regla la marcó, p. ej.: «La nota de
Matemáticas (2.8) es menor que 3, el límite de la regla «Nota en riesgo».»

### Matriz de desempeño

| Método y ruta | Quién | Descripción |
|---|---|---|
| 🔒 `GET /matriz-desempeno/?periodo=&grupo=&grado=&estado=&q=&page=` | administrador o coordinador | Una fila por estudiante con matrícula activa: promedio, % de asistencia, trabajos pendientes, estado y número de alertas. Las más graves primero. Trae `resumen` con el conteo por estado (siempre del total, aunque se filtre). |

Los datos se reúnen con consultas agrupadas (no una por estudiante), y el periodo por defecto es el
vigente.
