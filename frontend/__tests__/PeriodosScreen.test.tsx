import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { actualizarPeriodo, crearPeriodo, listarPeriodos } from '@/api/academico';
import { PeriodosScreen } from '@/screens/academica/PeriodosScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/academico', () => ({
  ...jest.requireActual('@/api/academico'),
  listarPeriodos: jest.fn(),
  crearPeriodo: jest.fn(),
  actualizarPeriodo: jest.fn(),
}));
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));

// Modal simplificado: expone el cierre del botón atrás como un botón.
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

const listarMock = listarPeriodos as jest.Mock;
const crearMock = crearPeriodo as jest.Mock;
const actualizarMock = actualizarPeriodo as jest.Mock;
const sesionMock = useSession as jest.Mock;

const P1 = {
  id: 1,
  nombre: '2026 - Periodo 1',
  fecha_inicio: '2026-01-19',
  fecha_fin: '2026-03-27',
  es_actual: false,
};
const P2 = {
  id: 2,
  nombre: '2026 - Periodo 2',
  fecha_inicio: '2026-04-06',
  fecha_fin: '2026-06-12',
  es_actual: true,
};

const comoRol = (rol: string) => sesionMock.mockReturnValue({ sesion: { usuario: { rol } } });
const boton = (nombre: string) => screen.getByRole('button', { name: nombre });

beforeEach(() => {
  [listarMock, crearMock, actualizarMock].forEach((m) => m.mockReset());
  listarMock.mockResolvedValue([P2, P1]);
  comoRol('administrador');
});

async function abrir() {
  await render(<PeriodosScreen />);
  await screen.findByLabelText('Periodo 2026 - Periodo 1');
}

async function llenar(nombre: string, inicio: string, fin: string) {
  await fireEvent.changeText(screen.getByLabelText('Nombre del periodo'), nombre);
  await fireEvent.changeText(screen.getByLabelText('Fecha de inicio (AAAA-MM-DD)'), inicio);
  await fireEvent.changeText(screen.getByLabelText('Fecha de fin (AAAA-MM-DD)'), fin);
}

test('lista los periodos con sus fechas y marca el vigente', async () => {
  await abrir();
  expect(screen.getByText('2026-01-19 al 2026-03-27')).toBeTruthy();
  expect(screen.getAllByText('Vigente')).toHaveLength(1);
});

test('crear un periodo válido', async () => {
  crearMock.mockResolvedValue({});
  await abrir();
  await fireEvent.press(boton('Agregar periodo'));
  await llenar('  2026 - Periodo 3 ', '2026-07-06', '2026-09-18');
  await fireEvent.press(boton('Guardar'));

  await waitFor(() =>
    expect(crearMock).toHaveBeenCalledWith({
      nombre: '2026 - Periodo 3',
      fecha_inicio: '2026-07-06',
      fecha_fin: '2026-09-18',
    }),
  );
  expect(await screen.findByText('Periodo creado.')).toBeTruthy();
});

test.each([
  ['formato incorrecto', '19/01/2026', '2026-03-27', 'fecha_inicio'],
  ['día que no existe', '2026-02-30', '2026-03-27', 'fecha_inicio'],
  ['mes inexistente', '2026-13-01', '2026-03-27', 'fecha_inicio'],
])('fecha de inicio con %s se rechaza sin llamar a la API', async (_, inicio, fin) => {
  await abrir();
  await fireEvent.press(boton('Agregar periodo'));
  await llenar('Periodo X', inicio, fin);
  await fireEvent.press(boton('Guardar'));

  expect((await screen.findAllByText('Usa el formato AAAA-MM-DD.')).length).toBeGreaterThan(0);
  expect(crearMock).not.toHaveBeenCalled();
});

test('la fecha de fin no puede ser anterior a la de inicio', async () => {
  await abrir();
  await fireEvent.press(boton('Agregar periodo'));
  await llenar('Periodo X', '2026-05-10', '2026-05-01');
  await fireEvent.press(boton('Guardar'));

  expect(
    await screen.findByText('La fecha de fin no puede ser anterior a la de inicio.'),
  ).toBeTruthy();
  expect(crearMock).not.toHaveBeenCalled();
});

test('el nombre es obligatorio', async () => {
  await abrir();
  await fireEvent.press(boton('Agregar periodo'));
  await llenar('  ', '2026-07-06', '2026-09-18');
  await fireEvent.press(boton('Guardar'));

  expect(await screen.findByText('Ingresa el nombre del periodo.')).toBeTruthy();
});

test('si el servidor detecta un solapamiento lo muestra bajo la fecha', async () => {
  crearMock.mockRejectedValue({
    error: {
      code: 'validation_error',
      message: 'x',
      details: { fecha_inicio: ['Se solapa con el periodo «2026 - Periodo 1».'] },
    },
  });
  await abrir();
  await fireEvent.press(boton('Agregar periodo'));
  await llenar('Otro', '2026-03-01', '2026-05-30');
  await fireEvent.press(boton('Guardar'));

  expect(await screen.findByText('Se solapa con el periodo «2026 - Periodo 1».')).toBeTruthy();
  expect(screen.getByText('Nuevo periodo')).toBeTruthy();
});

test('editar un periodo trae sus datos y envía el cambio con su id', async () => {
  actualizarMock.mockResolvedValue({});
  await abrir();
  await fireEvent.press(screen.getByLabelText('Periodo 2026 - Periodo 1'));

  expect(await screen.findByText('Editar periodo')).toBeTruthy();
  expect(screen.getByDisplayValue('2026-03-27')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Fecha de fin (AAAA-MM-DD)'), '2026-04-03');
  await fireEvent.press(boton('Guardar'));

  await waitFor(() =>
    expect(actualizarMock).toHaveBeenCalledWith(1, {
      nombre: '2026 - Periodo 1',
      fecha_inicio: '2026-01-19',
      fecha_fin: '2026-04-03',
    }),
  );
  expect(await screen.findByText('Periodo actualizado.')).toBeTruthy();
});

test.each(['coordinador', 'tutor', 'estudiante'])(
  '%s ve los periodos pero no los modifica',
  async (rol) => {
    comoRol(rol);
    await abrir();

    expect(screen.getByText(/Solo lectura/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Agregar periodo' })).toBeNull();
    await fireEvent.press(screen.getByLabelText('Periodo 2026 - Periodo 1'));
    expect(screen.queryByText('Editar periodo')).toBeNull();
  },
);

test('falla de red al guardar: mensaje general', async () => {
  crearMock.mockRejectedValue(new TypeError('Network request failed'));
  await abrir();
  await fireEvent.press(boton('Agregar periodo'));
  await llenar('Periodo Z', '2026-07-06', '2026-09-18');
  await fireEvent.press(boton('Guardar'));

  expect(await screen.findByText(/No pudimos guardar/)).toBeTruthy();
});

test('error al cargar: permite reintentar', async () => {
  listarMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  await render(<PeriodosScreen />);

  expect(await screen.findByText(/No pudimos cargar los periodos/)).toBeTruthy();
  await fireEvent.press(boton('Reintentar'));
  expect(await screen.findByLabelText('Periodo 2026 - Periodo 1')).toBeTruthy();
});

test('sin sesión no se muestra nada ni se consulta', async () => {
  sesionMock.mockReturnValue({ sesion: null });
  await render(<PeriodosScreen />);

  expect(await screen.findByText('Inicia sesión para ver los periodos académicos.')).toBeTruthy();
  expect(listarMock).not.toHaveBeenCalled();
});

test('sin periodos lo explica', async () => {
  listarMock.mockResolvedValue([]);
  await render(<PeriodosScreen embedded />);
  expect(await screen.findByText('Aún no hay periodos registrados.')).toBeTruthy();
});

test('fechas con formato inválido se rechazan sin llamar a la API', async () => {
  await abrir();
  await fireEvent.press(boton('Agregar periodo'));
  await llenar('Nuevo', '01/02/2026', 'mañana');
  await fireEvent.press(boton('Guardar'));
  expect((await screen.findAllByText('Usa el formato AAAA-MM-DD.')).length).toBe(2);
  expect(crearMock).not.toHaveBeenCalled();
});

test('el botón atrás y Cancelar cierran el panel', async () => {
  await abrir();
  await fireEvent.press(boton('Agregar periodo'));
  await fireEvent.press(boton('cerrar modal'));
  expect(screen.queryByText('Nuevo periodo')).toBeNull();
  await fireEvent.press(boton('Agregar periodo'));
  await fireEvent.press(boton('Cancelar'));
  expect(screen.queryByText('Nuevo periodo')).toBeNull();
});

test('muestra los errores generales del servidor sobre el periodo', async () => {
  crearMock.mockRejectedValue({
    error: { details: { non_field_errors: ['Periodo incoherente.'] } },
  });
  await abrir();
  await fireEvent.press(boton('Agregar periodo'));
  await llenar('Otro', '2026-07-01', '2026-09-01');
  await fireEvent.press(boton('Guardar'));
  expect(await screen.findByText('Periodo incoherente.')).toBeTruthy();
});
