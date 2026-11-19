/** Consulta y permite editar la información institucional y sus sedes. */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  actualizarInstitucion,
  actualizarSede,
  crearSede,
  listarSedes,
  obtenerInstitucion,
  type Institucion,
  type Sede,
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

type FormSede = {
  nombre: string;
  nit: string;
  direccion: string;
  ciudad: string;
  telefono: string;
  correo: string;
  activa: boolean;
  principal: boolean;
};
const SEDE_VACIA: FormSede = {
  nombre: '',
  nit: '',
  direccion: '',
  ciudad: '',
  telefono: '',
  correo: '',
  activa: true,
  principal: false,
};

type CampoTextoInstitucion = Exclude<keyof Institucion, 'sede_unica'>;

const CAMPOS_INSTITUCION: {
  campo: CampoTextoInstitucion;
  etiqueta: string;
  teclado?: 'email-address';
}[] = [
  { campo: 'nombre', etiqueta: 'Nombre de la institución' },
  { campo: 'nit', etiqueta: 'NIT' },
  { campo: 'direccion', etiqueta: 'Dirección' },
  { campo: 'ciudad', etiqueta: 'Ciudad' },
  { campo: 'telefono', etiqueta: 'Teléfono' },
  { campo: 'correo', etiqueta: 'Correo de contacto', teclado: 'email-address' },
];

export function InstitucionScreen({ embedded = false }: { embedded?: boolean }) {
  const { sesion } = useSession();
  const puedeVer = puedeVerRoles(sesion?.usuario.rol);
  const puedeEditar = esAdministrador(sesion?.usuario.rol);

  const carga = useCarga(() => Promise.all([obtenerInstitucion(), listarSedes()]), {
    habilitado: puedeVer,
    error: 'No pudimos cargar los datos de la institución. Revisa tu conexión.',
  });

  // Formulario de la institución: null = sin cambios (se muestran los datos cargados).
  const [edicion, setEdicion] = useState<Partial<Institucion>>({});
  const [erroresInst, setErroresInst] = useState<Record<string, string>>({});
  const [mensajeInst, setMensajeInst] = useState<string | null>(null);
  const [errorInst, setErrorInst] = useState<string | null>(null);
  const [guardandoInst, setGuardandoInst] = useState(false);
  const [datosInstitucionAbiertos, setDatosInstitucionAbiertos] = useState(false);

  // Panel de sede: 'nueva', el id de una existente, o null si está cerrado.
  const [panel, setPanel] = useState<'nueva' | number | null>(null);
  const [formSede, setFormSede] = useState<FormSede>(SEDE_VACIA);
  const [erroresSede, setErroresSede] = useState<Record<string, string>>({});
  const [errorSede, setErrorSede] = useState<string | null>(null);
  const [mensajeSede, setMensajeSede] = useState<string | null>(null);
  const [guardandoSede, setGuardandoSede] = useState(false);

  if (!puedeVer) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Text style={styles.title}>Sin acceso</Text>
        <Aviso tipo="error">No tienes permiso para ver los datos de la institución.</Aviso>
      </EmbeddedScreenFrame>
    );
  }
  if (carga.error) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Text style={styles.title}>Institución y sedes</Text>
        <Aviso tipo="error">{carga.error}</Aviso>
        <Button title="Reintentar" onPress={carga.recargar} />
      </EmbeddedScreenFrame>
    );
  }
  if (carga.cargando || !carga.datos) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Text style={styles.title}>Institución y sedes</Text>
        <Aviso tipo="nota">Cargando…</Aviso>
      </EmbeddedScreenFrame>
    );
  }

  const [institucion, sedes] = carga.datos;
  const valor = (campo: CampoTextoInstitucion) => edicion[campo] ?? institucion[campo];
  const hayCambios = Object.keys(edicion).length > 0;
  const sedeUnicaRegistrada = institucion.sede_unica && sedes.length > 0;

  const guardarInstitucion = async () => {
    /* istanbul ignore next -- el botón de guardar está deshabilitado sin cambios */
    if (!hayCambios) return;
    if (!valor('nombre').trim()) {
      setErroresInst({ nombre: 'Ingresa el nombre de la institución.' });
      return;
    }
    setGuardandoInst(true);
    setErroresInst({});
    setErrorInst(null);
    try {
      const nueva = await actualizarInstitucion(edicion);
      carga.actualizar(([, s]) => [nueva, s]);
      setEdicion({});
      setMensajeInst('Datos de la institución guardados.');
      setDatosInstitucionAbiertos(false);
    } catch (e) {
      const porCampo = erroresDeCampos(e);
      setErroresInst(porCampo);
      if (Object.keys(porCampo).length === 0) {
        setErrorInst(mensajeDe(e, 'No pudimos guardar. Revisa tu conexión e inténtalo de nuevo.'));
      }
    } finally {
      setGuardandoInst(false);
    }
  };

  const abrirSede = (sede: Sede | 'nueva') => {
    setPanel(sede === 'nueva' ? 'nueva' : sede.id);
    setFormSede(sede === 'nueva' ? SEDE_VACIA : { ...sede });
    setErroresSede({});
    setErrorSede(null);
    setMensajeSede(null);
  };

  const guardarSede = async () => {
    if (!formSede.nombre.trim()) {
      setErroresSede({ nombre: 'Ingresa el nombre de la sede.' });
      return;
    }
    setGuardandoSede(true);
    setErroresSede({});
    setErrorSede(null);
    try {
      const datos = { ...formSede, nombre: formSede.nombre.trim() };
      if (panel === 'nueva') await crearSede(datos);
      else await actualizarSede(panel as number, datos);
      // Recarga la lista: marcar una sede como principal cambia también a las demás.
      carga.actualizar(([i]) => [i, sedes]);
      const fresca = await listarSedes();
      carga.actualizar(([i]) => [i, fresca]);
      setPanel(null);
      setMensajeSede(panel === 'nueva' ? 'Sede creada.' : 'Sede actualizada.');
    } catch (e) {
      const porCampo = erroresDeCampos(e);
      setErroresSede(porCampo);
      if (Object.keys(porCampo).length === 0) {
        setErrorSede(mensajeDe(e, 'No pudimos guardar la sede. Inténtalo de nuevo.'));
      }
    } finally {
      setGuardandoSede(false);
    }
  };

  return (
    <EmbeddedScreenFrame embedded={embedded}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Institución y sedes</Text>
        {!puedeEditar ? (
          <Aviso tipo="nota">Solo lectura: únicamente un administrador edita estos datos.</Aviso>
        ) : null}

        <View style={styles.institucionCard}>
          <View style={styles.filaTexto}>
            <Text style={styles.filaNombre}>{institucion.nombre}</Text>
            <Text style={styles.nota}>Datos generales de la institución</Text>
          </View>
          {!sedeUnicaRegistrada ? (
            <Button
              title={
                datosInstitucionAbiertos
                  ? 'Ocultar datos'
                  : puedeEditar
                    ? 'Editar institución'
                    : 'Ver datos'
              }
              onPress={() => setDatosInstitucionAbiertos((abiertos) => !abiertos)}
              variant="link"
              compact
            />
          ) : null}
        </View>
        {mensajeInst ? <Aviso tipo="exito">{mensajeInst}</Aviso> : null}
        {datosInstitucionAbiertos ? (
          <View style={styles.formularioInstitucion}>
            {CAMPOS_INSTITUCION.map(({ campo, etiqueta, teclado }) => (
              <TextField
                key={campo}
                label={etiqueta}
                value={valor(campo)}
                onChangeText={(texto) => {
                  setEdicion((e) => ({ ...e, [campo]: texto }));
                  setMensajeInst(null);
                }}
                error={erroresInst[campo]}
                editable={puedeEditar}
                keyboardType={teclado}
                autoCapitalize={teclado ? 'none' : 'sentences'}
              />
            ))}
            <SwitchField
              label="Sede única"
              value={edicion.sede_unica ?? institucion.sede_unica}
              disabled={!puedeEditar}
              onValueChange={(sedeUnica) => {
                setEdicion((e) => ({ ...e, sede_unica: sedeUnica }));
                setMensajeInst(null);
              }}
            />
            {errorInst ? <Aviso tipo="error">{errorInst}</Aviso> : null}
            {puedeEditar ? (
              <Button
                title="Guardar datos"
                onPress={guardarInstitucion}
                loading={guardandoInst}
                disabled={!hayCambios}
              />
            ) : null}
          </View>
        ) : null}

        <Text style={styles.seccion}>Sedes</Text>
        {institucion.sede_unica ? <Text style={styles.etiqueta}>Sede única</Text> : null}
        {mensajeSede ? <Aviso tipo="exito">{mensajeSede}</Aviso> : null}
        {sedes.length === 0 && !institucion.sede_unica ? (
          <Aviso tipo="nota">Aún no hay sedes registradas.</Aviso>
        ) : null}
        {sedes.map((sede) => (
          <Pressable
            key={sede.id}
            accessibilityRole="button"
            accessibilityLabel={`Sede ${sede.nombre}`}
            disabled={!puedeEditar}
            onPress={() => abrirSede(sede)}
            style={styles.fila}
          >
            <View style={styles.filaTexto}>
              <Text style={styles.filaNombre}>{sede.nombre}</Text>
              {sede.direccion ? <Text style={styles.nota}>{sede.direccion}</Text> : null}
              {[sede.ciudad, sede.telefono, sede.correo].filter(Boolean).join(' · ') ? (
                <Text style={styles.nota}>
                  {[sede.ciudad, sede.telefono, sede.correo].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </View>
            <Text style={styles.etiqueta}>
              {[sede.principal ? 'Principal' : null, sede.activa ? null : 'Inactiva']
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </Pressable>
        ))}

        {puedeEditar && panel === null && !sedeUnicaRegistrada ? (
          <Button title="Agregar sede" onPress={() => abrirSede('nueva')} variant="link" compact />
        ) : null}

        {panel !== null ? (
          <FormModal visible={panel !== null} onClose={() => !guardandoSede && setPanel(null)}>
            <View style={styles.panel}>
              <Text style={styles.filaNombre}>
                {panel === 'nueva' ? 'Nueva sede' : 'Editar sede'}
              </Text>
              <TextField
                label="Nombre de la sede"
                value={formSede.nombre}
                onChangeText={(t) => setFormSede((f) => ({ ...f, nombre: t }))}
                error={erroresSede.nombre}
              />
              <TextField
                label="NIT de la sede"
                value={formSede.nit}
                onChangeText={(t) => setFormSede((f) => ({ ...f, nit: t }))}
                error={erroresSede.nit}
              />
              <TextField
                label="Dirección de la sede"
                value={formSede.direccion}
                onChangeText={(t) => setFormSede((f) => ({ ...f, direccion: t }))}
                error={erroresSede.direccion}
              />
              <TextField
                label="Ciudad de la sede"
                value={formSede.ciudad}
                onChangeText={(t) => setFormSede((f) => ({ ...f, ciudad: t }))}
                error={erroresSede.ciudad}
              />
              <TextField
                label="Teléfono de la sede"
                value={formSede.telefono}
                onChangeText={(t) => setFormSede((f) => ({ ...f, telefono: t }))}
                error={erroresSede.telefono}
              />
              <TextField
                label="Correo de contacto de la sede"
                value={formSede.correo}
                onChangeText={(t) => setFormSede((f) => ({ ...f, correo: t }))}
                error={erroresSede.correo}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <SwitchField
                label="Sede activa"
                value={formSede.activa}
                onValueChange={(v) => setFormSede((f) => ({ ...f, activa: v }))}
              />
              <SwitchField
                label="Sede principal"
                value={formSede.principal}
                onValueChange={(v) => setFormSede((f) => ({ ...f, principal: v }))}
              />
              {erroresSede.activa ? <Aviso tipo="error">{erroresSede.activa}</Aviso> : null}
              {erroresSede.non_field_errors ? (
                <Aviso tipo="error">{erroresSede.non_field_errors}</Aviso>
              ) : null}
              {erroresSede.sede_unica ? <Aviso tipo="error">{erroresSede.sede_unica}</Aviso> : null}
              {errorSede ? <Aviso tipo="error">{errorSede}</Aviso> : null}
              <Button title="Guardar sede" onPress={guardarSede} loading={guardandoSede} />
              <Button
                title="Cancelar"
                onPress={() => setPanel(null)}
                variant="link"
                disabled={guardandoSede}
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
  seccion: {
    ...typography.subtitle,
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  nota: { ...typography.body, color: colors.textMuted },
  institucionCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  formularioInstitucion: { marginTop: spacing.md },
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
  filaTexto: { flex: 1, marginRight: spacing.sm },
  filaNombre: { ...typography.subtitle, color: colors.text, marginBottom: spacing.xs },
  etiqueta: { ...typography.body, color: colors.primary, fontWeight: '600' },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
});
