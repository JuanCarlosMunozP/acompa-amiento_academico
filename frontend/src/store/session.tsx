import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { logoutApi, type SesionRespuesta } from '@/api/auth';
import { authFetch, conectarSesion, type Tokens } from '@/api/authFetch';
import { irAlLogin } from '@/navigation/ref';

const CLAVE = 'sesion';

type Sesion = SesionRespuesta | null;
export type MotivoCierre = 'inactividad' | 'expirada' | 'seguridad';

type Contexto = {
  sesion: Sesion;
  cargando: boolean;
  /** Motivo por el que la sesión se cerró sola (para avisarlo en el login). */
  aviso: MotivoCierre | null;
  iniciar: (s: SesionRespuesta) => Promise<void>;
  /** Refresca los datos del usuario (p. ej. tras editar sus nombres) sin cerrar la sesión. */
  actualizarUsuario: (u: SesionRespuesta['usuario']) => Promise<void>;
  cerrar: (motivo?: MotivoCierre) => Promise<void>;
};

const SessionContext = createContext<Contexto | null>(null);

/** El token queda en el Keystore/Keychain, solo con el equipo desbloqueado y sin pasar a otros equipos. */
const OPCIONES_SEGURAS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

async function persistir(s: Sesion) {
  try {
    if (s) await SecureStore.setItemAsync(CLAVE, JSON.stringify(s), OPCIONES_SEGURAS);
    else await SecureStore.deleteItemAsync(CLAVE);
  } catch {
    // Sin almacenamiento seguro: la sesión sigue en memoria.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Sesion>(null);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<MotivoCierre | null>(null);
  // Copia síncrona: la capa HTTP necesita el token más reciente sin esperar un render.
  const actual = useRef<Sesion>(null);

  const aplicar = useCallback((s: Sesion) => {
    actual.current = s;
    setSesion(s);
  }, []);

  const cerrar = useCallback(
    async (motivo?: MotivoCierre) => {
      const refresh = actual.current?.refresh;
      aplicar(null);
      setAviso(motivo ?? null);
      await persistir(null);
      // Se invalida el refresh en el servidor; si no hay red, igual queda cerrada aquí.
      if (refresh) logoutApi(refresh).catch(() => undefined);
      // Siempre se vuelve al inicio de sesión y no se puede regresar a pantallas privadas.
      irAlLogin();
    },
    [aplicar],
  );

  const iniciar = useCallback(
    async (s: SesionRespuesta) => {
      aplicar(s);
      setAviso(null);
      await persistir(s);
    },
    [aplicar],
  );

  const actualizarUsuario = useCallback(
    async (usuario: SesionRespuesta['usuario']) => {
      if (!actual.current) return;
      const nueva = { ...actual.current, usuario };
      aplicar(nueva);
      await persistir(nueva);
    },
    [aplicar],
  );

  useEffect(() => {
    conectarSesion({
      leer: () =>
        actual.current ? { access: actual.current.access, refresh: actual.current.refresh } : null,
      guardar: (t: Tokens) => {
        if (!actual.current) return;
        const nueva = { ...actual.current, ...t };
        aplicar(nueva);
        void persistir(nueva);
      },
      expirar: () => void cerrar('expirada'),
    });
    return () => conectarSesion(null);
  }, [aplicar, cerrar]);

  // Al abrir la app: recupera la sesión guardada y comprueba que siga vigente.
  useEffect(() => {
    (async () => {
      try {
        const guardada = await SecureStore.getItemAsync(CLAVE);
        if (guardada) {
          aplicar(JSON.parse(guardada));
          // Renueva si hace falta; si el refresh venció, authFetch cierra la sesión.
          const me = await authFetch<SesionRespuesta['usuario']>('/auth/me/').catch(() => null);
          if (me && actual.current) {
            const fresca = { ...actual.current, usuario: me };
            aplicar(fresca);
            await persistir(fresca);
          }
        }
      } catch {
        // Dato corrupto o sin almacenamiento seguro: se inicia sin sesión.
      } finally {
        setCargando(false);
      }
    })();
  }, [aplicar]);

  return (
    <SessionContext.Provider
      value={{ sesion, cargando, aviso, iniciar, actualizarUsuario, cerrar }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession debe usarse dentro de <SessionProvider>');
  return ctx;
}
