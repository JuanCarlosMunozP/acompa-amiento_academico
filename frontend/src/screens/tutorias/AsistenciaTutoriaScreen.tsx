/** Permite registrar y consultar la asistencia a una sesión de tutoría. */
import { useLayoutEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { registrarAsistenciaSesion } from '@/api/planes';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Screen } from '@/components/Screen';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { useSession } from '@/store/session';
import { colors, spacing, typography } from '@/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Asistencia'>;
type EstadoAsistenciaTutoria = 'presente' | 'ausente' | 'excusa';

const opciones: { valor: EstadoAsistenciaTutoria; etiqueta: string }[] = [
  { valor: 'presente', etiqueta: 'Asistí' },
  { valor: 'ausente', etiqueta: 'No asistí' },
  { valor: 'excusa', etiqueta: 'Tuve una excusa' },
];

export function AsistenciaTutoriaScreen({ navigation, route }: Props) {
  const { sesion } = useSession();
  const { sesion: tutoria } = route.params;
  const [estado, setEstado] = useState<EstadoAsistenciaTutoria>('presente');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const permitida = sesion?.usuario.rol === 'estudiante';
  const finalizada = new Date(tutoria.fin) <= new Date();
  const pendiente = tutoria.estado === 'programada';

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Asistencia' });
  }, [navigation]);

  const registrar = async () => {
    setGuardando(true);
    setError('');
    try {
      await registrarAsistenciaSesion(tutoria.id, estado);
      navigation.goBack();
    } catch (e) {
      setError(
        (e as { error?: { message?: string } })?.error?.message ??
          'No se pudo registrar la asistencia. Inténtalo de nuevo.',
      );
    } finally {
      setGuardando(false);
    }
  };

  if (!permitida) {
    return (
      <Screen>
        <Aviso tipo="error">Solo el estudiante puede registrar su asistencia a la tutoría.</Aviso>
        <Button title="Volver" onPress={() => navigation.goBack()} />
      </Screen>
    );
  }

  if (!pendiente || !finalizada) {
    return (
      <Screen>
        <Aviso tipo="nota">
          {pendiente
            ? 'Podrás registrar la asistencia cuando termine la tutoría.'
            : 'Esta tutoría ya tiene asistencia registrada.'}
        </Aviso>
        <Button title="Volver a mi agenda" onPress={() => navigation.goBack()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Registrar asistencia</Text>
        <Text style={styles.datos}>{tutoria.asignatura_nombre}</Text>
        <Text style={styles.datos}>Docente: {tutoria.tutor_nombre}</Text>
        <Text style={styles.datos}>
          {new Date(tutoria.inicio).toLocaleString('es-CO', {
            dateStyle: 'full',
            timeStyle: 'short',
          })}
        </Text>
        <Text style={styles.instruccion}>Indica qué ocurrió en esta tutoría:</Text>
        {opciones.map((opcion) => (
          <Chip
            key={opcion.valor}
            label={opcion.etiqueta}
            selected={estado === opcion.valor}
            onPress={() => setEstado(opcion.valor)}
          />
        ))}
        {error ? <Aviso tipo="error">{error}</Aviso> : null}
        <Text style={styles.nota}>
          Al guardar, la tutoría cambiará al estado “Realizada” y no podrás volver a registrar la
          asistencia.
        </Text>
        <Button title="Guardar asistencia" onPress={() => void registrar()} loading={guardando} />
        <Button title="Cancelar" onPress={() => navigation.goBack()} variant="link" />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingBottom: spacing.xl },
  title: { ...typography.title, color: colors.text, marginBottom: spacing.sm },
  datos: { ...typography.body, color: colors.text },
  instruccion: { ...typography.subtitle, color: colors.text, marginTop: spacing.md },
  nota: { ...typography.body, color: colors.textMuted, marginVertical: spacing.sm },
});
