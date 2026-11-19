import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  actualizarActividad,
  agregarActividad,
  asignarTutor,
  cerrarPlan,
  listarDudas,
  listarEntregas,
  listarObservaciones,
  listarTutoresElegibles,
  obtenerSeguimiento,
} from '@/api/planes';
import { PlanDetalleScreen } from '@/screens/planes/PlanDetalleScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/planes', () => ({
  ...jest.requireActual('@/api/planes'),
  obtenerSeguimiento: jest.fn(),
  agregarActividad: jest.fn(),
  actualizarActividad: jest.fn(),
  cerrarPlan: jest.fn(),
  listarTutoresElegibles: jest.fn(),
  asignarTutor: jest.fn(),
  listarDudas: jest.fn(),
  listarEntregas: jest.fn(),
  listarObservaciones: jest.fn(),
}));
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));

const seguimientoMock = obtenerSeguimiento as jest.Mock;
const agregarMock = agregarActividad as jest.Mock;
const actualizarMock = actualizarActividad as jest.Mock;
const cerrarMock = cerrarPlan as jest.Mock;
const elegiblesMock = listarTutoresElegibles as jest.Mock;
const asignarMock = asignarTutor as jest.Mock;
const sesionMock = useSession as jest.Mock;

const PLAN = {
  id: 5,
  estudiante: 7,
  estudiante_nombre: 'Beatriz Castro',
  periodo: 1,
  periodo_nombre: 'P',
  asignatura: 1,
  asignatura_nombre: 'Matemáticas',
  objetivos: 'Reforzar fracciones',
  fecha_inicio: '2026-10-16',
  fecha_fin: '2026-11-13',
  estado: 'asignado',
  tutor: 9,
  tutor_nombre: 'Luis Tutor',
  docente_nombre: 'Luis Tutor',
  desempenos_no_alcanzados: 'No resuelve fracciones',
  nota_final: null,
  visto_bueno: false,
  resultado: '',
  fecha_cierre: null,
  nota_cierre: '',
  actividades_total: 2,
  actividades_completadas: 1,
  progreso: 50,
  atrasado: false,
  puede_gestionar: true,
  sesiones: [],
  actividades: [
    {
      id: 1,
      titulo: 'Taller 1',
      descripcion: 'Página 12',
      fecha_limite: '2026-10-20',
      completada: false,
      fecha_completada: null,
      vencida: true,
    },
    {
      id: 2,
      titulo: 'Taller 2',
      descripcion: '',
      fecha_limite: '2026-10-22',
      completada: true,
      fecha_completada: '2026-10-21T10:00:00Z',
      vencida: false,
    },
  ],
};

const comoRol = (rol: string) =>
  sesionMock.mockReturnValue({ sesion: { usuario: { rol, id: 9 } } });
const boton = (nombre: string) => screen.getByRole('button', { name: nombre });

async function abrir() {
  await render(
    <PlanDetalleScreen navigation={{} as never} route={{ params: { planId: 5 } } as never} />,
  );
  await screen.findByText('Reforzar fracciones');
}

beforeEach(() => {
  [seguimientoMock, agregarMock, actualizarMock, cerrarMock, elegiblesMock, asignarMock].forEach(
    (m) => m.mockReset(),
  );
  seguimientoMock.mockResolvedValue(PLAN);
  (listarDudas as jest.Mock).mockResolvedValue([]);
  (listarEntregas as jest.Mock).mockResolvedValue([]);
  (listarObservaciones as jest.Mock).mockResolvedValue([]);
  elegiblesMock.mockResolvedValue([
    { id: 9, nombre: 'Luis Tutor', email: 'l@c.co', carga: 1 },
    { id: 10, nombre: 'Ana Tutora', email: 'a@c.co', carga: 0 },
  ]);
  comoRol('tutor');
});

test('muestra el avance, las actividades y la fecha límite de cada una', async () => {
  await abrir();

  expect(screen.getByText('50 % · 1 de 2 actividades')).toBeTruthy();
  expect(screen.getByText('Pendiente · límite 2026-10-20 (vencida)')).toBeTruthy();
  expect(screen.getByText('Completada · límite 2026-10-22')).toBeTruthy();
  expect(screen.getByText('Docente: Luis Tutor')).toBeTruthy();
  expect(elegiblesMock).not.toHaveBeenCalled(); // el docente no asigna docentes
});

test('marcar una actividad como completada', async () => {
  actualizarMock.mockResolvedValue({});
  await abrir();
  await fireEvent.press(boton('Marcar completada Taller 1'));

  await waitFor(() => expect(actualizarMock).toHaveBeenCalledWith(1, { completada: true }));
  await waitFor(() => expect(seguimientoMock).toHaveBeenCalledTimes(2)); // recarga el avance
});

test('reabrir una actividad completada', async () => {
  actualizarMock.mockResolvedValue({});
  await abrir();
  await fireEvent.press(boton('Reabrir Taller 2'));

  await waitFor(() => expect(actualizarMock).toHaveBeenCalledWith(2, { completada: false }));
});

test('agregar una actividad válida', async () => {
  agregarMock.mockResolvedValue({});
  await abrir();
  await fireEvent.press(boton('Nueva actividad'));
  await fireEvent.changeText(screen.getByLabelText('Título de la actividad'), '  Taller 3 ');
  await fireEvent.changeText(screen.getByLabelText('Fecha límite (AAAA-MM-DD)'), '2026-10-30');
  await fireEvent.press(boton('Agregar actividad'));

  await waitFor(() =>
    expect(agregarMock).toHaveBeenCalledWith(5, {
      titulo: 'Taller 3',
      descripcion: '',
      fecha_limite: '2026-10-30',
    }),
  );
  expect(await screen.findByText('Actividad agregada.')).toBeTruthy();
});

test('título vacío o fecha inválida se rechazan sin llamar a la API', async () => {
  await abrir();
  await fireEvent.press(boton('Nueva actividad'));
  await fireEvent.changeText(screen.getByLabelText('Fecha límite (AAAA-MM-DD)'), '30/10/2026');
  await fireEvent.press(boton('Agregar actividad'));

  expect(await screen.findByText('Escribe el título de la actividad.')).toBeTruthy();
  expect(screen.getByText('Usa el formato AAAA-MM-DD.')).toBeTruthy();
  expect(agregarMock).not.toHaveBeenCalled();
});

test('el servidor puede rechazar la fecha límite (fuera del plan o día no hábil)', async () => {
  agregarMock.mockRejectedValue({
    error: {
      code: 'validation_error',
      message: 'x',
      details: { fecha_limite: ['El 2026-10-31 no es un día hábil (sábado).'] },
    },
  });
  await abrir();
  await fireEvent.press(boton('Nueva actividad'));
  await fireEvent.changeText(screen.getByLabelText('Título de la actividad'), 'T');
  await fireEvent.press(boton('Agregar actividad'));

  expect(await screen.findByText('El 2026-10-31 no es un día hábil (sábado).')).toBeTruthy();
});

async function abrirCierre() {
  await abrir();
  await fireEvent.press(boton('Cerrar el expediente'));
}

test('cerrar con actividades pendientes pide confirmar y luego fuerza el cierre', async () => {
  cerrarMock
    .mockRejectedValueOnce({
      error: { code: 'actividades_pendientes', message: 'Quedan 1 actividad(es) sin cumplir.' },
    })
    .mockResolvedValueOnce({});
  await abrirCierre();
  await fireEvent.changeText(screen.getByLabelText('Valoración descriptiva'), 'Casi todo');
  await fireEvent.changeText(screen.getByLabelText('Nota (1,0 a 5,0)'), '3,5');
  await fireEvent.press(boton('Cerrar expediente'));

  expect(await screen.findByText('Quedan 1 actividad(es) sin cumplir.')).toBeTruthy();
  expect(cerrarMock).toHaveBeenLastCalledWith(5, {
    valoracion: 'Casi todo',
    nota_final: 3.5,
    forzar: false,
  });

  await fireEvent.press(boton('Cerrar de todos modos'));
  await waitFor(() =>
    expect(cerrarMock).toHaveBeenLastCalledWith(5, {
      valoracion: 'Casi todo',
      nota_final: 3.5,
      forzar: true,
    }),
  );
  expect(await screen.findByText('Expediente cerrado.')).toBeTruthy();
});

test('un expediente cerrado muestra el cierre y no ofrece cambios', async () => {
  seguimientoMock.mockResolvedValue({
    ...PLAN,
    estado: 'cerrado',
    resultado: 'logrado',
    fecha_cierre: '2026-11-10',
    nota_cierre: 'Superado',
    nota_final: '4.50',
  });
  await abrir();

  expect(
    screen.getByText('Cerrado el 2026-11-10. Resultado: Logrado (nivelado). Nota: 4,50. Superado'),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Cerrar el expediente' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Nueva actividad' })).toBeNull();
});

test('el estudiante ve el plan pero no puede modificarlo', async () => {
  comoRol('estudiante');
  seguimientoMock.mockResolvedValue({ ...PLAN, puede_gestionar: false });
  await abrir();

  expect(screen.getAllByText('Taller 1').length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'Marcar completada Taller 1' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Cerrar el expediente' })).toBeNull();
  expect(elegiblesMock).not.toHaveBeenCalled();
});

test('coordinación asigna otro tutor y se avisa del resultado de las notificaciones', async () => {
  comoRol('coordinador');
  asignarMock.mockResolvedValue({
    plan: PLAN,
    cambio: true,
    notificacion: { tutor: true, estudiante: false },
  });
  await abrir();
  expect(await screen.findByText('Cambiar de docente')).toBeTruthy();
  expect(
    boton('Mejor opción por carga: Luis Tutor (1 plan(es))').props.accessibilityState.disabled,
  ).toBe(true);
  await fireEvent.press(boton('Asignar a: Ana Tutora (0 plan(es))'));

  await waitFor(() => expect(asignarMock).toHaveBeenCalledWith(5, 10));
  expect(
    await screen.findByText(
      'Docente asignado, pero no pudimos enviar todos los avisos por correo.',
    ),
  ).toBeTruthy();
});

test('sin tutores elegibles lo explica', async () => {
  comoRol('coordinador');
  elegiblesMock.mockResolvedValue([]);
  await abrir();

  expect(
    await screen.findByText('Ningún docente está habilitado y disponible para esta área.'),
  ).toBeTruthy();
});

test('error al cargar: permite reintentar; sin sesión no se consulta', async () => {
  seguimientoMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  await render(
    <PlanDetalleScreen navigation={{} as never} route={{ params: { planId: 5 } } as never} />,
  );
  expect(await screen.findByText(/No pudimos cargar el plan/)).toBeTruthy();
  await fireEvent.press(boton('Reintentar'));
  expect(await screen.findByText('Reforzar fracciones')).toBeTruthy();
});

test('sin sesión no se consulta nada', async () => {
  sesionMock.mockReturnValue({ sesion: null });
  await render(
    <PlanDetalleScreen navigation={{} as never} route={{ params: { planId: 5 } } as never} />,
  );

  expect(await screen.findByText('Inicia sesión para ver el plan.')).toBeTruthy();
  expect(seguimientoMock).not.toHaveBeenCalled();
});

test('cerrar exige valoración y una nota válida y no llama a la API sin ellas', async () => {
  await abrirCierre();
  await fireEvent.changeText(screen.getByLabelText('Nota (1,0 a 5,0)'), '7');
  await fireEvent.press(boton('Cerrar expediente'));

  expect(await screen.findByText('Escribe la valoración descriptiva.')).toBeTruthy();
  expect(screen.getByText('La nota debe estar entre 1,0 y 5,0.')).toBeTruthy();
  expect(cerrarMock).not.toHaveBeenCalled();
});

test('cerrar con valoración y nota', async () => {
  cerrarMock.mockResolvedValue({});
  await abrirCierre();
  await fireEvent.changeText(screen.getByLabelText('Valoración descriptiva'), ' Superó el tema ');
  await fireEvent.changeText(screen.getByLabelText('Nota (1,0 a 5,0)'), '4.2');
  await fireEvent.press(boton('Cerrar expediente'));

  await waitFor(() =>
    expect(cerrarMock).toHaveBeenCalledWith(5, {
      valoracion: 'Superó el tema',
      nota_final: 4.2,
      forzar: false,
    }),
  );
  expect(await screen.findByText('Expediente cerrado.')).toBeTruthy();
});
