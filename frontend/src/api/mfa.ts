/** Verificación en dos pasos: alta por código QR, baja y códigos de recuperación. */
import { authFetch } from './authFetch';

export type ConfiguracionMfa = {
  /** Clave en texto para teclearla a mano si no se puede escanear el QR. */
  secreto: string;
  otpauth_uri: string;
  /** Imagen PNG del QR como data URI. */
  qr: string;
};

/** Genera un secreto nuevo (aún sin activar) y su código QR. */
export function configurarMfa() {
  return authFetch<ConfiguracionMfa>('/auth/mfa/configurar/', { method: 'POST' });
}

/** Confirma el alta con un código de la app. Devuelve los códigos de recuperación (solo esta vez). */
export function activarMfa(codigo: string) {
  return authFetch<{ mfa_activo: true; codigos_recuperacion: string[] }>('/auth/mfa/activar/', {
    method: 'POST',
    body: JSON.stringify({ codigo }),
  });
}

/** Quita la verificación en dos pasos. Exige contraseña y un código vigente. */
export function desactivarMfa(datos: { password: string; codigo: string }) {
  return authFetch<{ mfa_activo: false }>('/auth/mfa/desactivar/', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

/** Invalida los códigos de recuperación anteriores y entrega un juego nuevo. */
export function regenerarCodigosRecuperacion(datos: { password: string; codigo: string }) {
  return authFetch<{ codigos_recuperacion: string[] }>('/auth/mfa/codigos-recuperacion/', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}
