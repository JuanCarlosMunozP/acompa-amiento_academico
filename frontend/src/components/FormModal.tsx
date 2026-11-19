import type { ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/theme';

/** Modal consistente para formularios de registro y actualización. */
export function FormModal({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.fondo}>
        <View style={styles.contenedor}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.contenido}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fondo: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  contenedor: {
    width: '100%',
    maxWidth: 680,
    maxHeight: '90%',
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  contenido: { padding: spacing.lg },
});
