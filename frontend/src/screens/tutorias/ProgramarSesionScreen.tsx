/** Permite programar una sesión de tutoría desde la navegación de la aplicación. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { obtenerDisponibilidadPlan, programarSesion, reprogramarSesion } from '@/api/planes';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { useCarga } from '@/hooks/useCarga';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { fechaLocal } from '@/api/seguimiento';
import { colors, spacing, typography } from '@/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ProgramarSesion'>;
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export function ProgramarSesionScreen({ route, navigation }: Props) {
  const { planId } = route.params;
  const sesionExistente = route.params.session;
  const disponibilidad = useCarga(() => obtenerDisponibilidadPlan(planId), {
    dependencias: [planId],
    error: 'No pudimos cargar la disponibilidad del tutor.',
  });
  const [fecha, setFecha] = useState(() =>
    sesionExistente ? fechaDe(sesionExistente.inicio) : fechaLocal(1),
  );
  const [inicio, setInicio] = useState(() =>
    sesionExistente ? horaDe(sesionExistente.inicio) : '09:00',
  );
  const [fin, setFin] = useState(() => (sesionExistente ? horaDe(sesionExistente.fin) : '10:00'));
  const [modalidad, setModalidad] = useState<'presencial' | 'virtual'>(
    sesionExistente?.modalidad ?? 'presencial',
  );
  const [lugar, setLugar] = useState(sesionExistente?.lugar ?? '');
  const [enlace, setEnlace] = useState(sesionExistente?.enlace_virtual ?? '');
  const [notas, setNotas] = useState(sesionExistente?.notas ?? '');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !horaValida(inicio) || !horaValida(fin)) {
      setError('Indica una fecha AAAA-MM-DD y horas válidas en formato HH:MM.');
      return;
    }
    const [anio, mes, dia] = fecha.split('-').map(Number);
    const [horaIni, minutoIni] = inicio.split(':').map(Number);
    const [horaFin, minutoFin] = fin.split(':').map(Number);
    const fechaInicio = new Date(anio, mes - 1, dia, horaIni, minutoIni);
    const fechaFin = new Date(anio, mes - 1, dia, horaFin, minutoFin);
    if (fechaInicio.toISOString().slice(0, 10) !== fecha) {
      setError('La fecha no es válida.');
      return;
    }
    setGuardando(true);
    try {
      const datos = {
        inicio: fechaInicio.toISOString(),
        fin: fechaFin.toISOString(),
        modalidad,
        lugar: modalidad === 'presencial' ? lugar.trim() : '',
        enlace_virtual: modalidad === 'virtual' ? enlace.trim() : '',
        notas: notas.trim(),
      };
      if (sesionExistente) await reprogramarSesion(sesionExistente.id, datos);
      else await programarSesion(planId, datos);
      navigation.goBack();
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>
          {sesionExistente ? 'Reprogramar sesión' : 'Programar sesión'}
        </Text>
        {disponibilidad.error ? <Aviso tipo="error">{disponibilidad.error}</Aviso> : null}
        {disponibilidad.datos ? (
          <View style={styles.disponibilidad}>
            <Text style={styles.subtitulo}>Horario semanal del tutor</Text>
            {disponibilidad.datos.horarios.length ? (
              disponibilidad.datos.horarios.map((h, i) => (
                <Text style={styles.nota} key={`${h.dia_semana}-${i}`}>
                  {DIAS[h.dia_semana]} · {h.hora_inicio.slice(0, 5)}–{h.hora_fin.slice(0, 5)}
                </Text>
              ))
            ) : (
              <Text style={styles.nota}>El tutor aún no ha configurado horarios.</Text>
            )}
            {disponibilidad.datos.bloqueos.length ? (
              <Text style={styles.nota}>
                Fechas bloqueadas: {disponibilidad.datos.bloqueos.map((b) => b.fecha).join(', ')}
              </Text>
            ) : null}
          </View>
        ) : null}

        {error ? <Aviso tipo="error">{error}</Aviso> : null}
        <TextField label="Fecha (AAAA-MM-DD)" value={fecha} onChangeText={setFecha} />
        <View style={styles.fila}>
          <TextField label="Hora de inicio (HH:MM)" value={inicio} onChangeText={setInicio} />
          <TextField label="Hora de fin (HH:MM)" value={fin} onChangeText={setFin} />
        </View>
        <Text style={styles.subtitulo}>Modalidad</Text>
        <View style={styles.fila}>
          <Chip
            label="Presencial"
            selected={modalidad === 'presencial'}
            onPress={() => setModalidad('presencial')}
          />
          <Chip
            label="Virtual"
            selected={modalidad === 'virtual'}
            onPress={() => setModalidad('virtual')}
          />
        </View>
        {modalidad === 'presencial' ? (
          <TextField label="Lugar" value={lugar} onChangeText={setLugar} />
        ) : (
          <TextField
            label="Enlace de reunión"
            value={enlace}
            onChangeText={setEnlace}
            keyboardType="url"
            autoCapitalize="none"
          />
        )}
        <TextField label="Notas (opcional)" value={notas} onChangeText={setNotas} multiline />
        <Button
          title={sesionExistente ? 'Guardar nueva fecha' : 'Guardar sesión'}
          onPress={guardar}
          loading={guardando}
        />
      </ScrollView>
    </Screen>
  );
}

function horaValida(valor: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(valor);
  return !!match && Number(match[1]) < 24 && Number(match[2]) < 60;
}

function fechaDe(valor: string) {
  const fecha = new Date(valor);
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

function horaDe(valor: string) {
  const fecha = new Date(valor);
  return `${String(fecha.getHours()).padStart(2, '0')}:${String(fecha.getMinutes()).padStart(2, '0')}`;
}

function mensajeDe(e: unknown) {
  const error = (e as { error?: { message?: string; details?: Record<string, string | string[]> } })
    ?.error;
  if (error?.details) {
    return Object.values(error.details)
      .flatMap((v) => (Array.isArray(v) ? v : [v]))
      .join(' ');
  }
  return error?.message ?? 'No se pudo programar la sesión. Inténtalo de nuevo.';
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginBottom: spacing.md },
  subtitulo: { ...typography.subtitle, color: colors.text, marginBottom: spacing.xs },
  nota: { ...typography.body, color: colors.textMuted, marginBottom: spacing.xs },
  disponibilidad: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  fila: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
});
