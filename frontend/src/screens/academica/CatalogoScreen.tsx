/** Presenta las herramientas para consultar y administrar catálogos académicos. */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  actualizarAsignatura,
  crearAsignatura,
  listarAsignaturasAdmin,
  type AsignaturaAdmin,
} from '@/api/academico';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { FormModal } from '@/components/FormModal';
import { EmbeddedScreenFrame } from '@/components/EmbeddedScreenFrame';
import { SwitchField } from '@/components/SwitchField';
import { TextField } from '@/components/TextField';
import { useCarga } from '@/hooks/useCarga';
import { useSession } from '@/store/session';
import { colors, radius, spacing, typography } from '@/theme';
import { esAdministrador, puedeVerRoles } from '@/types/roles';
import { erroresDeCampos, mensajeDe } from '@/utils/errores';

export function CatalogoScreen({ embedded = false }: { embedded?: boolean }) {
  const { sesion } = useSession();
  const puedeVer = puedeVerRoles(sesion?.usuario.rol);
  const puedeEditar = esAdministrador(sesion?.usuario.rol);

  const carga = useCarga(listarAsignaturasAdmin, {
    habilitado: puedeVer,
    error: 'No pudimos cargar el catálogo. Revisa tu conexión e inténtalo de nuevo.',
  });

  const [soloActivas, setSoloActivas] = useState(false);
  // 'nueva', el id de la que se edita, o null si el panel está cerrado.
  const [panel, setPanel] = useState<'nueva' | number | null>(null);
  const [nombre, setNombre] = useState('');
  const [activa, setActiva] = useState(true);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  if (!puedeVer) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Text style={styles.title}>Sin acceso</Text>
        <Aviso tipo="error">No tienes permiso para ver el catálogo de asignaturas.</Aviso>
      </EmbeddedScreenFrame>
    );
  }
  if (carga.error) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Text style={styles.title}>Catálogo de asignaturas</Text>
        <Aviso tipo="error">{carga.error}</Aviso>
        <Button title="Reintentar" onPress={carga.recargar} />
      </EmbeddedScreenFrame>
    );
  }
  if (carga.cargando || !carga.datos) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Text style={styles.title}>Catálogo de asignaturas</Text>
        <Aviso tipo="nota">Cargando…</Aviso>
      </EmbeddedScreenFrame>
    );
  }

  const asignaturas = carga.datos;
  const visibles = soloActivas ? asignaturas.filter((a) => a.activa) : asignaturas;

  const abrir = (a: AsignaturaAdmin | 'nueva') => {
    setPanel(a === 'nueva' ? 'nueva' : a.id);
    setNombre(a === 'nueva' ? '' : a.nombre);
    setActiva(a === 'nueva' ? true : a.activa);
    setErrores({});
    setErrorGeneral(null);
    setMensaje(null);
  };

  const guardar = async () => {
    if (!nombre.trim()) {
      setErrores({ nombre: 'Ingresa el nombre de la asignatura.' });
      return;
    }
    setGuardando(true);
    setErrores({});
    setErrorGeneral(null);
    try {
      if (panel === 'nueva') await crearAsignatura(nombre.trim());
      else await actualizarAsignatura(panel as number, { nombre: nombre.trim(), activa });
      const fresca = await listarAsignaturasAdmin();
      carga.actualizar(() => fresca);
      setPanel(null);
      setMensaje(panel === 'nueva' ? 'Asignatura creada.' : 'Asignatura actualizada.');
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
        <Text style={styles.title}>Catálogo de asignaturas</Text>
        {!puedeEditar ? (
          <Aviso tipo="nota">Solo lectura: únicamente un administrador lo modifica.</Aviso>
        ) : null}
        <Aviso tipo="nota">
          Una asignatura desactivada deja de ofrecerse a los tutores, pero conserva su historial.
        </Aviso>
        {mensaje ? <Aviso tipo="exito">{mensaje}</Aviso> : null}

        <SwitchField
          label="Mostrar solo las activas"
          value={soloActivas}
          onValueChange={setSoloActivas}
        />

        {visibles.length === 0 ? <Aviso tipo="nota">No hay asignaturas para mostrar.</Aviso> : null}
        {visibles.map((a) => (
          <Pressable
            key={a.id}
            accessibilityRole="button"
            accessibilityLabel={`Asignatura ${a.nombre}`}
            disabled={!puedeEditar}
            onPress={() => abrir(a)}
            style={styles.fila}
          >
            <Text style={styles.nombre}>{a.nombre}</Text>
            <Text style={styles.etiqueta}>{a.activa ? 'Activa' : 'Inactiva'}</Text>
          </Pressable>
        ))}

        {puedeEditar && panel === null ? (
          <Button title="Agregar asignatura" onPress={() => abrir('nueva')} />
        ) : null}

        {panel !== null ? (
          <FormModal visible={panel !== null} onClose={() => !guardando && setPanel(null)}>
            <View style={styles.panel}>
              <Text style={styles.nombre}>
                {panel === 'nueva' ? 'Nueva asignatura' : 'Editar asignatura'}
              </Text>
              <TextField
                label="Nombre de la asignatura"
                value={nombre}
                onChangeText={setNombre}
                error={errores.nombre}
              />
              {panel !== 'nueva' ? (
                <SwitchField label="Asignatura activa" value={activa} onValueChange={setActiva} />
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
  nombre: { ...typography.subtitle, color: colors.text },
  etiqueta: { ...typography.body, color: colors.primary, fontWeight: '600' },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
});
