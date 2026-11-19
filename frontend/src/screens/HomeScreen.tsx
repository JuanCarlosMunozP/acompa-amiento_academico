/** Dirige al panel de inicio adecuado según la sesión y el rol activo. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { listarMisNotificaciones, marcarNotificacionLeida } from '@/api/planes';
import type { NotificacionAcompanamiento } from '@/api/planes';
import { ConfirmarCierreSesion } from '@/components/ConfirmarCierreSesion';
import { Screen } from '@/components/Screen';
import { useCarga } from '@/hooks/useCarga';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import {
  HomeResponsiveLayout,
  type HomeNavigationLink,
} from '@/screens/dashboard/HomeResponsiveLayout';
import { HomeMainContent, type SeccionInicio } from '@/screens/dashboard/HomeMainContent';
import { useSession } from '@/store/session';
import { esAdministrador, puedeTomarAsistencia, puedeVerRoles } from '@/types/roles';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const mensajeDeNotificacion = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'error' in error) {
    const apiError = (error as { error?: { message?: string } }).error;
    if (apiError?.message) return apiError.message;
  }
  return 'No pudimos cargar o actualizar tus avisos. Revisa tu conexión e inténtalo de nuevo.';
};

export function HomeScreen({ navigation }: Props) {
  const { sesion, cargando, cerrar } = useSession();
  const [confirmando, setConfirmando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [seccionInicio, setSeccionInicio] = useState<SeccionInicio | null>(null);
  const [errorNotificaciones, setErrorNotificaciones] = useState('');
  const notificacionesCarga = useCarga(listarMisNotificaciones, {
    habilitado: Boolean(sesion),
    error: 'No pudimos cargar tus avisos. Revisa tu conexión e inténtalo de nuevo.',
  });
  const notificaciones =
    notificacionesCarga.datos?.resultados.filter((item) => !item.leida).slice(0, 4) ?? [];

  // El inicio de sesión es la página de inicio: sin sesión no hay nada que mostrar aquí.
  useEffect(() => {
    if (!cargando && !sesion) navigation.replace('Login');
  }, [cargando, sesion, navigation]);

  useEffect(() => {
    if (!sesion) return;
    const intervalo = setInterval(notificacionesCarga.recargar, 20000);
    return () => clearInterval(intervalo);
  }, [notificacionesCarga.recargar, sesion]);

  const abrirNotificacion = async (notificacion: NotificacionAcompanamiento) => {
    try {
      await marcarNotificacionLeida(notificacion.id);
      notificacionesCarga.actualizar((actuales) => ({
        ...actuales,
        no_leidas: Math.max(0, actuales.no_leidas - 1),
        resultados: actuales.resultados.map((item) =>
          item.id === notificacion.id ? { ...item, leida: new Date().toISOString() } : item,
        ),
      }));
      setErrorNotificaciones('');
      if (notificacion.plan) {
        navigation.navigate('PlanDetalle', { planId: notificacion.plan });
      } else if (notificacion.sesion || notificacion.tipo === 'sesion') {
        navigation.navigate('Agenda');
      } else if (notificacion.tipo === 'plan' || notificacion.tipo === 'solicitud') {
        navigation.navigate('Planes');
      }
    } catch (error) {
      setErrorNotificaciones(mensajeDeNotificacion(error));
    }
  };

  const cerrarSesion = async () => {
    setCerrando(true);
    setSeccionInicio(null);
    try {
      await cerrar();
    } finally {
      setCerrando(false);
      setConfirmando(false);
    }
  };

  const enlacesNavegacion: HomeNavigationLink[] = sesion
    ? [
        {
          label: 'Inicio',
          active: seccionInicio === null,
          onPress: () => setSeccionInicio(null),
        },
        ...(sesion.usuario.rol === 'tutor'
          ? [{ label: 'Agenda de acompañamiento', onPress: () => navigation.navigate('Agenda') }]
          : []),
        ...(sesion.usuario.rol === 'estudiante'
          ? [{ label: 'Encuentros por asistir', onPress: () => navigation.navigate('Agenda') }]
          : []),
        {
          label: 'Mi perfil',
          active: seccionInicio === 'perfil',
          onPress: () => setSeccionInicio('perfil'),
        },
        ...(sesion.usuario.rol === 'estudiante'
          ? [{ label: 'Mi ficha', onPress: () => navigation.navigate('MiFicha') }]
          : []),
        ...(puedeVerRoles(sesion.usuario.rol) || sesion.usuario.rol === 'tutor'
          ? [
              {
                label: 'Usuarios',
                active: seccionInicio === 'usuarios',
                onPress: () => setSeccionInicio('usuarios'),
              },
            ]
          : []),
        ...(esAdministrador(sesion.usuario.rol)
          ? [
              {
                label: 'Acudientes',
                active: seccionInicio === 'acudientes',
                onPress: () => setSeccionInicio('acudientes'),
              },
            ]
          : []),
        ...(puedeVerRoles(sesion.usuario.rol)
          ? [
              {
                label: 'Académica',
                active: seccionInicio === 'academica',
                onPress: () => setSeccionInicio('academica'),
              },
              {
                label: 'Expedientes de nivelación',
                active: seccionInicio === 'solicitudes',
                onPress: () => setSeccionInicio('solicitudes'),
              },
            ]
          : []),
        ...(sesion.usuario.rol === 'tutor'
          ? [
              {
                label: 'Estudiantes',
                active: seccionInicio === 'estudiantes',
                onPress: () => setSeccionInicio('estudiantes'),
              },
              {
                label: 'Planes de nivelación',
                active: seccionInicio === 'planes',
                onPress: () => setSeccionInicio('planes'),
              },
            ]
          : []),
        ...(puedeTomarAsistencia(sesion.usuario.rol)
          ? [
              {
                label: sesion.usuario.rol === 'tutor' ? 'Mis informes' : 'Informes',
                active: seccionInicio === 'informes',
                onPress: () => setSeccionInicio('informes'),
              },
            ]
          : []),
        ...(sesion.usuario.rol === 'tutor'
          ? [
              { label: 'Perfil docente', onPress: () => navigation.navigate('PerfilTutor') },
              {
                label: 'Disponibilidad',
                onPress: () => navigation.navigate('DisponibilidadTutor'),
              },
            ]
          : []),
      ]
    : [];

  const contenido = (
    <HomeMainContent
      sesion={sesion}
      seccion={seccionInicio}
      notificaciones={notificaciones}
      errorNotificaciones={errorNotificaciones}
      errorCargaNotificaciones={notificacionesCarga.error}
      onRetryNotifications={() => {
        setErrorNotificaciones('');
        notificacionesCarga.recargar();
      }}
      onOpenNotification={(notificacion) => void abrirNotificacion(notificacion)}
      onRegistrarNivelacion={(estudianteId, nombre) =>
        navigation.navigate('PlanRefuerzo', { estudianteId, nombre })
      }
      onOpenAgenda={() => navigation.navigate('Agenda')}
      onOpenFicha={(estudianteId) => navigation.navigate('FichaEstudiante', { estudianteId })}
      onOpenPlan={(planId) => navigation.navigate('PlanDetalle', { planId })}
      onGoHome={() => setSeccionInicio(null)}
    />
  );

  return (
    <Screen fullWidth={Boolean(sesion && Platform.OS === 'web')}>
      {sesion ? (
        <HomeResponsiveLayout links={enlacesNavegacion} onLogout={() => setConfirmando(true)}>
          {contenido}
        </HomeResponsiveLayout>
      ) : (
        contenido
      )}
      {/* Independiente de la sección activa: se abre al pulsar "Cerrar sesión" desde cualquiera. */}
      <ConfirmarCierreSesion
        visible={Boolean(sesion) && confirmando}
        cerrando={cerrando}
        onConfirm={() => void cerrarSesion()}
        onCancel={() => setConfirmando(false)}
      />
    </Screen>
  );
}
