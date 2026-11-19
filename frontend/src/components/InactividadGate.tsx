import { ReactNode, useCallback, useEffect, useRef } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { useSession } from '@/store/session';
import { INACTIVIDAD_MINUTOS } from '@/utils/config';

type Props = { children: ReactNode; minutos?: number };

/**
 * Cierra la sesión tras `minutos` sin interacción táctil. También comprueba el tiempo al
 * volver a primer plano, porque los temporizadores se detienen con la app en segundo plano.
 */
export function InactividadGate({ children, minutos = INACTIVIDAD_MINUTOS }: Props) {
  const { sesion, cerrar } = useSession();
  const activa = sesion !== null;
  const limiteMs = minutos * 60_000;
  const ultimaActividad = useRef(0);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  const detener = useCallback(() => {
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = null;
  }, []);

  const programar = useCallback(() => {
    detener();
    temporizador.current = setTimeout(() => void cerrar('inactividad'), limiteMs);
  }, [cerrar, detener, limiteMs]);

  useEffect(() => {
    if (!activa) {
      detener();
      return;
    }
    ultimaActividad.current = Date.now();
    programar();

    const sub = AppState.addEventListener('change', (estado) => {
      if (estado !== 'active') return;
      if (Date.now() - ultimaActividad.current >= limiteMs) void cerrar('inactividad');
      else programar();
    });
    return () => {
      sub.remove();
      detener();
    };
  }, [activa, cerrar, detener, limiteMs, programar]);

  return (
    <View
      testID="inactividad-gate"
      style={styles.fill}
      // Registra cualquier toque sin quedarse con el gesto.
      onStartShouldSetResponderCapture={() => {
        ultimaActividad.current = Date.now();
        if (activa) programar();
        return false;
      }}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
