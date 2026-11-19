import { StyleSheet, Text } from 'react-native';

import { colors, spacing, typography } from '@/theme';

type Props = { tipo: 'error' | 'exito' | 'nota'; children: string };

/** Mensaje corto de error, éxito o nota. Los errores y éxitos se anuncian como alerta. */
export function Aviso({ tipo, children }: Props) {
  return (
    <Text
      accessibilityRole={tipo === 'nota' ? undefined : 'alert'}
      style={[styles.base, styles[tipo]]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: { ...typography.body, marginBottom: spacing.md },
  error: { color: colors.error },
  exito: { color: colors.success },
  nota: { color: colors.textMuted },
});
