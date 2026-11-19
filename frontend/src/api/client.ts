import Constants from 'expo-constants';
import { Platform } from 'react-native';

type ApiUrlOptions = {
  configuredUrl?: string;
  platform?: typeof Platform.OS;
  expoHostUri?: string;
  browserHost?: string;
};

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || host.startsWith('127.');
}

function isPrivateIpv4(host: string): boolean {
  const octets = host.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [first, second] = octets;
  return (
    first === 10 ||
    (first === 192 && second === 168) ||
    (first === 172 && second >= 16 && second <= 31)
  );
}

export function resolveApiUrl({
  configuredUrl,
  platform = Platform.OS,
  expoHostUri,
  browserHost,
}: ApiUrlOptions = {}): string {
  const url = new URL(configuredUrl ?? 'http://localhost:8001/api');
  if (url.hostname === '0.0.0.0') {
    throw new Error(
      '0.0.0.0 es una direccion de escucha del contenedor, no un host publico. Configura EXPO_PUBLIC_API_URL con la URL HTTPS de Render.',
    );
  }
  if (!isLoopbackHost(url.hostname)) return url.toString().replace(/\/+$/, '');

  if (platform === 'web' && browserHost && isPrivateIpv4(browserHost)) {
    url.hostname = browserHost;
  } else if (platform !== 'web') {
    const expoHost = expoHostUri?.split(':')[0];
    if (expoHost && isPrivateIpv4(expoHost)) {
      url.hostname = expoHost;
    } else if (platform === 'android') {
      url.hostname = '10.0.2.2';
    }
  }

  return url.toString().replace(/\/+$/, '');
}

const apiUrlResolved = resolveApiUrl({
  configuredUrl: process.env.EXPO_PUBLIC_API_URL,
  platform: Platform.OS,
  expoHostUri: Constants.expoConfig?.hostUri,
  browserHost:
    typeof window === 'undefined' || !window.location ? undefined : window.location.hostname,
});

// Solo aplica a la app instalada (APK/iOS): un celular no puede usar "localhost". En la versión
// web, nginx sirve la página y la API desde el mismo origen, así que localhost es válido.
if (!__DEV__ && Platform.OS !== 'web' && isLoopbackHost(new URL(apiUrlResolved).hostname)) {
  throw new Error(
    'La app instalada necesita una API pública HTTPS. Configura EXPO_PUBLIC_API_URL antes de compilar el APK.',
  );
}

/** En la app instalada solo se habla con la API por HTTPS (M5: sin tráfico en claro ni downgrade). */
export function exigirHttps(url: string, nativoDeProduccion: boolean): void {
  if (nativoDeProduccion && new URL(url).protocol !== 'https:') {
    throw new Error(
      'La app instalada solo se comunica con la API por HTTPS (EXPO_PUBLIC_API_URL).',
    );
  }
}
exigirHttps(apiUrlResolved, !__DEV__ && Platform.OS !== 'web');

export const API_URL = apiUrlResolved;

export type ApiError = { error: { code: string; message: string; details?: unknown } };

/** Tiempo máximo de espera de una petición pública; evita botones cargando indefinidamente. */
const TIMEOUT_MS = 20000;

export const errorDeTiempo = (): ApiError => ({
  error: {
    code: 'tiempo_agotado',
    message: 'El servidor tardó demasiado en responder. Inténtalo de nuevo en unos segundos.',
  },
});

/** Despierta el servidor (arranque en frío) sin esperar ni propagar errores. */
/**
 * Despierta el servidor antes de que la persona escriba sus datos. Usa el punto de salud, que
 * responde 200 a un GET; antes se consultaba el inicio de sesión, que solo admite POST, y el
 * navegador mostraba un error 405 en la consola en cada visita.
 */
export function precalentarApi() {
  fetch(`${API_URL}/health/`, { method: 'GET' }).catch(() => undefined);
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: controlador.signal,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch (e) {
    if (controlador.signal.aborted) throw errorDeTiempo();
    throw e;
  } finally {
    clearTimeout(temporizador);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw body as ApiError;
  return body as T;
}
