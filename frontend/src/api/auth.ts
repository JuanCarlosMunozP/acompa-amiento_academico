import { obtenerIdDispositivo } from '@/utils/dispositivo';

import { apiFetch, ApiError } from './client';

export type RegistroDatos = {
  email: string;
  nombres: string;
  apellidos: string;
  password: string;
  password_confirmacion: string;
};

export type UsuarioRegistrado = {
  id: number;
  email: string;
  nombres: string;
  apellidos: string;
  rol: string;
  email_verificado: boolean;
  /** Verificación en dos pasos (código QR/TOTP) activa en la cuenta. */
  mfa_activo?: boolean;
};

export function registrar(datos: RegistroDatos) {
  return apiFetch<UsuarioRegistrado>('/auth/registro/', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

/** Errores por campo que devuelve la API: {"error": {"details": {campo: [mensajes]}}}. */
export function erroresPorCampo(e: unknown): Record<string, string> {
  const details = (e as ApiError)?.error?.details;
  if (!details || typeof details !== 'object') return {};
  return Object.fromEntries(
    Object.entries(details as Record<string, string | string[]>).map(([campo, msg]) => [
      campo,
      Array.isArray(msg) ? msg.join(' ') : String(msg),
    ]),
  );
}

export type LoginDatos = { email: string; password: string };

export type SesionRespuesta = {
  access: string;
  refresh: string;
  usuario: UsuarioRegistrado;
};

/** Contraseña correcta pero la cuenta exige un segundo factor: aún no hay sesión. */
export type MfaRequerido = { mfa_requerido: true; mfa_token: string };

/** Dispositivo no reconocido: se envió un código al correo para verificarlo (no se bloquea). */
export type DispositivoNuevo = {
  dispositivo_nuevo: true;
  desafio_token: string;
  /** Correo parcialmente oculto (a***@dominio) para mostrar dónde llegó el código. */
  correo: string;
};

export type LoginRespuesta = SesionRespuesta | MfaRequerido | DispositivoNuevo;

export function requiereDispositivo(r: LoginRespuesta): r is DispositivoNuevo {
  return 'dispositivo_nuevo' in r && r.dispositivo_nuevo === true;
}

export function requiereMfa(r: LoginRespuesta): r is MfaRequerido {
  return 'mfa_requerido' in r && r.mfa_requerido === true;
}

export async function iniciarSesionApi(datos: LoginDatos) {
  const dispositivo = await obtenerIdDispositivo();
  return apiFetch<LoginRespuesta>('/auth/login/', {
    method: 'POST',
    body: JSON.stringify({ ...datos, dispositivo }),
  });
}

/** Canjea el código enviado al correo: registra este dispositivo y entrega la sesión. */
export function verificarDispositivoApi(datos: { desafio_token: string; codigo: string }) {
  return apiFetch<SesionRespuesta>('/auth/dispositivo/verificar/', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

export type DispositivoRegistrado = {
  id: number;
  nombre: string;
  ip: string | null;
  creado: string;
  ultimo_uso: string;
  actual: boolean;
};

/** Segundo paso del login: canjea el desafío + el código (de la app o de recuperación) por la sesión. */
export function verificarMfaApi(datos: { mfa_token: string; codigo: string }) {
  return apiFetch<SesionRespuesta>('/auth/mfa/verificar/', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

/** Mensaje legible para un error de login (mensaje de la API o fallo de red). */
export function mensajeDeLogin(e: unknown): string {
  const err = (e as ApiError)?.error;
  if (err?.message) return err.message;
  return 'No pudimos iniciar sesión. Revisa tu conexión e inténtalo de nuevo.';
}

export function verificarCorreo(token: string) {
  return apiFetch<{ email: string; email_verificado: boolean }>('/auth/verificar-correo/', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export function reenviarVerificacion(email: string) {
  return apiFetch<{ detail: string }>('/auth/reenviar-verificacion/', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

/** Código de error de la API (p. ej. "correo_no_verificado"), si lo hay. */
export function codigoDeError(e: unknown): string | undefined {
  return (e as ApiError)?.error?.code;
}

export function solicitarRecuperacion(email: string) {
  return apiFetch<{ detail: string }>('/auth/recuperar/', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export type RecuperacionDatos = {
  uid: string;
  token: string;
  password: string;
  password_confirmacion: string;
};

export function confirmarRecuperacion(datos: RecuperacionDatos) {
  return apiFetch<{ detail: string }>('/auth/recuperar/confirmar/', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

export function logoutApi(refresh: string) {
  return apiFetch<null>('/auth/logout/', {
    method: 'POST',
    body: JSON.stringify({ refresh }),
  });
}
