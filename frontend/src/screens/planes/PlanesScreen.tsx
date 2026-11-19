/** Lista los expedientes de nivelación accesibles al usuario según su rol. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useLayoutEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ETIQUETA_PLAN,
  listarMisPlanes,
  listarPlanes,
  type EstadoPlan,
  type Plan,
} from '@/api/planes';
import { Aviso } from '@/components/Aviso';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { EmbeddedScreenFrame } from '@/components/EmbeddedScreenFrame';
import { useCarga } from '@/hooks/useCarga';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { useSession } from '@/store/session';
import { colors, radius, spacing, typography } from '@/theme';
import { puedeVerRoles } from '@/types/roles';

type Props = NativeStackScreenProps<RootStackParamList, 'Planes'>;

const avance = (p: Plan) =>
  p.progreso === null
    ? 'Sin actividades'
    : `Progreso ${p.progreso} % (${p.actividades_completadas} de ${p.actividades_total})`;

const FILTROS_COORDINACION: { estado: EstadoPlan; etiqueta: string }[] = [
  { estado: 'cerrado', etiqueta: 'Cerrados (verificar)' },
  { estado: 'asignado', etiqueta: 'En acompañamiento' },
  { estado: 'pendiente', etiqueta: 'Sin docente' },
];

/**
 * Expedientes de nivelación: el docente, el estudiante y el acudiente ven los suyos; la
 * coordinación verifica los de toda la institución.
 */
export function PlanesScreen({ navigation }: Props) {
  const { sesion } = useSession();
  const rol = sesion?.usuario.rol;
  useLayoutEffect(() => {
    navigation.setOptions({
      title:
        rol === 'tutor'
          ? 'Planes de nivelación'
          : rol === 'estudiante' || rol === 'acudiente'
            ? 'Mis planes de nivelación'
            : 'Expedientes de nivelación',
    });
  }, [navigation, rol]);

  return (
    <PlanesPanel
      onOpenPlan={(planId) => navigation.navigate('PlanDetalle', { planId })}
      onGoHome={() => navigation.navigate('Home')}
    />
  );
}

export function PlanesPanel({
  embedded = false,
  onOpenPlan,
  onGoHome,
}: {
  embedded?: boolean;
  onOpenPlan: (planId: number) => void;
  onGoHome: () => void;
}) {
  const { sesion } = useSession();
  const coordina = puedeVerRoles(sesion?.usuario.rol);
  const esTutor = sesion?.usuario.rol === 'tutor';
  const esPropio =
    esTutor || sesion?.usuario.rol === 'estudiante' || sesion?.usuario.rol === 'acudiente';
  const [estado, setEstado] = useState<EstadoPlan>('cerrado');
  const [pagina, setPagina] = useState(1);
  const [previos, setPrevios] = useState<Plan[]>([]);

  const todos = useCarga(() => listarPlanes({ estado, page: pagina }), {
    habilitado: coordina,
    dependencias: [estado, pagina],
    error: 'No pudimos cargar los expedientes.',
  });
  const propios = useCarga(listarMisPlanes, {
    habilitado: esPropio,
    error: 'No pudimos cargar tus planes de nivelación.',
  });
  if (!sesion) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Aviso tipo="error">Inicia sesión para ver los planes de nivelación.</Aviso>
      </EmbeddedScreenFrame>
    );
  }

  if (esPropio) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <ScrollView>
          <Text style={styles.title}>
            {esTutor ? 'Planes de nivelación a mi cargo' : 'Planes de nivelación'}
          </Text>
          {propios.error ? <Aviso tipo="error">{propios.error}</Aviso> : null}
          {propios.cargando ? <Aviso tipo="nota">Cargando tus planes…</Aviso> : null}
          {propios.datos?.length === 0 ? (
            <Aviso tipo="nota">Todavía no hay planes de nivelación registrados.</Aviso>
          ) : null}
          {propios.datos?.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`Plan de ${p.asignatura_nombre}, ${p.estudiante_nombre}`}
              onPress={() => onOpenPlan(p.id)}
              style={styles.fila}
            >
              <Text style={styles.nombre}>{p.asignatura_nombre}</Text>
              <Text style={styles.nota}>Estudiante: {p.estudiante_nombre}</Text>
              <Text style={styles.nota}>
                Desempeños: {p.desempenos_no_alcanzados || p.objetivos}
              </Text>
              <Text style={styles.nota}>{avance(p)}</Text>
              <Text style={styles.nota}>
                {p.nota_final
                  ? `${ETIQUETA_PLAN[p.estado]} · nota ${p.nota_final.replace('.', ',')}`
                  : ETIQUETA_PLAN[p.estado]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </EmbeddedScreenFrame>
    );
  }

  if (!coordina) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Aviso tipo="error">
          Este módulo es para docentes, estudiantes, acudientes y coordinación.
        </Aviso>
        <Button title="Volver al inicio" onPress={onGoHome} />
      </EmbeddedScreenFrame>
    );
  }

  const fuente = todos;
  const datos = todos.datos;
  const filas = Array.from(
    new Map([...previos, ...(todos.datos?.results ?? [])].map((plan) => [plan.id, plan])).values(),
  );
  const hayMas = !!datos?.next;

  return (
    <EmbeddedScreenFrame embedded={embedded}>
      <ScrollView>
        <Text style={styles.title}>Expedientes de nivelación</Text>
        <Text style={styles.nota}>
          Verifica los procesos y las evidencias de cada expediente y da el visto bueno al cierre.
        </Text>
        <View style={styles.chips}>
          {FILTROS_COORDINACION.map((f) => (
            <Chip
              key={f.estado}
              label={f.etiqueta}
              selected={estado === f.estado}
              onPress={() => {
                setEstado(f.estado);
                setPagina(1);
                setPrevios([]);
              }}
            />
          ))}
        </View>

        {fuente.error ? (
          <>
            <Aviso tipo="error">{fuente.error}</Aviso>
            <Button title="Reintentar" onPress={fuente.recargar} />
          </>
        ) : null}
        {fuente.cargando && filas.length === 0 ? <Aviso tipo="nota">Cargando…</Aviso> : null}
        {fuente.datos && filas.length === 0 ? (
          <Aviso tipo="nota">No hay expedientes en este estado.</Aviso>
        ) : null}

        {filas.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={`Expediente de ${p.estudiante_nombre}, ${p.asignatura_nombre}`}
            onPress={() => onOpenPlan(p.id)}
            style={styles.fila}
          >
            <View style={styles.cabecera}>
              <View style={styles.cabeceraTexto}>
                <Text style={styles.nombre}>{p.estudiante_nombre}</Text>
                <Text style={styles.nota}>{p.asignatura_nombre}</Text>
              </View>
              <Text style={styles.atraso}>
                {p.estado === 'cerrado' && !p.visto_bueno
                  ? 'Sin visto bueno'
                  : ETIQUETA_PLAN[p.estado]}
              </Text>
            </View>
            <Text style={styles.nota}>Desempeños: {p.desempenos_no_alcanzados || p.objetivos}</Text>
            <Text style={styles.nota}>
              {p.docente_nombre ? `Docente: ${p.docente_nombre}` : 'Sin docente asignado'}
              {p.nota_final ? ` · nota ${p.nota_final.replace('.', ',')}` : ''}
              {p.visto_bueno ? ' · visto bueno' : ''}
            </Text>
          </Pressable>
        ))}

        {hayMas ? (
          <Button
            title="Cargar más"
            variant="link"
            loading={todos.cargando}
            onPress={() => {
              setPrevios(filas);
              setPagina((n) => n + 1);
            }}
          />
        ) : null}
      </ScrollView>
    </EmbeddedScreenFrame>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginBottom: spacing.md },
  resumen: { marginBottom: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  fila: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cabecera: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  cabeceraTexto: { flex: 1, minWidth: 0, marginRight: spacing.sm },
  nombre: { ...typography.subtitle, color: colors.text },
  nota: { ...typography.body, color: colors.textMuted },
  atraso: { ...typography.body, color: '#9B1C1C', fontWeight: '700' },
});
