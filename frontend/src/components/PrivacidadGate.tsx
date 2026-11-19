import { ReactNode, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/theme';
import { BLOQUEAR_INCOGNITO, esNavegacionPrivada } from '@/utils/privacidad';

type Props = {
  children: ReactNode;
  /** Inyectable para pruebas. */
  detectar?: () => Promise<boolean>;
  activo?: boolean;
};

/**
 * En una ventana privada no monta la aplicación (ni sesión ni peticiones a la API) y muestra una
 * pantalla de conexión rechazada. Solo actúa en la web.
 */
export function PrivacidadGate({
  children,
  detectar = esNavegacionPrivada,
  activo = Platform.OS === 'web' && BLOQUEAR_INCOGNITO,
}: Props) {
  const [estado, setEstado] = useState<'comprobando' | 'bloqueado' | 'libre'>(
    activo ? 'comprobando' : 'libre',
  );

  useEffect(() => {
    if (!activo) return;
    let vigente = true;
    detectar()
      .then((privada) => vigente && setEstado(privada ? 'bloqueado' : 'libre'))
      .catch(() => vigente && setEstado('libre'));
    return () => {
      vigente = false;
    };
  }, [activo, detectar]);

  if (estado === 'comprobando')
    return <View testID="privacidad-comprobando" style={styles.fondo} />;
  if (estado === 'bloqueado') {
    const sitio = globalThis.location?.hostname || 'el servidor';
    return (
      <View testID="conexion-rechazada" accessibilityRole="alert" style={styles.fondo}>
        <View style={styles.caja}>
          <Text style={styles.titulo}>No se puede acceder a este sitio</Text>
          <Text style={styles.texto}>{sitio} rechazó la conexión.</Text>
          <Text style={styles.codigo}>ERR_CONNECTION_REFUSED</Text>
        </View>
      </View>
    );
  }
  return <>{children}</>;
}

const styles = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: colors.surface, justifyContent: 'center' },
  caja: { padding: spacing.xl, maxWidth: 560, alignSelf: 'center' },
  titulo: { ...typography.title, color: colors.text, marginBottom: spacing.md },
  texto: { ...typography.subtitle, color: colors.textMuted, marginBottom: spacing.md },
  codigo: { ...typography.body, color: colors.textMuted },
});
