import { fireEvent, render, screen } from '@testing-library/react-native';

import { HomeMainContent } from '@/screens/dashboard/HomeMainContent';

function mockPanel(texto: (p: { rol?: string }) => string) {
  const React = require('react');
  const { Text } = require('react-native');
  return (props: { rol?: string }) => React.createElement(Text, null, texto(props));
}
jest.mock('@/screens/perfil/DatosPersonalesScreen', () => ({
  DatosPersonalesScreen: mockPanel(() => 'panel perfil'),
}));
jest.mock('@/screens/usuarios/AsignarRolScreen', () => ({
  AsignarRolScreen: mockPanel(() => 'panel usuarios'),
}));
jest.mock('@/screens/usuarios/VinculosAcudienteScreen', () => ({
  VinculosAcudienteScreen: mockPanel(() => 'panel acudientes'),
}));
jest.mock('@/screens/academica/GestionAcademicaScreen', () => ({
  GestionAcademicaPanel: mockPanel(() => 'panel academica'),
}));
jest.mock('@/screens/planes/PlanesScreen', () => ({
  PlanesPanel: mockPanel(() => 'panel planes'),
}));
jest.mock('@/screens/informes/InformesScreen', () => ({
  InformesPanel: mockPanel(() => 'panel informes'),
}));
jest.mock('@/screens/planes/EstudiantesNivelacionPanel', () => ({
  EstudiantesNivelacionPanel: mockPanel(() => 'panel estudiantes'),
}));
jest.mock('@/screens/dashboard/HomeExpedientesPanel', () => ({
  HomeExpedientesPanel: mockPanel((p) => `expedientes ${p.rol}`),
}));
jest.mock('@/screens/dashboard/HomeDashboardPanels', () => ({
  PanelTutor: mockPanel(() => 'panel tutor'),
  PanelInstitucional: mockPanel(() => 'panel institucional'),
}));

const usuario = (rol: string) => ({ usuario: { rol, nombres: 'Ana' } }) as never;

const base = {
  sesion: null,
  seccion: null,
  notificaciones: [],
  errorNotificaciones: '',
  onRetryNotifications: jest.fn(),
  onOpenNotification: jest.fn(),
  onRegistrarNivelacion: jest.fn(),
  onOpenAgenda: jest.fn(),
  onOpenFicha: jest.fn(),
  onOpenPlan: jest.fn(),
  onGoHome: jest.fn(),
};

const aviso = (extra: Record<string, unknown>) =>
  ({
    id: 1,
    titulo: 'Título',
    mensaje: 'Mensaje',
    tipo: 'general',
    plan: null,
    sesion: null,
    leida: null,
    ...extra,
  }) as never;

beforeEach(() => jest.clearAllMocks());

test.each([
  ['perfil', 'panel perfil'],
  ['usuarios', 'panel usuarios'],
  ['acudientes', 'panel acudientes'],
  ['academica', 'panel academica'],
  ['solicitudes', 'panel planes'],
  ['planes', 'panel planes'],
  ['informes', 'panel informes'],
  ['estudiantes', 'panel estudiantes'],
])('la sección %s muestra su panel', async (seccion, texto) => {
  await render(<HomeMainContent {...base} seccion={seccion as never} />);
  expect(screen.getByText(texto)).toBeTruthy();
});

test.each([
  ['estudiante', 'expedientes estudiante'],
  ['acudiente', 'expedientes acudiente'],
  ['tutor', 'panel tutor'],
  ['coordinador', 'panel institucional'],
])('el inicio de %s', async (rol, texto) => {
  await render(<HomeMainContent {...base} sesion={usuario(rol)} />);
  expect(screen.getByText('Hola, Ana')).toBeTruthy();
  expect(screen.getByText(texto)).toBeTruthy();
});

describe('errores de notificaciones', () => {
  test('muestra el error de carga si no hay otro y permite reintentar', async () => {
    await render(
      <HomeMainContent
        {...base}
        sesion={usuario('tutor')}
        errorCargaNotificaciones="No pudimos cargar"
      />,
    );
    expect(screen.getByText('No pudimos cargar')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
    expect(base.onRetryNotifications).toHaveBeenCalled();
  });

  test('prefiere el error de la última acción', async () => {
    await render(
      <HomeMainContent
        {...base}
        sesion={usuario('tutor')}
        errorNotificaciones="Falló marcar"
        errorCargaNotificaciones="No pudimos cargar"
      />,
    );
    expect(screen.getByText('Falló marcar')).toBeTruthy();
  });
});

describe('avisos', () => {
  test.each([
    [{ plan: 4 }, 'Ir al aviso →'],
    [{ sesion: 3 }, 'Ir al aviso →'],
    [{ tipo: 'sesion' }, 'Ir al aviso →'],
    [{ tipo: 'plan' }, 'Ir al aviso →'],
    [{ tipo: 'duda' }, 'Ir al aviso →'],
    [{ tipo: 'entrega' }, 'Ir al aviso →'],
    [{ tipo: 'solicitud' }, 'Ir al aviso →'],
    [{ tipo: 'general' }, 'Marcar como leída'],
  ])('%j', async (extra, boton) => {
    const notificacion = aviso(extra);
    await render(
      <HomeMainContent {...base} sesion={usuario('tutor')} notificaciones={[notificacion]} />,
    );
    await fireEvent.press(screen.getByText(boton));
    expect(base.onOpenNotification).toHaveBeenCalledWith(notificacion);
  });
});

test('sin sesión no muestra botones de iniciar sesión ni de crear cuenta', async () => {
  await render(<HomeMainContent {...base} />);
  expect(screen.queryByRole('button', { name: 'Iniciar sesión' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Crear cuenta' })).toBeNull();
});
