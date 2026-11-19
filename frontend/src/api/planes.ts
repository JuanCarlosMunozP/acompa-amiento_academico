import { authFetch, authFetchRaw } from './authFetch';
import type { Evaluacion } from './seguimiento';
import type { Pagina } from './usuarios';

export type EstadoPlan = 'pendiente' | 'asignado' | 'cerrado' | 'cancelado';

export const ETIQUETA_PLAN: Record<EstadoPlan, string> = {
  pendiente: 'Pendiente de docente',
  asignado: 'En acompañamiento',
  cerrado: 'Cerrado',
  cancelado: 'Cancelado',
};

export type ResultadoPlan = 'logrado' | 'parcial' | 'no_logrado';

export const RESULTADOS: { codigo: ResultadoPlan; etiqueta: string }[] = [
  { codigo: 'logrado', etiqueta: 'Logrado (nivelado)' },
  { codigo: 'parcial', etiqueta: 'Logrado parcialmente' },
  { codigo: 'no_logrado', etiqueta: 'No logrado' },
];

export const etiquetaResultado = (r: string) =>
  RESULTADOS.find((x) => x.codigo === r)?.etiqueta ?? r;

export const OBJETIVOS_MAX = 1000;
export const DESEMPENOS_MAX = 1500;
export const NOTA_MIN = 1;
export const NOTA_MAX = 5;

/** Convierte lo escrito por la persona («4,5» o «4.5») en una nota válida de 1,0 a 5,0. */
export function notaValida(texto: string): number | null {
  const valor = Number(texto.trim().replace(',', '.'));
  return Number.isFinite(valor) && valor >= NOTA_MIN && valor <= NOTA_MAX ? valor : null;
}

export type Plan = {
  id: number;
  estudiante: number;
  estudiante_nombre: string;
  periodo: number;
  periodo_nombre: string;
  asignatura: number;
  asignatura_nombre: string;
  objetivos: string;
  /** Desempeños que el estudiante no alcanzó en el área y el periodo. */
  desempenos_no_alcanzados: string;
  fecha_inicio: string;
  fecha_fin: string;
  estado: EstadoPlan;
  tutor: number | null;
  tutor_nombre: string | null;
  /** El tutor del servidor se presenta como docente en la interfaz. */
  docente_nombre: string | null;
  resultado: ResultadoPlan | '';
  fecha_cierre: string | null;
  /** Valoración descriptiva del cierre. */
  nota_cierre: string;
  /** Nota cuantitativa de 1,0 a 5,0 (decimal serializado como texto). */
  nota_final: string | null;
  visto_bueno: boolean;
  visto_bueno_fecha: string | null;
  visto_bueno_por_nombre: string | null;
  actividades_total: number;
  actividades_completadas: number;
  /** Porcentaje de actividades completadas; `null` si el plan aún no tiene actividades. */
  progreso: number | null;
  atrasado: boolean;
};

export type DatosPlan = {
  estudiante: number;
  asignatura: number;
  objetivos: string;
  desempenos_no_alcanzados: string;
  fecha_inicio: string;
  fecha_fin: string;
};

export const crearPlan = (datos: DatosPlan) =>
  authFetch<Plan>('/planes/', { method: 'POST', body: JSON.stringify(datos) });

export type TutorElegible = { id: number; nombre: string; email: string; carga: number };

export const listarTutoresElegibles = (plan: number) =>
  authFetch<TutorElegible[]>(`/planes/${plan}/tutores-elegibles/`);

export type ResultadoAsignacion = {
  plan: Plan;
  cambio: boolean;
  notificacion: { tutor: boolean; estudiante: boolean } | null;
};

export const asignarTutor = (plan: number, tutor: number) =>
  authFetch<ResultadoAsignacion>(`/planes/${plan}/tutor/`, {
    method: 'PUT',
    body: JSON.stringify({ tutor }),
  });

export const listarMisPlanes = () => authFetch<Plan[]>('/mis-planes/');

export type NotificacionAcompanamiento = {
  id: number;
  tipo:
    | 'registro'
    | 'solicitud'
    | 'plan'
    | 'sesion'
    | 'material'
    | 'cierre'
    | 'alerta'
    | 'duda'
    | 'entrega';
  titulo: string;
  mensaje: string;
  creada: string;
  leida: string | null;
  plan: number | null;
  sesion: number | null;
};

export type PreferenciaNotificacion = {
  tipo: string;
  nombre: string;
  habilitada: boolean;
};

export const listarMisNotificaciones = () =>
  authFetch<{ no_leidas: number; resultados: NotificacionAcompanamiento[] }>(
    '/mis-notificaciones/',
  );

export const marcarNotificacionLeida = (id: number) =>
  authFetch<{ id: number; leida: string }>(`/notificaciones/${id}/leer/`, { method: 'POST' });

export const listarPreferenciasNotificacion = () =>
  authFetch<PreferenciaNotificacion[]>('/mis-preferencias-notificacion/');

export const guardarPreferenciasNotificacion = (preferencias: PreferenciaNotificacion[]) =>
  authFetch<PreferenciaNotificacion[]>('/mis-preferencias-notificacion/', {
    method: 'PATCH',
    body: JSON.stringify({
      preferencias: preferencias.map(({ tipo, habilitada }) => ({ tipo, habilitada })),
    }),
  });

// --- Ficha completa del estudiante ---

export type FichaCompleta = {
  estudiante: {
    id: number;
    nombre: string;
    email: string;
    grado: string | null;
    grupo: string | null;
    matricula: string | null;
  };
  periodo: { id: number; nombre: string };
  evaluacion: Evaluacion;
  asistencia: {
    porcentaje: string | null;
    registros: { fecha: string; estado: string }[];
  };
  trabajos_pendientes: {
    id: number;
    asignatura_nombre: string;
    descripcion: string;
    fecha_limite: string;
    vencido: boolean;
  }[];
  planes: Plan[];
};

export const obtenerFichaCompleta = (estudiante: number) =>
  authFetch<FichaCompleta>(`/estudiantes/${estudiante}/ficha-completa/`);

// --- Consulta por estado (coordinación) ---

export type ResumenPlanes = Record<EstadoPlan, number>;
export type PaginaPlanes = Pagina<Plan> & { resumen: ResumenPlanes };

export type FiltroPlanes = { estado?: EstadoPlan | null; atrasado?: boolean; page?: number };

export function listarPlanes({ estado, atrasado, page }: FiltroPlanes = {}) {
  const partes: string[] = [];
  if (estado) partes.push(`estado=${estado}`);
  if (atrasado) partes.push('atrasado=1');
  if (page && page > 1) partes.push(`page=${page}`);
  return authFetch<PaginaPlanes>(`/planes/${partes.length ? `?${partes.join('&')}` : ''}`);
}

// --- Seguimiento: actividades y cierre ---

export type Actividad = {
  id: number;
  titulo: string;
  descripcion: string;
  fecha_limite: string;
  completada: boolean;
  fecha_completada: string | null;
  vencida: boolean;
};

export type SeguimientoPlan = Plan & {
  puede_gestionar: boolean;
  actividades: Actividad[];
  sesiones: SesionTutoria[];
};

export type SesionTutoria = {
  id: number;
  plan: number;
  tutor: number;
  tutor_nombre: string;
  estudiante_nombre: string;
  asignatura_nombre: string;
  inicio: string;
  fin: string;
  modalidad: 'presencial' | 'virtual';
  lugar: string;
  enlace_virtual: string;
  notas: string;
  estado: 'programada' | 'cancelada' | 'realizada';
  motivo_cancelacion: string;
  asistencia: 'pendiente' | 'presente' | 'ausente' | 'excusa';
  asistencia_fecha: string | null;
  inasistencias_tutorias: number;
  bitacora?: {
    temas: string;
    desarrollo: string;
    acuerdos: string;
    observaciones: string;
    fecha_cierre: string;
  } | null;
  materiales?: MaterialSesion[];
};

export type MiDesempenoTutorias =
  | {
      rol: 'estudiante';
      tutorias_programadas: number;
      tutorias_realizadas: number;
      asistencias: number;
      porcentaje_asistencia: number | null;
    }
  | {
      rol: 'tutor';
      tutorias_realizadas: number;
    };

export const obtenerMiDesempenoTutorias = () =>
  authFetch<MiDesempenoTutorias>('/mi-desempeno-tutorias/');

export type MaterialSesion = {
  id: number;
  titulo: string;
  descripcion: string;
  fecha_creacion: string;
};

export const cerrarSesionConBitacora = (
  id: number,
  datos: {
    temas: string;
    desarrollo: string;
    acuerdos: string;
    observaciones: string;
  },
) =>
  authFetch<SesionTutoria>(`/sesiones/${id}/cerrar/`, {
    method: 'POST',
    body: JSON.stringify(datos),
  });

export function subirMaterialSesion(
  id: number,
  titulo: string,
  descripcion: string,
  archivo: FormData,
) {
  archivo.append('titulo', titulo);
  archivo.append('descripcion', descripcion);
  return authFetch<MaterialSesion>(`/sesiones/${id}/materiales/`, {
    method: 'POST',
    body: archivo,
  });
}

export async function descargarMaterialSesion(id: number, material: number) {
  return authFetchRaw(`/sesiones/${id}/materiales/${material}/descargar/`);
}

export type DisponibilidadPlan = {
  horarios: { dia_semana: number; hora_inicio: string; hora_fin: string }[];
  bloqueos: { id: number; fecha: string; hora_inicio: string; hora_fin: string }[];
};

export const obtenerDisponibilidadPlan = (plan: number) =>
  authFetch<DisponibilidadPlan>(`/planes/${plan}/disponibilidad/`);

export const listarSesionesPlan = (plan: number) =>
  authFetch<SesionTutoria[]>(`/planes/${plan}/sesiones/`);

export type DatosSesion = {
  inicio: string;
  fin: string;
  modalidad: 'presencial' | 'virtual';
  lugar?: string;
  enlace_virtual?: string;
  notas?: string;
};

export const programarSesion = (plan: number, datos: DatosSesion) =>
  authFetch<SesionTutoria>(`/planes/${plan}/sesiones/`, {
    method: 'POST',
    body: JSON.stringify(datos),
  });

export const listarAgendaSesiones = () => authFetch<SesionTutoria[]>('/agenda-sesiones/');

export type InformeBitacora = {
  id: number;
  sesion: number;
  estudiante: string;
  grado: string;
  asignatura: string;
  tutor: string;
  fecha_sesion: string;
  temas: string;
  desarrollo: string;
  acuerdos: string;
  observaciones: string;
  fecha_cierre: string;
  creada_por_nombre: string;
};

export type FiltrosInformeBitacora = {
  docente?: string;
  grado?: string;
  estudiante?: string;
  materia?: string;
};

export const listarInformesBitacora = (filtros: FiltrosInformeBitacora = {}) => {
  const consulta = Object.entries(filtros)
    .filter(([, valor]) => valor?.trim())
    .map(([campo, valor]) => `${encodeURIComponent(campo)}=${encodeURIComponent(valor!.trim())}`)
    .join('&');
  return authFetch<InformeBitacora[]>(`/informes-bitacoras/${consulta ? `?${consulta}` : ''}`);
};

export const actualizarInformeBitacora = (
  id: number,
  datos: Pick<InformeBitacora, 'temas' | 'desarrollo' | 'acuerdos' | 'observaciones'>,
) =>
  authFetch<InformeBitacora>(`/informes-bitacoras/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(datos),
  });

export const cancelarSesion = (id: number) =>
  authFetch<SesionTutoria>(`/sesiones/${id}/cancelar/`, {
    method: 'POST',
    body: JSON.stringify({ motivo: 'Cancelada por coordinación/tutor' }),
  });

export const cancelarSesionConMotivo = (id: number, motivo: string) =>
  authFetch<SesionTutoria>(`/sesiones/${id}/cancelar/`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  });

export const reprogramarSesion = (id: number, datos: Partial<DatosSesion>) =>
  authFetch<SesionTutoria>(`/sesiones/${id}/`, { method: 'PATCH', body: JSON.stringify(datos) });

export const registrarAsistenciaSesion = (id: number, estado: 'presente' | 'ausente' | 'excusa') =>
  authFetch<SesionTutoria>(`/sesiones/${id}/asistencia/`, {
    method: 'PATCH',
    body: JSON.stringify({ estado }),
  });

export const obtenerSeguimiento = (plan: number) =>
  authFetch<SeguimientoPlan>(`/planes/${plan}/seguimiento/`);

export type DatosActividad = { titulo: string; descripcion?: string; fecha_limite: string };

export const agregarActividad = (plan: number, datos: DatosActividad) =>
  authFetch<Actividad>(`/planes/${plan}/actividades/`, {
    method: 'POST',
    body: JSON.stringify(datos),
  });

export const actualizarActividad = (
  id: number,
  cambios: Partial<DatosActividad> & { completada?: boolean },
) =>
  authFetch<Actividad>(`/actividades/${id}/`, { method: 'PATCH', body: JSON.stringify(cambios) });

/** Cierra el expediente: valoración descriptiva y nota de 1,0 a 5,0 (resultado opcional). */
export const cerrarPlan = (
  plan: number,
  datos: { valoracion: string; nota_final: number; resultado?: ResultadoPlan; forzar?: boolean },
) => authFetch<Plan>(`/planes/${plan}/cerrar/`, { method: 'POST', body: JSON.stringify(datos) });

// --- Acompañamiento: dudas, entregas y correcciones ---

export type Duda = {
  id: number;
  autor: number;
  autor_nombre: string;
  autor_rol: string;
  texto: string;
  respuesta_a: number | null;
  creada: string;
};

export const listarDudas = (plan: number) => authFetch<Duda[]>(`/planes/${plan}/dudas/`);

export const escribirDuda = (plan: number, texto: string, respuestaA?: number | null) =>
  authFetch<Duda>(`/planes/${plan}/dudas/`, {
    method: 'POST',
    body: JSON.stringify({ texto, respuesta_a: respuestaA ?? null }),
  });

export type Retroalimentacion = {
  id: number;
  docente_nombre: string | null;
  comentario: string;
  requiere_correccion: boolean;
  fecha: string;
};

export type Entrega = {
  id: number;
  actividad: number;
  tipo: 'entrega' | 'correccion';
  archivo_nombre: string;
  comentario: string;
  fecha: string;
  retroalimentacion: Retroalimentacion | null;
};

export const listarEntregas = (actividad: number) =>
  authFetch<Entrega[]>(`/actividades/${actividad}/entregas/`);

export function subirEntrega(actividad: number, archivo: FormData, comentario: string) {
  archivo.append('comentario', comentario);
  return authFetch<Entrega>(`/actividades/${actividad}/entregas/`, {
    method: 'POST',
    body: archivo,
  });
}

export const descargarEntrega = (entrega: number) =>
  authFetchRaw(`/entregas/${entrega}/descargar/`);

export const retroalimentarEntrega = (
  entrega: number,
  datos: { comentario: string; requiere_correccion: boolean },
) =>
  authFetch<Retroalimentacion>(`/entregas/${entrega}/retroalimentacion/`, {
    method: 'POST',
    body: JSON.stringify(datos),
  });

// --- Verificación de coordinación y reporte ---

export type ObservacionCoordinacion = {
  id: number;
  autor_nombre: string | null;
  texto: string;
  creada: string;
};

export const listarObservaciones = (plan: number) =>
  authFetch<ObservacionCoordinacion[]>(`/planes/${plan}/observaciones/`);

export const registrarObservacion = (plan: number, texto: string) =>
  authFetch<ObservacionCoordinacion>(`/planes/${plan}/observaciones/`, {
    method: 'POST',
    body: JSON.stringify({ texto }),
  });

export const darVistoBueno = (plan: number) =>
  authFetch<Plan>(`/planes/${plan}/visto-bueno/`, { method: 'POST' });

/** Reporte institucional imprimible (HTML); se abre con la sesión actual y se imprime. */
export const obtenerReporteImprimible = (plan: number) =>
  authFetchRaw(`/planes/${plan}/reporte/?formato=html`);

// --- Contadores (coordinación) ---

export type Contadores = {
  periodo: number | null;
  total: number;
  pendientes: number;
  en_curso: number;
  atrasados: number;
  cerrados: number;
  cancelados: number;
  recuperados: number;
  parciales: number;
  no_logrados: number;
  /** Porcentaje de recuperados entre los cerrados; `null` si aún no hay planes cerrados. */
  tasa_recuperacion: number | null;
};

export const obtenerContadores = () => authFetch<Contadores>('/planes/contadores/');
