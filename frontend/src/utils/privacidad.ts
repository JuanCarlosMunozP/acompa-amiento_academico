/**
 * Detección de navegación privada (incógnito) en la versión web.
 *
 * Ningún navegador la expone de forma oficial; se infiere por señales indirectas. Por eso es una
 * barrera de la interfaz y NO la defensa real: el servidor sigue exigiendo dispositivo verificado,
 * MFA y sesiones revocables. Se desactiva con EXPO_PUBLIC_BLOQUEAR_INCOGNITO=false.
 */
import { Platform } from 'react-native';

export const BLOQUEAR_INCOGNITO = process.env.EXPO_PUBLIC_BLOQUEAR_INCOGNITO !== 'false';

/** Chrome/Edge reducen la cuota de almacenamiento en incógnito muy por debajo de la normal. */
const CUOTA_MINIMA_NORMAL = 120 * 1024 * 1024;

async function cuotaReducida(): Promise<boolean> {
  const almacenamiento = globalThis.navigator?.storage;
  if (!almacenamiento?.estimate) return false;
  const { quota } = await almacenamiento.estimate();
  return typeof quota === 'number' && quota > 0 && quota < CUOTA_MINIMA_NORMAL;
}

/** Firefox en modo privado rechaza abrir IndexedDB. */
function indexedDbBloqueada(): Promise<boolean> {
  const agente = globalThis.navigator?.userAgent ?? '';
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!/Firefox/i.test(agente) || !idb) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      const peticion = idb.open('__sonda_privacidad__');
      peticion.onerror = () => resolve(true);
      peticion.onsuccess = () => {
        peticion.result.close();
        resolve(false);
      };
    } catch {
      resolve(true);
    }
  });
}

/** `true` si el navegador parece estar en modo incógnito/privado. Ante la duda, `false`. */
export async function esNavegacionPrivada(): Promise<boolean> {
  if (Platform.OS !== 'web') return false;
  try {
    return (await cuotaReducida()) || (await indexedDbBloqueada());
  } catch {
    return false;
  }
}
