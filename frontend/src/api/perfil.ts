import { authFetch } from './authFetch';
import type { UsuarioRegistrado } from './auth';

export const NOMBRE_MAX = 150;

export type DatosPersonales = { nombres: string; apellidos: string };

export type FichaEstudiante = {
  id: number;
  usuario: { id: number; email: string; nombres: string; apellidos: string };
  grado: { id: number; nombre: string } | null;
  grupo: { id: number; nombre: string; grado: { id: number; nombre: string } } | null;
  trabajos_pendientes: number;
};

/** Edita los datos personales de quien tiene la sesión (correo, rol y estado no se editan). */
export function actualizarMisDatos(datos: Partial<DatosPersonales>) {
  return authFetch<UsuarioRegistrado>('/auth/me/', {
    method: 'PATCH',
    body: JSON.stringify(datos),
  });
}

export function obtenerMiFicha() {
  return authFetch<FichaEstudiante>('/mi-ficha/');
}
