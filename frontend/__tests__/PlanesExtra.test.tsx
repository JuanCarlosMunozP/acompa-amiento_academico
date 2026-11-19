import { fireEvent, render, screen } from '@testing-library/react-native';

import { listarMisPlanes, listarPlanes } from '@/api/planes';
import { PlanesPanel, PlanesScreen } from '@/screens/planes/PlanesScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/planes', () => ({
  ...jest.requireActual('@/api/planes'),
  listarPlanes: jest.fn(),
  listarMisPlanes: jest.fn(),
}));
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));

const listarMock = listarPlanes as jest.Mock;
const misMock = listarMisPlanes as jest.Mock;
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
  desempenos_no_alcanzados: '',
  docente_nombre: null,
  nota_final: null,
  visto_bueno: false,
  fecha_inicio: '2026-10-16',
  fecha_fin: '2026-11-13',
  estado: 'asignado',
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

const pagina = (results: unknown[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
  resumen: { pendiente: 0, asignado: 0, cerrado: 0, cancelado: 0 },
});

const comoRol = (rol: string) => sesionMock.mockReturnValue({ sesion: { usuario: { rol } } });

beforeEach(() => {
  jest.clearAllMocks();
  listarMock.mockReset().mockResolvedValue(pagina([]));
  misMock.mockReset().mockResolvedValue([]);
});

describe('título de la pantalla según el rol', () => {
  test.each([
    ['tutor', 'Planes de nivelación'],
    ['estudiante', 'Mis planes de nivelación'],
    ['acudiente', 'Mis planes de nivelación'],
    ['coordinador', 'Expedientes de nivelación'],
  ])('%s', async (rol, titulo) => {
    comoRol(rol);
    await render(<PlanesScreen navigation={navigation as never} route={{} as never} />);
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: titulo });
  });

  test('sin sesión usa el título general', async () => {
    sesionMock.mockReturnValue({ sesion: null });
    await render(<PlanesScreen navigation={navigation as never} route={{} as never} />);
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Expedientes de nivelación' });
  });

  test('abrir un plan o volver al inicio navega', async () => {
    comoRol('tutor');
    misMock.mockResolvedValue([plan(3)]);
    await render(<PlanesScreen navigation={navigation as never} route={{} as never} />);
    await fireEvent.press(await screen.findByLabelText('Plan de Materia 3, Estudiante 3'));
    expect(navigation.navigate).toHaveBeenCalledWith('PlanDetalle', { planId: 3 });
  });

  test('un rol sin acceso vuelve al inicio desde la pantalla', async () => {
    sesionMock.mockReturnValue({ sesion: { usuario: { rol: 'invitado' } } });
    await render(<PlanesScreen navigation={navigation as never} route={{} as never} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Volver al inicio' }));
    expect(navigation.navigate).toHaveBeenCalledWith('Home');
  });
});

describe('planes propios', () => {
  test('mientras carga y cuando no hay planes', async () => {
    comoRol('estudiante');
    let resolver: (v: unknown[]) => void = () => undefined;
    misMock.mockReturnValue(new Promise((r) => (resolver = r)));
    await render(<PlanesPanel embedded onOpenPlan={jest.fn()} onGoHome={jest.fn()} />);
    expect(screen.getByText('Cargando tus planes…')).toBeTruthy();
    resolver([]);
    expect(
      await screen.findByText('Todavía no hay planes de nivelación registrados.'),
    ).toBeTruthy();
  });

  test('si falla la consulta lo avisa', async () => {
    comoRol('estudiante');
    misMock.mockRejectedValue(new Error('x'));
    await render(<PlanesPanel onOpenPlan={jest.fn()} onGoHome={jest.fn()} />);
    expect(await screen.findByText('No pudimos cargar tus planes de nivelación.')).toBeTruthy();
  });

  test('muestra el avance, los objetivos si faltan desempeños y la nota final', async () => {
    comoRol('acudiente');
    const onOpenPlan = jest.fn();
    misMock.mockResolvedValue([
      plan(4, { progreso: 50, actividades_completadas: 1, actividades_total: 2 }),
      plan(5, { estado: 'cerrado', nota_final: '4.20' }),
    ]);
    await render(<PlanesPanel onOpenPlan={onOpenPlan} onGoHome={jest.fn()} />);
    expect(await screen.findByText('Progreso 50 % (1 de 2)')).toBeTruthy();
    expect(screen.getAllByText('Desempeños: Requiere refuerzo')).toHaveLength(2);
    expect(screen.getByText('Sin actividades')).toBeTruthy();
    expect(screen.getByText(/nota 4,20/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Plan de Materia 4, Estudiante 4'));
    expect(onOpenPlan).toHaveBeenCalledWith(4);
  });
});

describe('otros roles y coordinación', () => {
  test('un rol sin acceso vuelve al inicio', async () => {
    sesionMock.mockReturnValue({ sesion: { usuario: { rol: 'invitado' } } });
    const onGoHome = jest.fn();
    await render(<PlanesPanel embedded onOpenPlan={jest.fn()} onGoHome={onGoHome} />);
    expect(screen.getByText(/Este módulo es para docentes/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Volver al inicio' }));
    expect(onGoHome).toHaveBeenCalled();
  });

  test('cambia de filtro, muestra el estado de cada expediente y abre uno', async () => {
    comoRol('administrador');
    const onOpenPlan = jest.fn();
    listarMock.mockResolvedValue(
      pagina([
        plan(1, {
          estado: 'cerrado',
          visto_bueno: true,
          nota_final: '3.50',
          docente_nombre: 'Luis Tutor',
        }),
        plan(2, { estado: 'pendiente' }),
      ]),
    );
    await render(<PlanesPanel onOpenPlan={onOpenPlan} onGoHome={jest.fn()} />);
    expect(await screen.findByText(/Docente: Luis Tutor · nota 3,50 · visto bueno/)).toBeTruthy();
    expect(screen.getByText('Sin docente asignado')).toBeTruthy();

    await fireEvent.press(screen.getByText('Sin docente'));
    expect(listarMock).toHaveBeenLastCalledWith({ estado: 'pendiente', page: 1 });
    await fireEvent.press(screen.getByText('En acompañamiento'));
    expect(listarMock).toHaveBeenLastCalledWith({ estado: 'asignado', page: 1 });

    await fireEvent.press(await screen.findByLabelText('Expediente de Estudiante 1, Materia 1'));
    expect(onOpenPlan).toHaveBeenCalledWith(1);
  });
});
