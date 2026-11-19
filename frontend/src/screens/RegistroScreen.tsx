/** Recoge los datos necesarios para crear una cuenta de estudiante. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import {
  erroresPorCampo,
  iniciarSesionApi,
  registrar,
  RegistroDatos,
  requiereDispositivo,
  requiereMfa,
} from '@/api/auth';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { useSession } from '@/store/session';
import { colors, spacing, typography } from '@/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Registro'>;

const VACIO: RegistroDatos = {
  email: '',
  nombres: '',
  apellidos: '',
  password: '',
  password_confirmacion: '',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validar(d: RegistroDatos): Record<string, string> {
  const e: Record<string, string> = {};
  if (!d.nombres.trim()) e.nombres = 'Ingresa tus nombres.';
  if (!d.apellidos.trim()) e.apellidos = 'Ingresa tus apellidos.';
  if (!EMAIL_RE.test(d.email.trim())) e.email = 'Ingresa un correo válido.';
  if (d.password.length < 8) e.password = 'La contraseña debe tener al menos 8 caracteres.';
  if (d.password !== d.password_confirmacion)
    e.password_confirmacion = 'Las contraseñas no coinciden.';
  return e;
}

export function RegistroScreen({ navigation }: Props) {
  const [datos, setDatos] = useState<RegistroDatos>(VACIO);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const { iniciar } = useSession();

  const cambiar = (campo: keyof RegistroDatos) => (valor: string) =>
    setDatos((d) => ({ ...d, [campo]: valor }));

  const enviar = async () => {
    setErrorGeneral(null);
    const locales = validar(datos);
    setErrores(locales);
    if (Object.keys(locales).length > 0) return;

    setEnviando(true);
    try {
      const email = datos.email.trim();
      const usuario = await registrar({ ...datos, email });
      // Si el servidor no exige verificar el correo, la cuenta ya nace verificada: se entra directo.
      if (usuario.email_verificado) {
        try {
          const r = await iniciarSesionApi({ email, password: datos.password });
          if (!requiereMfa(r) && !requiereDispositivo(r)) {
            await iniciar(r);
            navigation.replace('Home');
            return;
          }
        } catch {
          // Cuenta creada pero sin sesión automática: el usuario entra desde el login.
        }
        navigation.replace('Login');
        return;
      }
      navigation.replace('RegistroExito', { email: usuario.email });
    } catch (e) {
      const delServidor = erroresPorCampo(e);
      setErrores(delServidor);
      if (Object.keys(delServidor).length === 0) {
        setErrorGeneral('No pudimos crear tu cuenta. Revisa tu conexión e inténtalo de nuevo.');
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Screen layout="form">
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Crear cuenta</Text>
        <TextField
          label="Nombres"
          value={datos.nombres}
          onChangeText={cambiar('nombres')}
          error={errores.nombres}
          autoComplete="given-name"
        />
        <TextField
          label="Apellidos"
          value={datos.apellidos}
          onChangeText={cambiar('apellidos')}
          error={errores.apellidos}
          autoComplete="family-name"
        />
        <TextField
          label="Correo institucional"
          value={datos.email}
          onChangeText={cambiar('email')}
          error={errores.email}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
        <TextField
          label="Contraseña"
          value={datos.password}
          onChangeText={cambiar('password')}
          error={errores.password}
          secureTextEntry
          autoCapitalize="none"
        />
        <TextField
          label="Confirmar contraseña"
          value={datos.password_confirmacion}
          onChangeText={cambiar('password_confirmacion')}
          error={errores.password_confirmacion}
          secureTextEntry
          autoCapitalize="none"
        />
        {errorGeneral ? (
          <Text accessibilityRole="alert" style={styles.errorGeneral}>
            {errorGeneral}
          </Text>
        ) : null}
        <Button title="Crear cuenta" onPress={enviar} loading={enviando} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginBottom: spacing.lg },
  errorGeneral: { ...typography.body, color: colors.error, marginBottom: spacing.md },
});
