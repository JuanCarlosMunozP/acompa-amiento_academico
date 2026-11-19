import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  actualizarReglaAcademica,
  crearReglaAcademica,
  listarReglasAcademicas,
} from '@/api/seguimiento';
import { ReglasAcademicasScreen } from '@/screens/academica/ReglasAcademicasScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/seguimiento', () => ({
  ...jest.requireActual('@/api/seguimiento'),
  actualizarReglaAcademica: jest.fn(),
  crearReglaAcademica: jest.fn(),
  listarReglasAcademicas: jest.fn(),
}));
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));

const listarMock = listarReglasAcademicas as jest.Mock;
const crearMock = crearReglaAcademica as jest.Mock;
const actualizarMock = actualizarReglaAcademica as jest.Mock;
const sesionMock = useSession as jest.Mock;

const REGLA = {
  id: 7,
  nombre: 'Promedio bajo',
  tipo: 'nota_baja' as const,
  umbral: '3.00',
  severidad: 'riesgo' as const,
  activa: true,
};
const INACTIVA = {
  ...REGLA,
  id: 8,
  nombre: 'Asistencia',
  tipo: 'asistencia_baja' as const,
  activa: false,
};

const comoAdmin = () =>
  sesionMock.mockReturnValue({ sesion: { usuario: { rol: 'administrador' } } });
const boton = (nombre: string) => screen.getByRole('button', { name: nombre });

beforeEach(() => {
  jest.clearAllMocks();
  listarMock.mockReset().mockResolvedValue([REGLA, INACTIVA]);
  crearMock.mockReset();
  actualizarMock.mockReset();
  comoAdmin();
});

test('sin sesión pide iniciar sesión', async () => {
  sesionMock.mockReturnValue({ sesion: null });
  await render(<ReglasAcademicasScreen />);
  expect(await screen.findByText('Inicia sesión para consultar las reglas.')).toBeTruthy();
  expect(listarMock).not.toHaveBeenCalled();
});

test('si falla la carga permite reintentar', async () => {
  listarMock.mockRejectedValueOnce(new Error('x'));
  await render(<ReglasAcademicasScreen embedded />);
  expect(await screen.findByText(/No pudimos cargar las reglas académicas/)).toBeTruthy();
  await fireEvent.press(boton('Reintentar'));
  expect(await screen.findByText('Promedio bajo')).toBeTruthy();
});

test('muestra las reglas activas e inactivas con su tipo y severidad', async () => {
  await render(<ReglasAcademicasScreen embedded />);
  expect(await screen.findByText('Inactiva')).toBeTruthy();
  expect(screen.getByText('Activa')).toBeTruthy();
  expect(screen.getByText(/Asistencia baja · Umbral 3.00 · Riesgo/)).toBeTruthy();
});

test('crea una regla nueva eligiendo tipo y severidad', async () => {
  crearMock.mockResolvedValue({});
  await render(<ReglasAcademicasScreen embedded />);
  await fireEvent.press(await screen.findByText('Agregar regla'));
  expect(screen.getByText('Nueva regla')).toBeTruthy();
  expect(screen.queryByText('Regla activa')).toBeNull();

  await fireEvent.press(boton('Guardar regla'));
  expect(await screen.findByText('Ingresa un nombre para la regla.')).toBeTruthy();
  expect(screen.getByText('Ingresa el valor del umbral.')).toBeTruthy();
  expect(crearMock).not.toHaveBeenCalled();

  await fireEvent.changeText(screen.getByLabelText('Nombre'), '  Pendientes  ');
  await fireEvent.press(boton('Trabajos pendientes'));
  await fireEvent.changeText(screen.getByLabelText('Umbral'), ' 4 ');
  await fireEvent.press(boton('Crítico'));
  await fireEvent.press(boton('Guardar regla'));

  await waitFor(() =>
    expect(crearMock).toHaveBeenCalledWith({
      nombre: 'Pendientes',
      tipo: 'trabajos_pendientes',
      umbral: '4',
      severidad: 'critico',
      activa: true,
    }),
  );
  expect(await screen.findByText('La regla académica se guardó correctamente.')).toBeTruthy();
  expect(screen.getByText('Agregar regla')).toBeTruthy();
});

test('muestra los errores del servidor y permite cancelar', async () => {
  actualizarMock.mockRejectedValueOnce({
    error: { message: 'Umbral fuera de rango', details: { umbral: ['Debe estar entre 1 y 5.'] } },
  });
  await render(<ReglasAcademicasScreen embedded />);
  await fireEvent.press((await screen.findAllByText('Editar regla'))[1]);
  expect(screen.getAllByText('Editar regla').length).toBeGreaterThan(0);
  await fireEvent.press(boton('Guardar regla'));
  expect(await screen.findByText('Debe estar entre 1 y 5.')).toBeTruthy();
  expect(screen.getByText('Umbral fuera de rango')).toBeTruthy();
  expect(actualizarMock).toHaveBeenCalledWith(8, expect.objectContaining({ activa: false }));

  await fireEvent(screen.getByRole('switch'), 'valueChange', true);
  await fireEvent.press(boton('Cancelar'));
  expect(screen.queryByText('Guardar regla')).toBeNull();
});
