/** Permite establecer una contraseña nueva usando el flujo de recuperación. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { codigoDeError, confirmarRecuperacion, erroresPorCampo } from '@/api/auth';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { colors, spacing, typography } from '@/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'NuevaContrasena'>;

/** Destino del enlace del correo: `.../nueva-contrasena?uid=...&token=...`. */
export function NuevaContrasenaScreen({ route, navigation }: Props) {
  const uid = route.params?.uid;
  const token = route.params?.token;
  const [password, setPassword] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enlaceInvalido, setEnlaceInvalido] = useState(!uid || !token);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    setErrorGeneral(null);
    const locales: Record<string, string> = {};
    if (password.length < 8) locales.password = 'La contraseña debe tener al menos 8 caracteres.';
    if (password !== confirmacion) locales.password_confirmacion = 'Las contraseñas no coinciden.';
    setErrores(locales);
    if (Object.keys(locales).length > 0) return;

    setEnviando(true);
    try {
      await confirmarRecuperacion({
        uid: uid as string,
        token: token as string,
        password,
        password_confirmacion: confirmacion,
      });
      setListo(true);
    } catch (e) {
      if (codigoDeError(e) === 'enlace_invalido') {
        setEnlaceInvalido(true);
        return;
      }
      const delServidor = erroresPorCampo(e);
      setErrores(delServidor);
      if (Object.keys(delServidor).length === 0) {
        setErrorGeneral(
          'No pudimos cambiar tu contraseña. Revisa tu conexión e inténtalo de nuevo.',
        );
      }
    } finally {
      setEnviando(false);
    }
  };

  if (listo) {
    return (
      <Screen layout="form">
        <Text style={styles.title}>Contraseña actualizada</Text>
        <Text style={styles.body}>
          Ya puedes iniciar sesión con tu nueva contraseña. Por seguridad cerramos tus otras
          sesiones.
        </Text>
        <Button title="Iniciar sesión" onPress={() => navigation.replace('Login')} />
      </Screen>
    );
  }

  if (enlaceInvalido) {
    return (
      <Screen layout="form">
        <Text style={styles.title}>Enlace no válido</Text>
        <Text accessibilityRole="alert" style={styles.error}>
          El enlace no es válido o ya venció. Solicita uno nuevo.
        </Text>
        <Button
          title="Solicitar otro enlace"
          onPress={() => navigation.replace('RecuperarContrasena')}
        />
      </Screen>
    );
  }

  return (
    <Screen layout="form">
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Nueva contraseña</Text>
        <TextField
          label="Nueva contraseña"
          value={password}
          onChangeText={setPassword}
          error={errores.password}
          secureTextEntry
          autoCapitalize="none"
        />
        <TextField
          label="Confirmar nueva contraseña"
          value={confirmacion}
          onChangeText={setConfirmacion}
          error={errores.password_confirmacion}
          secureTextEntry
          autoCapitalize="none"
        />
        {errorGeneral ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {errorGeneral}
          </Text>
        ) : null}
        <Button title="Cambiar contraseña" onPress={enviar} loading={enviando} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginBottom: spacing.md },
  body: { ...typography.body, color: colors.textMuted, marginBottom: spacing.lg },
  error: { ...typography.body, color: colors.error, marginBottom: spacing.lg },
});
