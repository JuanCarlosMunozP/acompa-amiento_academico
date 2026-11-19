import { fireEvent, render, screen } from '@testing-library/react-native';

import { obtenerFichaCompleta } from '@/api/planes';
import { FichaEstudianteScreen } from '@/screens/academica/FichaEstudianteScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/planes', () => ({
  ...jest.requireActual('@/api/planes'),
  obtenerFichaCompleta: jest.fn(),
}));
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));

const fichaMock = obtenerFichaCompleta as jest.Mock;
const sesionMock = useSession as jest.Mock;
const navigation = { navigate: jest.fn() };

const FICHA = {
  estudiante: {
    id: 7,
    nombre: 'Beatriz Castro',
    email: 'bea@c.co',
    grado: 'Sexto',
    grupo: 'A',
    matricula: 'activa',
  },
  periodo: { id: 1, nombre: '2026 - Periodo 2' },
  evaluacion: {
    estudiante: 7,
    estado: 'riesgo',
    medidas: {
      promedio: '2.80',
      asistencia: { porcentaje: '85.0', total: 10 },
      trabajos_pendientes: 1,
    },
    alertas: [
      {
        regla: 2,
        nombre: 'Nota en riesgo',
        tipo: 'nota_baja',
        severidad: 'riesgo',
        asignatura: 'Matemáticas',
        valor: '2.8',
        umbral: '3.00',
        explicacion: 'La nota de Matemáticas (2.8) es menor que 3.',
      },
    ],
  },
  asistencia: { porcentaje: '85.0', registros: [{ fecha: '2026-10-14', estado: 'ausente' }] },
  trabajos_pendientes: [
    {
      id: 1,
      asignatura_nombre: 'Matemáticas',
      descripcion: 'Taller 3',
      fecha_limite: '2026-10-01',
      vencido: true,
    },
  ],
  planes: [
    {
      id: 5,
      estudiante: 7,
      estudiante_nombre: 'Beatriz Castro',
      periodo: 1,
      periodo_nombre: '2026 - Periodo 2',
      asignatura: 1,
      asignatura_nombre: 'Matemáticas',
      objetivos: 'x',
      fecha_inicio: '2026-10-16',
      fecha_fin: '2026-11-13',
      estado: 'asignado',
      tutor: 9,
      tutor_nombre: 'Luis Tutor',
      docente_nombre: 'Luis Tutor',
    },
  ],
};

const comoRol = (rol: string) => sesionMock.mockReturnValue({ sesion: { usuario: { rol } } });
const abrir = () =>
  render(
    <FichaEstudianteScreen
      navigation={navigation as never}
      route={{ params: { estudianteId: 7 } } as never}
    />,
  );

beforeEach(() => {
  fichaMock.mockReset();
  navigation.navigate.mockReset();
  fichaMock.mockResolvedValue(FICHA);
  comoRol('coordinador');
});

test('muestra todas las secciones de la ficha', async () => {
  await abrir();

  expect(await screen.findByText('Beatriz Castro')).toBeTruthy();
  expect(screen.getByText('Sexto A · 2026 - Periodo 2')).toBeTruthy();
  expect(screen.getByText('Riesgo')).toBeTruthy();
  expect(
    screen.getByText('Promedio 2.80 · Asistencia 85.0 % · Trabajos sin entregar 1'),
  ).toBeTruthy();
  expect(screen.getByText('• La nota de Matemáticas (2.8) es menor que 3.')).toBeTruthy();
  expect(screen.getByText('2026-10-14 · Ausente')).toBeTruthy();
  expect(screen.getByText('Matemáticas: Taller 3 (límite 2026-10-01, vencido)')).toBeTruthy();
  expect(screen.getByText('En acompañamiento · 2026-10-16 al 2026-11-13')).toBeTruthy();
  expect(screen.getByText('Docente: Luis Tutor')).toBeTruthy();
  expect(fichaMock).toHaveBeenCalledWith(7);
});

test('coordinación crea un plan desde la ficha', async () => {
  await abrir();
  await fireEvent.press(await screen.findByRole('button', { name: 'Registrar nivelación' }));

  expect(navigation.navigate).toHaveBeenCalledWith('PlanRefuerzo', {
    estudianteId: 7,
    nombre: 'Beatriz Castro',
  });
});

test('un tutor ve la ficha pero no puede crear planes', async () => {
  comoRol('tutor');
  await abrir();

  expect(await screen.findByText('Beatriz Castro')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Registrar nivelación' })).toBeNull();
});

test('sin matrícula activa no se ofrece crear el plan y no se inventan datos', async () => {
  fichaMock.mockResolvedValue({
    ...FICHA,
    estudiante: { ...FICHA.estudiante, grado: null, grupo: null, matricula: null },
    asistencia: { porcentaje: null, registros: [] },
    trabajos_pendientes: [],
    planes: [],
    evaluacion: {
      ...FICHA.evaluacion,
      estado: 'sin_alertas',
      alertas: [],
      medidas: {
        promedio: null,
        asistencia: { porcentaje: null, total: 0 },
        trabajos_pendientes: 0,
      },
    },
  });
  await abrir();

  expect(await screen.findByText('Sin matrícula en 2026 - Periodo 2')).toBeTruthy();
  expect(screen.getByText('Promedio — · Asistencia — · Trabajos sin entregar 0')).toBeTruthy();
  expect(screen.getByText('No tiene planes de nivelación.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Registrar nivelación' })).toBeNull();
});

test('error al cargar: permite reintentar; 403 muestra el mensaje del servidor', async () => {
  fichaMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  await abrir();
  expect(await screen.findByText(/No pudimos cargar la ficha/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('Beatriz Castro')).toBeTruthy();

  fichaMock.mockReset();
  fichaMock.mockRejectedValue({
    error: { code: 'permission_denied', message: 'Solo ves a los estudiantes de tus planes.' },
  });
  await abrir();
  expect(await screen.findByText('Solo ves a los estudiantes de tus planes.')).toBeTruthy();
});

test('sin sesión no se consulta nada', async () => {
  sesionMock.mockReturnValue({ sesion: null });
  await abrir();

  expect(await screen.findByText('Inicia sesión para ver la ficha del estudiante.')).toBeTruthy();
  expect(fichaMock).not.toHaveBeenCalled();
});

test('alertas sin asignatura, estado de asistencia desconocido, trabajos vigentes y planes sin docente', async () => {
  fichaMock.mockResolvedValue({
    ...FICHA,
    evaluacion: {
      ...FICHA.evaluacion,
      alertas: [{ ...FICHA.evaluacion.alertas[0], asignatura: null, explicacion: 'Sin materia.' }],
    },
    asistencia: { porcentaje: '50.0', registros: [{ fecha: '2026-10-15', estado: 'otro' }] },
    trabajos_pendientes: [{ ...FICHA.trabajos_pendientes[0], vencido: false }],
    planes: [{ ...FICHA.planes[0], docente_nombre: null }],
  });
  await abrir();

  expect(await screen.findByText('• Sin materia.')).toBeTruthy();
  expect(screen.getByText('2026-10-15 · otro')).toBeTruthy();
  expect(screen.getByText('Matemáticas: Taller 3 (límite 2026-10-01)')).toBeTruthy();
  expect(screen.getByText('Sin docente')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Plan de Matemáticas'));
  expect(navigation.navigate).toHaveBeenCalledWith('PlanDetalle', { planId: 5 });
});
