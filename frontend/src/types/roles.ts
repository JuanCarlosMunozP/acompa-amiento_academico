export type Rol =
  'estudiante' | 'acudiente' | 'tutor' | 'coordinador' | 'administrador' | 'superadmin';

/** El superadministrador hace todo lo del administrador y gestiona el rol de superadministrador. */
export function esSuperadmin(rol?: string): boolean {
  return rol === 'superadmin';
}

/** Quién ve el listado de roles (el servidor lo vuelve a comprobar en cada petición). */
export function puedeVerRoles(rol?: string): boolean {
  return esAdministrador(rol) || rol === 'coordinador';
}

/** Quién puede cambiar el rol de otras personas. */
export function puedeAsignarRoles(rol?: string): boolean {
  return esAdministrador(rol);
}

/** Solo el administrador modifica la estructura de la institución (sedes, grados, periodos...). */
export function esAdministrador(rol?: string): boolean {
  return rol === 'administrador' || rol === 'superadmin';
}

/** Quién toma la asistencia: quien dicta y la coordinación. */
export function puedeTomarAsistencia(rol?: string): boolean {
  return rol === 'tutor' || rol === 'coordinador' || esAdministrador(rol);
}
