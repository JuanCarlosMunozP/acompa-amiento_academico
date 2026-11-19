/** Administración de vínculos: qué acudiente acompaña a qué estudiante. */
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  crearVinculo,
  listarEstudiantes,
  listarUsuarios,
  listarVinculos,
  retirarVinculo,
} from '@/api/usuarios';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { EmbeddedScreenFrame } from '@/components/EmbeddedScreenFrame';
import { TextField } from '@/components/TextField';
import { useCarga } from '@/hooks/useCarga';
import { colors, radius, spacing, typography } from '@/theme';
import { erroresDeCampos, mensajeDe } from '@/utils/errores';

type Props = { embedded?: boolean };

type Persona = { id: number; nombre: string };

export function VinculosAcudienteScreen({ embedded = false }: Props) {
  const vinculos = useCarga(listarVinculos, { error: 'No pudimos cargar los vínculos.' });
  const [busquedaAcudiente, setBusquedaAcudiente] = useState('');
  const [consultaAcudiente, setConsultaAcudiente] = useState('');
  const [busquedaEstudiante, setBusquedaEstudiante] = useState('');
  const [consultaEstudiante, setConsultaEstudiante] = useState('');
  const acudientes = useCarga(() => listarUsuarios({ rol: 'acudiente', q: consultaAcudiente }), {
    dependencias: [consultaAcudiente],
    error: 'No pudimos cargar los acudientes.',
  });
  const estudiantes = useCarga(() => listarEstudiantes({ q: consultaEstudiante }), {
    dependencias: [consultaEstudiante],
    error: 'No pudimos cargar los estudiantes.',
  });
  const [acudiente, setAcudiente] = useState<Persona | null>(null);
  const [estudiante, setEstudiante] = useState<Persona | null>(null);
  const [parentesco, setParentesco] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const vincular = async () => {
    const locales: Record<string, string> = {};
    if (!acudiente) locales.acudiente = 'Elige al acudiente.';
    if (!estudiante) locales.estudiante = 'Elige al estudiante.';
    setErrores(locales);
    setError(null);
    setMensaje(null);
    if (!acudiente || !estudiante) return;
    setOcupado(true);
    try {
      await crearVinculo({
        acudiente: acudiente.id,
        estudiante: estudiante.id,
        parentesco: parentesco.trim(),
      });
      setMensaje(`${acudiente.nombre} quedó vinculado con ${estudiante.nombre}.`);
      setAcudiente(null);
      setEstudiante(null);
      setParentesco('');
      vinculos.recargar();
    } catch (e) {
      const porCampo = erroresDeCampos(e);
      setErrores(porCampo);
      if (Object.keys(porCampo).length === 0) {
        setError(mensajeDe(e, 'No pudimos crear el vínculo. Inténtalo de nuevo.'));
      }
    } finally {
      setOcupado(false);
    }
  };

  const retirar = async (id: number, texto: string) => {
    setOcupado(true);
    setError(null);
    setMensaje(null);
    try {
      await retirarVinculo(id);
      setMensaje(`Vínculo retirado: ${texto}.`);
      vinculos.recargar();
    } catch (e) {
      setError(mensajeDe(e, 'No pudimos retirar el vínculo. Inténtalo de nuevo.'));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <EmbeddedScreenFrame embedded={embedded}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Acudientes</Text>
        <Text style={styles.nota}>
          El acudiente solo consulta y acompaña el proceso de los estudiantes vinculados. Retirar el
          vínculo le quita el acceso de inmediato.
        </Text>
        {mensaje ? <Aviso tipo="exito">{mensaje}</Aviso> : null}
        {error ? <Aviso tipo="error">{error}</Aviso> : null}

        <Text style={styles.seccion}>Nuevo vínculo</Text>
        <TextField
          label="Buscar acudiente"
          value={busquedaAcudiente}
          onChangeText={setBusquedaAcudiente}
          autoCapitalize="none"
        />
        <Button
          title="Buscar acudiente"
          variant="link"
          onPress={() => setConsultaAcudiente(busquedaAcudiente)}
        />
        {acudientes.error ? <Aviso tipo="error">{acudientes.error}</Aviso> : null}
        {acudientes.datos?.results.length === 0 ? (
          <Aviso tipo="nota">
            No hay acudientes con ese nombre. Asigna primero el rol Acudiente en Usuarios.
          </Aviso>
        ) : null}
        <View style={styles.chips}>
          {acudientes.datos?.results.map((u) => (
            <Chip
              key={u.id}
              label={`${u.nombres} ${u.apellidos}`}
              accessibilityLabel={`Acudiente ${u.nombres} ${u.apellidos}`}
              selected={acudiente?.id === u.id}
              onPress={() => setAcudiente({ id: u.id, nombre: `${u.nombres} ${u.apellidos}` })}
            />
          ))}
        </View>
        {errores.acudiente ? <Aviso tipo="error">{errores.acudiente}</Aviso> : null}

        <TextField
          label="Buscar estudiante"
          value={busquedaEstudiante}
          onChangeText={setBusquedaEstudiante}
          autoCapitalize="none"
        />
        <Button
          title="Buscar estudiante"
          variant="link"
          onPress={() => setConsultaEstudiante(busquedaEstudiante)}
        />
        {estudiantes.error ? <Aviso tipo="error">{estudiantes.error}</Aviso> : null}
        <View style={styles.chips}>
          {estudiantes.datos?.results.map((ficha) => {
            const nombre = `${ficha.usuario.nombres} ${ficha.usuario.apellidos}`;
            return (
              <Chip
                key={ficha.id}
                label={nombre}
                accessibilityLabel={`Estudiante ${nombre}`}
                selected={estudiante?.id === ficha.usuario.id}
                onPress={() => setEstudiante({ id: ficha.usuario.id, nombre })}
              />
            );
          })}
        </View>
        {errores.estudiante ? <Aviso tipo="error">{errores.estudiante}</Aviso> : null}

        <TextField
          label="Parentesco (opcional)"
          value={parentesco}
          onChangeText={setParentesco}
          error={errores.parentesco}
        />
        {acudiente && estudiante ? (
          <Text style={styles.nota}>{`${acudiente.nombre} → ${estudiante.nombre}`}</Text>
        ) : null}
        <Button title="Vincular" onPress={() => void vincular()} loading={ocupado} />

        <Text style={styles.seccion}>Vínculos actuales</Text>
        {vinculos.error ? (
          <>
            <Aviso tipo="error">{vinculos.error}</Aviso>
            <Button title="Reintentar" onPress={vinculos.recargar} />
          </>
        ) : null}
        {vinculos.cargando ? <Aviso tipo="nota">Cargando…</Aviso> : null}
        {vinculos.datos?.length === 0 ? (
          <Aviso tipo="nota">Todavía no hay acudientes vinculados.</Aviso>
        ) : null}
        {vinculos.datos?.map((v) => {
          const texto = `${v.acudiente_nombre} con ${v.estudiante_nombre}`;
          return (
            <View key={v.id} style={styles.fila}>
              <Text style={styles.nombre}>{v.acudiente_nombre}</Text>
              <Text style={styles.nota}>
                {`Acudiente de ${v.estudiante_nombre}${v.parentesco ? ` · ${v.parentesco}` : ''}`}
              </Text>
              <Button
                title={`Retirar vínculo de ${texto}`}
                variant="link"
                disabled={ocupado}
                onPress={() => void retirar(v.id, texto)}
              />
            </View>
          );
        })}
      </ScrollView>
    </EmbeddedScreenFrame>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginBottom: spacing.sm },
  seccion: {
    ...typography.subtitle,
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  nota: { ...typography.body, color: colors.textMuted, marginBottom: spacing.sm },
  nombre: { ...typography.subtitle, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  fila: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
});
