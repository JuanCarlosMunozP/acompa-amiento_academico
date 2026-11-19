/** Muestra la ficha y los datos de perfil del usuario autenticado. */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { obtenerMiFicha, type FichaEstudiante } from '@/api/perfil';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useSession } from '@/store/session';
import { colors, radius, spacing, typography } from '@/theme';

export function MiFichaScreen() {
  const { sesion } = useSession();
  const esEstudiante = sesion?.usuario.rol === 'estudiante';

  const [intento, setIntento] = useState(0);
  const [resuelto, setResuelto] = useState(-1);
  const [error, setError] = useState<{ intento: number; mensaje: string } | null>(null);
  const [ficha, setFicha] = useState<FichaEstudiante | null>(null);

  useEffect(() => {
    if (!esEstudiante) return;
    let vigente = true;
    obtenerMiFicha()
      .then((f) => {
        if (!vigente) return;
        setFicha(f);
        setResuelto(intento);
      })
      .catch((e) => {
        if (!vigente) return;
        setError({
          intento,
          mensaje:
            (e as { error?: { message?: string } })?.error?.message ??
            'No pudimos cargar tu ficha. Revisa tu conexión e inténtalo de nuevo.',
        });
        setResuelto(intento);
      });
    return () => {
      vigente = false;
    };
  }, [esEstudiante, intento]);

  if (!esEstudiante) {
    return (
      <Screen>
        <Text style={styles.title}>Sin acceso</Text>
        <Text accessibilityRole="alert" style={styles.error}>
          La ficha es solo para estudiantes.
        </Text>
      </Screen>
    );
  }

  const mensajeError = error?.intento === intento ? error.mensaje : null;
  if (mensajeError) {
    return (
      <Screen>
        <Text style={styles.title}>Mi ficha</Text>
        <Text accessibilityRole="alert" style={styles.error}>
          {mensajeError}
        </Text>
        <Button title="Reintentar" onPress={() => setIntento((n) => n + 1)} />
      </Screen>
    );
  }
  if (resuelto !== intento || !ficha) {
    return (
      <Screen>
        <Text style={styles.title}>Mi ficha</Text>
        <Text style={styles.nota}>Cargando…</Text>
      </Screen>
    );
  }

  const { usuario, grado, grupo, trabajos_pendientes } = ficha;
  return (
    <Screen>
      <Text style={styles.title}>Mi ficha</Text>
      <View style={styles.tarjeta}>
        <Text style={styles.nombre}>
          {usuario.nombres} {usuario.apellidos}
        </Text>
        <Text style={styles.nota}>{usuario.email}</Text>
        <Fila etiqueta="Grado" valor={grado?.nombre ?? 'Sin asignar'} />
        <Fila etiqueta="Grupo" valor={grupo?.nombre ?? 'Sin asignar'} />
        <Fila etiqueta="Trabajos sin entregar" valor={String(trabajos_pendientes)} />
      </View>
      {!grupo ? (
        <Text style={styles.nota}>
          Coordinación te asignará un grupo. Si ya debería estar asignado, avísales.
        </Text>
      ) : null}
    </Screen>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <View style={styles.fila}>
      <Text style={styles.etiqueta}>{etiqueta}</Text>
      <Text style={styles.valor}>{valor}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginBottom: spacing.md },
  tarjeta: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  nombre: { ...typography.subtitle, color: colors.text, marginBottom: spacing.xs },
  nota: { ...typography.body, color: colors.textMuted, marginBottom: spacing.md },
  fila: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  etiqueta: { ...typography.body, color: colors.textMuted },
  valor: { ...typography.subtitle, color: colors.text },
  error: { ...typography.body, color: colors.error, marginBottom: spacing.md },
});
