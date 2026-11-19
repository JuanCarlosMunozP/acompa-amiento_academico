/** Informa y permite continuar el flujo de verificación del correo electrónico. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';

import { verificarCorreo } from '@/api/auth';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { colors, spacing, typography } from '@/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'VerificarCorreo'>;

type Estado =
  { tipo: 'verificando' } | { tipo: 'ok'; email: string } | { tipo: 'error'; mensaje: string };

/** Destino del enlace del correo: `.../verificar-correo?token=...`. */
export function VerificarCorreoScreen({ route, navigation }: Props) {
  // Algunos visores de correo abren el enlace sin decodificar quoted-printable:
  // el '=' que separa `token=` aparece como `3D` al principio del valor.
  const token = route.params?.token?.replace(/^(?:=)?3D(?=eyJ)/i, '');
  const [estado, setEstado] = useState<Estado>(
    token ? { tipo: 'verificando' } : { tipo: 'error', mensaje: 'El enlace no es válido.' },
  );

  useEffect(() => {
    if (!token) return;
    let activo = true;
    verificarCorreo(token)
      .then((r) => activo && setEstado({ tipo: 'ok', email: r.email }))
      .catch((e) => {
        const mensaje =
          (e as { error?: { message?: string } })?.error?.message ??
          'No pudimos verificar tu correo. Revisa tu conexión e inténtalo de nuevo.';
        if (activo) setEstado({ tipo: 'error', mensaje });
      });
    return () => {
      activo = false;
    };
  }, [token]);

  return (
    <Screen layout="form">
      {estado.tipo === 'verificando' && (
        <>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.body}>Verificando tu correo…</Text>
        </>
      )}
      {estado.tipo === 'ok' && (
        <>
          <Text style={styles.title}>Correo verificado</Text>
          <Text style={styles.body}>{estado.email} ya está verificado. Puedes iniciar sesión.</Text>
          <Button title="Iniciar sesión" onPress={() => navigation.replace('Login')} />
        </>
      )}
      {estado.tipo === 'error' && (
        <>
          <Text style={styles.title}>No se pudo verificar</Text>
          <Text accessibilityRole="alert" style={styles.error}>
            {estado.mensaje}
          </Text>
          <Button title="Ir a iniciar sesión" onPress={() => navigation.replace('Login')} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginBottom: spacing.md },
  body: { ...typography.body, color: colors.textMuted, marginVertical: spacing.md },
  error: { ...typography.body, color: colors.error, marginBottom: spacing.lg },
});
