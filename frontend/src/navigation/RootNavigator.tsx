import type { ComponentType } from 'react';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AsignarRolScreen } from '@/screens/usuarios/AsignarRolScreen';
import { AgendaScreen } from '@/screens/tutorias/AgendaScreen';
import { AsistenciaTutoriaScreen } from '@/screens/tutorias/AsistenciaTutoriaScreen';
import { CatalogoScreen } from '@/screens/academica/CatalogoScreen';
import { DatosPersonalesScreen } from '@/screens/perfil/DatosPersonalesScreen';
import { DisponibilidadTutorScreen } from '@/screens/tutorias/DisponibilidadTutorScreen';
import { ModalLayoutContext } from '@/components/ModalLayoutContext';
import { EstructuraScreen } from '@/screens/academica/EstructuraScreen';
import { GestionAcademicaScreen } from '@/screens/academica/GestionAcademicaScreen';
import { FichaEstudianteScreen } from '@/screens/academica/FichaEstudianteScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { InstitucionScreen } from '@/screens/academica/InstitucionScreen';
import { MiFichaScreen } from '@/screens/perfil/MiFichaScreen';
import { navigationRef } from '@/navigation/ref';
import { LoginScreen } from '@/screens/LoginScreen';
import { PerfilTutorScreen } from '@/screens/perfil/PerfilTutorScreen';
import { PeriodosScreen } from '@/screens/academica/PeriodosScreen';
import { PlanDetalleScreen } from '@/screens/planes/PlanDetalleScreen';
import { PlanesScreen } from '@/screens/planes/PlanesScreen';
import { PlanRefuerzoScreen } from '@/screens/planes/PlanRefuerzoScreen';
import { InformesScreen } from '@/screens/informes/InformesScreen';
import { ProgramarSesionScreen } from '@/screens/tutorias/ProgramarSesionScreen';
import { TableroScreen } from '@/screens/academica/TableroScreen';
import { NuevaContrasenaScreen } from '@/screens/auth/NuevaContrasenaScreen';
import { RecuperarContrasenaScreen } from '@/screens/auth/RecuperarContrasenaScreen';
import { VerificarCorreoScreen } from '@/screens/auth/VerificarCorreoScreen';
import { RegistroExitoScreen } from '@/screens/auth/RegistroExitoScreen';
import { RegistroScreen } from '@/screens/RegistroScreen';
import { colors, institution } from '@/theme';
import type { SesionTutoria } from '@/api/planes';

export type RootStackParamList = {
  Home: undefined;
  Agenda: undefined;
  DisponibilidadTutor: undefined;
  ProgramarSesion: { planId: number; session?: SesionTutoria };
  Login: undefined;
  AsignarRol: undefined;
  PerfilTutor: undefined;
  DatosPersonales: undefined;
  MiFicha: undefined;
  GestionAcademica: undefined;
  Institucion: undefined;
  Estructura: undefined;
  Catalogo: undefined;
  Periodos: undefined;
  Asistencia: { sesion: SesionTutoria };
  Tablero: undefined;
  FichaEstudiante: { estudianteId: number };
  PlanRefuerzo: { estudianteId: number; nombre: string };
  Planes: undefined;
  PlanDetalle: { planId: number };
  Informes: undefined;
  RecuperarContrasena: undefined;
  NuevaContrasena: { uid?: string; token?: string } | undefined;
  VerificarCorreo: { token?: string } | undefined;
  Registro: undefined;
  RegistroExito: { email: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const modalOptions = {
  presentation: 'transparentModal',
  animation: 'fade',
  contentStyle: { backgroundColor: 'transparent' },
} as const;

function enModal<P extends object>(Pantalla: ComponentType<P>) {
  return function PantallaModal(props: P) {
    return (
      <ModalLayoutContext.Provider value={true}>
        <Pantalla {...props} />
      </ModalLayoutContext.Provider>
    );
  };
}

const DatosPersonalesModal = enModal(DatosPersonalesScreen);
const MiFichaModal = enModal(MiFichaScreen);
const AsignarRolModal = enModal(AsignarRolScreen);
const GestionAcademicaModal = enModal(GestionAcademicaScreen);
const PlanesModal = enModal(PlanesScreen);
const AsistenciaModal = enModal(AsistenciaTutoriaScreen);
const PerfilTutorModal = enModal(PerfilTutorScreen);
const AgendaModal = enModal(AgendaScreen);
const DisponibilidadTutorModal = enModal(DisponibilidadTutorScreen);
const ProgramarSesionModal = enModal(ProgramarSesionScreen);

/**
 * En el celular `window` existe pero no tiene `location`; leerlo directamente cierra la app al abrir.
 * Solo el navegador aporta su propio origen como prefijo de enlaces.
 */
export function prefijosDeEnlaces(
  ventana: { location?: { origin?: string } } | undefined,
): string[] {
  const origen = ventana?.location?.origin;
  return ['tutorias://', 'http://localhost:8081', ...(origen ? [origen] : [])];
}

const linking = {
  // En Jest siempre hay `window`; la rama sin ventana (render en servidor) no se ejecuta aquí.
  prefixes: prefijosDeEnlaces(
    /* istanbul ignore next */ typeof window === 'undefined' ? undefined : window,
  ),
  config: {
    screens: { VerificarCorreo: 'verificar-correo', NuevaContrasena: 'nueva-contrasena' },
  },
};

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.navegacion,
    text: colors.primaryText,
    border: colors.border,
  },
};

export function RootNavigator() {
  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} linking={linking}>
      <Stack.Navigator initialRouteName="Login">
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: institution.appName }} />
        <Stack.Screen
          name="Agenda"
          component={AgendaModal}
          options={{ title: 'Agenda de acompañamiento', ...modalOptions }}
        />
        <Stack.Screen
          name="DisponibilidadTutor"
          component={DisponibilidadTutorModal}
          options={{ title: 'Mi disponibilidad', ...modalOptions }}
        />
        <Stack.Screen
          name="ProgramarSesion"
          component={ProgramarSesionModal}
          options={{ title: 'Programar encuentro', ...modalOptions }}
        />
        <Stack.Screen
          name="Registro"
          component={RegistroScreen}
          options={{ title: 'Crear cuenta' }}
        />
        <Stack.Screen
          name="AsignarRol"
          component={AsignarRolModal}
          options={{ title: 'Usuarios', ...modalOptions }}
        />
        <Stack.Screen
          name="PerfilTutor"
          component={PerfilTutorModal}
          options={{ title: 'Mi perfil docente', ...modalOptions }}
        />
        <Stack.Screen
          name="DatosPersonales"
          component={DatosPersonalesModal}
          options={{ title: 'Mi perfil', ...modalOptions }}
        />
        <Stack.Screen
          name="MiFicha"
          component={MiFichaModal}
          options={{
            title: 'Mi ficha',
            presentation: 'transparentModal',
            animation: 'fade',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="GestionAcademica"
          component={GestionAcademicaModal}
          options={{
            title: 'Académica',
            presentation: 'transparentModal',
            animation: 'fade',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="Institucion"
          component={InstitucionScreen}
          options={{ title: 'Institución y sedes' }}
        />
        <Stack.Screen
          name="Estructura"
          component={EstructuraScreen}
          options={{ title: 'Grados y grupos' }}
        />
        <Stack.Screen
          name="Catalogo"
          component={CatalogoScreen}
          options={{ title: 'Asignaturas' }}
        />
        <Stack.Screen
          name="Periodos"
          component={PeriodosScreen}
          options={{ title: 'Periodos académicos' }}
        />
        <Stack.Screen
          name="Asistencia"
          component={AsistenciaModal}
          options={{
            title: 'Asistencia',
            presentation: 'transparentModal',
            animation: 'fade',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="Tablero"
          component={TableroScreen}
          options={{ title: 'Tablero de desempeño' }}
        />
        <Stack.Screen
          name="Informes"
          component={InformesScreen}
          options={{ title: 'Informes de acompañamiento' }}
        />
        <Stack.Screen
          name="FichaEstudiante"
          component={FichaEstudianteScreen}
          options={{ title: 'Ficha del estudiante' }}
        />
        <Stack.Screen
          name="PlanRefuerzo"
          component={PlanRefuerzoScreen}
          options={{ title: 'Registro de nivelación' }}
        />
        <Stack.Screen
          name="Planes"
          component={PlanesModal}
          options={{
            title: 'Planes de nivelación',
            presentation: 'transparentModal',
            animation: 'fade',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="PlanDetalle"
          component={PlanDetalleScreen}
          options={{ title: 'Expediente de nivelación' }}
        />
        <Stack.Screen
          name="RecuperarContrasena"
          component={RecuperarContrasenaScreen}
          options={{ title: 'Recuperar contraseña' }}
        />
        <Stack.Screen
          name="NuevaContrasena"
          component={NuevaContrasenaScreen}
          options={{ title: 'Nueva contraseña' }}
        />
        <Stack.Screen
          name="VerificarCorreo"
          component={VerificarCorreoScreen}
          options={{ title: 'Verificar correo' }}
        />
        <Stack.Screen
          name="RegistroExito"
          component={RegistroExitoScreen}
          options={{ title: 'Cuenta creada', headerBackVisible: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
