# Matriz de permisos del piloto

Los permisos se aplican en la API; ocultar una opción en la aplicación no sustituye la
autorización del servidor. Todas las rutas privadas requieren una cuenta activa y autenticada.
Cuando la acción depende de una entidad concreta, la vista comprueba además la relación del
usuario con el expediente, la sesión, el informe o la ficha.

El rol `tutor` del backend se presenta como **Docente** en la aplicación.

| Capacidad | Estudiante | Acudiente | Docente (`tutor`) | Coordinación | Administrador |
|---|---|---|---|---|---|
| Consultar/actualizar sus datos personales | Propios | Propios | Propios | Propios | Propios |
| Registrar expediente de nivelación (desempeños, área, periodo) | No | No | Sí; queda como docente responsable | Sí; luego asigna docente | Sí; luego asigna docente |
| Consultar el expediente | El propio | Los de estudiantes vinculados | Los que tiene a cargo | Todos | Todos |
| Crear plan y actividades | No | No | En sus expedientes | Sí | Sí |
| Escribir dudas y aclaraciones | Sí, en su expediente | No (solo lee) | Sí, en sus expedientes | No (solo lee) | No (solo lee) |
| Cargar entregas y correcciones | Sí, en su expediente | No | No | No | No |
| Retroalimentar entregas | No | No | Sí, en sus expedientes | No | No |
| Cerrar con valoración y nota (1,0–5,0) | No | No | Sí, en sus expedientes | No | No |
| Registrar observaciones y visto bueno | No | No | Solo lee las observaciones | Sí | Sí |
| Reporte institucional imprimible | No | No | Sus expedientes cerrados | Sí | Sí |
| Directorio de estudiantes (búsqueda) | No | No | Sí | Sí | Sí |
| Consultar ficha completa de un estudiante | Su propia ficha | No | Solo si tiene un plan con esa persona | Institucional | Institucional |
| Vincular acudientes con estudiantes | No | No | No | No | Sí |
| Asignar roles o cambiar estado de cuenta | No | No | No | No | Sí |
| Gestionar periodos, grados, áreas y parámetros | No | No | No | Lectura | Sí |
| Consultar reglas académicas | No | No | No | Sí | Sí |
| Modificar reglas académicas | No | No | No | Lectura solamente | Sí |
| Consultar/editar plantillas de asignación | No | No | No | Sí | Sí |
| Consultar notificaciones y preferencias propias | Sí | Sí | Sí | Sí | Sí |
| Consultar la bitácora de auditoría | No | No | No | Sí | Sí |

## Reglas de alcance

- El **acudiente** solo ve expedientes de estudiantes con vínculo activo (`VinculoAcudiente`),
  creado por el administrador. No puede modificar el plan, las entregas ni las notas; retirar el
  vínculo le quita el acceso de inmediato.
- Los docentes no reciben acceso global por conocer el identificador de un estudiante: el
  expediente y la ficha completa exigen ser el docente responsable. Una consulta fuera de alcance
  se rechaza (404 en recursos de un expediente ajeno).
- Solo el **docente responsable** retroalimenta entregas y cierra el expediente. Coordinación
  verifica (observaciones y visto bueno) pero no altera la valoración ni la nota.
- El visto bueno solo se registra sobre un expediente cerrado y una sola vez.
- Las notificaciones y preferencias se consultan siempre con el identificador del usuario
  autenticado. No se acepta un destinatario en el cuerpo de la solicitud.
- Coordinación y administración pueden consultar informes institucionales; la edición de reglas
  académicas y la administración de roles/cuentas son acciones de administrador.
- Las plantillas de correo editables se limitan a la asignación de planes; las de verificación y
  recuperación de cuentas no se exponen en la aplicación. Los valores HTML se validan contra una
  lista segura de etiquetas, y las variables disponibles están limitadas por el servidor.
- Cada consulta de ficha, cambio de rol, cambio de nota, cierre, visto bueno, retroalimentación y
  consulta del reporte se registra con actor, rol vigente, recurso, fecha y datos mínimos. No se
  guardan contraseñas ni copias de fichas en la bitácora.
- Los archivos de entregas solo se descargan con sesión y con acceso al expediente (estudiante,
  sus acudientes vinculados, docente responsable y coordinación); se limitan a 20 MB y a PDF,
  Office o imagen.

La matriz ejecutable está en `backend/usuarios/permisos.py`; las pruebas entre roles están en
`backend/tests/test_permisos_auditoria.py` y `backend/tests/test_nivelacion.py`.
