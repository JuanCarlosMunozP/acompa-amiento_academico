/** Organiza el contenido principal y las acciones disponibles desde el inicio. */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { NotificacionAcompanamiento } from '@/api/planes';
import type { SesionRespuesta } from '@/api/auth';
import { AsignarRolScreen } from '@/screens/usuarios/AsignarRolScreen';
import { VinculosAcudienteScreen } from '@/screens/usuarios/VinculosAcudienteScreen';
import { DatosPersonalesScreen } from '@/screens/perfil/DatosPersonalesScreen';
import { GestionAcademicaPanel } from '@/screens/academica/GestionAcademicaScreen';
import { HomeExpedientesPanel } from '@/screens/dashboard/HomeExpedientesPanel';
import { PanelInstitucional, PanelTutor } from '@/screens/dashboard/HomeDashboardPanels';
import { InformesPanel } from '@/screens/informes/InformesScreen';
import { EstudiantesNivelacionPanel } from '@/screens/planes/EstudiantesNivelacionPanel';
import { PlanesPanel } from '@/screens/planes/PlanesScreen';
import { colors, radius, spacing, typography } from '@/theme';

export type SeccionInicio =
  | 'perfil'
  | 'usuarios'
  | 'academica'
  | 'solicitudes'
  | 'planes'
  | 'informes'
  | 'estudiantes'
  | 'acudientes';

type Props = {
  sesion: SesionRespuesta | null;
  seccion: SeccionInicio | null;
  notificaciones: NotificacionAcompanamiento[];
  errorNotificaciones: string;
  errorCargaNotificaciones?: string;
  onRetryNotifications: () => void;
  onOpenNotification: (notificacion: NotificacionAcompanamiento) => void;
  onRegistrarNivelacion: (estudianteId: number, nombre: string) => void;
  onOpenAgenda: () => void;
  onOpenFicha: (estudianteId: number) => void;
  onOpenPlan: (planId: number) => void;
  onGoHome: () => void;
};

export function HomeMainContent({
  sesion,
  seccion,
  notificaciones,
  errorNotificaciones,
  errorCargaNotificaciones,
  onRetryNotifications,
  onOpenNotification,
  onRegistrarNivelacion,
  onOpenAgenda,
  onOpenFicha,
  onOpenPlan,
  onGoHome,
}: Props) {
  if (seccion !== null) {
    return (
      <View style={styles.internalView}>
        {seccion === 'perfil' ? <DatosPersonalesScreen embedded /> : null}
        {seccion === 'usuarios' ? <AsignarRolScreen embedded /> : null}
        {seccion === 'acudientes' ? <VinculosAcudienteScreen embedded /> : null}
        {seccion === 'academica' ? (
          <GestionAcademicaPanel embedded onOpenFicha={onOpenFicha} />
        ) : null}
        {seccion === 'solicitudes' || seccion === 'planes' ? (
          <PlanesPanel embedded onOpenPlan={onOpenPlan} onGoHome={onGoHome} />
        ) : null}
        {seccion === 'informes' ? <InformesPanel embedded onOpenAgenda={onOpenAgenda} /> : null}
        {seccion === 'estudiantes' ? (
          <EstudiantesNivelacionPanel embedded onRegistrar={onRegistrarNivelacion} />
        ) : null}
      </View>
    );
  }

  return (
    <ScrollView style={styles.content} contentContainerStyle={styles.homeContent}>
      {sesion ? (
        <>
          <Text style={styles.saludo}>Hola, {sesion.usuario.nombres}</Text>
          {errorNotificaciones || errorCargaNotificaciones ? (
            <View style={styles.notificationErrorRow}>
              <Text accessibilityRole="alert" style={styles.notificationError}>
                {errorNotificaciones || errorCargaNotificaciones}
              </Text>
              <Pressable accessibilityRole="button" onPress={onRetryNotifications}>
                <Text style={styles.notificationDismiss}>Reintentar</Text>
              </Pressable>
            </View>
          ) : null}
          {notificaciones.length > 0 ? (
            <View style={styles.notificationGrid}>
              {notificaciones.map((notificacion) => (
                <View
                  key={notificacion.id}
                  accessibilityRole="alert"
                  style={styles.notificationToast}
                >
                  <View style={styles.notificationCopy}>
                    <Text style={styles.notificationTitle}>{notificacion.titulo}</Text>
                    <Text style={styles.notificationMessage}>{notificacion.mensaje}</Text>
                  </View>
                  <View style={styles.notificationActions}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => onOpenNotification(notificacion)}
                    >
                      <Text style={styles.notificationDismiss}>
                        {notificacion.plan ||
                        notificacion.sesion ||
                        notificacion.tipo === 'sesion' ||
                        notificacion.tipo === 'plan' ||
                        notificacion.tipo === 'duda' ||
                        notificacion.tipo === 'entrega' ||
                        notificacion.tipo === 'solicitud'
                          ? 'Ir al aviso →'
                          : 'Marcar como leída'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
          {sesion.usuario.rol === 'estudiante' || sesion.usuario.rol === 'acudiente' ? (
            <HomeExpedientesPanel rol={sesion.usuario.rol} onOpenPlan={onOpenPlan} />
          ) : sesion.usuario.rol === 'tutor' ? (
            <PanelTutor onOpenAgenda={onOpenAgenda} />
          ) : (
            <PanelInstitucional />
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, marginTop: spacing.lg },
  internalView: { flex: 1, marginTop: spacing.lg },
  homeContent: { paddingBottom: spacing.xl, gap: spacing.md },
  saludo: { ...typography.subtitle, color: colors.text, marginBottom: spacing.md },
  notificationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  notificationToast: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 280,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#EDF5FF',
    borderColor: '#B7D2F2',
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  notificationCopy: { flex: 1, minWidth: 0, gap: 4 },
  notificationTitle: { color: '#183B66', fontWeight: '700' },
  notificationMessage: { color: '#345578', fontSize: 12 },
  notificationActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  notificationDismiss: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  notificationError: { ...typography.body, color: colors.error, flex: 1 },
  notificationErrorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
});
