/** Administra las plantillas de correo utilizadas por los flujos académicos. */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  guardarPlantillaCorreo,
  listarPlantillasCorreo,
  type ClavePlantillaCorreo,
  type PlantillaCorreoPlan,
} from '@/api/plantillas';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { colors, radius, spacing, typography } from '@/theme';

const ETIQUETAS: Record<ClavePlantillaCorreo, string> = {
  asignacion_tutor: 'Aviso de asignación al tutor',
  asignacion_estudiante: 'Aviso de asignación al estudiante',
};

const VARIABLES = [
  '{{ nombres }}',
  '{{ correo }}',
  '{{ estudiante }}',
  '{{ tutor }}',
  '{{ asignatura }}',
  '{{ periodo }}',
  '{{ fecha_inicio }}',
  '{{ fecha_fin }}',
  '{{ objetivos }}',
  '{{ app }}',
  '{{ institucion }}',
  '{{ color }}',
];

const mensajeDe = (error: unknown) =>
  (error as { error?: { message?: string } })?.error?.message ??
  'No pudimos guardar la plantilla. Revisa los campos e inténtalo de nuevo.';

export function PlantillasCorreoScreen({ embedded = false }: { embedded?: boolean }) {
  const [plantillas, setPlantillas] = useState<PlantillaCorreoPlan[]>([]);
  const [seleccionada, setSeleccionada] = useState<ClavePlantillaCorreo>('asignacion_tutor');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [exito, setExito] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      setPlantillas(await listarPlantillasCorreo());
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    const temporizador = setTimeout(() => void cargar(), 0);
    return () => clearTimeout(temporizador);
  }, [cargar]);

  const plantilla = plantillas.find((item) => item.clave === seleccionada);

  const cambiar = (
    campo: keyof Pick<PlantillaCorreoPlan, 'asunto' | 'cuerpo_texto' | 'cuerpo_html'>,
    valor: string,
  ) => {
    setPlantillas((actuales) =>
      actuales.map((item) => (item.clave === seleccionada ? { ...item, [campo]: valor } : item)),
    );
    setExito('');
  };

  const guardar = async () => {
    /* istanbul ignore next -- el botón de guardar solo existe con una plantilla cargada */
    if (!plantilla) return;
    setGuardando(true);
    setError('');
    setExito('');
    try {
      const actualizada = await guardarPlantillaCorreo(seleccionada, {
        asunto: plantilla.asunto,
        cuerpo_texto: plantilla.cuerpo_texto,
        cuerpo_html: plantilla.cuerpo_html,
      });
      setPlantillas((actuales) =>
        actuales.map((item) => (item.clave === seleccionada ? actualizada : item)),
      );
      setExito('La plantilla se guardó correctamente.');
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.content, !embedded && styles.standalone]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Plantillas de correo</Text>
      <Text style={styles.description}>
        Personaliza los correos enviados cuando coordinación asigna un plan de refuerzo. Los cambios
        no modifican los correos de verificación ni recuperación de cuenta.
      </Text>
      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      {exito ? <Aviso tipo="exito">{exito}</Aviso> : null}
      <View style={styles.tabs}>
        {(Object.keys(ETIQUETAS) as ClavePlantillaCorreo[]).map((clave) => (
          <Pressable
            key={clave}
            accessibilityRole="button"
            accessibilityState={{ selected: seleccionada === clave }}
            onPress={() => setSeleccionada(clave)}
            style={[styles.tab, seleccionada === clave && styles.tabSelected]}
          >
            <Text style={[styles.tabText, seleccionada === clave && styles.tabTextSelected]}>
              {ETIQUETAS[clave]}
            </Text>
          </Pressable>
        ))}
      </View>
      {cargando ? <Aviso tipo="nota">Cargando plantillas…</Aviso> : null}
      {!cargando && plantilla ? (
        <View style={styles.form}>
          <Text style={styles.label}>Asunto</Text>
          <TextInput
            accessibilityLabel="Asunto del correo"
            value={plantilla.asunto}
            onChangeText={(valor) => cambiar('asunto', valor)}
            style={styles.input}
            maxLength={160}
          />
          <Text style={styles.label}>Contenido de texto</Text>
          <TextInput
            accessibilityLabel="Contenido de texto del correo"
            value={plantilla.cuerpo_texto}
            onChangeText={(valor) => cambiar('cuerpo_texto', valor)}
            style={[styles.input, styles.multiline]}
            multiline
            textAlignVertical="top"
          />
          <Text style={styles.label}>Contenido HTML</Text>
          <TextInput
            accessibilityLabel="Contenido HTML del correo"
            value={plantilla.cuerpo_html}
            onChangeText={(valor) => cambiar('cuerpo_html', valor)}
            style={[styles.input, styles.multiline]}
            multiline
            textAlignVertical="top"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.helperTitle}>Variables disponibles</Text>
          <Text style={styles.helper}>{VARIABLES.join('  ·  ')}</Text>
          <Button title="Guardar plantilla" onPress={() => void guardar()} loading={guardando} />
        </View>
      ) : null}
      {!cargando && !plantilla && !error ? (
        <Aviso tipo="nota">No se encontró la plantilla seleccionada.</Aviso>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  standalone: { padding: spacing.md },
  title: { ...typography.title, color: colors.text },
  description: { ...typography.body, color: colors.textMuted },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { ...typography.body, color: colors.text },
  tabTextSelected: { color: colors.primaryText },
  form: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  label: { ...typography.subtitle, color: colors.text },
  input: {
    ...typography.body,
    color: colors.text,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  multiline: { minHeight: 150 },
  helperTitle: { ...typography.subtitle, color: colors.text, marginTop: spacing.sm },
  helper: { ...typography.body, color: colors.textMuted },
});
