/** Agrupa las opciones de navegación de la gestión académica. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CatalogoScreen } from '@/screens/academica/CatalogoScreen';
import { EstructuraScreen } from '@/screens/academica/EstructuraScreen';
import { InstitucionScreen } from '@/screens/academica/InstitucionScreen';
import { PeriodosScreen } from '@/screens/academica/PeriodosScreen';
import { PlantillasCorreoScreen } from '@/screens/academica/PlantillasCorreoScreen';
import { ReglasAcademicasScreen } from '@/screens/academica/ReglasAcademicasScreen';
import { TableroPanel } from '@/screens/academica/TableroScreen';
import { Aviso } from '@/components/Aviso';
import { EmbeddedScreenFrame } from '@/components/EmbeddedScreenFrame';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { useSession } from '@/store/session';
import { colors, radius, spacing, typography } from '@/theme';
import { puedeVerRoles } from '@/types/roles';

type Props = NativeStackScreenProps<RootStackParamList, 'GestionAcademica'>;

type Destino =
  'Institucion' | 'Estructura' | 'Catalogo' | 'Periodos' | 'Tablero' | 'Plantillas' | 'Reglas';
type Seccion = Destino;

const OPCIONES: { titulo: string; destino: Destino }[] = [
  { titulo: 'Tablero de desempeño', destino: 'Tablero' },
  { titulo: 'Institución y sedes', destino: 'Institucion' },
  { titulo: 'Grados y grupos', destino: 'Estructura' },
  { titulo: 'Catálogo de asignaturas', destino: 'Catalogo' },
  { titulo: 'Periodos académicos', destino: 'Periodos' },
  { titulo: 'Plantillas de correo', destino: 'Plantillas' },
  { titulo: 'Reglas y umbrales', destino: 'Reglas' },
];

/** Accesos académicos para administración y coordinación. */
export function GestionAcademicaScreen({ navigation }: Props) {
  return (
    <GestionAcademicaPanel
      onOpenFicha={(estudianteId) => navigation.navigate('FichaEstudiante', { estudianteId })}
    />
  );
}

export function GestionAcademicaPanel({
  embedded = false,
  onOpenFicha,
}: {
  embedded?: boolean;
  onOpenFicha: (estudianteId: number) => void;
}) {
  const { sesion } = useSession();
  const [seccion, setSeccion] = useState<Seccion>('Tablero');

  if (!puedeVerRoles(sesion?.usuario.rol)) {
    return (
      <EmbeddedScreenFrame embedded={embedded}>
        <Text style={styles.title}>Sin acceso</Text>
        <Aviso tipo="error">No tienes permiso para acceder a la sección académica.</Aviso>
      </EmbeddedScreenFrame>
    );
  }

  return (
    <EmbeddedScreenFrame embedded={embedded}>
      <Text style={styles.title}>Académica</Text>
      <View style={styles.sectionNavigation}>
        <Text style={styles.sectionLabel}>Módulos académicos</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.navbar}
          contentContainerStyle={styles.navItems}
        >
          {OPCIONES.map((opcion) => (
            <Pressable
              key={opcion.destino}
              accessibilityRole="button"
              accessibilityState={{ selected: seccion === opcion.destino }}
              onPress={() => setSeccion(opcion.destino)}
              style={[styles.navItem, seccion === opcion.destino && styles.navItemActivo]}
            >
              <Text style={[styles.navText, seccion === opcion.destino && styles.navTextActivo]}>
                {opcion.titulo}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {seccion === 'Institucion' ? <InstitucionScreen embedded /> : null}
      {seccion === 'Estructura' ? <EstructuraScreen embedded /> : null}
      {seccion === 'Catalogo' ? <CatalogoScreen embedded /> : null}
      {seccion === 'Periodos' ? <PeriodosScreen embedded /> : null}
      {seccion === 'Tablero' ? <TableroPanel embedded onOpenFicha={onOpenFicha} /> : null}
      {seccion === 'Plantillas' ? <PlantillasCorreoScreen embedded /> : null}
      {seccion === 'Reglas' ? <ReglasAcademicasScreen embedded /> : null}
    </EmbeddedScreenFrame>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginBottom: spacing.lg },
  sectionNavigation: {
    marginBottom: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  sectionLabel: {
    ...typography.body,
    color: colors.textMuted,
    fontWeight: '600',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  navbar: {
    flexGrow: 0,
    minHeight: 48,
  },
  navItems: {
    alignItems: 'stretch',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    minHeight: 48,
  },
  navItem: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm + 2,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  navText: { ...typography.body, color: colors.textMuted, fontWeight: '600' },
  navTextActivo: { color: colors.primary },
  navItemActivo: { borderBottomColor: colors.primary },
});
