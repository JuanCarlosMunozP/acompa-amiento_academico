import { authFetch } from './authFetch';
import type { Rol } from '@/types/roles';

export type UsuarioLista = {
  id: number;
  email: string;
  nombres: string;
  apellidos: string;
  rol: Rol;
  rol_nombre: string;
  is_active: boolean;
};

export type Pagina<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export type RolCatalogo = { codigo: Rol; nombre: string; descripcion: string };

export type FiltroUsuarios = { q?: string; rol?: Rol | null; page?: number };

export function listarUsuarios({ q, rol, page }: FiltroUsuarios = {}) {
  const partes: string[] = [];
  if (q?.trim()) partes.push(`q=${encodeURIComponent(q.trim())}`);
  if (rol) partes.push(`rol=${rol}`);
  if (page && page > 1) partes.push(`page=${page}`);
  const consulta = partes.length ? `?${partes.join('&')}` : '';
  return authFetch<Pagina<UsuarioLista>>(`/usuarios/${consulta}`);
}

export type EstudianteLista = {
  id: number;
  usuario: { id: number; email: string; nombres: string; apellidos: string };
  grado: { id: number; nombre: string } | null;
  grupo: { id: number; nombre: string } | null;
};

/** Directorio de estudiantes activos (docente y coordinación), con búsqueda por nombre. */
export function listarEstudiantes({ q, page }: { q?: string; page?: number } = {}) {
  const partes: string[] = [];
  if (q?.trim()) partes.push(`q=${encodeURIComponent(q.trim())}`);
  if (page && page > 1) partes.push(`page=${page}`);
  const consulta = partes.length ? `?${partes.join('&')}` : '';
  return authFetch<Pagina<EstudianteLista>>(`/estudiantes/${consulta}`);
}

export function listarRoles() {
  return authFetch<RolCatalogo[]>('/roles/');
}

export function asignarRol(usuarioId: number, rol: Rol) {
  return authFetch<{ id: number; rol: Rol; rol_nombre: string }>(`/usuarios/${usuarioId}/rol/`, {
    method: 'PUT',
    body: JSON.stringify({ rol }),
  });
}

export type VinculoAcudiente = {
  id: number;
  acudiente: number;
  acudiente_nombre: string;
  estudiante: number;
  estudiante_nombre: string;
  parentesco: string;
};

/** Vínculos acudiente–estudiante (solo administración). */
export const listarVinculos = () => authFetch<VinculoAcudiente[]>('/vinculos-acudiente/');

export const crearVinculo = (datos: {
  acudiente: number;
  estudiante: number;
  parentesco: string;
}) =>
  authFetch<VinculoAcudiente>('/vinculos-acudiente/', {
    method: 'POST',
    body: JSON.stringify(datos),
  });

export const retirarVinculo = (id: number) =>
  authFetch<null>(`/vinculos-acudiente/${id}/`, { method: 'DELETE' });
