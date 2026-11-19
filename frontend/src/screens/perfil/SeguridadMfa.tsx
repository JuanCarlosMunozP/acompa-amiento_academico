/** Verificación en dos pasos: activar con código QR, ver/renovar códigos de recuperación y desactivar. */
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { ApiError } from '@/api/client';
import {
  activarMfa,
  configurarMfa,
  desactivarMfa,
  regenerarCodigosRecuperacion,
  type ConfiguracionMfa,
} from '@/api/mfa';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useSession } from '@/store/session';
import { colors, radius, spacing, typography } from '@/theme';

type Fase = 'reposo' | 'escaneando' | 'codigos' | 'confirmando';
type Accion = 'desactivar' | 'regenerar';

const mensajeDe = (e: unknown, porDefecto: string) => (e as ApiError)?.error?.message ?? porDefecto;

export function SeguridadMfa() {
  const { sesion, actualizarUsuario } = useSession();
  const usuario = sesion?.usuario;
  const [fase, setFase] = useState<Fase>('reposo');
  const [config, setConfig] = useState<ConfiguracionMfa | null>(null);
  const [codigo, setCodigo] = useState('');
  const [password, setPassword] = useState('');
  const [accion, setAccion] = useState<Accion>('desactivar');
  const [codigosRecuperacion, setCodigosRecuperacion] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  if (!usuario) return null;
  const activo = Boolean(usuario.mfa_activo);

  const limpiar = () => {
    setCodigo('');
    setPassword('');
    setError(null);
  };

  const ejecutar = async (tarea: () => Promise<void>, falla: string) => {
    setCargando(true);
    setError(null);
    try {
      await tarea();
    } catch (e) {
      setError(mensajeDe(e, falla));
    } finally {
      setCargando(false);
    }
  };

  const empezar = () =>
    ejecutar(async () => {
      limpiar();
      setConfig(await configurarMfa());
      setFase('escaneando');
    }, 'No pudimos generar el código QR. Inténtalo de nuevo.');

  const cancelar = () => {
    limpiar();
    setConfig(null);
    setFase('reposo');
  };

  const confirmarActivacion = () => {
    if (!codigo.trim()) {
      setError('Ingresa el código de 6 dígitos de tu app.');
      return;
    }
    return ejecutar(async () => {
      const r = await activarMfa(codigo.trim());
      setCodigosRecuperacion(r.codigos_recuperacion);
      setConfig(null);
      limpiar();
      setFase('codigos');
      await actualizarUsuario({ ...usuario, mfa_activo: true });
    }, 'No pudimos activar la verificación. Revisa el código e inténtalo de nuevo.');
  };

  const pedirConfirmacion = (a: Accion) => {
    limpiar();
    setAccion(a);
    setFase('confirmando');
  };

  const confirmarOperacion = () => {
    if (!password || !codigo.trim()) {
      setError('Ingresa tu contraseña y un código de tu app.');
      return;
    }
    const datos = { password, codigo: codigo.trim() };
    return ejecutar(async () => {
      if (accion === 'desactivar') {
        await desactivarMfa(datos);
        await actualizarUsuario({ ...usuario, mfa_activo: false });
        limpiar();
        setFase('reposo');
      } else {
        const r = await regenerarCodigosRecuperacion(datos);
        setCodigosRecuperacion(r.codigos_recuperacion);
        limpiar();
        setFase('codigos');
      }
    }, 'No pudimos completar la operación. Inténtalo de nuevo.');
  };

  return (
    <View style={styles.caja}>
      <Text style={styles.titulo}>Verificación en dos pasos</Text>

      {fase === 'reposo' && !activo ? (
        <>
          <Text style={styles.texto}>
            Protege tu cuenta: además de tu contraseña, te pediremos un código de 6 dígitos que
            genera tu teléfono. Así, aunque alguien conozca o robe tu contraseña, no podrá entrar
            sin tu dispositivo.
          </Text>
          {error ? <Aviso tipo="error">{error}</Aviso> : null}
          <Button title="Activar con código QR" onPress={empezar} loading={cargando} compact />
        </>
      ) : null}

      {fase === 'escaneando' && config ? (
        <>
          <Text style={styles.texto}>
            1. Instala una app autenticadora (Google Authenticator, Microsoft Authenticator,
            Authy…).
            {'\n'}2. Escanea este código QR con la app.{'\n'}3. Escribe aquí el código de 6 dígitos
            que muestra.
          </Text>
          <Image
            accessibilityLabel="Código QR para configurar la verificación en dos pasos"
            source={{ uri: config.qr }}
            style={styles.qr}
            resizeMode="contain"
          />
          <Text style={styles.nota}>
            ¿No puedes escanearlo? Ingresa esta clave en la app: {config.secreto}
          </Text>
          <TextField
            label="Código de 6 dígitos"
            value={codigo}
            onChangeText={setCodigo}
            keyboardType="number-pad"
            maxLength={7}
            autoComplete="one-time-code"
          />
          {error ? <Aviso tipo="error">{error}</Aviso> : null}
          <Button
            title="Confirmar y activar"
            onPress={confirmarActivacion}
            loading={cargando}
            compact
          />
          <Button title="Cancelar" onPress={cancelar} variant="link" compact />
        </>
      ) : null}

      {fase === 'codigos' ? (
        <>
          <Aviso tipo="exito">Verificación en dos pasos activa.</Aviso>
          <Text style={styles.texto}>
            Guarda estos códigos de recuperación en un lugar seguro. Cada uno sirve una sola vez si
            pierdes tu teléfono. No volverán a mostrarse.
          </Text>
          <View style={styles.codigos} accessibilityLabel="Códigos de recuperación">
            {codigosRecuperacion.map((c) => (
              <Text key={c} selectable style={styles.codigo}>
                {c}
              </Text>
            ))}
          </View>
          <Button
            title="Ya los guardé"
            onPress={() => {
              setCodigosRecuperacion([]);
              setFase('reposo');
            }}
            compact
          />
        </>
      ) : null}

      {fase === 'reposo' && activo ? (
        <>
          <Aviso tipo="exito">Activa: tu cuenta pide un código de tu app al iniciar sesión.</Aviso>
          <Button
            title="Generar nuevos códigos de recuperación"
            onPress={() => pedirConfirmacion('regenerar')}
            variant="link"
            compact
          />
          <Button
            title="Desactivar"
            onPress={() => pedirConfirmacion('desactivar')}
            variant="link"
            compact
          />
        </>
      ) : null}

      {fase === 'confirmando' ? (
        <>
          <Text style={styles.texto}>
            {accion === 'desactivar'
              ? 'Para desactivarla confirma tu identidad con tu contraseña y un código de tu app.'
              : 'Los códigos anteriores dejarán de funcionar. Confirma con tu contraseña y un código de tu app.'}
          </Text>
          <TextField
            label="Contraseña"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
          />
          <TextField
            label="Código de 6 dígitos"
            value={codigo}
            onChangeText={setCodigo}
            keyboardType="number-pad"
            maxLength={7}
            autoComplete="one-time-code"
          />
          {error ? <Aviso tipo="error">{error}</Aviso> : null}
          <Button
            title={accion === 'desactivar' ? 'Desactivar verificación' : 'Generar códigos nuevos'}
            onPress={confirmarOperacion}
            loading={cargando}
            compact
          />
          <Button title="Cancelar" onPress={cancelar} variant="link" compact />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  caja: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  titulo: { ...typography.subtitle, color: colors.text, marginBottom: spacing.xs },
  texto: { ...typography.body, color: colors.text, marginBottom: spacing.md },
  nota: { ...typography.body, color: colors.textMuted, marginBottom: spacing.md },
  qr: { width: 220, height: 220, alignSelf: 'center', marginBottom: spacing.md },
  codigos: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  codigo: { ...typography.body, color: colors.text, fontFamily: 'monospace', letterSpacing: 1 },
});
