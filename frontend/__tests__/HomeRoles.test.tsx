import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { listarMisNotificaciones, marcarNotificacionLeida } from '@/api/planes';
import { HomeScreen } from '@/screens/HomeScreen';
import { useSession } from '@/store/session';

jest.mock('@/store/session', () => ({ useSession: jest.fn() }));
jest.mock('@/api/planes', () => ({
  ...jest.requireActual('@/api/planes'),
  listarMisNotificaciones: jest.fn(),
  marcarNotificacionLeida: jest.fn(),
}));

const sesionMock = useSession as jest.Mock;
const notificacionesMock = listarMisNotificaciones as jest.Mock;
const marcarLeidaMock = marcarNotificacionLeida as jest.Mock;
const route = { key: 'Home', name: 'Home' } as never;

beforeEach(() => {
  notificacionesMock.mockReset().mockResolvedValue({ no_leidas: 0, resultados: [] });
  marcarLeidaMock.mockReset().mockResolvedValue({ id: 12, leida: '2026-10-20T12:00:00Z' });
});

async function abrirComo(rol?: string) {
  sesionMock.mockReturnValue({
    sesion: rol ? { usuario: { nombres: 'Ana', rol } } : null,
    cerrar: jest.fn(),
  });
  const navigation = { navigate: jest.fn(), replace: jest.fn() };
  await render(<HomeScreen navigation={navigation as never} route={route} />);
  return navigation;
}

test.each(['administrador', 'coordinador'])('%s abre Usuarios dentro de Inicio', async (rol) => {
  const navigation = await abrirComo(rol);
  await fireEvent.press(screen.getByRole('button', { name: 'Usuarios' }));
  expect(await screen.findAllByText('Usuarios')).toHaveLength(2);
  expect(navigation.navigate).not.toHaveBeenCalled();
});

test('el estudiante no ve el acceso a Usuarios', async () => {
  await abrirComo('estudiante');
  expect(screen.getByText('Hola, Ana')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Usuarios' })).toBeNull();
});

test('el tutor puede abrir Usuarios en modo de consulta', async () => {
  const navigation = await abrirComo('tutor');
  await fireEvent.press(screen.getByRole('button', { name: 'Usuarios' }));
  expect(await screen.findAllByText('Usuarios')).toHaveLength(2);
  expect(navigation.navigate).not.toHaveBeenCalled();
});

test('sin sesión no se ofrece Usuarios y se lleva al login', async () => {
  const navigation = await abrirComo();
  expect(screen.queryByRole('button', { name: 'Usuarios' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Iniciar sesión' })).toBeNull();
  expect(navigation.replace).toHaveBeenCalledWith('Login');
});

test('el tutor ve el acceso a su perfil de tutor', async () => {
  const navigation = await abrirComo('tutor');
  await fireEvent.press(screen.getByRole('button', { name: 'Perfil docente' }));
  expect(navigation.navigate).toHaveBeenCalledWith('PerfilTutor');
});

test('muestra avisos como tarjetas y abre el plan relacionado', async () => {
  notificacionesMock.mockResolvedValue({
    no_leidas: 1,
    resultados: [
      {
        id: 12,
        tipo: 'plan',
        titulo: 'Nuevo plan de acompañamiento',
        mensaje: 'Tienes un plan asignado.',
        creada: '2026-10-20T12:00:00Z',
        leida: null,
        plan: 34,
        sesion: null,
      },
    ],
  });
  const navigation = await abrirComo('estudiante');

  expect(await screen.findByText('Nuevo plan de acompañamiento')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Ir al aviso →' }));

  await waitFor(() => {
    expect(marcarLeidaMock).toHaveBeenCalledWith(12);
    expect(navigation.navigate).toHaveBeenCalledWith('PlanDetalle', { planId: 34 });
  });
});

test.each(['estudiante', 'coordinador', 'administrador'])(
  '%s no ve el perfil de tutor',
  async (rol) => {
    await abrirComo(rol);
    expect(screen.queryByRole('button', { name: 'Mi perfil de tutor' })).toBeNull();
  },
);
