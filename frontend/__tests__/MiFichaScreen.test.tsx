import { fireEvent, render, screen } from '@testing-library/react-native';

import { obtenerMiFicha } from '@/api/perfil';
import { MiFichaScreen } from '@/screens/perfil/MiFichaScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/perfil', () => ({
  ...jest.requireActual('@/api/perfil'),
  obtenerMiFicha: jest.fn(),
}));
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));

const fichaMock = obtenerMiFicha as jest.Mock;
const sesionMock = useSession as jest.Mock;

const USUARIO = { id: 7, email: 'ana@colegio.edu.co', nombres: 'Ana', apellidos: 'Ruiz' };

const ficha = (extra: Record<string, unknown> = {}) => ({
  id: 3,
  usuario: USUARIO,
  grado: null,
  grupo: null,
  ...extra,
});

beforeEach(() => {
  fichaMock.mockReset().mockResolvedValue(ficha());
  sesionMock.mockReturnValue({ sesion: { usuario: { ...USUARIO, rol: 'estudiante' } } });
});

test('muestra el grado y el grupo asignados', async () => {
  fichaMock.mockResolvedValue(
    ficha({
      grado: { id: 1, nombre: 'Sexto' },
      grupo: { id: 2, nombre: 'A', grado: { id: 1, nombre: 'Sexto' } },
    }),
  );
  await render(<MiFichaScreen />);

  expect(await screen.findByText('Ana Ruiz')).toBeTruthy();
  expect(screen.getByText('ana@colegio.edu.co')).toBeTruthy();
  expect(screen.getByText('Sexto')).toBeTruthy();
  expect(screen.getByText('A')).toBeTruthy();
  expect(screen.queryByText(/Coordinación te asignará/)).toBeNull();
});

test('sin grupo asignado lo explica con claridad', async () => {
  await render(<MiFichaScreen />);

  expect(await screen.findByText('Ana Ruiz')).toBeTruthy();
  expect(screen.getAllByText('Sin asignar')).toHaveLength(2);
  expect(screen.getByText(/Coordinación te asignará un grupo/)).toBeTruthy();
});

test('muestra "Cargando…" mientras llega la ficha', async () => {
  fichaMock.mockReturnValue(new Promise(() => undefined)); // nunca responde
  await render(<MiFichaScreen />);
  expect(screen.getByText('Cargando…')).toBeTruthy();
});

test('error de red: avisa y permite reintentar', async () => {
  fichaMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  await render(<MiFichaScreen />);

  expect(await screen.findByText(/No pudimos cargar tu ficha/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));

  expect(await screen.findByText('Ana Ruiz')).toBeTruthy();
  expect(screen.queryByText(/No pudimos cargar tu ficha/)).toBeNull();
});

test.each(['tutor', 'coordinador', 'administrador'])(
  '%s no accede a la ficha de estudiante y no se consulta nada',
  async (rol) => {
    sesionMock.mockReturnValue({ sesion: { usuario: { ...USUARIO, rol } } });
    await render(<MiFichaScreen />);

    expect(await screen.findByText('La ficha es solo para estudiantes.')).toBeTruthy();
    expect(fichaMock).not.toHaveBeenCalled();
  },
);

test('sin sesión tampoco se muestra', async () => {
  sesionMock.mockReturnValue({ sesion: null });
  await render(<MiFichaScreen />);

  expect(await screen.findByText('Sin acceso')).toBeTruthy();
  expect(fichaMock).not.toHaveBeenCalled();
});

test('si se sale de la pantalla antes de la respuesta no se actualiza nada', async () => {
  let resolver: (v: unknown) => void = () => undefined;
  fichaMock.mockReturnValueOnce(new Promise((r) => (resolver = r)));
  const vista = await render(<MiFichaScreen />);
  await vista.unmount();
  resolver(ficha());
  await Promise.resolve();

  let rechazar: (e: unknown) => void = () => undefined;
  fichaMock.mockReturnValueOnce(new Promise((_ok, no) => (rechazar = no)));
  const otra = await render(<MiFichaScreen />);
  await otra.unmount();
  rechazar(new Error('tarde'));
  await Promise.resolve();
  expect(fichaMock).toHaveBeenCalledTimes(2);
});
