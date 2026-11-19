/** Muestra la ficha académica y el contexto de un estudiante seleccionado. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ETIQUETA_PLAN, obtenerFichaCompleta } from '@/api/planes';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { EstadoBadge } from '@/components/EstadoBadge';
import { Screen } from '@/components/Screen';
import { useCarga } from '@/hooks/useCarga';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { useSession } from '@/store/session';
import { colors, radius, spacing, typography } from '@/theme';
import { puedeVerRoles } from '@/types/roles';

type Props = NativeStackScreenProps<RootStackParamList, 'FichaEstudiante'>;

const ETIQUETA_ASISTENCIA: Record<string, string> = {
  presente: 'Presente',
  tarde: 'Tarde',
  ausente: 'Ausente',
  excusa: 'Excusa',
};

/** Ficha completa: datos, evaluación con sus alertas, asistencia, trabajos y planes de nivelación. */
export function FichaEstudianteScreen({ navigation, route }: Props) {
  const { estudianteId } = route.params;
  const { sesion } = useSession();
  const rol = sesion?.usuario.rol;
  const puedeCrearPlan = puedeVerRoles(rol);

  const carga = useCarga(() => obtenerFichaCompleta(estudianteId), {
    habilitado: !!sesion,
    dependencias: [estudianteId],
    error: 'No pudimos cargar la ficha. Revisa tu conexión e inténtalo de nuevo.',
  });

  if (!sesion) {
    return (
      <Screen>
        <Aviso tipo="error">Inicia sesión para ver la ficha del estudiante.</Aviso>
      </Screen>
    );
  }
  if (carga.error) {
    return (
      <Screen>
        <Aviso tipo="error">{carga.error}</Aviso>
        <Button title="Reintentar" onPress={carga.recargar} />
      </Screen>
    );
  }
  const ficha = carga.datos;
  if (!ficha) {
    return (
      <Screen>
        <Aviso tipo="nota">Cargando…</Aviso>
      </Screen>
    );
  }

  const { estudiante, evaluacion, asistencia, trabajos_pendientes: trabajos, planes } = ficha;
  const medidas = evaluacion.medidas;

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={styles.cabecera}>
          <View style={styles.cabeceraTexto}>
            <Text style={styles.title}>{estudiante.nombre}</Text>
            <Text style={styles.nota}>{estudiante.email}</Text>
            <Text style={styles.nota}>
              {estudiante.grado && estudiante.grupo
                ? `${estudiante.grado} ${estudiante.grupo} · ${ficha.periodo.nombre}`
                : `Sin matrícula en ${ficha.periodo.nombre}`}
            </Text>
          </View>
          <EstadoBadge estado={evaluacion.estado} />
        </View>

        <Text style={styles.seccion}>Desempeño</Text>
        <Text style={styles.cuerpo}>
          {`Promedio ${medidas.promedio ?? '—'} · Asistencia ${medidas.asistencia.porcentaje ?? '—'}${medidas.asistencia.porcentaje === null ? '' : ' %'} · Trabajos sin entregar ${medidas.trabajos_pendientes}`}
        </Text>
        {evaluacion.alertas.length === 0 ? (
          <Aviso tipo="nota">Sin solicitudes: ninguna regla se activó.</Aviso>
        ) : (
          evaluacion.alertas.map((a) => (
            <Text key={`${a.regla}-${a.asignatura ?? ''}`} style={styles.alerta}>
              {`• ${a.explicacion}`}
            </Text>
          ))
        )}

        <Text style={styles.seccion}>Asistencia reciente</Text>
        {asistencia.registros.length === 0 ? (
          <Aviso tipo="nota">Aún no hay asistencia registrada.</Aviso>
        ) : (
          asistencia.registros.slice(0, 10).map((r) => (
            <Text key={r.fecha} style={styles.cuerpo}>
              {`${r.fecha} · ${ETIQUETA_ASISTENCIA[r.estado] ?? r.estado}`}
            </Text>
          ))
        )}

        <Text style={styles.seccion}>Trabajos sin entregar</Text>
        {trabajos.length === 0 ? (
          <Aviso tipo="nota">No tiene trabajos pendientes.</Aviso>
        ) : (
          trabajos.map((t) => (
            <Text key={t.id} style={styles.cuerpo}>
              {`${t.asignatura_nombre}: ${t.descripcion} (límite ${t.fecha_limite}${t.vencido ? ', vencido' : ''})`}
            </Text>
          ))
        )}

        <Text style={styles.seccion}>Planes de nivelación</Text>
        {planes.length === 0 ? <Aviso tipo="nota">No tiene planes de nivelación.</Aviso> : null}
        {planes.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={`Plan de ${p.asignatura_nombre}`}
            onPress={() => navigation.navigate('PlanDetalle', { planId: p.id })}
            style={styles.plan}
          >
            <Text style={styles.nombre}>{p.asignatura_nombre}</Text>
            <Text style={styles.nota}>
              {`${ETIQUETA_PLAN[p.estado]} · ${p.fecha_inicio} al ${p.fecha_fin}`}
            </Text>
            <Text style={styles.nota}>
              {p.docente_nombre ? `Docente: ${p.docente_nombre}` : 'Sin docente'}
            </Text>
          </Pressable>
        ))}

        {puedeCrearPlan && estudiante.matricula === 'activa' ? (
          <Button
            title="Registrar nivelación"
            onPress={() =>
              navigation.navigate('PlanRefuerzo', {
                estudianteId: estudiante.id,
                nombre: estudiante.nombre,
              })
            }
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cabecera: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cabeceraTexto: { flex: 1, marginRight: spacing.sm },
  title: { ...typography.title, color: colors.text },
  seccion: {
    ...typography.subtitle,
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  cuerpo: { ...typography.body, color: colors.text, marginBottom: spacing.xs },
  nota: { ...typography.body, color: colors.textMuted },
  nombre: { ...typography.subtitle, color: colors.text },
  alerta: { ...typography.body, color: colors.text, marginBottom: spacing.xs },
  plan: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
});
