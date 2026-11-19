import { authFetch } from './authFetch';

const enviar = (metodo: 'POST' | 'PATCH', datos: unknown) => ({
  method: metodo,
  body: JSON.stringify(datos),
});

// --- Institución y sedes ---

export type Institucion = {
  nombre: string;
  nit: string;
  direccion: string;
  ciudad: string;
  telefono: string;
  correo: string;
  sede_unica: boolean;
};

export type Sede = {
  id: number;
  nombre: string;
  nit: string;
  direccion: string;
  ciudad: string;
  telefono: string;
  correo: string;
  activa: boolean;
  principal: boolean;
};

export const obtenerInstitucion = () => authFetch<Institucion>('/institucion/');
export const actualizarInstitucion = (datos: Partial<Institucion>) =>
  authFetch<Institucion>('/institucion/', enviar('PATCH', datos));

export const listarSedes = () => authFetch<Sede[]>('/sedes/');
export const crearSede = (datos: Partial<Sede>) =>
  authFetch<Sede>('/sedes/', enviar('POST', datos));
export const actualizarSede = (id: number, datos: Partial<Sede>) =>
  authFetch<Sede>(`/sedes/${id}/`, enviar('PATCH', datos));

// --- Grados y grupos ---

export type GrupoAdmin = { id: number; nombre: string; activo: boolean };
export type GradoAdmin = {
  id: number;
  nombre: string;
  orden: number;
  activo: boolean;
  grupos: GrupoAdmin[];
};

export const listarGradosAdmin = () => authFetch<GradoAdmin[]>('/admin/grados/');
export const crearGrado = (datos: { nombre: string; orden: number }) =>
  authFetch<GradoAdmin>('/admin/grados/', enviar('POST', datos));
export const actualizarGrado = (id: number, datos: Partial<Omit<GradoAdmin, 'id' | 'grupos'>>) =>
  authFetch<GradoAdmin>(`/admin/grados/${id}/`, enviar('PATCH', datos));
export const crearGrupo = (datos: { grado: number; nombre: string }) =>
  authFetch<GrupoAdmin>('/admin/grupos/', enviar('POST', datos));
export const actualizarGrupo = (
  id: number,
  datos: Partial<Pick<GrupoAdmin, 'nombre' | 'activo'>>,
) => authFetch<GrupoAdmin>(`/admin/grupos/${id}/`, enviar('PATCH', datos));

// --- Catálogo de asignaturas ---

export type AsignaturaAdmin = { id: number; nombre: string; activa: boolean };

export const listarAsignaturasAdmin = () => authFetch<AsignaturaAdmin[]>('/admin/asignaturas/');
export const crearAsignatura = (nombre: string) =>
  authFetch<AsignaturaAdmin>('/admin/asignaturas/', enviar('POST', { nombre }));
export const actualizarAsignatura = (
  id: number,
  datos: Partial<Pick<AsignaturaAdmin, 'nombre' | 'activa'>>,
) => authFetch<AsignaturaAdmin>(`/admin/asignaturas/${id}/`, enviar('PATCH', datos));

// --- Periodos académicos ---

export type Periodo = {
  id: number;
  nombre: string;
  fecha_inicio: string;
  fecha_fin: string;
  es_actual: boolean;
};

export const listarPeriodos = () => authFetch<Periodo[]>('/periodos/');
export const crearPeriodo = (datos: Omit<Periodo, 'id' | 'es_actual'>) =>
  authFetch<Periodo>('/periodos/', enviar('POST', datos));
export const actualizarPeriodo = (id: number, datos: Partial<Omit<Periodo, 'id' | 'es_actual'>>) =>
  authFetch<Periodo>(`/periodos/${id}/`, enviar('PATCH', datos));

/** Fecha en formato AAAA-MM-DD válida (no solo con la forma correcta: también existe en el calendario). */
export function fechaValida(texto: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [a, m, d] = texto.split('-').map(Number);
  const fecha = new Date(Date.UTC(a, m - 1, d));
  return fecha.getUTCFullYear() === a && fecha.getUTCMonth() === m - 1 && fecha.getUTCDate() === d;
}
