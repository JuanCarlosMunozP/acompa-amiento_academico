import { API_URL, ApiError } from './client';

export type Tokens = { access: string; refresh: string };

/** Enlace entre la capa HTTP y el almacén de sesión (lo conecta el SessionProvider). */
type Puente = {
  leer: () => Tokens | null;
  guardar: (t: Tokens) => void;
  expirar: () => void;
};

let puente: Puente | null = null;
let renovando: Promise<Tokens> | null = null;

export function conectarSesion(p: Puente | null) {
  puente = p;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function renovar(): Promise<Tokens> {
  const actual = puente?.leer();
  if (!actual) throw sinSesion();

  // Un fallo de red aquí se propaga tal cual: no se cierra la sesión por no tener conexión.
  const res = await fetch(`${API_URL}/auth/refresh/`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ refresh: actual.refresh }),
  });
  if (!res.ok) {
    puente?.expirar();
    throw sesionExpirada();
  }
  const body = await res.json();
  const nuevos = { access: body.access, refresh: body.refresh ?? actual.refresh };
  puente?.guardar(nuevos);
  return nuevos;
}

const sinSesion = (): ApiError => ({
  error: { code: 'sin_sesion', message: 'Inicia sesión para continuar.' },
});

const sesionExpirada = (): ApiError => ({
  error: { code: 'sesion_expirada', message: 'Tu sesión venció. Inicia sesión de nuevo.' },
});

/**
 * Petición autenticada. Si el access token venció (401) renueva la sesión una sola vez
 * (varias peticiones simultáneas comparten la misma renovación) y reintenta.
 */
export async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const tokens = puente?.leer();
  if (!tokens) throw sinSesion();

  const intentar = (access: string) =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(typeof FormData !== 'undefined' && init?.body instanceof FormData ? {} : JSON_HEADERS),
        ...init?.headers,
        Authorization: `Bearer ${access}`,
      },
    });

  let res = await intentar(tokens.access);
  if (res.status === 401) {
    renovando ??= renovar().finally(() => {
      renovando = null;
    });
    const nuevos = await renovando;
    res = await intentar(nuevos.access);
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) throw body as ApiError;
  return body as T;
}

export async function authFetchRaw(path: string): Promise<Response> {
  const tokens = puente?.leer();
  if (!tokens) throw sinSesion();
  const intentar = (access: string) =>
    fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${access}` } });
  let res = await intentar(tokens.access);
  if (res.status === 401) {
    renovando ??= renovar().finally(() => {
      renovando = null;
    });
    const nuevos = await renovando;
    res = await intentar(nuevos.access);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw body as ApiError;
  }
  return res;
}
