/** Permite consultar y administrar los períodos académicos. */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  actualizarPeriodo,
  crearPeriodo,
  fechaValida,
  listarPeriodos,
  type Periodo,
} from '@/api/academico';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { FormModal } from '@/components/FormModal';
import { EmbeddedScreenFrame } from '@/components/EmbeddedScreenFrame';
import { TextField } from '@/components/TextField';
import { useCarga } from '@/hooks/useCarga';
import { useSession } from '@/store/session';
import { colors, radius, spacing, typography } from '@/theme';
import { esAdministrador } from '@/types/roles';
import { erroresDeCampos, mensajeDe } from '@/utils/errores';

type Formulario = { nombre: string; fecha_inicio: string; fecha_fin: string };
const VACIO: Formulario = { nombre: '', fecha_inicio: '', fecha_fin: '' };

export function PeriodosScreen({ embedded = false }: { embedded?: boolean }) {
  const { sesion } = useSession();
  const puedeEditar = esAdministrador(sesion?.usuario.rol);
  const autenticado = sesion !== null;

  const carga = useCarga(listarPeriodos, {
    habilitado: autenticado,
    error: 'No pudimos cargar los periodos. Revisa tu conexión e inténtalo de nuevo.',
  });

  const [panel, setPanel] = useState<'nuevo' | number | null>(null);
  const [form, setForm] = useState<Formulario>(VACIO);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  if (!autenticado) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Text style={styles.title}>Sin sesión</Text>
        <Aviso tipo="error">Inicia sesión para ver los periodos académicos.</Aviso>
      </EmbeddedScreenFrame>
    );
  }
  if (carga.error) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Text style={styles.title}>Periodos académicos</Text>
        <Aviso tipo="error">{carga.error}</Aviso>
        <Button title="Reintentar" onPress={carga.recargar} />
      </EmbeddedScreenFrame>
    );
  }
  if (carga.cargando || !carga.datos) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Text style={styles.title}>Periodos académicos</Text>
        <Aviso tipo="nota">Cargando…</Aviso>
      </EmbeddedScreenFrame>
    );
  }
  const periodos = carga.datos;

  const abrir = (p: Periodo | 'nuevo') => {
    setPanel(p === 'nuevo' ? 'nuevo' : p.id);
    setForm(
      p === 'nuevo'
        ? VACIO
        : { nombre: p.nombre, fecha_inicio: p.fecha_inicio, fecha_fin: p.fecha_fin },
    );
    setErrores({});
    setErrorGeneral(null);
    setMensaje(null);
  };

  const guardar = async () => {
    const locales: Record<string, string> = {};
    if (!form.nombre.trim()) locales.nombre = 'Ingresa el nombre del periodo.';
    if (!fechaValida(form.fecha_inicio)) locales.fecha_inicio = 'Usa el formato AAAA-MM-DD.';
    if (!fechaValida(form.fecha_fin)) locales.fecha_fin = 'Usa el formato AAAA-MM-DD.';
    if (!locales.fecha_inicio && !locales.fecha_fin && form.fecha_fin < form.fecha_inicio) {
      locales.fecha_fin = 'La fecha de fin no puede ser anterior a la de inicio.';
    }
    setErrores(locales);
    if (Object.keys(locales).length > 0) return;

    setGuardando(true);
    setErrorGeneral(null);
    try {
      const datos = { ...form, nombre: form.nombre.trim() };
      if (panel === 'nuevo') await crearPeriodo(datos);
      else await actualizarPeriodo(panel as number, datos);
      const fresca = await listarPeriodos();
      carga.actualizar(() => fresca);
      setPanel(null);
      setMensaje(panel === 'nuevo' ? 'Periodo creado.' : 'Periodo actualizado.');
    } catch (e) {
      const porCampo = erroresDeCampos(e);
      setErrores(porCampo);
      if (Object.keys(porCampo).length === 0) {
        setErrorGeneral(
          mensajeDe(e, 'No pudimos guardar. Revisa tu conexión e inténtalo de nuevo.'),
        );
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <EmbeddedScreenFrame embedded={embedded}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Periodos académicos</Text>
        {!puedeEditar ? (
          <Aviso tipo="nota">Solo lectura: únicamente un administrador los modifica.</Aviso>
        ) : null}
        {mensaje ? <Aviso tipo="exito">{mensaje}</Aviso> : null}
        {periodos.length === 0 ? <Aviso tipo="nota">Aún no hay periodos registrados.</Aviso> : null}

        {periodos.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={`Periodo ${p.nombre}`}
            disabled={!puedeEditar}
            onPress={() => abrir(p)}
            style={[styles.fila, p.es_actual && styles.filaActual]}
          >
            <View style={styles.filaTexto}>
              <Text style={styles.nombre}>{p.nombre}</Text>
              <Text style={styles.nota}>
                {p.fecha_inicio} al {p.fecha_fin}
              </Text>
            </View>
            {p.es_actual ? <Text style={styles.etiqueta}>Vigente</Text> : null}
          </Pressable>
        ))}

        {puedeEditar && panel === null ? (
          <Button title="Agregar periodo" onPress={() => abrir('nuevo')} />
        ) : null}

        {panel !== null ? (
          <FormModal visible={panel !== null} onClose={() => !guardando && setPanel(null)}>
            <View style={styles.panel}>
              <Text style={styles.nombre}>
                {panel === 'nuevo' ? 'Nuevo periodo' : 'Editar periodo'}
              </Text>
              <TextField
                label="Nombre del periodo"
                value={form.nombre}
                onChangeText={(t) => setForm((f) => ({ ...f, nombre: t }))}
                error={errores.nombre}
              />
              <TextField
                label="Fecha de inicio (AAAA-MM-DD)"
                value={form.fecha_inicio}
                onChangeText={(t) => setForm((f) => ({ ...f, fecha_inicio: t }))}
                error={errores.fecha_inicio}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
              />
              <TextField
                label="Fecha de fin (AAAA-MM-DD)"
                value={form.fecha_fin}
                onChangeText={(t) => setForm((f) => ({ ...f, fecha_fin: t }))}
                error={errores.fecha_fin}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
              />
              {errores.non_field_errors ? (
                <Aviso tipo="error">{errores.non_field_errors}</Aviso>
              ) : null}
              {errorGeneral ? <Aviso tipo="error">{errorGeneral}</Aviso> : null}
              <Button title="Guardar" onPress={guardar} loading={guardando} />
              <Button
                title="Cancelar"
                onPress={() => setPanel(null)}
                variant="link"
                disabled={guardando}
              />
            </View>
          </FormModal>
        ) : null}
      </ScrollView>
    </EmbeddedScreenFrame>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginBottom: spacing.md },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  filaActual: { borderColor: colors.primary },
  filaTexto: { flex: 1, marginRight: spacing.sm },
  nombre: { ...typography.subtitle, color: colors.text },
  nota: { ...typography.body, color: colors.textMuted },
  etiqueta: { ...typography.body, color: colors.primary, fontWeight: '700' },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
});
