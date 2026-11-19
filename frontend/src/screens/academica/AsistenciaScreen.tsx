/** Permite consultar y gestionar la asistencia académica de estudiantes. */
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { fechaValida } from '@/api/academico';
import {
  ESTADOS_ASISTENCIA,
  fechaLocal,
  guardarAsistencia,
  listarGradosConGrupos,
  obtenerListaAsistencia,
  type EstadoAsistencia,
} from '@/api/seguimiento';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { useCarga } from '@/hooks/useCarga';
import { useSession } from '@/store/session';
import { colors, radius, spacing, typography } from '@/theme';
import { puedeTomarAsistencia } from '@/types/roles';
import { erroresDeCampos, mensajeDe } from '@/utils/errores';

/** Mueve una fecha AAAA-MM-DD el número de días indicado. */
function desplazar(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return fechaLocal(dias, new Date(a, m - 1, d));
}

export function AsistenciaScreen() {
  const { sesion } = useSession();
  const permitido = puedeTomarAsistencia(sesion?.usuario.rol);

  const [grupoId, setGrupoId] = useState<number | null>(null);
  const [fecha, setFecha] = useState(() => fechaLocal());
  // Lo que la persona marcó y todavía no se guardó.
  const [marcas, setMarcas] = useState<Record<number, EstadoAsistencia>>({});
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const grados = useCarga(listarGradosConGrupos, {
    habilitado: permitido,
    error: 'No pudimos cargar los grupos. Revisa tu conexión e inténtalo de nuevo.',
  });
  const fechaOk = fechaValida(fecha);
  const lista = useCarga(() => obtenerListaAsistencia(grupoId as number, fecha), {
    habilitado: permitido && grupoId !== null && fechaOk,
    dependencias: [grupoId, fecha],
    error: 'No pudimos cargar la lista del grupo.',
  });

  if (!permitido) {
    return (
      <Screen>
        <Text style={styles.title}>Sin acceso</Text>
        <Aviso tipo="error">No tienes permiso para tomar asistencia.</Aviso>
      </Screen>
    );
  }
  if (grados.error) {
    return (
      <Screen>
        <Text style={styles.title}>Tomar asistencia</Text>
        <Aviso tipo="error">{grados.error}</Aviso>
        <Button title="Reintentar" onPress={grados.recargar} />
      </Screen>
    );
  }
  if (grados.cargando || !grados.datos) {
    return (
      <Screen>
        <Text style={styles.title}>Tomar asistencia</Text>
        <Aviso tipo="nota">Cargando…</Aviso>
      </Screen>
    );
  }

  const cambiarFecha = (nueva: string) => {
    setFecha(nueva);
    setMarcas({});
    setMensaje(null);
    setErrorGuardar(null);
  };
  const elegirGrupo = (id: number) => {
    setGrupoId(id);
    setMarcas({});
    setMensaje(null);
    setErrorGuardar(null);
  };

  const hoy = fechaLocal();
  const esFutura = fechaOk && fecha > hoy;
  const detalle = lista.datos;
  const sinMarcas = Object.keys(marcas).length === 0;
  const puedeGuardar = !!detalle && detalle.habil && !esFutura && !sinMarcas;

  const estadoDe = (id: number, guardado: EstadoAsistencia | null) => marcas[id] ?? guardado;

  const marcarTodosPresentes = () => {
    /* istanbul ignore next -- el botón solo existe con la lista cargada */
    if (!detalle) return;
    setMarcas(Object.fromEntries(detalle.estudiantes.map((e) => [e.estudiante, 'presente'])));
    setMensaje(null);
  };

  const guardar = async () => {
    /* istanbul ignore next -- guardar solo está activo con la lista cargada y un grupo elegido */
    if (!detalle || grupoId === null) return;
    setGuardando(true);
    setErrorGuardar(null);
    setMensaje(null);
    try {
      const registros = Object.entries(marcas).map(([id, estado]) => ({
        estudiante: Number(id),
        estado,
      }));
      const respuesta = await guardarAsistencia(grupoId, fecha, registros);
      lista.actualizar(() => respuesta);
      setMarcas({});
      setMensaje(`Asistencia guardada (${respuesta.guardados ?? registros.length}).`);
    } catch (e) {
      const porCampo = erroresDeCampos(e);
      const primero = Object.values(porCampo)[0];
      setErrorGuardar(
        primero ??
          mensajeDe(
            e,
            'No pudimos guardar la asistencia. Revisa tu conexión e inténtalo de nuevo.',
          ),
      );
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Tomar asistencia</Text>

        <Text style={styles.seccion}>Grupo</Text>
        <View style={styles.chips}>
          {grados.datos.flatMap((g) =>
            g.grupos.map((gr) => (
              <Chip
                key={gr.id}
                label={`${g.nombre} ${gr.nombre}`}
                selected={grupoId === gr.id}
                onPress={() => elegirGrupo(gr.id)}
              />
            )),
          )}
        </View>
        {grados.datos.every((g) => g.grupos.length === 0) ? (
          <Aviso tipo="nota">Aún no hay grupos registrados.</Aviso>
        ) : null}

        <Text style={styles.seccion}>Fecha</Text>
        <View style={styles.fechas}>
          <Button
            title="‹ Anterior"
            onPress={() => fechaOk && cambiarFecha(desplazar(fecha, -1))}
            variant="link"
          />
          <Button title="Hoy" onPress={() => cambiarFecha(hoy)} variant="link" />
          <Button
            title="Siguiente ›"
            onPress={() => fechaOk && cambiarFecha(desplazar(fecha, 1))}
            variant="link"
          />
        </View>
        <TextField
          label="Fecha (AAAA-MM-DD)"
          value={fecha}
          onChangeText={cambiarFecha}
          error={fechaOk ? undefined : 'Usa el formato AAAA-MM-DD.'}
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
        />
        {esFutura ? (
          <Aviso tipo="error">No se puede tomar asistencia de una fecha futura.</Aviso>
        ) : null}

        {grupoId === null ? <Aviso tipo="nota">Elige un grupo para ver su lista.</Aviso> : null}
        {lista.error ? (
          <>
            <Aviso tipo="error">{lista.error}</Aviso>
            <Button title="Reintentar" onPress={lista.recargar} variant="link" />
          </>
        ) : null}
        {lista.cargando && grupoId !== null && fechaOk ? (
          <Aviso tipo="nota">Cargando la lista…</Aviso>
        ) : null}

        {detalle ? (
          <>
            <Text style={styles.seccion}>{detalle.grupo}</Text>
            {!detalle.habil ? (
              <Aviso tipo="error">
                {`Esta fecha no es un día hábil (${detalle.motivo}): no se puede tomar asistencia.`}
              </Aviso>
            ) : null}
            {detalle.estudiantes.length === 0 ? (
              <Aviso tipo="nota">No hay estudiantes matriculados en este grupo en esa fecha.</Aviso>
            ) : (
              <Button
                title="Marcar todos presentes"
                onPress={marcarTodosPresentes}
                variant="link"
              />
            )}

            {detalle.estudiantes.map((e) => (
              <View key={e.estudiante} style={styles.estudiante}>
                <Text style={styles.nombre}>{e.nombre}</Text>
                <View style={styles.chips}>
                  {ESTADOS_ASISTENCIA.map(({ codigo, etiqueta }) => (
                    <Chip
                      key={codigo}
                      label={etiqueta}
                      accessibilityLabel={`${e.nombre}: ${etiqueta}`}
                      selected={estadoDe(e.estudiante, e.estado) === codigo}
                      onPress={() => {
                        setMarcas((m) => ({ ...m, [e.estudiante]: codigo }));
                        setMensaje(null);
                      }}
                    />
                  ))}
                </View>
              </View>
            ))}

            {mensaje ? <Aviso tipo="exito">{mensaje}</Aviso> : null}
            {errorGuardar ? <Aviso tipo="error">{errorGuardar}</Aviso> : null}
            {detalle.estudiantes.length > 0 ? (
              <Button
                title="Guardar asistencia"
                onPress={guardar}
                loading={guardando}
                disabled={!puedeGuardar}
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginBottom: spacing.md },
  seccion: {
    ...typography.subtitle,
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  fechas: { flexDirection: 'row', justifyContent: 'space-between' },
  estudiante: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  nombre: { ...typography.subtitle, color: colors.text, marginBottom: spacing.sm },
});
