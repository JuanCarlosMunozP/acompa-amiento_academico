/** Permite consultar y mantener la disponibilidad horaria del docente. */
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  guardarDisponibilidadTutor,
  obtenerDisponibilidadTutor,
  type BloqueoTutor,
  type HorarioTutor,
} from '@/api/tutores';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { useSession } from '@/store/session';
import { colors, radius, spacing, typography } from '@/theme';
import { fechaLocal } from '@/api/seguimiento';

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const mensajeDe = (e: unknown) =>
  (e as { error?: { message?: string } })?.error?.message ??
  'No se pudo guardar la disponibilidad. Revisa los horarios e inténtalo de nuevo.';

export function DisponibilidadTutorScreen() {
  const { sesion } = useSession();
  const [horarios, setHorarios] = useState<HorarioTutor[]>([]);
  const [bloqueos, setBloqueos] = useState<BloqueoTutor[]>([]);
  const [dia, setDia] = useState(0);
  const [horaInicio, setHoraInicio] = useState('08:00');
  const [horaFin, setHoraFin] = useState('09:00');
  const [fecha, setFecha] = useState(() => fechaLocal(1));
  const [motivo, setMotivo] = useState('');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  useEffect(() => {
    let vigente = true;
    obtenerDisponibilidadTutor()
      .then((datos) => {
        if (!vigente) return;
        setHorarios(datos.horarios);
        setBloqueos(datos.bloqueos);
      })
      .catch((e) => vigente && setError(mensajeDe(e)))
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
  }, []);

  const agregarHorario = () => {
    setError(null);
    setExito(false);
    if (!horaValida(horaInicio) || !horaValida(horaFin) || horaInicio >= horaFin) {
      setError('Usa horas válidas en formato HH:MM y asegúrate de que el fin sea posterior.');
      return;
    }
    const nuevo = { dia_semana: dia, hora_inicio: horaInicio, hora_fin: horaFin };
    const cruza = horarios.some(
      (h) =>
        h.dia_semana === dia &&
        horaInicio < h.hora_fin.slice(0, 5) &&
        horaFin > h.hora_inicio.slice(0, 5),
    );
    if (cruza) {
      setError('Ese horario se cruza con otro del mismo día.');
      return;
    }
    setHorarios((actuales) => [...actuales, nuevo].sort((a, b) => a.dia_semana - b.dia_semana));
  };

  const agregarBloqueo = () => {
    setError(null);
    setExito(false);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !horaValida(horaInicio) || !horaValida(horaFin)) {
      setError('Indica una fecha AAAA-MM-DD y horas válidas en formato HH:MM.');
      return;
    }
    if (horaInicio >= horaFin) {
      setError('La hora de fin debe ser posterior al inicio.');
      return;
    }
    const cruza = bloqueos.some(
      (b) =>
        b.fecha === fecha &&
        horaInicio < b.hora_fin.slice(0, 5) &&
        horaFin > b.hora_inicio.slice(0, 5),
    );
    if (cruza) {
      setError('Ese bloqueo se cruza con otro de la misma fecha.');
      return;
    }
    setBloqueos((actuales) =>
      [...actuales, { fecha, hora_inicio: horaInicio, hora_fin: horaFin, motivo }].sort((a, b) =>
        a.fecha.localeCompare(b.fecha),
      ),
    );
    setMotivo('');
  };

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    setExito(false);
    try {
      const datos = await guardarDisponibilidadTutor({ horarios, bloqueos });
      setHorarios(datos.horarios);
      setBloqueos(datos.bloqueos);
      setExito(true);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  };

  if (sesion?.usuario.rol !== 'tutor') {
    return (
      <Screen>
        <Aviso tipo="error">La disponibilidad solo la puede editar el docente.</Aviso>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Mi disponibilidad</Text>
        <Text style={styles.nota}>
          Define las horas semanales en que puedes dar tutorías y agrega bloqueos para fechas
          puntuales.
        </Text>
        {cargando ? <Aviso tipo="nota">Cargando disponibilidad…</Aviso> : null}
        {error ? <Aviso tipo="error">{error}</Aviso> : null}
        {exito ? <Aviso tipo="exito">Disponibilidad guardada.</Aviso> : null}

        <Text style={styles.seccion}>Horarios semanales</Text>
        <View style={styles.dias}>
          {DIAS.map((nombre, indice) => (
            <Chip
              key={nombre}
              label={nombre}
              selected={dia === indice}
              onPress={() => setDia(indice)}
            />
          ))}
        </View>
        <View style={styles.fila}>
          <TextField
            label="Desde (HH:MM)"
            value={horaInicio}
            onChangeText={setHoraInicio}
            placeholder="08:00"
          />
          <TextField
            label="Hasta (HH:MM)"
            value={horaFin}
            onChangeText={setHoraFin}
            placeholder="09:00"
          />
        </View>
        <Button title={`Agregar horario · ${DIAS[dia]}`} onPress={agregarHorario} />
        {horarios.length ? (
          horarios.map((h, indice) => (
            <View style={styles.registro} key={`${h.dia_semana}-${h.hora_inicio}-${indice}`}>
              <Text style={styles.registroTexto}>
                {DIAS[h.dia_semana]} · {h.hora_inicio.slice(0, 5)}–{h.hora_fin.slice(0, 5)}
              </Text>
              <Button
                title="Quitar"
                variant="link"
                onPress={() => setHorarios((actuales) => actuales.filter((_, i) => i !== indice))}
              />
            </View>
          ))
        ) : (
          <Text style={styles.nota}>Aún no has agregado horarios semanales.</Text>
        )}

        <Text style={styles.seccion}>Bloqueos puntuales</Text>
        <TextField label="Fecha (AAAA-MM-DD)" value={fecha} onChangeText={setFecha} />
        <View style={styles.fila}>
          <TextField label="Desde (HH:MM)" value={horaInicio} onChangeText={setHoraInicio} />
          <TextField label="Hasta (HH:MM)" value={horaFin} onChangeText={setHoraFin} />
        </View>
        <TextField label="Motivo (opcional)" value={motivo} onChangeText={setMotivo} />
        <Button title="Agregar bloqueo" onPress={agregarBloqueo} />
        {bloqueos.map((b, indice) => (
          <View style={styles.registro} key={`${b.fecha}-${b.hora_inicio}-${indice}`}>
            <Text style={styles.registroTexto}>
              {b.fecha} · {b.hora_inicio.slice(0, 5)}–{b.hora_fin.slice(0, 5)}
              {b.motivo ? ` · ${b.motivo}` : ''}
            </Text>
            <Button
              title="Quitar"
              variant="link"
              onPress={() => setBloqueos((actuales) => actuales.filter((_, i) => i !== indice))}
            />
          </View>
        ))}
        <View style={styles.guardar}>
          <Button title="Guardar disponibilidad" onPress={guardar} loading={guardando} />
        </View>
      </ScrollView>
    </Screen>
  );
}

function horaValida(valor: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(valor);
  return !!match && Number(match[1]) < 24 && Number(match[2]) < 60;
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
  dias: { flexDirection: 'row', flexWrap: 'wrap' },
  fila: { flexDirection: 'row', gap: spacing.md },
  registro: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  registroTexto: { ...typography.body, color: colors.text, flexShrink: 1 },
  guardar: { marginTop: spacing.lg, marginBottom: spacing.xl },
});
