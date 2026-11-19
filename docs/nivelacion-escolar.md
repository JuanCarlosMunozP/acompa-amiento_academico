# Nivelación escolar: alcance, roles y API

El producto pasó de «tutorías académicas» a **seguimiento de la nivelación de estudiantes con
desempeños no alcanzados**: en un colegio la tutoría abierta no es viable, pero el docente sí debe
registrar, acompañar y cerrar el proceso de nivelación de cada estudiante y dejar evidencia para la
institución.

El nombre del repositorio y los identificadores internos se conservan por compatibilidad: el
modelo `PlanRefuerzo` es el **expediente de nivelación** (un estudiante, un área y un periodo) y el
rol `tutor` del backend se presenta como **Docente** en la aplicación.

## Tres procesos

| Proceso | Qué incluye | Dónde |
|---|---|---|
| **1. Registro** | Datos del estudiante, área, periodo, docente y desempeños pendientes. | `POST /planes/` |
| **2. Acompañamiento** | Plan y actividades, dudas, entregas, retroalimentación y correcciones. | `/planes/{id}/actividades/`, `/dudas/`, `/actividades/{id}/entregas/` |
| **3. Cierre** | Valoración descriptiva, nota 1,0–5,0, visto bueno y reporte institucional. | `/planes/{id}/cerrar/`, `/visto-bueno/`, `/reporte/` |

Estados del expediente: `pendiente` (sin docente, lo registró coordinación) → `asignado`
(en acompañamiento) → `cerrado`; `cancelado` desde los dos primeros. El resto de las reglas
(un expediente vigente por estudiante, área y periodo; bloqueo tras el cierre) no cambió.

## Roles

| Rol (interfaz) | Código | Qué hace |
|---|---|---|
| Docente | `tutor` | Estructura y planea: identifica desempeños, estudiantes y grados; crea el plan y las actividades; retroalimenta; valora y cierra. |
| Estudiante | `estudiante` | Consulta su plan, pregunta y carga actividades y correcciones. |
| Acudiente | `acudiente` | Consulta y acompaña el proceso del estudiante vinculado; no modifica el plan ni las notas. |
| Coordinador | `coordinador` | Verifica procesos y evidencias, consulta reportes, registra observaciones y visto bueno, hace el seguimiento institucional. |
| Administrador | `administrador` | Gestiona usuarios, roles, permisos, periodos, grados, áreas y parámetros; puede ser un coordinador autorizado o un administrativo designado (rector, ingeniero de software). |

La matriz completa está en [matriz-permisos-piloto.md](matriz-permisos-piloto.md).

## Endpoints nuevos o modificados

Base `/api`, todos con sesión.

| Método y ruta | Quién | Descripción |
|---|---|---|
| `POST /planes/` `{estudiante, asignatura, objetivos, desempenos_no_alcanzados, fecha_inicio, fecha_fin, periodo?}` | Docente, coordinación, administrador | Registra el expediente. Si lo registra un **docente**, queda asignado a él (`asignado`). El estudiante **ya no** puede solicitarlo. |
| `PATCH /planes/{id}/` | Docente responsable (en acompañamiento); coordinación (si está pendiente) | Edita objetivos, desempeños y fechas. |
| `GET /mis-planes/` | Docente, estudiante, acudiente | Los expedientes propios; el acudiente ve los de sus estudiantes vinculados. |
| `GET/POST /planes/{id}/dudas/` | Lee: quien ve el expediente. Escribe: estudiante y docente responsable | Mensajes con `respuesta_a` opcional. Solo mientras está en acompañamiento. |
| `GET/POST /actividades/{id}/entregas/` | Lee: quien ve el expediente. Carga: el estudiante (multipart `archivo`, `comentario?`) | La primera carga es `entrega`; solo se acepta otra (`correccion`) cuando el docente pidió corregir la última. |
| `POST /entregas/{id}/retroalimentacion/` `{comentario, requiere_correccion}` | Docente responsable | Si no pide corrección, la actividad queda cumplida. Solo sobre la entrega más reciente. |
| `GET /entregas/{id}/descargar/` | Quien ve el expediente | Descarga autenticada del archivo. |
| `POST /planes/{id}/cerrar/` `{valoracion, nota_final, resultado?, forzar?}` | Docente responsable | `valoracion` ≤500; `nota_final` de 1,00 a 5,00; `resultado` se deduce de la nota (≥3,0 = `logrado`) si no se envía. Avisa a estudiante, acudientes y coordinación. |
| `GET/POST /planes/{id}/observaciones/` | Lee: docente responsable y coordinación. Escribe: coordinación | Observaciones institucionales. |
| `POST /planes/{id}/visto-bueno/` | Coordinación, administrador | Solo sobre un expediente cerrado y una sola vez. |
| `GET /planes/{id}/reporte/` (`?formato=html`) | Docente responsable, coordinación | Reporte institucional del expediente cerrado: identificación, síntesis del plan, acompañamiento, resultado y validación. La versión HTML es imprimible, con espacios para la firma del docente y el visto bueno de coordinación. |
| `GET /estudiantes/` | Docente, coordinación, administrador | Directorio con búsqueda por nombre, grado y grupo. |
| `GET/POST /vinculos-acudiente/`, `DELETE /vinculos-acudiente/{id}/` | Administrador | Vincula acudientes con estudiantes. También disponible en el admin de Django. |
| `GET /mis-estudiantes-vinculados/` | Acudiente | Estudiantes a su cargo, con grado y grupo. |

## Retirado

- **Tutorías abiertas** (cupos, reservas y lista de espera): rutas `/cupos-abiertos/`,
  `/mis-cupos-abiertos/`, `/mis-reservas-abiertas/`, `/reservas-abiertas/` y sus pantallas. Los
  modelos `CupoTutoria` y `ReservaCupoTutoria` se conservan en la base de datos (sin borrar datos
  existentes) y pueden eliminarse con una migración cuando se confirme que no hacen falta.
- El cierre sin nota: ahora `valoracion` y `nota_final` son obligatorias.
- **Valoración con estrellas de cada sesión**: el estudiante ya no califica al docente al registrar
  su asistencia (`PATCH /sesiones/{id}/asistencia/` solo recibe `estado`), el perfil del docente
  no muestra promedio ni comentarios y el modelo `ValoracionTutoria` se eliminó
  (migración `planes.0016_quitar_valoracion_tutoria`; las valoraciones guardadas se pierden).

## Decisiones y pendientes

- **Encuentros de acompañamiento.** Las sesiones agendadas, su asistencia, bitácora y materiales
  se conservan como encuentros opcionales dentro del acompañamiento. Si el colegio no los usa, se
  pueden ocultar sin tocar el resto del flujo.
- **Reporte.** La firma y el visto bueno se hacen sobre el reporte impreso; el visto bueno
  registrado en el sistema también aparece en el reporte. La firma electrónica queda para una
  fase posterior.
- **Datos personales.** Los expedientes contienen datos de menores de edad: aunque no sean datos
  sensibles, aplican la Ley 1581 de 2012 (habeas data) y la autorización institucional para el
  piloto. El acceso está limitado por rol y vínculo, y las consultas relevantes quedan auditadas.
- **Vínculos de acudiente.** El administrador los gestiona en *Inicio → Acudientes*: elige al
  acudiente (usuario con rol Acudiente) y al estudiante, indica el parentesco y vincula; también
  puede retirar un vínculo. El reporte HTML se abre en una pestaña nueva (web) o se comparte
  como archivo (móvil).
- **Datos demo.** `seed_demo_datos` ahora crea acudientes vinculados, desempeños no
  alcanzados, nota final y visto bueno en los expedientes cerrados, y ya no genera cupos
  abiertos ni valoraciones. `seed_demo_informes` también registra desempeños no alcanzados y
  ya no atribuye el expediente al estudiante.
