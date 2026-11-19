/** Inicio del estudiante y del acudiente: sus planes de nivelación y el avance de cada uno. */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ETIQUETA_PLAN, listarMisPlanes, type Plan } from '@/api/planes';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { useCarga } from '@/hooks/useCarga';
import { colors, radius, spacing, typography } from '@/theme';

const avance = (plan: Plan) =>
  plan.progreso === null
    ? 'Aún sin actividades'
    : `${plan.progreso} % · ${plan.actividades_completadas} de ${plan.actividades_total} actividades`;

type Props = { rol: 'estudiante' | 'acudiente'; onOpenPlan: (planId: number) => void };

export function HomeExpedientesPanel({ rol, onOpenPlan }: Props) {
  const planes = useCarga(listarMisPlanes, {
    error: 'No pudimos cargar tus planes de nivelación. Revisa tu conexión e inténtalo de nuevo.',
  });
  const esAcudiente = rol === 'acudiente';

  return (
    <View style={styles.panel}>
      <Text style={styles.titulo}>
        {esAcudiente ? 'Proceso de nivelación del estudiante' : 'Mis planes de nivelación'}
      </Text>
      <Text style={styles.descripcion}>
        {esAcudiente
          ? 'Consulta y acompaña el avance de los estudiantes a tu cargo. Solo el docente modifica el plan y las notas.'
          : 'Consulta tu plan, pregunta tus dudas al docente y carga tus actividades y correcciones.'}
      </Text>
      {planes.error ? (
        <>
          <Aviso tipo="error">{planes.error}</Aviso>
          <Button title="Reintentar" onPress={planes.recargar} />
        </>
      ) : null}
      {planes.cargando ? <Aviso tipo="nota">Cargando…</Aviso> : null}
      {planes.datos?.length === 0 ? (
        <Aviso tipo="nota">
          {esAcudiente
            ? 'No hay planes de nivelación para los estudiantes vinculados a tu cuenta.'
            : 'No tienes planes de nivelación registrados.'}
        </Aviso>
      ) : null}
      {planes.datos?.map((plan) => (
        <Pressable
          key={plan.id}
          accessibilityRole="button"
          accessibilityLabel={`Plan de ${plan.asignatura_nombre}, ${plan.estudiante_nombre}`}
          onPress={() => onOpenPlan(plan.id)}
          style={styles.tarjeta}
        >
          <Text style={styles.area}>{plan.asignatura_nombre}</Text>
          {esAcudiente ? (
            <Text style={styles.nota}>Estudiante: {plan.estudiante_nombre}</Text>
          ) : null}
          <Text style={styles.nota}>
            {plan.docente_nombre ? `Docente: ${plan.docente_nombre}` : 'Sin docente asignado'}
          </Text>
          <Text style={styles.nota}>{`${ETIQUETA_PLAN[plan.estado]} · ${avance(plan)}`}</Text>
          {plan.nota_final ? (
            <Text style={styles.nota}>{`Nota: ${plan.nota_final.replace('.', ',')}`}</Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.sm },
  titulo: { ...typography.title, color: colors.text },
  descripcion: { ...typography.body, color: colors.textMuted, marginBottom: spacing.sm },
  tarjeta: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: 2,
  },
  area: { ...typography.subtitle, color: colors.text },
  nota: { ...typography.body, color: colors.textMuted },
});
