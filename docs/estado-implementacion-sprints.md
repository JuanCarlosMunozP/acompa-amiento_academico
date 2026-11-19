# Estado de implementación de los sprints

Este documento registra solo trabajo cuya implementación se puede localizar en el código actual.
No cambia estados en Jira y no considera terminado un sprint completo por haber implementado algunas
historias. Los tickets que no aparecen aquí siguen pendientes de revisión e implementación.

## Trabajo del tablero implementado

| Ticket / historia | Implementación disponible | Evidencia principal |
|---|---|---|
| PTA-652 · HU-05.06 Bitácora de la sesión | El tutor puede registrar una bitácora al cerrar una sesión asignada. | `backend/planes/models.py` (`BitacoraSesion`), `backend/planes/views.py` (`cerrar_sesion`) |
| PTA-653 · HU-05.06.T1 Modelo de bitácora | Se conserva una bitácora por sesión con temas, desarrollo, acuerdos, observaciones y fecha de cierre. | `backend/planes/models.py`, migración `0006_bitacora_y_materiales_sesion` |
| PTA-654 · HU-05.06.T2 Formulario de cierre | La agenda del tutor muestra el formulario de cierre y la pantalla de informes permite consultar los registros. | `frontend/src/screens/AgendaScreen.tsx`, `frontend/src/screens/InformesScreen.tsx` |
| PTA-655 · HU-05.07 Material de la sesión | Cada sesión muestra materiales autorizados para descargar; el tutor puede subirlos. | `backend/planes/models.py` (`MaterialSesion`), `backend/planes/views.py` |
| PTA-656 · HU-05.07.T1 Carga y descarga autorizada | La carga y descarga requieren autenticación y acceso a la sesión correspondiente. | `backend/planes/views.py` (`subir_material_sesion`, `descargar_material_sesion`) |
| PTA-658–661 · HU-06.01 Evaluación posterior a la recuperación | Se registra la nota posterior, se calcula la mejora y se valida el umbral de progreso. | `backend/seguimiento/models.py`, `backend/seguimiento/views.py`, `frontend/src/screens/PlanDetalleScreen.tsx` |
| PTA-662–664 · HU-06.02 Tablero de coordinación | El reporte consolida indicadores institucionales, con desgloses por grupo y estado de desempeño. | `backend/seguimiento/views.py` (`tablero`), `frontend/src/screens/InformesScreen.tsx` |
| PTA-665–667 · HU-06.03 Reporte de asistencia del acompañamiento | El reporte incluye consulta comparada y una vista tabular de asistencia. | `backend/seguimiento/views.py`, `frontend/src/screens/InformesScreen.tsx` |
| PTA-668–670 · HU-06.04 Reporte por asignatura | El reporte agrega resultados por asignatura y presenta su detalle. | `backend/seguimiento/views.py`, `frontend/src/screens/InformesScreen.tsx` |
| PTA-671–673 · HU-06.05 Reporte del tutor | Rectoría/coordinación consultan el reporte institucional; el tutor queda limitado a sus propios informes. | `backend/planes/views.py` (`informes_bitacoras`), `frontend/src/screens/InformesScreen.tsx` |
| PTA-674–675 · HU-06.06 Exportación | Los reportes disponibles se pueden descargar en CSV. | `backend/seguimiento/views.py`, `frontend/src/screens/InformesScreen.tsx` |
| PTA-676 · EP-07 Notificaciones del proceso de acompañamiento | Las notificaciones se generan dentro de los flujos del proceso y se consultan desde Inicio; no se presenta un módulo independiente. | `backend/planes/models.py`, `backend/planes/views.py`, `backend/usuarios/views.py`, `docs/api-planes.md` |
| Sprints 4–6 · Preferencias y recordatorios | Preferencias por tipo de aviso, historial personal y comando idempotente para avisos de sesiones dentro de 24 horas. | `backend/planes/management/commands/enviar_recordatorios_sesiones.py`, `frontend/src/screens/CentroNotificacionesPanel.tsx` |
| Sprints 4–6 · Permisos y auditoría | Matriz de capacidades por rol, consulta de auditoría para coordinación/administración y trazabilidad de operaciones sensibles. | `backend/usuarios/permisos.py`, `backend/usuarios/views_auditoria.py`, `docs/matriz-permisos-piloto.md` |
| Sprints 4–6 · Plantillas y umbrales | Plantillas editables para asignación de planes con variables limitadas; coordinación consulta y administración modifica reglas académicas. | `backend/planes/views_plantillas.py`, `backend/seguimiento/views.py`, `frontend/src/screens/PlantillasCorreoScreen.tsx`, `frontend/src/screens/ReglasAcademicasScreen.tsx` |
| PTA-683–685 · HU-07.T6–T8 Alertas de reglas académicas | Al registrar o corregir notas, asistencia o trabajos, las alertas vigentes del motor de reglas se publican una sola vez como avisos de tipo `alerta` para coordinación y administración; la bandeja filtra con `GET /mis-notificaciones/?tipo=alerta` y el centro de notificaciones ofrece «Solo alertas académicas». | `backend/seguimiento/alertas.py`, `backend/planes/views.py` (`mis_notificaciones`), `frontend/src/screens/notificaciones/CentroNotificacionesPanel.tsx`, `backend/tests/test_alertas_academicas.py` |
| PTA-681 · HU-07.T4 Programación de recordatorios | `entrypoint.sh` ejecuta `enviar_recordatorios_sesiones` cada 15 minutos (`RECORDATORIOS_INTERVALO_SEGUNDOS`, 0 lo desactiva). | `backend/entrypoint.sh` |
| Sprint 6 · Tutorías abiertas | Publicación y búsqueda de cupos, reserva, lista de espera, promoción al cancelar, privacidad del tutor y orden local que prioriza valoraciones/disponibilidad. | `backend/planes/views.py`, `backend/planes/models.py`, `frontend/src/screens/HomeStudentPanel.tsx`, `frontend/src/screens/DisponibilidadTutorScreen.tsx` |

Los tickets de estas filas tienen respaldo de implementación, pero este registro no sustituye la
revisión de aceptación de cada historia ni confirma que su estado en Jira haya sido actualizado.

## Ajustes de acceso y experiencia documentados

- **Solicitudes y planes:** rectoría/coordinación revisan solicitudes de tutoría y asignan tutores;
  cada tutor consulta sus planes asignados.
- **Agenda:** el tutor consulta solo sus sesiones asignadas y el estudiante solo las tutorías de sus
  planes. Rectoría y coordinación no tienen acceso a esas agendas personales.
- **Asistencia y valoración:** el estudiante confirma asistencia al finalizar la tutoría. Si marca
  que asistió, puede calificar al tutor de una a cinco estrellas y dejar un comentario sobre la
  metodología.
- **Informes:** el tutor registra y consulta sus propios informes; rectoría y coordinación pueden
  consultar y corregir informes. La edición abre un modal. Los filtros institucionales se vacían
  después de buscar, mientras los resultados conservan los criterios de esa consulta.
- **Desempeño personal:** el estudiante ve su resumen de tutorías en Mi perfil; el tutor ve su
  propio resumen como docente y las valoraciones recibidas.
- **Interfaz académica:** los accesos se presentan según el rol. “Mi perfil” reemplaza “Mis datos” y
  las notificaciones se muestran dentro del flujo, sin un módulo de navegación separado.

## Trabajo restante

Este registro acredita la implementación localizada y probada, no la aceptación formal de todos los
tickets ni un cambio de estado en Jira. Las historias que no se identifican explícitamente en este
documento requieren contrastar sus criterios de aceptación antes de marcarlas como completas.

## Verificación del código descrito

En la validación de estos cambios pasaron 57 pruebas enfocadas de API, `manage.py check`,
`makemigrations --check --dry-run`, compilación de módulos Python, TypeScript, ESLint y Prettier
para los archivos de cliente modificados. La prueba completa del cliente/API y la programación en
un entorno de despliegue deben validarse por separado.
