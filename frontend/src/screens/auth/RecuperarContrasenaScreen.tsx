/** Solicita el correo asociado a la cuenta para iniciar su recuperación. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { solicitarRecuperacion } from '@/api/auth';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { colors, spacing, typography } from '@/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'RecuperarContrasena'>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RecuperarContrasenaScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    setError(null);
    if (!EMAIL_RE.test(email.trim())) {
      setError('Ingresa un correo válido.');
      return;
    }
    setEnviando(true);
    try {
      await solicitarRecuperacion(email.trim());
      setEnviado(true);
    } catch (e) {
      const mensaje = (e as { error?: { message?: string } })?.error?.message;
      setError(mensaje ?? 'No pudimos enviar el correo. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <Screen layout="form">
        <Text style={styles.title}>Revisa tu correo</Text>
        <Text style={styles.body}>
          Si hay una cuenta con {email.trim()}, te enviamos un enlace para crear una nueva
          contraseña. Sirve una sola vez y vence pronto.
        </Text>
        <Button title="Volver a iniciar sesión" onPress={() => navigation.popToTop()} />
      </Screen>
    );
  }

  return (
    <Screen layout="form">
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Recuperar contraseña</Text>
        <Text style={styles.body}>
          Escribe tu correo institucional y te enviaremos un enlace para crear una nueva contraseña.
        </Text>
        <TextField
          label="Correo institucional"
          value={email}
          onChangeText={setEmail}
          error={error ?? undefined}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
        <Button title="Enviar enlace" onPress={enviar} loading={enviando} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginBottom: spacing.md },
  body: { ...typography.body, color: colors.textMuted, marginBottom: spacing.lg },
});
