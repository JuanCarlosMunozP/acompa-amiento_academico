/** Compone los paneles de información y acciones del tablero de inicio. */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/theme';

export function PanelInstitucional() {
  return (
    <View style={styles.roleDashboard}>
      <View style={styles.dashboardHeading}>
        <Text style={styles.dashboardTitle}>Inicio institucional</Text>
        <Text style={styles.demoLabel}>Datos ficticios para el piloto</Text>
      </View>
      <Text style={styles.dashboardDescription}>
        Resumen para coordinación y administración. Verifica los procesos de nivelación y da el
        visto bueno a los cierres.
      </Text>
      <View style={styles.dashboardStats}>
        <StatCard label="Estudiantes activos" value="286" detail="En todos los grados" />
        <StatCard label="Docentes habilitados" value="18" detail="Docentes del colegio" />
        <StatCard label="Planes en curso" value="32" detail="Nivelaciones en acompañamiento" />
        <StatCard label="Nivelación lograda" value="74 %" detail="En el periodo actual" />
      </View>
      <View style={styles.dashboardColumns}>
        <View style={styles.dashboardSection}>
          <Text style={styles.sectionTitle}>Seguimiento prioritario</Text>
          <DashboardRow
            title="Samuel Ortega · 8.º A"
            detail="Matemáticas · asistencia por revisar"
            badge="Atención"
          />
          <DashboardRow
            title="Mariana López · 9.º B"
            detail="Ciencias naturales · plan en curso"
            badge="En riesgo"
          />
          <DashboardRow
            title="David Rosero · 7.º A"
            detail="Lengua castellana · sin docente asignado"
            badge="Pendiente"
          />
        </View>
        <View style={styles.dashboardSection}>
          <Text style={styles.sectionTitle}>Actividad del colegio</Text>
          <DashboardRow title="12 sesiones programadas" detail="Para hoy entre todos los grados" />
          <DashboardRow
            title="3 expedientes por verificar"
            detail="Cerrados, a la espera del visto bueno"
          />
          <DashboardRow
            title="Grado con mayor avance"
            detail="8.º · 81 % de asistencia registrada"
          />
        </View>
      </View>
    </View>
  );
}

export function PanelTutor({ onOpenAgenda }: { onOpenAgenda: () => void }) {
  return (
    <View style={styles.roleDashboard}>
      <View style={styles.dashboardHeading}>
        <Text style={styles.dashboardTitle}>Mi espacio docente</Text>
        <Text style={styles.demoLabel}>Datos ficticios para el piloto</Text>
      </View>
      <Text style={styles.dashboardDescription}>
        Revisa tus estudiantes, las próximas sesiones y los registros que tienes pendientes.
      </Text>
      <View style={styles.dashboardStats}>
        <StatCard label="Estudiantes asignados" value="8" detail="De 7.º a 10.º" />
        <StatCard label="Sesiones esta semana" value="6" detail="4 completadas" />
        <StatCard label="Bitácoras pendientes" value="2" detail="Registra el cierre de sesión" />
      </View>
      <View style={styles.dashboardSection}>
        <Text style={styles.sectionTitle}>Próximas tutorías</Text>
        <DashboardRow
          title="Hoy · 10:00 a. m. · 8.º A"
          detail="Matemáticas · Fracciones y proporciones"
          badge="Virtual"
        />
        <DashboardRow
          title="Mañana · 2:00 p. m. · 9.º B"
          detail="Ciencias naturales · Sistema respiratorio"
          badge="Presencial"
        />
        <DashboardRow
          title="Viernes · 9:00 a. m. · 7.º A"
          detail="Inglés · Comprensión de lectura"
          badge="Virtual"
        />
        <Pressable accessibilityRole="button" onPress={onOpenAgenda} style={styles.dashboardAction}>
          <Text style={styles.dashboardActionText}>Abrir mi agenda</Text>
        </Pressable>
      </View>
    </View>
  );
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statDetail}>{detail}</Text>
    </View>
  );
}

function DashboardRow({ title, detail, badge }: { title: string; detail: string; badge?: string }) {
  return (
    <View style={styles.dashboardRow}>
      <View style={styles.dashboardRowCopy}>
        <Text style={styles.dashboardRowTitle}>{title}</Text>
        <Text style={styles.dashboardRowDetail}>{detail}</Text>
      </View>
      {badge ? <Text style={styles.dashboardBadge}>{badge}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  roleDashboard: { gap: spacing.md, paddingBottom: spacing.xl },
  dashboardHeading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  dashboardTitle: { color: '#142B45', fontSize: 24, fontWeight: '700' },
  demoLabel: { fontSize: 11, color: colors.textMuted },
  dashboardDescription: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  dashboardStats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statCard: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 190,
    minHeight: 110,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  statLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  statValue: { color: colors.primary, fontSize: 28, fontWeight: '700' },
  statDetail: { color: colors.textMuted, fontSize: 11 },
  dashboardColumns: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  dashboardSection: {
    flex: 1,
    flexBasis: 290,
    flexShrink: 1,
    minWidth: 0,
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  sectionTitle: { color: '#142B45', fontSize: 15, fontWeight: '700', marginBottom: spacing.xs },
  dashboardRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dashboardRowCopy: { flex: 1, minWidth: 0, gap: 3 },
  dashboardRowTitle: { color: colors.text, fontWeight: '600', fontSize: 12 },
  dashboardRowDetail: { color: colors.textMuted, fontSize: 11 },
  dashboardBadge: {
    color: '#345578',
    backgroundColor: '#EDF2F8',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: 12,
    fontSize: 10,
  },
  dashboardAction: {
    minHeight: 40,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: '#142B45',
    borderRadius: radius.sm,
  },
  dashboardActionText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
});
