# Definición de hecho y componentes del tablero

Acuerdo de trabajo del equipo para el Scrum Sprint 1 (dos semanas).
**Estado: propuesta pendiente de acordar con el equipo.** Se ajusta en la retrospectiva si algo no funciona.

## Definición de hecho (DoD)

Una tarea pasa a **Listo** solo si cumple todo lo que aplique:

**Código**
- [ ] Cumple el criterio de aceptación de la tarea en Jira.
- [ ] API: `ruff check .` y `ruff format --check .` sin errores.
- [ ] Cliente: `npm run lint`, `npm run format:check` y `npm run typecheck` sin errores.
- [ ] Sin secretos en el repositorio; las variables nuevas están en el `.env.example` correspondiente.

**Pruebas**
- [ ] API: `python -m pytest` en verde; el comportamiento nuevo tiene prueba.
- [ ] Cliente: `npm test` en verde; la pantalla o componente nuevo tiene al menos una prueba.
- [ ] Probado a mano el flujo principal (API contra PostgreSQL local, cliente en Expo).

**Base de datos**
- [ ] Todo cambio de esquema viaja en una migración de Django (`backend/<app>/migrations/`).
- [ ] `python manage.py migrate` funciona sobre una base vacía.

**Contrato API ↔ cliente**
- [ ] Los errores usan el formato `{"error": {"code", "message", "details"?}}`.
- [ ] Si cambió un endpoint, el cliente y la documentación en `docs/` están actualizados.

**Cierre**
- [ ] Cambios integrados en la rama principal con mensaje de commit claro.
- [ ] README o `docs/` actualizados si cambia cómo se instala, configura o ejecuta algo.
- [ ] Estado en Jira cambiado a **Listo**.

## Componentes del tablero (Jira, proyecto PTA)

### Columnas / estados
| Estado       | Significado                                  | Salida a la siguiente columna             |
|--------------|----------------------------------------------|-------------------------------------------|
| **Por hacer**| En el sprint, sin empezar                    | Alguien la toma y la asigna               |
| **En curso** | Trabajo activo                               | Cumple la DoD                             |
| **Listo**    | Cumple la definición de hecho                | —                                         |

Límite de trabajo en curso: **máx. 3 tareas** simultáneas por persona.

### Tipos de actividad
- **Épica** (`EP-xx`): agrupa un objetivo grande. Ej.: EP-00 Configuración del proyecto.
- **Historia de usuario** (`HU-xx`): valor visible para un usuario. Ej.: HU-01 Gestionar usuarios, roles y acceso.
- **Tarea** (`HU-xx.Ty` o `Tn`): trabajo técnico de una historia; cabe en un día.

### Convenciones
- Título de tarea: `HU-01.T2 Endpoint POST /auth/registro ...` (verbo + resultado).
- Cada tarea tiene **persona asignada**, **sprint** y **story point estimate**.
- Tareas de 1 punto ≈ medio día; si una tarea supera 2 puntos se divide.
- Ritmo objetivo: ~8 tareas por día de equipo, según capacidad del sprint.
- Campos usados: Principal (épica/historia), Sprint, Etiquetas, Fecha de vencimiento, Story points.

### Etiquetas sugeridas
`api`, `cliente`, `base-de-datos`, `docs`, `bloqueada`.

### Ceremonias
- Planificación al inicio del sprint; revisión y retrospectiva al cierre del sprint.
- Revisión rápida del tablero cada día: qué está en curso y qué bloquea.
