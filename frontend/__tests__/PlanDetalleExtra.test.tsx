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
import { obtenerEvaluacionPosteriorPlan, registrarEvaluacionPosterior } from '@/api/seguimiento';
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
jest.mock('@/api/seguimiento', () => ({
  ...jest.requireActual('@/api/seguimiento'),
  obtenerEvaluacionPosteriorPlan: jest.fn(),
  registrarEvaluacionPosterior: jest.fn(),
}));
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));
// Un modal simplificado que expone su "cerrar" (botón atrás) como un botón.
jest.mock('@/components/FormModal', () => {
  const React = require('react');
  const { Pressable, View } = require('react-native');
  return {
    FormModal: ({
      visible,
      onClose,
      children,
    }: {
      visible: boolean;
      onClose: () => void;
      children: unknown;
    }) =>
      visible
        ? React.createElement(
            View,
            null,
            React.createElement(Pressable, {
              accessibilityRole: 'button',
              accessibilityLabel: 'cerrar modal',
              onPress: onClose,
            }),
            children,
          )
        : null,
  };
});

const seguimientoMock = obtenerSeguimiento as jest.Mock;
const agregarMock = agregarActividad as jest.Mock;
const cerrarMock = cerrarPlan as jest.Mock;
const asignarMock = asignarTutor as jest.Mock;
const elegiblesMock = listarTutoresElegibles as jest.Mock;
const evaluacionMock = obtenerEvaluacionPosteriorPlan as jest.Mock;
const registrarMock = registrarEvaluacionPosterior as jest.Mock;
const actualizarMock = actualizarActividad as jest.Mock;
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
  actividades_total: 0,
  actividades_completadas: 0,
  progreso: null,
  atrasado: false,
  puede_gestionar: true,
  sesiones: [],
  actividades: [],
};

const CERRADO = {
  ...PLAN,
  estado: 'cerrado',
  resultado: 'logrado',
  fecha_cierre: '2026-11-10',
};

const comoRol = (rol: string) =>
  sesionMock.mockReturnValue({ sesion: { usuario: { rol, id: 9 } } });
const boton = (nombre: string) => screen.getByRole('button', { name: nombre });
const navigate = jest.fn();

async function abrir(plan: object = PLAN) {
  seguimientoMock.mockResolvedValue(plan);
  await render(
    <PlanDetalleScreen
      navigation={{ navigate } as never}
      route={{ params: { planId: 5 } } as never}
    />,
  );
  await screen.findByText('Reforzar fracciones');
}

beforeEach(() => {
  jest.clearAllMocks();
  [seguimientoMock, agregarMock, cerrarMock, asignarMock, evaluacionMock, registrarMock].forEach(
    (m) => m.mockReset(),
  );
  (listarDudas as jest.Mock).mockResolvedValue([]);
  (listarEntregas as jest.Mock).mockResolvedValue([]);
  (listarObservaciones as jest.Mock).mockResolvedValue([]);
  elegiblesMock.mockResolvedValue([]);
  evaluacionMock.mockResolvedValue([]);
  comoRol('tutor');
});

describe('datos vacíos y encuentros', () => {
  test('textos por defecto cuando el expediente está vacío', async () => {
    await abrir({ ...PLAN, docente_nombre: '', desempenos_no_alcanzados: '', atrasado: true });
    expect(screen.getByText('Sin docente asignado')).toBeTruthy();
    expect(screen.getByText('Sin desempeños registrados.')).toBeTruthy();
    expect(screen.getByText('Aún no hay actividades.')).toBeTruthy();
    expect(screen.getByText('No hay actividades registradas.')).toBeTruthy();
    expect(screen.getByText('Este plan va atrasado.')).toBeTruthy();
    expect(
      screen.getByText('Todavía no se han programado encuentros para este expediente.'),
    ).toBeTruthy();
  });

  test('lista los encuentros y permite programar uno nuevo', async () => {
    const base = { plan: 5, estado: 'programada', enlace_virtual: '' };
    await abrir({
      ...PLAN,
      sesiones: [
        {
          ...base,
          id: 1,
          inicio: '2026-11-02T14:00:00Z',
          modalidad: 'virtual',
          lugar: '',
          enlace_virtual: 'https://meet.test/a',
        },
        {
          ...base,
          id: 2,
          inicio: '2026-11-03T14:00:00Z',
          modalidad: 'presencial',
          lugar: 'Aula 4',
        },
        {
          ...base,
          id: 3,
          inicio: '2026-11-04T14:00:00Z',
          modalidad: 'presencial',
          lugar: 'Aula 5',
          estado: 'cancelada',
        },
      ],
    });
    expect(screen.getByText('https://meet.test/a')).toBeTruthy();
    expect(screen.getByText(/Presencial · Aula 4 · Programada/)).toBeTruthy();
    expect(screen.getByText(/Presencial · Aula 5 · Cancelada/)).toBeTruthy();
    await fireEvent.press(boton('Programar encuentro'));
    expect(navigate).toHaveBeenCalledWith('ProgramarSesion', { planId: 5 });
  });
});

describe('nueva actividad', () => {
  test('el botón atrás y Cancelar cierran el formulario', async () => {
    await abrir();
    await fireEvent.press(boton('Nueva actividad'));
    await fireEvent.press(boton('cerrar modal'));
    expect(screen.queryByText('Agregar actividad')).toBeNull();
    await fireEvent.press(boton('Nueva actividad'));
    await fireEvent.press(boton('Cancelar'));
    expect(screen.queryByText('Agregar actividad')).toBeNull();
  });

  test('un error sin detalle por campo se muestra completo', async () => {
    agregarMock.mockRejectedValueOnce(new Error('caída'));
    await abrir();
    await fireEvent.press(boton('Nueva actividad'));
    await fireEvent.changeText(screen.getByLabelText('Título de la actividad'), 'Taller');
    await fireEvent.press(boton('Agregar actividad'));
    expect(await screen.findByText(/No pudimos agregar la actividad/)).toBeTruthy();
  });

  test('una acción que falla muestra el error', async () => {
    actualizarMock.mockRejectedValueOnce(new Error('x'));
    await abrir({
      ...PLAN,
      actividades: [
        {
          id: 1,
          titulo: 'T1',
          descripcion: '',
          fecha_limite: '2026-10-20',
          completada: false,
          fecha_completada: null,
          vencida: false,
        },
      ],
    });
    await fireEvent.press(boton('Marcar completada T1'));
    expect(await screen.findByText(/No pudimos completar la acción/)).toBeTruthy();
  });
});

describe('cierre del expediente', () => {
  async function abrirCierre() {
    await abrir();
    await fireEvent.press(boton('Cerrar el expediente'));
    await fireEvent.changeText(screen.getByLabelText('Valoración descriptiva'), 'Bien');
    await fireEvent.changeText(screen.getByLabelText('Nota (1,0 a 5,0)'), '4');
  }

  test('el botón atrás y Cancelar cierran el formulario', async () => {
    await abrir();
    await fireEvent.press(boton('Cerrar el expediente'));
    await fireEvent.press(boton('cerrar modal'));
    expect(screen.queryByText('Cerrar expediente')).toBeNull();
    await fireEvent.press(boton('Cerrar el expediente'));
    await fireEvent.press(boton('Cancelar'));
    expect(screen.queryByText('Cerrar expediente')).toBeNull();
  });

  test('un error genérico y uno por campo', async () => {
    cerrarMock.mockRejectedValueOnce(new Error('caída'));
    await abrirCierre();
    await fireEvent.press(boton('Cerrar expediente'));
    expect(await screen.findByText(/No pudimos cerrar el expediente/)).toBeTruthy();

    cerrarMock.mockRejectedValueOnce({
      error: { code: 'validacion', details: { valoracion: ['Demasiado corta.'] } },
    });
    await fireEvent.press(boton('Cerrar expediente'));
    expect(await screen.findByText('Demasiado corta.')).toBeTruthy();
  });
});

describe('evaluación posterior', () => {
  test('muestra la evaluación registrada, efectiva y con observaciones', async () => {
    evaluacionMock.mockResolvedValue([
      {
        nota_inicial: '2.00',
        nota_posterior: '4.00',
        mejora: '2.00',
        recuperacion_efectiva: true,
        observaciones: 'Muy bien',
      },
    ]);
    await abrir(CERRADO);
    expect(await screen.findByText(/Nota inicial 2.00 → nota posterior 4.00/)).toBeTruthy();
    expect(screen.getByText(/Recuperación efectiva/)).toBeTruthy();
    expect(screen.getByText('Muy bien')).toBeTruthy();
  });

  test('una evaluación sin observaciones que no alcanzó la nota', async () => {
    evaluacionMock.mockResolvedValue([
      {
        nota_inicial: '2.00',
        nota_posterior: '2.50',
        mejora: '0.50',
        recuperacion_efectiva: false,
        observaciones: '',
      },
    ]);
    await abrir({ ...CERRADO, nota_final: '3.00' });
    expect(await screen.findByText(/No alcanzó la nota aprobatoria/)).toBeTruthy();
  });

  test('si no se puede consultar lo avisa', async () => {
    evaluacionMock.mockRejectedValue(new Error('x'));
    await abrir(CERRADO);
    expect(await screen.findByText('No pudimos consultar la evaluación posterior.')).toBeTruthy();
  });

  test('registra una evaluación nueva y la cierra con el botón atrás', async () => {
    registrarMock.mockResolvedValue({});
    await abrir(CERRADO);
    await fireEvent.press(await screen.findByText('Guardar evaluación'));
    await fireEvent.press(boton('cerrar modal'));
    expect(screen.queryByText('Registrar evaluación posterior')).toBeNull();

    await fireEvent.press(screen.getByText('Guardar evaluación'));
    await fireEvent.changeText(screen.getByLabelText('Nota posterior (1,00 a 5,00)'), '4,5');
    await fireEvent.changeText(screen.getByLabelText('Observaciones (opcional)'), 'ok');
    await fireEvent.press(boton('Registrar evaluación posterior'));
    await waitFor(() =>
      expect(registrarMock).toHaveBeenCalledWith({
        plan: 5,
        nota_posterior: '4.5',
        observaciones: 'ok',
      }),
    );
    expect(
      await screen.findByText('Evaluación posterior registrada y mejora calculada.'),
    ).toBeTruthy();
  });
});

describe('asignación de docente', () => {
  test('sin docente se ofrece asignar y se avisa si todo se envió', async () => {
    comoRol('coordinador');
    elegiblesMock.mockResolvedValue([{ id: 10, nombre: 'Ana', email: 'a@c.co', carga: 0 }]);
    asignarMock.mockResolvedValue({
      plan: PLAN,
      cambio: true,
      notificacion: { tutor: true, estudiante: true },
    });
    await abrir({ ...PLAN, tutor: null, estado: 'pendiente' });
    expect(await screen.findByText('Asignar docente')).toBeTruthy();
    await fireEvent.press(boton('Mejor opción por carga: Ana (0 plan(es))'));
    expect(await screen.findByText('Docente asignado y notificado.')).toBeTruthy();
  });

  test('sin información de avisos también se da por notificado', async () => {
    comoRol('coordinador');
    elegiblesMock.mockResolvedValue([{ id: 10, nombre: 'Ana', email: 'a@c.co', carga: 0 }]);
    asignarMock.mockResolvedValue({ plan: PLAN, cambio: true, notificacion: null });
    await abrir();
    await fireEvent.press(await screen.findByText('Mejor opción por carga: Ana (0 plan(es))'));
    expect(await screen.findByText('Docente asignado y notificado.')).toBeTruthy();
  });

  test('si no se pueden cargar los docentes elegibles lo avisa', async () => {
    comoRol('coordinador');
    elegiblesMock.mockRejectedValue(new Error('x'));
    await abrir();
    expect(await screen.findByText('No pudimos cargar los tutores disponibles.')).toBeTruthy();
  });
});
