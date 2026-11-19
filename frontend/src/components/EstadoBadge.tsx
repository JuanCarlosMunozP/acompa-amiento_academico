import { StyleSheet, Text, View } from 'react-native';

import { ESTADOS_DESEMPENO, type EstadoDesempeno } from '@/api/seguimiento';
import { radius, spacing, typography } from '@/theme';

// Colores del semáforo de desempeño. No dependen solo del color: siempre llevan texto.
const COLORES: Record<EstadoDesempeno, { fondo: string; texto: string }> = {
  critico: { fondo: '#FDE7E7', texto: '#9B1C1C' },
  riesgo: { fondo: '#FFEFD9', texto: '#9A4A00' },
  atencion: { fondo: '#FFF7CC', texto: '#6B5600' },
  sin_alertas: { fondo: '#E3F4E6', texto: '#1E6B2E' },
};

export function EstadoBadge({ estado }: { estado: EstadoDesempeno }) {
  // Todos los estados del tipo están en la lista, así que siempre hay etiqueta.
  const etiqueta = (ESTADOS_DESEMPENO.find((e) => e.codigo === estado) as { etiqueta: string })
    .etiqueta;
  return (
    <View style={[styles.badge, { backgroundColor: COLORES[estado].fondo }]}>
      <Text style={[styles.texto, { color: COLORES[estado].texto }]}>{etiqueta}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.lg,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm + 2,
    alignSelf: 'flex-start',
  },
  texto: { ...typography.body, fontWeight: '700' },
});
