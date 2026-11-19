import { useNavigation } from '@react-navigation/native';
import { ReactNode, useContext } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ModalLayoutContext } from '@/components/ModalLayoutContext';
import { colors, spacing } from '@/theme';

type Props = { children: ReactNode; fullWidth?: boolean };

type Layout = 'wide' | 'form';

/** Botón para cerrar un modal (solo se muestra dentro de uno, donde sí hay navegación). */
function BotonCerrarModal() {
  const navigation = useNavigation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Cerrar"
      onPress={() => (navigation.canGoBack() ? navigation.goBack() : undefined)}
      style={styles.cerrar}
    >
      <Text style={styles.cerrarTexto}>✕ Cerrar</Text>
    </Pressable>
  );
}

/** Layout base de toda pantalla: área segura, fondo y margen estándar. */
export function Screen({
  children,
  layout = 'wide',
  fullWidth = false,
}: Props & { layout?: Layout }) {
  const modal = useContext(ModalLayoutContext);
  return (
    <SafeAreaView style={[styles.safe, modal && styles.modalOverlay]}>
      <View
        style={[
          styles.content,
          layout === 'form' && styles.form,
          fullWidth && styles.fullWidth,
          modal && styles.modalContent,
        ]}
      >
        {modal ? <BotonCerrarModal /> : null}
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  modalOverlay: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
  },
  content: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 1180,
    padding: spacing.md,
  },
  form: { maxWidth: 680 },
  fullWidth: { maxWidth: '100%', alignSelf: 'stretch' },
  cerrar: { alignSelf: 'flex-end', paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  cerrarTexto: { color: colors.primary, fontWeight: '600', fontSize: 14 },
  modalContent: {
    width: '94%',
    maxWidth: 1080,
    maxHeight: '90%',
    backgroundColor: colors.background,
    borderRadius: 16,
    overflow: 'hidden',
  },
});
