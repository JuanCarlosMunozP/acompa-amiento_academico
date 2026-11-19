/** Administra la estructura académica definida para la institución. */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  actualizarGrado,
  actualizarGrupo,
  crearGrado,
  crearGrupo,
  listarGradosAdmin,
  type GradoAdmin,
} from '@/api/academico';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { FormModal } from '@/components/FormModal';
import { EmbeddedScreenFrame } from '@/components/EmbeddedScreenFrame';
import { SwitchField } from '@/components/SwitchField';
import { TextField } from '@/components/TextField';
import { useCarga } from '@/hooks/useCarga';
import { useSession } from '@/store/session';
import { colors, radius, spacing, typography } from '@/theme';
import { esAdministrador, puedeVerRoles } from '@/types/roles';
import { erroresDeCampos, mensajeDe } from '@/utils/errores';

// Qué se está editando: un grado (nuevo o existente) o un grupo (nuevo o existente).
type Panel =
  { tipo: 'grado'; id: number | null } | { tipo: 'grupo'; id: number | null; gradoId: number };

type Formulario = { nombre: string; orden: string; activo: boolean };

export function EstructuraScreen({ embedded = false }: { embedded?: boolean }) {
  const { sesion } = useSession();
  const puedeVer = puedeVerRoles(sesion?.usuario.rol);
  const puedeEditar = esAdministrador(sesion?.usuario.rol);

  const carga = useCarga(listarGradosAdmin, {
    habilitado: puedeVer,
    error: 'No pudimos cargar los grados. Revisa tu conexión e inténtalo de nuevo.',
  });

  const [panel, setPanel] = useState<Panel | null>(null);
  const [form, setForm] = useState<Formulario>({ nombre: '', orden: '', activo: true });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  if (!puedeVer) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Text style={styles.title}>Sin acceso</Text>
        <Aviso tipo="error">No tienes permiso para ver los grados y grupos.</Aviso>
      </EmbeddedScreenFrame>
    );
  }
  if (carga.error) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Text style={styles.title}>Grados y grupos</Text>
        <Aviso tipo="error">{carga.error}</Aviso>
        <Button title="Reintentar" onPress={carga.recargar} />
      </EmbeddedScreenFrame>
    );
  }
  if (carga.cargando || !carga.datos) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Text style={styles.title}>Grados y grupos</Text>
        <Aviso tipo="nota">Cargando…</Aviso>
      </EmbeddedScreenFrame>
    );
  }
  const grados = carga.datos;

  const abrir = (nuevo: Panel, inicial: Formulario) => {
    setPanel(nuevo);
    setForm(inicial);
    setErrores({});
    setErrorGeneral(null);
    setMensaje(null);
  };

  const guardar = async () => {
    /* istanbul ignore next -- el botón de guardar solo existe con el panel abierto */
    if (!panel) return;
    const nombre = form.nombre.trim();
    const orden = Number(form.orden);
    const locales: Record<string, string> = {};
    if (!nombre) locales.nombre = 'Ingresa un nombre.';
    if (
      panel.tipo === 'grado' &&
      (form.orden.trim() === '' || !Number.isInteger(orden) || orden < 0)
    ) {
      locales.orden = 'El orden debe ser un número entero (0, 1, 2…).';
    }
    setErrores(locales);
    if (Object.keys(locales).length > 0) return;

    setGuardando(true);
    setErrorGeneral(null);
    try {
      if (panel.tipo === 'grado') {
        if (panel.id === null) await crearGrado({ nombre, orden });
        else await actualizarGrado(panel.id, { nombre, orden, activo: form.activo });
      } else if (panel.id === null) {
        await crearGrupo({ grado: panel.gradoId, nombre });
      } else {
        await actualizarGrupo(panel.id, { nombre, activo: form.activo });
      }
      const fresca = await listarGradosAdmin();
      carga.actualizar(() => fresca);
      setPanel(null);
      setMensaje('Cambios guardados.');
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

  const titulo =
    panel?.tipo === 'grado'
      ? panel.id === null
        ? 'Nuevo grado'
        : 'Editar grado'
      : panel?.id === null
        ? 'Nuevo grupo'
        : 'Editar grupo';

  return (
    <EmbeddedScreenFrame embedded={embedded}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Grados y grupos</Text>
        {!puedeEditar ? (
          <Aviso tipo="nota">Solo lectura: únicamente un administrador los modifica.</Aviso>
        ) : null}
        {mensaje ? <Aviso tipo="exito">{mensaje}</Aviso> : null}
        {grados.length === 0 ? (
          <Aviso tipo="nota">Aún no hay grados y grupos registrados.</Aviso>
        ) : null}

        {grados.map((grado: GradoAdmin) => (
          <View key={grado.id} style={styles.tarjeta}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Grado ${grado.nombre}`}
              disabled={!puedeEditar}
              onPress={() =>
                abrir(
                  { tipo: 'grado', id: grado.id },
                  { nombre: grado.nombre, orden: String(grado.orden), activo: grado.activo },
                )
              }
            >
              <Text style={styles.gradoNombre}>
                {grado.nombre}
                {grado.activo ? '' : ' (inactivo)'}
              </Text>
            </Pressable>
            <View style={styles.grupos}>
              {grado.grupos.map((g) => (
                <Chip
                  key={g.id}
                  label={`Grupo ${g.nombre}${g.activo ? '' : ' (inactivo)'}`}
                  selected={false}
                  onPress={() =>
                    puedeEditar &&
                    abrir(
                      { tipo: 'grupo', id: g.id, gradoId: grado.id },
                      { nombre: g.nombre, orden: '', activo: g.activo },
                    )
                  }
                />
              ))}
              {grado.grupos.length === 0 ? <Text style={styles.nota}>Sin grupos</Text> : null}
            </View>
            {puedeEditar && panel === null ? (
              <Button
                title={`Agregar grupo a ${grado.nombre}`}
                onPress={() =>
                  abrir(
                    { tipo: 'grupo', id: null, gradoId: grado.id },
                    { nombre: '', orden: '', activo: true },
                  )
                }
                variant="link"
              />
            ) : null}
          </View>
        ))}

        {puedeEditar && panel === null ? (
          <Button
            title="Agregar grado"
            onPress={() =>
              abrir(
                { tipo: 'grado', id: null },
                { nombre: '', orden: String(grados.length + 1), activo: true },
              )
            }
          />
        ) : null}

        {panel ? (
          <FormModal visible={panel !== null} onClose={() => !guardando && setPanel(null)}>
            <View style={styles.panel}>
              <Text style={styles.gradoNombre}>{titulo}</Text>
              <TextField
                label={panel.tipo === 'grado' ? 'Nombre del grado' : 'Nombre del grupo'}
                value={form.nombre}
                onChangeText={(t) => setForm((f) => ({ ...f, nombre: t }))}
                error={errores.nombre ?? errores.non_field_errors}
              />
              {panel.tipo === 'grado' ? (
                <TextField
                  label="Orden en la lista"
                  value={form.orden}
                  onChangeText={(t) => setForm((f) => ({ ...f, orden: t }))}
                  error={errores.orden}
                  keyboardType="number-pad"
                />
              ) : null}
              {panel.id !== null ? (
                <SwitchField
                  label={panel.tipo === 'grado' ? 'Grado activo' : 'Grupo activo'}
                  value={form.activo}
                  onValueChange={(v) => setForm((f) => ({ ...f, activo: v }))}
                />
              ) : null}
              {errores.grado ? <Aviso tipo="error">{errores.grado}</Aviso> : null}
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
  nota: { ...typography.body, color: colors.textMuted },
  tarjeta: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  gradoNombre: { ...typography.subtitle, color: colors.text, marginBottom: spacing.sm },
  grupos: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
});
