/** Presenta y gestiona las notificaciones visibles en el centro de notificaciones. */
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import {
  guardarPreferenciasNotificacion,
  listarMisNotificaciones,
  listarPreferenciasNotificacion,
  marcarNotificacionLeida,
  type NotificacionAcompanamiento,
  type PreferenciaNotificacion,
} from '@/api/planes';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { colors, radius, spacing, typography } from '@/theme';

const mensajeDe = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'error' in error) {
    const mensaje = (error as { error?: { message?: string } }).error?.message;
    if (mensaje) return mensaje;
  }
  return 'No pudimos cargar las notificaciones. Inténtalo de nuevo.';
};

export function CentroNotificacionesPanel() {
  const [notificaciones, setNotificaciones] = useState<NotificacionAcompanamiento[]>([]);
  const [preferencias, setPreferencias] = useState<PreferenciaNotificacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [soloAlertas, setSoloAlertas] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    const [avisos, opciones] = await Promise.allSettled([
      listarMisNotificaciones(),
      listarPreferenciasNotificacion(),
    ]);
    const errores: string[] = [];
    if (avisos.status === 'fulfilled') setNotificaciones(avisos.value.resultados);
    else errores.push(mensajeDe(avisos.reason));
    if (opciones.status === 'fulfilled') setPreferencias(opciones.value);
    else errores.push(mensajeDe(opciones.reason));
    setError(errores.join(' '));
    setCargando(false);
  }, []);

  useEffect(() => {
    const temporizador = setTimeout(() => void cargar(), 0);
    return () => clearTimeout(temporizador);
  }, [cargar]);

  const alternarPreferencia = async (preferencia: PreferenciaNotificacion, habilitada: boolean) => {
    const anteriores = preferencias;
    const nuevas = preferencias.map((item) =>
      item.tipo === preferencia.tipo ? { ...item, habilitada } : item,
    );
    setPreferencias(nuevas);
    setGuardando(preferencia.tipo);
    setError('');
    try {
      setPreferencias(await guardarPreferenciasNotificacion(nuevas));
    } catch (e) {
      setPreferencias(anteriores);
      setError(mensajeDe(e));
    } finally {
      setGuardando(null);
    }
  };

  const marcarLeida = async (notificacion: NotificacionAcompanamiento) => {
    try {
      await marcarNotificacionLeida(notificacion.id);
      setNotificaciones((actuales) =>
        actuales.map((item) =>
          item.id === notificacion.id ? { ...item, leida: new Date().toISOString() } : item,
        ),
      );
    } catch (e) {
      setError(mensajeDe(e));
    }
  };

  const hayAlertas = notificaciones.some((item) => item.tipo === 'alerta');
  const visibles = soloAlertas
    ? notificaciones.filter((item) => item.tipo === 'alerta')
    : notificaciones;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Centro de notificaciones</Text>
      <Text style={styles.subtitle}>
        Consulta tus avisos y elige qué tipos quieres recibir en la aplicación.
      </Text>
      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      <View style={styles.section}>
        <Text style={styles.heading}>Preferencias por tipo de aviso</Text>
        {preferencias.map((preferencia) => (
          <View key={preferencia.tipo} style={styles.preferenceRow}>
            <Text style={styles.preferenceLabel}>{preferencia.nombre}</Text>
            <Switch
              accessibilityLabel={preferencia.nombre}
              value={preferencia.habilitada}
              disabled={guardando !== null}
              onValueChange={(valor) => void alternarPreferencia(preferencia, valor)}
            />
          </View>
        ))}
      </View>
      <View style={styles.section}>
        <View style={styles.headingRow}>
          <Text style={styles.heading}>Avisos recientes</Text>
          <Button title="Actualizar" variant="link" onPress={() => void cargar()} />
        </View>
        {hayAlertas ? (
          <View style={styles.preferenceRow}>
            <Text style={styles.preferenceLabel}>Solo alertas académicas</Text>
            <Switch
              accessibilityLabel="Solo alertas académicas"
              value={soloAlertas}
              onValueChange={setSoloAlertas}
            />
          </View>
        ) : null}
        {cargando ? <Aviso tipo="nota">Cargando avisos…</Aviso> : null}
        {!cargando && notificaciones.length === 0 ? (
          <Aviso tipo="nota">Todavía no tienes notificaciones.</Aviso>
        ) : null}
        {visibles.map((notificacion) => (
          <View key={notificacion.id} style={styles.notification}>
            <View style={styles.notificationHeading}>
              <Text style={styles.notificationTitle}>{notificacion.titulo}</Text>
              {notificacion.leida ? null : <Text style={styles.unread}>Sin leer</Text>}
            </View>
            <Text style={styles.notificationMessage}>{notificacion.mensaje}</Text>
            <Text style={styles.date}>{new Date(notificacion.creada).toLocaleString('es-CO')}</Text>
            {notificacion.leida ? null : (
              <Button
                title="Marcar como leída"
                variant="link"
                onPress={() => void marcarLeida(notificacion)}
              />
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted },
  section: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  headingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  heading: { ...typography.subtitle, color: colors.text },
  preferenceRow: {
    minHeight: 48,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  preferenceLabel: { ...typography.body, color: colors.text, flex: 1, minWidth: 0 },
  notification: {
    padding: spacing.md,
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  notificationHeading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  notificationTitle: { color: colors.text, fontWeight: '700' },
  unread: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  notificationMessage: { ...typography.body, color: colors.text },
  date: { color: colors.textMuted, fontSize: 11 },
});
