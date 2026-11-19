import { fireEvent, render, screen } from '@testing-library/react-native';

import { listarMisPlanes, listarPlanes, obtenerContadores } from '@/api/planes';
import { PlanesScreen } from '@/screens/planes/PlanesScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/planes', () => ({
  ...jest.requireActual('@/api/planes'),
  listarPlanes: jest.fn(),
  listarMisPlanes: jest.fn(),
  obtenerContadores: jest.fn(),
}));
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));

const listarMock = listarPlanes as jest.Mock;
const misMock = listarMisPlanes as jest.Mock;
const contadoresMock = obtenerContadores as jest.Mock;
const sesionMock = useSession as jest.Mock;
const navigation = { navigate: jest.fn(), setOptions: jest.fn() };

const plan = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  estudiante: 7,
  estudiante_nombre: `Estudiante ${id}`,
  periodo: 1,
  periodo_nombre: 'P',
  asignatura: 1,
  asignatura_nombre: `Materia ${id}`,
  objetivos: 'Requiere refuerzo',
  desempenos_no_alcanzados: 'No resuelve fracciones',
  docente_nombre: null,
  nota_final: null,
  visto_bueno: false,
  fecha_inicio: '2026-10-16',
  fecha_fin: '2026-11-13',
  estado: 'cerrado',
  tutor: null,
  tutor_nombre: null,
  resultado: '',
  fecha_cierre: null,
  nota_cierre: '',
  actividades_total: 0,
  actividades_completadas: 0,
  progreso: null,
  atrasado: false,
  ...extra,
});

const pagina = (results: unknown[], extra: Record<string, unknown> = {}) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
  resumen: { pendiente: 1, asignado: 2, cerrado: 0, cancelado: 0 },
  ...extra,
});

const comoRol = (rol: string) => sesionMock.mockReturnValue({ sesion: { usuario: { rol } } });
const abrir = () => render(<PlanesScreen navigation={navigation as never} route={{} as never} />);

beforeEach(() => {
  [listarMock, misMock, contadoresMock, navigation.navigate, navigation.setOptions].forEach((m) =>
    m.mockReset(),
  );
  listarMock.mockResolvedValue(pagina([plan(1), plan(2)]));
  misMock.mockResolvedValue([
    plan(3, { estado: 'asignado', tutor_nombre: 'Luis Tutor', docente_nombre: 'Luis Tutor' }),
  ]);
  comoRol('coordinador');
});

test('coordinación ve los expedientes cerrados por verificar y sus detalles', async () => {
  await abrir();

  expect(await screen.findByLabelText('Expediente de Estudiante 1, Materia 1')).toBeTruthy();
  expect(screen.getAllByText('Desempeños: No resuelve fracciones')).toHaveLength(2);
  expect(screen.getAllByText('Sin visto bueno')).toHaveLength(2);
  expect(listarMock).toHaveBeenCalledWith({ estado: 'cerrado', page: 1 });
  expect(contadoresMock).not.toHaveBeenCalled();
});

test('cargar más agrega los expedientes siguientes sin duplicar las anteriores', async () => {
  listarMock
    .mockResolvedValueOnce(
      pagina([plan(1)], { count: 2, next: 'http://api/planes/?estado=cerrado&page=2' }),
    )
    .mockResolvedValueOnce(pagina([plan(2)], { count: 2 }));
  await abrir();
  await fireEvent.press(await screen.findByRole('button', { name: 'Cargar más' }));

  expect(await screen.findByLabelText('Expediente de Estudiante 2, Materia 2')).toBeTruthy();
  expect(screen.getByLabelText('Expediente de Estudiante 1, Materia 1')).toBeTruthy();
  expect(listarMock).toHaveBeenLastCalledWith({ estado: 'cerrado', page: 2 });
});

test('abrir un expediente muestra el seguimiento del plan', async () => {
  await abrir();
  await fireEvent.press(await screen.findByLabelText('Expediente de Estudiante 1, Materia 1'));

  expect(navigation.navigate).toHaveBeenCalledWith('PlanDetalle', { planId: 1 });
});

test('sin expedientes muestra un mensaje', async () => {
  listarMock.mockResolvedValue(pagina([]));
  await abrir();

  expect(await screen.findByText('No hay expedientes en este estado.')).toBeTruthy();
});

test('si falla la carga se puede reintentar', async () => {
  listarMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  await abrir();

  expect(await screen.findByText('No pudimos cargar los expedientes.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByLabelText('Expediente de Estudiante 1, Materia 1')).toBeTruthy();
});

test.each(['tutor', 'estudiante', 'acudiente'])(
  '%s ve únicamente los planes propios',
  async (rol) => {
    comoRol(rol);
    await abrir();

    expect(await screen.findByLabelText('Plan de Materia 3, Estudiante 3')).toBeTruthy();
    expect(
      screen.getByText(
        rol === 'tutor' ? 'Planes de nivelación a mi cargo' : 'Planes de nivelación',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Desempeños: No resuelve fracciones')).toBeTruthy();
    expect(listarMock).not.toHaveBeenCalled();
    expect(contadoresMock).not.toHaveBeenCalled();
  },
);

test('sin sesión no se consultan los planes', async () => {
  sesionMock.mockReturnValue({ sesion: null });
  await abrir();

  expect(await screen.findByText('Inicia sesión para ver los planes de nivelación.')).toBeTruthy();
  expect(listarMock).not.toHaveBeenCalled();
  expect(misMock).not.toHaveBeenCalled();
});
