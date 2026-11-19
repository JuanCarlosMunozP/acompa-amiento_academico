import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { listarGradosConGrupos, obtenerEvaluacion, obtenerMatriz } from '@/api/seguimiento';
import { TableroScreen } from '@/screens/academica/TableroScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/seguimiento', () => ({
  ...jest.requireActual('@/api/seguimiento'),
  listarGradosConGrupos: jest.fn(),
  obtenerMatriz: jest.fn(),
  obtenerEvaluacion: jest.fn(),
}));
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));

const gradosMock = listarGradosConGrupos as jest.Mock;
const matrizMock = obtenerMatriz as jest.Mock;
const evaluacionMock = obtenerEvaluacion as jest.Mock;
const sesionMock = useSession as jest.Mock;

const fila = (id: number, nombre: string, estado: string, extra: Record<string, unknown> = {}) => ({
  estudiante: id,
  nombre,
  email: `${nombre.split(' ')[0].toLowerCase()}@c.co`,
  grupo: 'Sexto A',
  promedio: '3.50',
  asistencia: '85.0',
  trabajos_pendientes: 1,
  estado,
  alertas: estado === 'sin_alertas' ? 0 : 1,
  ...extra,
});

const RESUMEN = { sin_alertas: 1, atencion: 0, riesgo: 1, critico: 1 };
const matriz = (filas: unknown[], extra: Record<string, unknown> = {}) => ({
  count: filas.length,
  next: null,
  previous: null,
  results: filas,
  periodo: 1,
  resumen: RESUMEN,
  ...extra,
});

const FILAS = [
  fila(1, 'Carlos Díaz', 'critico', { promedio: '1.50', asistencia: null, trabajos_pendientes: 6 }),
  fila(2, 'Beatriz Castro', 'riesgo'),
  fila(3, 'Ana Álvarez', 'sin_alertas', { promedio: '4.80' }),
];

const navigation = { navigate: jest.fn() };
const pantalla = () => <TableroScreen navigation={navigation as never} route={{} as never} />;

const comoRol = (rol: string) => sesionMock.mockReturnValue({ sesion: { usuario: { rol } } });
const boton = (nombre: string) => screen.getByRole('button', { name: nombre });

beforeEach(() => {
  [gradosMock, matrizMock, evaluacionMock, navigation.navigate].forEach((m) => m.mockReset());
  gradosMock.mockResolvedValue([{ id: 1, nombre: 'Sexto', grupos: [{ id: 10, nombre: 'A' }] }]);
  matrizMock.mockResolvedValue(matriz(FILAS));
  comoRol('coordinador');
});

async function abrir() {
  await render(pantalla());
  await screen.findByLabelText('Carlos Díaz, critico');
}

test('muestra cada estudiante con su estado y sus medidas', async () => {
  await abrir();

  expect(screen.getByText('Crítico')).toBeTruthy(); // la etiqueta del estado, no solo el color
  expect(screen.getByText('Sin solicitudes')).toBeTruthy();
  expect(screen.getByText('Promedio 1.50 · Asistencia — · Trabajos sin entregar 6')).toBeTruthy(); // sin dato de asistencia no se inventa un 0 %
  expect(
    screen.getByText('Promedio 4.80 · Asistencia 85.0 % · Trabajos sin entregar 1'),
  ).toBeTruthy();
  expect(screen.getByText('3 estudiante(s)')).toBeTruthy();
});

test('los filtros de estado traen el conteo de cada uno', async () => {
  await abrir();

  expect(screen.getByLabelText('Crítico')).toBeTruthy();
  expect(screen.getByText('Crítico (1)')).toBeTruthy();
  expect(screen.getByText('Riesgo (1)')).toBeTruthy();
  expect(screen.getByText('Atención (0)')).toBeTruthy();
});

test('filtrar por estado vuelve a consultar con ese estado', async () => {
  await abrir();
  matrizMock.mockResolvedValue(matriz([FILAS[0]]));
  await fireEvent.press(boton('Crítico'));

  await screen.findByText('1 estudiante(s)');
  expect(matrizMock).toHaveBeenLastCalledWith({ grupo: null, estado: 'critico', q: '', page: 1 });
  expect(boton('Crítico').props.accessibilityState.selected).toBe(true);
});

test('filtrar por grupo', async () => {
  await abrir();
  await fireEvent.press(boton('Sexto A'));

  await screen.findByText('3 estudiante(s)');
  expect(matrizMock).toHaveBeenLastCalledWith({ grupo: 10, estado: null, q: '', page: 1 });
});

test('buscar por nombre aplica el filtro al pulsar el botón con lupa', async () => {
  await abrir();
  matrizMock.mockClear();
  const campo = screen.getByLabelText('Buscar estudiante');
  expect(campo.props.placeholder).toBe('Buscar estudiante...');
  await fireEvent.changeText(campo, '  castro  ');
  expect(matrizMock).not.toHaveBeenCalled();
  await fireEvent.press(boton('Ejecutar búsqueda de estudiantes'));

  await waitFor(() =>
    expect(matrizMock).toHaveBeenLastCalledWith({
      grupo: null,
      estado: null,
      q: 'castro',
      page: 1,
    }),
  );
  expect(matrizMock).toHaveBeenCalledTimes(1);
});

test('conserva los filtros de estado y grupo al buscar', async () => {
  await abrir();
  await fireEvent.press(boton('Sexto A'));
  matrizMock.mockClear();
  await fireEvent.changeText(screen.getByLabelText('Buscar estudiante'), 'Beatriz');
  await fireEvent.press(boton('Ejecutar búsqueda de estudiantes'));

  await waitFor(() =>
    expect(matrizMock).toHaveBeenLastCalledWith({
      grupo: 10,
      estado: null,
      q: 'Beatriz',
      page: 1,
    }),
  );
});

test('al tocar un estudiante se explica por qué tiene ese estado', async () => {
  evaluacionMock.mockResolvedValue({
    estudiante: 2,
    estado: 'riesgo',
    medidas: {
      promedio: '3.50',
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
        explicacion:
          'La nota de Matemáticas (2.8) es menor que 3, el límite de la regla «Nota en riesgo».',
      },
    ],
  });
  await abrir();
  await fireEvent.press(screen.getByLabelText('Beatriz Castro, riesgo'));

  expect(
    await screen.findByText(
      '• La nota de Matemáticas (2.8) es menor que 3, el límite de la regla «Nota en riesgo».',
    ),
  ).toBeTruthy();
  expect(evaluacionMock).toHaveBeenCalledWith(2);
});

test('tocar de nuevo el mismo estudiante cierra el detalle', async () => {
  evaluacionMock.mockResolvedValue({
    estudiante: 3,
    estado: 'sin_alertas',
    medidas: {
      promedio: '4.80',
      asistencia: { porcentaje: null, total: 0 },
      trabajos_pendientes: 0,
    },
    alertas: [],
  });
  await abrir();
  const abrirFila = screen.getByLabelText('Ana Álvarez, sin_alertas');
  await fireEvent.press(abrirFila);
  expect(await screen.findByText('Sin solicitudes: ninguna regla se activó.')).toBeTruthy();

  await fireEvent.press(screen.getByLabelText('Ana Álvarez, sin_alertas'));
  expect(screen.queryByText('Sin solicitudes: ninguna regla se activó.')).toBeNull();
});

test('si falla el detalle se avisa sin romper la lista', async () => {
  evaluacionMock.mockRejectedValue(new TypeError('Network request failed'));
  await abrir();
  await fireEvent.press(screen.getByLabelText('Carlos Díaz, critico'));

  expect(await screen.findByText('No pudimos cargar el detalle del estudiante.')).toBeTruthy();
  expect(screen.getByLabelText('Beatriz Castro, riesgo')).toBeTruthy();
});

test('«Cargar más» agrega la página siguiente sin perder la anterior', async () => {
  matrizMock
    .mockResolvedValueOnce(matriz([FILAS[0]], { count: 2, next: 'http://api/?page=2' }))
    .mockResolvedValueOnce(matriz([FILAS[1]], { count: 2, next: null }));
  await abrir();
  await fireEvent.press(boton('Cargar más'));

  expect(await screen.findByLabelText('Beatriz Castro, riesgo')).toBeTruthy();
  expect(screen.getByLabelText('Carlos Díaz, critico')).toBeTruthy();
  expect(matrizMock).toHaveBeenLastCalledWith({ grupo: null, estado: null, q: '', page: 2 });
  expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull();
});

test('cambiar un filtro reinicia a la primera página', async () => {
  matrizMock
    .mockResolvedValueOnce(matriz([FILAS[0]], { count: 2, next: 'http://api/?page=2' }))
    .mockResolvedValueOnce(matriz([FILAS[1]], { count: 2, next: null }))
    .mockResolvedValue(matriz([FILAS[2]], { count: 1 }));
  await abrir();
  await fireEvent.press(boton('Cargar más'));
  await screen.findByLabelText('Beatriz Castro, riesgo');
  await fireEvent.press(boton('Sin solicitudes'));

  expect(await screen.findByLabelText('Ana Álvarez, sin_alertas')).toBeTruthy();
  expect(matrizMock).toHaveBeenLastCalledWith({
    grupo: null,
    estado: 'sin_alertas',
    q: '',
    page: 1,
  });
  expect(screen.queryByLabelText('Carlos Díaz, critico')).toBeNull(); // no se arrastran filas viejas
});

test('sin resultados lo explica', async () => {
  matrizMock.mockResolvedValue(matriz([], { count: 0 }));
  await render(pantalla());

  expect(await screen.findByText('No hay estudiantes con ese filtro.')).toBeTruthy();
});

test('error al cargar: avisa y permite reintentar', async () => {
  matrizMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  await render(pantalla());

  expect(await screen.findByText(/No pudimos cargar el tablero/)).toBeTruthy();
  await fireEvent.press(boton('Reintentar'));
  expect(await screen.findByLabelText('Carlos Díaz, critico')).toBeTruthy();
});

test('sin periodo vigente muestra el mensaje del servidor', async () => {
  matrizMock.mockRejectedValue({
    error: {
      code: 'validation_error',
      message: 'Indica un periodo existente: hoy no hay uno vigente.',
    },
  });
  await render(pantalla());

  expect(
    await screen.findByText('Indica un periodo existente: hoy no hay uno vigente.'),
  ).toBeTruthy();
});

test.each(['administrador', 'coordinador'])('%s puede ver el tablero', async (rol) => {
  comoRol(rol);
  await abrir();
});

test.each(['estudiante', 'tutor'])('%s no accede y no se consulta nada', async (rol) => {
  comoRol(rol);
  await render(pantalla());

  expect(
    await screen.findByText('No tienes permiso para ver el tablero de desempeño.'),
  ).toBeTruthy();
  expect(matrizMock).not.toHaveBeenCalled();
});

test('«Abrir ficha completa» lleva a la ficha del estudiante', async () => {
  evaluacionMock.mockResolvedValue({
    estudiante: 2,
    estado: 'riesgo',
    medidas: {
      promedio: '3.50',
      asistencia: { porcentaje: '85.0', total: 10 },
      trabajos_pendientes: 1,
    },
    alertas: [],
  });
  await abrir();
  await fireEvent.press(screen.getByLabelText('Beatriz Castro, riesgo'));
  await fireEvent.press(await screen.findByRole('button', { name: 'Abrir ficha completa' }));

  expect(navigation.navigate).toHaveBeenCalledWith('FichaEstudiante', { estudianteId: 2 });
});

test('los chips «Todos» quitan los filtros de estado y de grupo', async () => {
  await abrir();
  await fireEvent.press(boton('Riesgo'));
  await fireEvent.press(boton('Todos'));
  await waitFor(() =>
    expect(matrizMock).toHaveBeenLastCalledWith(expect.objectContaining({ estado: null })),
  );
  await fireEvent.press(boton('Sexto A'));
  await fireEvent.press(boton('Todos los grupos'));
  await waitFor(() => expect(matrizMock).toHaveBeenCalledTimes(5));
});

test('una alerta sin asignatura se explica igual', async () => {
  evaluacionMock.mockResolvedValue({
    estudiante: 2,
    estado: 'riesgo',
    medidas: {
      promedio: '3.50',
      asistencia: { porcentaje: '85.0', total: 10 },
      trabajos_pendientes: 1,
    },
    alertas: [
      {
        regla: 2,
        nombre: 'Asistencia baja',
        tipo: 'asistencia_baja',
        severidad: 'riesgo',
        asignatura: null,
        valor: '70',
        umbral: '80',
        explicacion: 'La asistencia es menor al 80 %.',
      },
    ],
  });
  await abrir();
  await fireEvent.press(screen.getByLabelText('Beatriz Castro, riesgo'));
  expect(await screen.findByText('• La asistencia es menor al 80 %.')).toBeTruthy();
});
