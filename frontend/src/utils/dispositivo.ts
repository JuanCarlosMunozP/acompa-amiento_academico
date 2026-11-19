/**
 * Identificador aleatorio de este dispositivo/navegador. El servidor solo guarda su huella
 * SHA-256 y lo usa para reconocer dispositivos ya verificados. No es un secreto de sesión: una
 * ventana de incógnito (almacenamiento vacío) genera uno nuevo y debe verificarse por correo.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const CLAVE = 'dispositivo_id';
let enMemoria: string | null = null;

export function generarId(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function leer(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(CLAVE) ?? null;
    return await SecureStore.getItemAsync(CLAVE);
  } catch {
    return null;
  }
}

async function guardar(valor: string): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(CLAVE, valor);
    else
      await SecureStore.setItemAsync(CLAVE, valor, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
  } catch {
    // Sin almacenamiento: el id vive en memoria y el dispositivo se verificará de nuevo.
  }
}

export async function obtenerIdDispositivo(): Promise<string> {
  if (enMemoria) return enMemoria;
  const guardado = await leer();
  if (guardado && /^[A-Za-z0-9_-]{16,128}$/.test(guardado)) {
    enMemoria = guardado;
    return guardado;
  }
  const nuevo = generarId();
  enMemoria = nuevo;
  await guardar(nuevo);
  return nuevo;
}

/** Solo para pruebas. */
export function reiniciarDispositivoEnMemoria() {
  enMemoria = null;
}
