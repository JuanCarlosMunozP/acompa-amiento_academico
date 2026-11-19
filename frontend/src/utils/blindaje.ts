/**
 * Endurecimiento del cliente web frente al uso de la consola del navegador.
 *
 * Aviso honesto: el código del navegador lo controla quien lo usa, así que esto DISUADE y reduce
 * la exposición, pero no sustituye la seguridad del servidor (autorización por rol en cada
 * endpoint, JWT por dispositivo, CSP, filtros de entrada). Medidas:
 *  - silencia la consola en producción (no se filtran datos por console.*) y avisa del self-XSS;
 *  - bloquea los atajos de herramientas de desarrollo y el menú contextual fuera de los campos;
 *  - detecta herramientas abiertas (sonda de Chrome/Edge) y cierra la sesión en memoria;
 *  - evita que la app se cargue dentro de un iframe (clickjacking).
 * La sesión web vive solo en memoria, de modo que no hay tokens en localStorage que robar.
 */

export const BLINDAJE_ACTIVO = !__DEV__ && process.env.EXPO_PUBLIC_BLINDAJE !== 'false';

const METODOS_CONSOLA = [
  'log',
  'info',
  'debug',
  'warn',
  'error',
  'table',
  'dir',
  'dirxml',
  'trace',
  'group',
  'groupCollapsed',
  'groupEnd',
  'time',
  'timeEnd',
  'count',
] as const;

const ADVERTENCIA =
  '¡Detente! Esta consola es para desarrolladores. Si alguien te pidió pegar algo aquí, es un ' +
  'intento de robar tu cuenta. Nunca lo hagas.';

type Consola = Record<string, unknown>;

/** Reemplaza los métodos de la consola por funciones vacías. Devuelve cómo restaurarlos. */
export function silenciarConsola(consola: Consola = console as unknown as Consola): () => void {
  const originales = new Map<string, unknown>();
  const aviso = consola.warn as ((...a: unknown[]) => void) | undefined;
  for (const metodo of METODOS_CONSOLA) {
    if (typeof consola[metodo] !== 'function') continue;
    originales.set(metodo, consola[metodo]);
    consola[metodo] = () => undefined;
  }
  aviso?.call(consola, `%c${ADVERTENCIA}`, 'color:#C62828;font-size:16px;font-weight:bold');
  return () => originales.forEach((fn, metodo) => (consola[metodo] = fn));
}

/**
 * En la app instalada (APK/iOS) apaga los registros de la consola: logcat es legible por quien
 * conecte el teléfono por USB (M1/M6), así que no debe salir nada de ahí. No muestra avisos.
 */
export function silenciarRegistrosNativos(
  consola: Consola = console as unknown as Consola,
): () => void {
  const originales = new Map<string, unknown>();
  for (const metodo of METODOS_CONSOLA) {
    if (typeof consola[metodo] !== 'function') continue;
    originales.set(metodo, consola[metodo]);
    consola[metodo] = () => undefined;
  }
  return () => originales.forEach((fn, metodo) => (consola[metodo] = fn));
}

type EventoTeclado = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/** F12, Ctrl/Cmd+Shift+I/J/C, Cmd+Alt+I/J/C y Ctrl/Cmd+U (ver código fuente). */
export function esAtajoDeHerramientas(e: EventoTeclado): boolean {
  const tecla = e.key.toLowerCase();
  if (e.key === 'F12') return true;
  const mando = e.ctrlKey || e.metaKey;
  if (mando && e.shiftKey && ['i', 'j', 'c'].includes(tecla)) return true;
  if (e.metaKey && e.altKey && ['i', 'j', 'c'].includes(tecla)) return true;
  return mando && !e.shiftKey && tecla === 'u';
}

function esCampoDeTexto(destino: unknown): boolean {
  const etiqueta = (destino as { tagName?: string } | null)?.tagName?.toLowerCase();
  return etiqueta === 'input' || etiqueta === 'textarea';
}

type Opciones = {
  alDetectarHerramientas: () => void;
  ventana?: Window & typeof globalThis;
  intervaloMs?: number;
};

/** Activa el blindaje en la ventana del navegador. Devuelve la función que lo desactiva. */
export function activarBlindaje({
  alDetectarHerramientas,
  ventana = globalThis.window as Window & typeof globalThis,
  intervaloMs = 1000,
}: Opciones): () => void {
  if (!ventana?.document) return () => undefined;
  const doc = ventana.document;

  // Clickjacking: si la app quedó dentro de un marco ajeno, sale de él.
  try {
    if (ventana.top && ventana.top !== ventana.self)
      ventana.top.location.href = ventana.location.href;
  } catch {
    // Marco de otro origen: CSP frame-ancestors ya lo impide en el servidor.
  }

  // La sonda necesita el método real: se guarda antes de silenciar la consola.
  const depurar = ventana.console.debug?.bind(ventana.console);
  const restaurarConsola = silenciarConsola(ventana.console as unknown as Consola);

  const alTeclear = (e: KeyboardEvent) => {
    if (esAtajoDeHerramientas(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const alMenu = (e: MouseEvent) => {
    if (!esCampoDeTexto(e.target)) e.preventDefault();
  };
  doc.addEventListener('keydown', alTeclear, true);
  doc.addEventListener('contextmenu', alMenu, true);

  // Sonda: Chrome/Edge leen las propiedades del elemento solo cuando la consola está abierta.
  let abierta = false;
  let avisado = false;
  const sonda = doc.createElement('div');
  Object.defineProperty(sonda, 'id', {
    get() {
      abierta = true;
      return 'sonda';
    },
  });
  const temporizador = ventana.setInterval(() => {
    abierta = false;
    depurar?.(sonda);
    if (abierta && !avisado) {
      avisado = true;
      alDetectarHerramientas();
    } else if (!abierta) {
      avisado = false;
    }
  }, intervaloMs);

  return () => {
    ventana.clearInterval(temporizador);
    doc.removeEventListener('keydown', alTeclear, true);
    doc.removeEventListener('contextmenu', alMenu, true);
    restaurarConsola();
  };
}
