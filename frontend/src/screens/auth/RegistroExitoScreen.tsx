/** Confirma el registro y orienta al usuario sobre la verificación de su cuenta. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { reenviarVerificacion } from '@/api/auth';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { colors, spacing, typography } from '@/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'RegistroExito'>;

export function RegistroExitoScreen({ route, navigation }: Props) {
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const reenviar = async () => {
    setEnviando(true);
    try {
      await reenviarVerificacion(route.params.email);
      setAviso('Listo, te enviamos otro correo.');
    } catch {
      setAviso('No pudimos reenviar el correo. Inténtalo más tarde.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Screen layout="form">
      <Text style={styles.title}>Revisa tu correo</Text>
      <Text style={styles.body}>
        Te enviamos un enlace de verificación a {route.params.email}. Ábrelo para activar tu cuenta.
      </Text>
      {aviso ? <Text style={styles.body}>{aviso}</Text> : null}
      <Button title="Reenviar correo" onPress={reenviar} loading={enviando} />
      <Button title="Volver al inicio" onPress={() => navigation.popToTop()} variant="link" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginBottom: spacing.md },
  body: { ...typography.body, color: colors.textMuted, marginBottom: spacing.lg },
});
