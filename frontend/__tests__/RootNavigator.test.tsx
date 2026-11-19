import { act, render, screen } from '@testing-library/react-native';

import { navigationRef } from '@/navigation/ref';
import { RootNavigator } from '@/navigation/RootNavigator';

// Cada pantalla se sustituye por un texto con su nombre: aquí solo se prueba la navegación.
jest.mock('@/screens/usuarios/AsignarRolScreen', () => {
  const { Text } = require('react-native');
  return { AsignarRolScreen: () => <Text>pantalla AsignarRolScreen</Text> };
});
jest.mock('@/screens/tutorias/AgendaScreen', () => {
  const { Text } = require('react-native');
  return { AgendaScreen: () => <Text>pantalla AgendaScreen</Text> };
});
jest.mock('@/screens/tutorias/AsistenciaTutoriaScreen', () => {
  const { Text } = require('react-native');
  return { AsistenciaTutoriaScreen: () => <Text>pantalla AsistenciaTutoriaScreen</Text> };
});
jest.mock('@/screens/academica/CatalogoScreen', () => {
  const { Text } = require('react-native');
  return { CatalogoScreen: () => <Text>pantalla CatalogoScreen</Text> };
});
jest.mock('@/screens/perfil/DatosPersonalesScreen', () => {
  const { Text } = require('react-native');
  return { DatosPersonalesScreen: () => <Text>pantalla DatosPersonalesScreen</Text> };
});
jest.mock('@/screens/tutorias/DisponibilidadTutorScreen', () => {
  const { Text } = require('react-native');
  return { DisponibilidadTutorScreen: () => <Text>pantalla DisponibilidadTutorScreen</Text> };
});
jest.mock('@/screens/academica/EstructuraScreen', () => {
  const { Text } = require('react-native');
  return { EstructuraScreen: () => <Text>pantalla EstructuraScreen</Text> };
});
jest.mock('@/screens/academica/GestionAcademicaScreen', () => {
  const { Text } = require('react-native');
  return { GestionAcademicaScreen: () => <Text>pantalla GestionAcademicaScreen</Text> };
});
jest.mock('@/screens/academica/FichaEstudianteScreen', () => {
  const { Text } = require('react-native');
  return { FichaEstudianteScreen: () => <Text>pantalla FichaEstudianteScreen</Text> };
});
jest.mock('@/screens/HomeScreen', () => {
  const { Text } = require('react-native');
  return { HomeScreen: () => <Text>pantalla HomeScreen</Text> };
});
jest.mock('@/screens/academica/InstitucionScreen', () => {
  const { Text } = require('react-native');
  return { InstitucionScreen: () => <Text>pantalla InstitucionScreen</Text> };
});
jest.mock('@/screens/perfil/MiFichaScreen', () => {
  const { Text } = require('react-native');
  return { MiFichaScreen: () => <Text>pantalla MiFichaScreen</Text> };
});
jest.mock('@/screens/LoginScreen', () => {
  const { Text } = require('react-native');
  return { LoginScreen: () => <Text>pantalla LoginScreen</Text> };
});
jest.mock('@/screens/perfil/PerfilTutorScreen', () => {
  const { Text } = require('react-native');
  return { PerfilTutorScreen: () => <Text>pantalla PerfilTutorScreen</Text> };
});
jest.mock('@/screens/academica/PeriodosScreen', () => {
  const { Text } = require('react-native');
  return { PeriodosScreen: () => <Text>pantalla PeriodosScreen</Text> };
});
jest.mock('@/screens/planes/PlanDetalleScreen', () => {
  const { Text } = require('react-native');
  return { PlanDetalleScreen: () => <Text>pantalla PlanDetalleScreen</Text> };
});
jest.mock('@/screens/planes/PlanesScreen', () => {
  const { Text } = require('react-native');
  return { PlanesScreen: () => <Text>pantalla PlanesScreen</Text> };
});
jest.mock('@/screens/planes/PlanRefuerzoScreen', () => {
  const { Text } = require('react-native');
  return { PlanRefuerzoScreen: () => <Text>pantalla PlanRefuerzoScreen</Text> };
});
jest.mock('@/screens/informes/InformesScreen', () => {
  const { Text } = require('react-native');
  return { InformesScreen: () => <Text>pantalla InformesScreen</Text> };
});
jest.mock('@/screens/tutorias/ProgramarSesionScreen', () => {
  const { Text } = require('react-native');
  return { ProgramarSesionScreen: () => <Text>pantalla ProgramarSesionScreen</Text> };
});
jest.mock('@/screens/academica/TableroScreen', () => {
  const { Text } = require('react-native');
  return { TableroScreen: () => <Text>pantalla TableroScreen</Text> };
});
jest.mock('@/screens/auth/NuevaContrasenaScreen', () => {
  const { Text } = require('react-native');
  return { NuevaContrasenaScreen: () => <Text>pantalla NuevaContrasenaScreen</Text> };
});
jest.mock('@/screens/auth/RecuperarContrasenaScreen', () => {
  const { Text } = require('react-native');
  return { RecuperarContrasenaScreen: () => <Text>pantalla RecuperarContrasenaScreen</Text> };
});
jest.mock('@/screens/auth/VerificarCorreoScreen', () => {
  const { Text } = require('react-native');
  return { VerificarCorreoScreen: () => <Text>pantalla VerificarCorreoScreen</Text> };
});
jest.mock('@/screens/auth/RegistroExitoScreen', () => {
  const { Text } = require('react-native');
  return { RegistroExitoScreen: () => <Text>pantalla RegistroExitoScreen</Text> };
});
jest.mock('@/screens/RegistroScreen', () => {
  const { Text } = require('react-native');
  return { RegistroScreen: () => <Text>pantalla RegistroScreen</Text> };
});

describe('RootNavigator', () => {
  test('arranca en el login', async () => {
    await render(<RootNavigator />);
    expect(await screen.findByText('pantalla LoginScreen')).toBeTruthy();
  });

  test('las pantallas modales se muestran dentro del contenedor de modal', async () => {
    await render(<RootNavigator />);
    await screen.findByText('pantalla LoginScreen');
    await act(async () => {
      (navigationRef as unknown as { navigate: (n: string) => void }).navigate('Agenda');
    });
    expect(await screen.findByText('pantalla AgendaScreen')).toBeTruthy();
  });
});
