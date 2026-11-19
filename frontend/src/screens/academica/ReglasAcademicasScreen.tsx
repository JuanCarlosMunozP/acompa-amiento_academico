/** Presenta las reglas que configuran el comportamiento académico del sistema. */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import {
  actualizarReglaAcademica,
  crearReglaAcademica,
  listarReglasAcademicas,
  type DatosReglaAcademica,
  type ReglaAcademica,
} from '@/api/seguimiento';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { EmbeddedScreenFrame } from '@/components/EmbeddedScreenFrame';
import { TextField } from '@/components/TextField';
import { useCarga } from '@/hooks/useCarga';
import { useSession } from '@/store/session';
import { colors, radius, spacing, typography } from '@/theme';
import { esAdministrador } from '@/types/roles';
import { erroresDeCampos, mensajeDe } from '@/utils/errores';

const TIPOS: { value: DatosReglaAcademica['tipo']; label: string }[] = [
  { value: 'nota_baja', label: 'Nota baja' },
  { value: 'asistencia_baja', label: 'Asistencia baja' },
  { value: 'trabajos_pendientes', label: 'Trabajos pendientes' },
];

const SEVERIDADES: { value: DatosReglaAcademica['severidad']; label: string }[] = [
  { value: 'atencion', label: 'Atención' },
  { value: 'riesgo', label: 'Riesgo' },
  { value: 'critico', label: 'Crítico' },
];

const NUEVA: DatosReglaAcademica = {
  nombre: '',
  tipo: 'nota_baja',
  umbral: '',
  severidad: 'atencion',
  activa: true,
};

export function ReglasAcademicasScreen({ embedded = false }: { embedded?: boolean }) {
  const { sesion } = useSession();
  const puedeEditar = esAdministrador(sesion?.usuario.rol);
  const carga = useCarga(listarReglasAcademicas, {
    habilitado: sesion !== null,
    error: 'No pudimos cargar las reglas académicas. Revisa tu conexión e inténtalo de nuevo.',
  });
  const [seleccion, setSeleccion] = useState<ReglaAcademica | 'nueva' | null>(null);
  const [form, setForm] = useState<DatosReglaAcademica>(NUEVA);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [guardando, setGuardando] = useState(false);

  if (!sesion) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Text style={styles.title}>Reglas académicas</Text>
        <Aviso tipo="error">Inicia sesión para consultar las reglas.</Aviso>
      </EmbeddedScreenFrame>
    );
  }

  if (carga.error) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Text style={styles.title}>Reglas académicas</Text>
        <Aviso tipo="error">{carga.error}</Aviso>
        <Button title="Reintentar" onPress={carga.recargar} />
      </EmbeddedScreenFrame>
    );
  }

  const abrir = (regla: ReglaAcademica | 'nueva') => {
    setSeleccion(regla);
    setForm(
      regla === 'nueva'
        ? NUEVA
        : {
            nombre: regla.nombre,
            tipo: regla.tipo,
            umbral: regla.umbral,
            severidad: regla.severidad,
            activa: regla.activa,
          },
    );
    setErrores({});
    setErrorGeneral('');
    setMensaje('');
  };

  const guardar = async () => {
    const erroresLocales: Record<string, string> = {};
    if (!form.nombre.trim()) erroresLocales.nombre = 'Ingresa un nombre para la regla.';
    if (!form.umbral.trim()) erroresLocales.umbral = 'Ingresa el valor del umbral.';
    setErrores(erroresLocales);
    if (Object.keys(erroresLocales).length > 0) return;

    setGuardando(true);
    setErrorGeneral('');
    setMensaje('');
    try {
      const datos = { ...form, nombre: form.nombre.trim(), umbral: form.umbral.trim() };
      if (seleccion === 'nueva') await crearReglaAcademica(datos);
      // El formulario solo existe con una regla seleccionada (nueva o existente).
      else await actualizarReglaAcademica((seleccion as ReglaAcademica).id, datos);
      const reglasActualizadas = await listarReglasAcademicas();
      carga.actualizar(() => reglasActualizadas);
      setSeleccion(null);
      setMensaje('La regla académica se guardó correctamente.');
    } catch (e) {
      setErrores(erroresDeCampos(e));
      setErrorGeneral(mensajeDe(e, 'No pudimos guardar la regla.'));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <EmbeddedScreenFrame embedded={embedded}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Reglas académicas y umbrales</Text>
        <Text style={styles.description}>
          Las reglas clasifican señales académicas de acuerdo con los valores definidos por la
          institución.
        </Text>
        {!puedeEditar ? (
          <Aviso tipo="nota">
            Solo lectura: únicamente un administrador modifica estas reglas.
          </Aviso>
        ) : null}
        {mensaje ? <Aviso tipo="exito">{mensaje}</Aviso> : null}
        {carga.cargando || !carga.datos ? <Aviso tipo="nota">Cargando reglas…</Aviso> : null}
        {carga.datos?.map((regla) => (
          <View key={regla.id} style={styles.rule}>
            <View style={styles.ruleHeader}>
              <Text style={styles.ruleName}>{regla.nombre}</Text>
              <Text style={[styles.badge, !regla.activa && styles.badgeOff]}>
                {regla.activa ? 'Activa' : 'Inactiva'}
              </Text>
            </View>
            <Text style={styles.ruleDetails}>
              {TIPOS.find((item) => item.value === regla.tipo)?.label} · Umbral {regla.umbral} ·{' '}
              {SEVERIDADES.find((item) => item.value === regla.severidad)?.label}
            </Text>
            {puedeEditar ? (
              <Button title="Editar regla" variant="link" onPress={() => abrir(regla)} />
            ) : null}
          </View>
        ))}
        {puedeEditar && seleccion === null ? (
          <Button title="Agregar regla" onPress={() => abrir('nueva')} />
        ) : null}
        {seleccion !== null ? (
          <View style={styles.form}>
            <Text style={styles.formTitle}>
              {seleccion === 'nueva' ? 'Nueva regla' : 'Editar regla'}
            </Text>
            <TextField
              label="Nombre"
              value={form.nombre}
              onChangeText={(nombre) => setForm((actual) => ({ ...actual, nombre }))}
              error={errores.nombre}
              maxLength={100}
            />
            <Text style={styles.label}>Tipo</Text>
            <View style={styles.options}>
              {TIPOS.map((item) => (
                <Pressable
                  key={item.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: form.tipo === item.value }}
                  onPress={() => setForm((actual) => ({ ...actual, tipo: item.value }))}
                  style={[styles.option, form.tipo === item.value && styles.optionSelected]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      form.tipo === item.value && styles.optionTextSelected,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextField
              label="Umbral"
              value={form.umbral}
              onChangeText={(umbral) => setForm((actual) => ({ ...actual, umbral }))}
              error={errores.umbral}
              keyboardType="decimal-pad"
            />
            <Text style={styles.label}>Severidad</Text>
            <View style={styles.options}>
              {SEVERIDADES.map((item) => (
                <Pressable
                  key={item.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: form.severidad === item.value }}
                  onPress={() => setForm((actual) => ({ ...actual, severidad: item.value }))}
                  style={[styles.option, form.severidad === item.value && styles.optionSelected]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      form.severidad === item.value && styles.optionTextSelected,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {seleccion !== 'nueva' ? (
              <View style={styles.switchRow}>
                <Text style={styles.label}>Regla activa</Text>
                <Switch
                  value={form.activa}
                  onValueChange={(activa) => setForm((actual) => ({ ...actual, activa }))}
                />
              </View>
            ) : null}
            {errorGeneral ? <Aviso tipo="error">{errorGeneral}</Aviso> : null}
            <Button title="Guardar regla" onPress={() => void guardar()} loading={guardando} />
            <Button
              title="Cancelar"
              onPress={() => setSeleccion(null)}
              variant="link"
              disabled={guardando}
            />
          </View>
        ) : null}
      </ScrollView>
    </EmbeddedScreenFrame>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  title: { ...typography.title, color: colors.text, marginBottom: spacing.sm },
  description: { ...typography.body, color: colors.textMuted },
  rule: {
    gap: spacing.xs,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  ruleHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  ruleName: { ...typography.subtitle, color: colors.text, flex: 1 },
  badge: { color: colors.success, fontSize: 12, fontWeight: '700' },
  badgeOff: { color: colors.textMuted },
  ruleDetails: { ...typography.body, color: colors.textMuted },
  form: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  formTitle: { ...typography.subtitle, color: colors.text },
  label: { ...typography.body, color: colors.text },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  option: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  optionText: { ...typography.body, color: colors.text },
  optionTextSelected: { color: colors.primaryText },
  switchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
});
