import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { actualizarReglaAcademica, listarReglasAcademicas } from '@/api/seguimiento';
import { ReglasAcademicasScreen } from '@/screens/academica/ReglasAcademicasScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/seguimiento', () => ({
  ...jest.requireActual('@/api/seguimiento'),
  actualizarReglaAcademica: jest.fn(),
  listarReglasAcademicas: jest.fn(),
}));
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));

const listarMock = listarReglasAcademicas as jest.Mock;
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

beforeEach(() => {
  listarMock.mockReset().mockResolvedValue([REGLA]);
  actualizarMock.mockReset();
});

test('administrador puede ajustar y guardar el umbral', async () => {
  sesionMock.mockReturnValue({ sesion: { usuario: { rol: 'administrador' } } });
  actualizarMock.mockImplementation(async (_id, datos) => ({ ...REGLA, ...datos }));
  await render(<ReglasAcademicasScreen embedded />);

  await fireEvent.press(await screen.findByRole('button', { name: 'Editar regla' }));
  await fireEvent.changeText(screen.getByLabelText('Umbral'), '3.25');
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar regla' }));

  await waitFor(() =>
    expect(actualizarMock).toHaveBeenCalledWith(7, {
      nombre: REGLA.nombre,
      tipo: REGLA.tipo,
      umbral: '3.25',
      severidad: REGLA.severidad,
      activa: true,
    }),
  );
  expect(await screen.findByText('La regla académica se guardó correctamente.')).toBeTruthy();
});

test('coordinación consulta las reglas pero no puede editarlas', async () => {
  sesionMock.mockReturnValue({ sesion: { usuario: { rol: 'coordinador' } } });
  await render(<ReglasAcademicasScreen embedded />);

  expect(await screen.findByText(/Solo lectura/)).toBeTruthy();
  expect(screen.getByText('Promedio bajo')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Editar regla' })).toBeNull();
});
