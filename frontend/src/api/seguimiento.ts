import { authFetch, authFetchRaw } from './authFetch';
import type { Pagina } from './usuarios';

// --- Grados con sus grupos (para elegir el grupo) ---

export type GradoConGrupos = {
  id: number;
  nombre: string;
  grupos: { id: number; nombre: string }[];
};

export const listarGradosConGrupos = () => authFetch<GradoConGrupos[]>('/grados/');

// --- Asistencia ---

export type EstadoAsistencia = 'presente' | 'tarde' | 'ausente' | 'excusa';

export const ESTADOS_ASISTENCIA: { codigo: EstadoAsistencia; etiqueta: string }[] = [
  { codigo: 'presente', etiqueta: 'Presente' },
  { codigo: 'tarde', etiqueta: 'Tarde' },
  { codigo: 'ausente', etiqueta: 'Ausente' },
  { codigo: 'excusa', etiqueta: 'Excusa' },
];

export type EstudianteDelDia = {
  estudiante: number;
  nombre: string;
  email: string;
  estado: EstadoAsistencia | null;
};

export type ListaAsistencia = {
  fecha: string;
  grupo: string;
  periodo: number;
  habil: boolean;
  motivo: string | null;
  estudiantes: EstudianteDelDia[];
  guardados?: number;
};

export const obtenerListaAsistencia = (grupo: number, fecha: string) =>
  authFetch<ListaAsistencia>(`/asistencia/grupo/${grupo}/${fecha}/`);

export const guardarAsistencia = (
  grupo: number,
  fecha: string,
  registros: { estudiante: number; estado: EstadoAsistencia }[],
) =>
  authFetch<ListaAsistencia>(`/asistencia/grupo/${grupo}/${fecha}/`, {
    method: 'PUT',
    body: JSON.stringify({ registros }),
  });

// --- Matriz de desempeño ---

export type EstadoDesempeno = 'sin_alertas' | 'atencion' | 'riesgo' | 'critico';

export const ESTADOS_DESEMPENO: { codigo: EstadoDesempeno; etiqueta: string }[] = [
  { codigo: 'critico', etiqueta: 'Crítico' },
  { codigo: 'riesgo', etiqueta: 'Riesgo' },
  { codigo: 'atencion', etiqueta: 'Atención' },
  { codigo: 'sin_alertas', etiqueta: 'Sin solicitudes' },
];

export type FilaMatriz = {
  estudiante: number;
  nombre: string;
  email: string;
  grupo: string;
  promedio: string | null;
  asistencia: string | null;
  trabajos_pendientes: number;
  estado: EstadoDesempeno;
  alertas: number;
};

export type Matriz = Pagina<FilaMatriz> & {
  periodo: number;
  resumen: Record<EstadoDesempeno, number>;
};

export type FiltroMatriz = {
  grupo?: number | null;
  estado?: EstadoDesempeno | null;
  q?: string;
  page?: number;
};

export function obtenerMatriz({ grupo, estado, q, page }: FiltroMatriz = {}) {
  const partes: string[] = [];
  if (grupo) partes.push(`grupo=${grupo}`);
  if (estado) partes.push(`estado=${estado}`);
  if (q?.trim()) partes.push(`q=${encodeURIComponent(q.trim())}`);
  if (page && page > 1) partes.push(`page=${page}`);
  return authFetch<Matriz>(`/matriz-desempeno/${partes.length ? `?${partes.join('&')}` : ''}`);
}

export type Alerta = {
  regla: number;
  nombre: string;
  tipo: string;
  severidad: EstadoDesempeno;
  asignatura: string | null;
  valor: string;
  umbral: string;
  explicacion: string;
};

export type Evaluacion = {
  estudiante: number;
  estado: EstadoDesempeno;
  medidas: {
    promedio: string | null;
    asistencia: { porcentaje: string | null; total: number };
    trabajos_pendientes: number;
  };
  alertas: Alerta[];
};

export type ReglaAcademica = {
  id: number;
  nombre: string;
  tipo: 'nota_baja' | 'asistencia_baja' | 'trabajos_pendientes';
  umbral: string;
  severidad: 'atencion' | 'riesgo' | 'critico';
  activa: boolean;
};

export type DatosReglaAcademica = Omit<ReglaAcademica, 'id'>;

export const listarReglasAcademicas = () => authFetch<ReglaAcademica[]>('/reglas/');

export const crearReglaAcademica = (datos: DatosReglaAcademica) =>
  authFetch<ReglaAcademica>('/reglas/', {
    method: 'POST',
    body: JSON.stringify(datos),
  });

export const actualizarReglaAcademica = (id: number, datos: DatosReglaAcademica) =>
  authFetch<ReglaAcademica>(`/reglas/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(datos),
  });

export const obtenerEvaluacion = (estudiante: number) =>
  authFetch<Evaluacion>(`/estudiantes/${estudiante}/evaluacion/`);

export type InformeAcompanamiento = {
  periodo: { id: number; nombre: string };
  cards: {
    estudiantes: number;
    criticos: number;
    en_riesgo: number;
    planes_en_curso: number;
    recuperaciones_efectivas: number;
  };
  grupos: {
    grupo_id: number;
    grupo: string;
    grado: string;
    estudiantes: number;
    criticos: number;
    en_riesgo: number;
    planes_en_curso: number;
    recuperaciones_efectivas: number;
    asistencia_porcentaje: string | null;
  }[];
  grados: {
    grado_id: number;
    grado: string;
    grupos: number;
    estudiantes: number;
    criticos: number;
    en_riesgo: number;
    planes_en_curso: number;
    recuperaciones_efectivas: number;
    asistencia_porcentaje: string | null;
  }[];
  asistencia_por_grupo: {
    grupo: string;
    presentes: number;
    tardes: number;
    ausentes: number;
    excusas: number;
    total: number;
    porcentaje: string | null;
  }[];
  asistencia_estudiantes: {
    estudiante: string;
    grupo: string;
    presente: number;
    tarde: number;
    ausente: number;
    excusa: number;
    porcentaje: string | null;
  }[];
  asignaturas: {
    asignatura_id: number;
    asignatura: string;
    estudiantes: number;
    promedio: number | null;
    bajo_umbral: number;
    recuperaciones_efectivas: number;
  }[];
  tutores: {
    tutor: string;
    estudiantes: number;
    planes: number;
    sesiones: number;
    recuperaciones_efectivas: number;
  }[];
  recuperaciones: EvaluacionPosterior[];
  filtros: {
    grupos: { id: number; nombre: string }[];
    asignaturas: { id: number; nombre: string }[];
    tutores: { id: number; nombre: string }[];
  };
};

export type FiltrosInforme = {
  grupo?: number | null;
  asignatura?: number | null;
  tutor?: number | null;
  periodo?: number | null;
};

export function obtenerInformeAcompanamiento(filtros: FiltrosInforme = {}) {
  const params = new URLSearchParams();
  Object.entries(filtros).forEach(([k, v]) => {
    if (v) params.set(k, String(v));
  });
  return authFetch<InformeAcompanamiento>(
    `/informes-acompanamiento/${params.size ? `?${params}` : ''}`,
  );
}

export async function descargarInforme(
  tipo: 'grupos' | 'asistencia' | 'asignaturas' | 'tutores' | 'recuperaciones',
  filtros: FiltrosInforme = {},
) {
  const params = new URLSearchParams({ exportar: tipo });
  Object.entries(filtros).forEach(([k, v]) => {
    if (v) params.set(k, String(v));
  });
  return authFetchRaw(`/informes-acompanamiento/?${params}`);
}

export type EvaluacionPosterior = {
  id: number;
  plan: number;
  estudiante_nombre: string;
  asignatura_nombre: string;
  grupo_nombre: string;
  nota_inicial: string;
  nota_posterior: string;
  mejora: string;
  recuperacion_efectiva: boolean;
  observaciones: string;
  fecha_registro: string;
};

export const obtenerEvaluacionPosteriorPlan = (plan: number) =>
  authFetch<EvaluacionPosterior[]>(`/evaluaciones-posteriores/?plan=${plan}`);

export const registrarEvaluacionPosterior = (datos: {
  plan: number;
  nota_posterior: string;
  observaciones: string;
}) =>
  authFetch<EvaluacionPosterior>('/evaluaciones-posteriores/', {
    method: 'POST',
    body: JSON.stringify(datos),
  });

/** Fecha de hoy y desplazamientos en formato AAAA-MM-DD (en hora local, no UTC). */
export function fechaLocal(desplazamientoDias = 0, base = new Date()): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + desplazamientoDias);
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}
