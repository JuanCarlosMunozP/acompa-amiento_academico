/** Recoge las credenciales e inicia el flujo de autenticación. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import {
  codigoDeError,
  iniciarSesionApi,
  mensajeDeLogin,
  reenviarVerificacion,
  requiereDispositivo,
  requiereMfa,
  verificarDispositivoApi,
  verificarMfaApi,
} from '@/api/auth';
import { precalentarApi } from '@/api/client';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { useSession } from '@/store/session';
import { colors, institution, radius, spacing, typography } from '@/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

/** La recuperación de contraseña sigue en el código (frontend y backend) pero oculta al usuario. */
const RECUPERACION_CONTRASENA_VISIBLE = false;

export function LoginScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const escritorio = width >= 820;
  const { iniciar, aviso } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errores, setErrores] = useState<{ email?: string; password?: string }>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [sinVerificar, setSinVerificar] = useState(false);
  const [reenviado, setReenviado] = useState(false);
  // Segundo factor: tras acertar la contraseña, el servidor entrega un desafío de corta vida.
  const [desafio, setDesafio] = useState<string | null>(null);
  // Dispositivo nuevo: el código llega al correo en vez de a la app autenticadora.
  const [porCorreo, setPorCorreo] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [errorCodigo, setErrorCodigo] = useState<string | undefined>();

  useEffect(() => {
    precalentarApi();
  }, []);

  const volverAlPrimerPaso = () => {
    setDesafio(null);
    setPorCorreo(null);
    setCodigo('');
    setErrorCodigo(undefined);
    setErrorGeneral(null);
  };

  const verificarCodigo = async () => {
    /* istanbul ignore next -- el botón se deshabilita mientras envía; es una defensa extra */
    if (enviando) return;
    setErrorGeneral(null);
    if (!codigo.trim()) {
      setErrorCodigo('Ingresa el código de verificación.');
      return;
    }
    setErrorCodigo(undefined);
    setEnviando(true);
    try {
      const sesion = porCorreo
        ? await verificarDispositivoApi({ desafio_token: desafio as string, codigo: codigo.trim() })
        : await verificarMfaApi({ mfa_token: desafio as string, codigo: codigo.trim() });
      await iniciar(sesion);
      navigation.replace('Home');
    } catch (e) {
      const cod = codigoDeError(e);
      if (cod === 'codigo_mfa_invalido' || cod === 'codigo_dispositivo_invalido') {
        setErrorCodigo(mensajeDeLogin(e));
      } else {
        // Desafío vencido, cuenta bloqueada o sin red: hay que empezar de nuevo.
        volverAlPrimerPaso();
        setErrorGeneral(mensajeDeLogin(e));
      }
    } finally {
      setEnviando(false);
    }
  };

  const reenviar = async () => {
    try {
      await reenviarVerificacion(email.trim());
      setReenviado(true);
    } catch {
      setErrorGeneral('No pudimos reenviar el correo. Inténtalo más tarde.');
    }
  };

  const enviar = async () => {
    /* istanbul ignore next -- el botón se deshabilita mientras envía; es una defensa extra */
    if (enviando) return;
    setErrorGeneral(null);
    setSinVerificar(false);
    setReenviado(false);
    const locales = {
      email: email.trim() ? undefined : 'Ingresa tu correo.',
      password: password ? undefined : 'Ingresa tu contraseña.',
    };
    setErrores(locales);
    if (locales.email || locales.password) return;

    setEnviando(true);
    try {
      const respuesta = await iniciarSesionApi({ email: email.trim(), password });
      if (requiereDispositivo(respuesta)) {
        setDesafio(respuesta.desafio_token);
        setPorCorreo(respuesta.correo);
        setPassword('');
        return;
      }
      if (requiereMfa(respuesta)) {
        setDesafio(respuesta.mfa_token);
        setPassword(''); // la contraseña ya cumplió su función; no se conserva en memoria
        return;
      }
      await iniciar(respuesta);
      navigation.replace('Home');
    } catch (e) {
      setErrorGeneral(mensajeDeLogin(e));
      setSinVerificar(codigoDeError(e) === 'correo_no_verificado');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={[styles.layout, escritorio && styles.layoutWide]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.hero, escritorio && styles.heroWide]}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>AA</Text>
          </View>
          <Text style={styles.heroEyebrow}>PLATAFORMA ACADÉMICA</Text>
          <Text style={styles.heroTitle}>{institution.appName}</Text>
          <Text style={styles.heroSubtitle}>{institution.name}</Text>
          <View style={styles.accentLine} />
          <Text style={styles.description}>
            Organiza el acompañamiento académico, registra asistencia y acompaña el progreso de cada
            estudiante con seguimiento y planes de refuerzo.
          </Text>
          <View style={styles.features}>
            <Text style={styles.feature}>01 · Acompañamiento organizado</Text>
            <Text style={styles.feature}>02 · Seguimiento académico</Text>
            <Text style={styles.feature}>03 · Progreso visible</Text>
          </View>
          <View pointerEvents="none" style={styles.decorCircle} />
        </View>

        <View style={[styles.formColumn, escritorio && styles.formColumnWide]}>
          {desafio ? (
            <View style={styles.formCard}>
              <Text style={styles.formTitle}>
                {porCorreo ? 'Verifica este dispositivo' : 'Verificación en dos pasos'}
              </Text>
              <Text style={styles.formHint}>
                {porCorreo
                  ? `No reconocemos este dispositivo. Te enviamos un código de 6 dígitos a ${porCorreo}. Ingrésalo para continuar; solo se pide la primera vez.`
                  : 'Abre tu app autenticadora e ingresa el código de 6 dígitos. Si perdiste el teléfono, usa uno de tus códigos de recuperación.'}
              </Text>
              <TextField
                label="Código de verificación"
                value={codigo}
                onChangeText={setCodigo}
                error={errorCodigo}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={32}
              />
              <View style={styles.loginButton}>
                <Button
                  title="Verificar"
                  onPress={verificarCodigo}
                  loading={enviando}
                  color={colors.navegacion}
                />
              </View>
              <Button
                title="Volver"
                onPress={volverAlPrimerPaso}
                variant="link"
                color={colors.navegacion}
                disabled={enviando}
              />
            </View>
          ) : (
            <View style={styles.formCard}>
              <Text style={styles.formTitle}>Iniciar sesión</Text>
              <Text style={styles.formHint}>Ingresa con tu correo institucional.</Text>
              {aviso ? (
                <Text accessibilityRole="alert" style={styles.aviso}>
                  {aviso === 'inactividad'
                    ? 'Tu sesión se cerró por inactividad. Inicia sesión de nuevo.'
                    : aviso === 'seguridad'
                      ? 'Por seguridad cerramos tu sesión al detectar herramientas de desarrollo abiertas. Ciérralas e inicia sesión de nuevo.'
                      : 'Tu sesión venció. Inicia sesión de nuevo.'}
                </Text>
              ) : null}
              <TextField
                label="Correo institucional"
                value={email}
                onChangeText={setEmail}
                error={errores.email}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
              <TextField
                label="Contraseña"
                value={password}
                onChangeText={setPassword}
                error={errores.password}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="password"
              />
              {errorGeneral ? (
                <Text accessibilityRole="alert" style={styles.errorGeneral}>
                  {errorGeneral}
                </Text>
              ) : null}
              {sinVerificar && !reenviado ? (
                <Button
                  title="Reenviar correo de verificación"
                  onPress={reenviar}
                  variant="link"
                  color={colors.navegacion}
                />
              ) : null}
              {reenviado ? (
                <Text style={styles.info}>Te enviamos otro correo de verificación.</Text>
              ) : null}
              <View style={styles.loginButton}>
                <Button
                  title="Entrar"
                  onPress={enviar}
                  loading={enviando}
                  color={colors.navegacion}
                />
              </View>
              {RECUPERACION_CONTRASENA_VISIBLE ? (
                <Button
                  title="¿Olvidaste tu contraseña?"
                  onPress={() => navigation.navigate('RecuperarContrasena')}
                  variant="link"
                  disabled={enviando}
                />
              ) : null}
              <Pressable
                accessibilityRole="link"
                disabled={enviando}
                onPress={() => navigation.navigate('Registro')}
                style={styles.registerLink}
              >
                <Text style={styles.registerPrompt}>¿Aún no tienes cuenta? </Text>
                <Text style={styles.registerAction}>Regístrate</Text>
              </Pressable>
            </View>
          )}
          <Text style={styles.footer}>Acceso seguro para la comunidad educativa</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  layout: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 1180,
    alignSelf: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    gap: spacing.lg,
  },
  layoutWide: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl, padding: spacing.xl },
  hero: {
    minHeight: 300,
    backgroundColor: colors.navegacion,
    borderRadius: radius.lg,
    padding: spacing.xl,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  heroWide: { flex: 1.08, minHeight: 500, padding: 40 },
  brandMark: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderColor: 'rgba(255,255,255,0.28)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  brandMarkText: { color: colors.primaryText, fontSize: 17, fontWeight: '800', letterSpacing: 1 },
  heroEyebrow: {
    color: '#C9D5FF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: spacing.sm,
  },
  heroTitle: { ...typography.title, color: colors.primaryText, fontSize: 32, lineHeight: 39 },
  heroSubtitle: {
    ...typography.subtitle,
    color: colors.secondary,
    fontSize: 18,
    marginTop: spacing.sm,
  },
  accentLine: {
    width: 54,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.secondary,
    marginTop: spacing.lg,
  },
  description: {
    ...typography.body,
    color: colors.primaryText,
    fontSize: 16,
    marginTop: spacing.lg,
    lineHeight: 25,
    maxWidth: 480,
  },
  features: { gap: spacing.sm, marginTop: spacing.xl },
  feature: { color: '#DCE5FF', fontSize: 13, fontWeight: '600' },
  decorCircle: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    right: -100,
    top: -90,
  },
  formColumn: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  formColumnWide: { flex: 0.92, maxWidth: 500 },
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#152451',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.09,
    shadowRadius: 24,
    elevation: 5,
  },
  formTitle: { ...typography.title, color: colors.text, fontSize: 28, marginBottom: spacing.xs },
  formHint: { ...typography.body, color: colors.textMuted, marginBottom: spacing.xl },
  aviso: { ...typography.body, color: colors.textMuted, marginBottom: spacing.md },
  info: { ...typography.body, color: colors.success, marginBottom: spacing.md },
  errorGeneral: { ...typography.body, color: colors.error, marginBottom: spacing.md },
  loginButton: { marginTop: spacing.sm },
  registerLink: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  registerPrompt: { ...typography.body, color: colors.textMuted },
  registerAction: { ...typography.body, color: colors.navegacion, fontWeight: '700' },
  footer: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
