/** Ventana de confirmación para cerrar sesión; se muestra sobre cualquier sección. */
import { Modal, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { colors, radius, spacing, typography } from '@/theme';

type Props = {
  visible: boolean;
  cerrando: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmarCierreSesion({ visible, cerrando, onConfirm, onCancel }: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!cerrando) onCancel();
      }}
    >
      <View style={styles.overlay}>
        <View accessibilityViewIsModal style={styles.card}>
          <Text accessibilityRole="alert" style={styles.texto}>
            ¿Quieres cerrar la sesión en este dispositivo?
          </Text>
          <Button title="Sí, cerrar sesión" onPress={onConfirm} loading={cerrando} />
          <Button title="Cancelar" onPress={onCancel} variant="link" disabled={cerrando} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
    padding: spacing.md,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  texto: { ...typography.body, color: colors.text, marginBottom: spacing.sm },
});
