import { authFetch } from './authFetch';

export type Asignatura = { id: number; nombre: string };

export type PerfilTutor = {
  id: number;
  usuario: { id: number; email: string; nombres: string; apellidos: string };
  biografia: string;
  asignaturas: Asignatura[];
  disponible: boolean;
};

/** Solo se envían los campos que cambiaron. */
export type CambiosPerfil = {
  biografia?: string;
  asignaturas?: number[];
  disponible?: boolean;
};

export type HorarioTutor = { dia_semana: number; hora_inicio: string; hora_fin: string };
export type BloqueoTutor = {
  id?: number;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  motivo: string;
};
export type DisponibilidadTutor = { horarios: HorarioTutor[]; bloqueos: BloqueoTutor[] };

export const BIOGRAFIA_MAX = 1000;

export function obtenerMiPerfil() {
  return authFetch<PerfilTutor>('/perfil-tutor/');
}

export function actualizarMiPerfil(cambios: CambiosPerfil) {
  return authFetch<PerfilTutor>('/perfil-tutor/', {
    method: 'PATCH',
    body: JSON.stringify(cambios),
  });
}

export function listarAsignaturas() {
  return authFetch<Asignatura[]>('/asignaturas/');
}

export function obtenerDisponibilidadTutor() {
  return authFetch<DisponibilidadTutor>('/perfil-tutor/disponibilidad/');
}

export function guardarDisponibilidadTutor(disponibilidad: DisponibilidadTutor) {
  return authFetch<DisponibilidadTutor>('/perfil-tutor/disponibilidad/', {
    method: 'PUT',
    body: JSON.stringify(disponibilidad),
  });
}
