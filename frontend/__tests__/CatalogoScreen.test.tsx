import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { actualizarAsignatura, crearAsignatura, listarAsignaturasAdmin } from '@/api/academico';
import { CatalogoScreen } from '@/screens/academica/CatalogoScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/academico', () => ({
  listarAsignaturasAdmin: jest.fn(),
  crearAsignatura: jest.fn(),
  actualizarAsignatura: jest.fn(),
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

const listarMock = listarAsignaturasAdmin as jest.Mock;
const crearMock = crearAsignatura as jest.Mock;
const actualizarMock = actualizarAsignatura as jest.Mock;
const sesionMock = useSession as jest.Mock;

const MATE = { id: 1, nombre: 'Matemáticas', activa: true };
const ROBOTICA = { id: 2, nombre: 'Robótica', activa: false };

const comoRol = (rol: string) => sesionMock.mockReturnValue({ sesion: { usuario: { rol } } });
const boton = (nombre: string) => screen.getByRole('button', { name: nombre });

beforeEach(() => {
  [listarMock, crearMock, actualizarMock].forEach((m) => m.mockReset());
  listarMock.mockResolvedValue([MATE, ROBOTICA]);
  comoRol('administrador');
});

async function abrir() {
  await render(<CatalogoScreen />);
  await screen.findByLabelText('Asignatura Matemáticas');
}

test('lista las asignaturas con su estado', async () => {
  await abrir();
  expect(screen.getByText('Activa')).toBeTruthy();
  expect(screen.getByText('Inactiva')).toBeTruthy();
});

test('se puede mostrar solo las activas', async () => {
  await abrir();
  await fireEvent(screen.getByLabelText('Mostrar solo las activas'), 'valueChange', true);

  expect(screen.getByLabelText('Asignatura Matemáticas')).toBeTruthy();
  expect(screen.queryByLabelText('Asignatura Robótica')).toBeNull();
});

test('agregar una asignatura y verla en la lista', async () => {
  crearMock.mockResolvedValue({});
  listarMock
    .mockResolvedValueOnce([MATE, ROBOTICA])
    .mockResolvedValueOnce([MATE, ROBOTICA, { id: 3, nombre: 'Ajedrez', activa: true }]);
  await abrir();
  await fireEvent.press(boton('Agregar asignatura'));
  await fireEvent.changeText(screen.getByLabelText('Nombre de la asignatura'), '  Ajedrez ');
  await fireEvent.press(boton('Guardar'));

  await waitFor(() => expect(crearMock).toHaveBeenCalledWith('Ajedrez'));
  expect(await screen.findByText('Asignatura creada.')).toBeTruthy();
  expect(screen.getByLabelText('Asignatura Ajedrez')).toBeTruthy();
});

test('el nombre es obligatorio', async () => {
  await abrir();
  await fireEvent.press(boton('Agregar asignatura'));
  await fireEvent.press(boton('Guardar'));

  expect(await screen.findByText('Ingresa el nombre de la asignatura.')).toBeTruthy();
  expect(crearMock).not.toHaveBeenCalled();
});

test('renombrar y reactivar una asignatura', async () => {
  actualizarMock.mockResolvedValue({});
  await abrir();
  await fireEvent.press(screen.getByLabelText('Asignatura Robótica'));

  expect(await screen.findByText('Editar asignatura')).toBeTruthy();
  expect(screen.getByLabelText('Asignatura activa').props.value).toBe(false);
  await fireEvent.changeText(screen.getByLabelText('Nombre de la asignatura'), 'Robótica I');
  await fireEvent(screen.getByLabelText('Asignatura activa'), 'valueChange', true);
  await fireEvent.press(boton('Guardar'));

  await waitFor(() =>
    expect(actualizarMock).toHaveBeenCalledWith(2, { nombre: 'Robótica I', activa: true }),
  );
  expect(await screen.findByText('Asignatura actualizada.')).toBeTruthy();
});

test('desactivar una asignatura', async () => {
  actualizarMock.mockResolvedValue({});
  await abrir();
  await fireEvent.press(screen.getByLabelText('Asignatura Matemáticas'));
  await fireEvent(await screen.findByLabelText('Asignatura activa'), 'valueChange', false);
  await fireEvent.press(boton('Guardar'));

  await waitFor(() =>
    expect(actualizarMock).toHaveBeenCalledWith(1, { nombre: 'Matemáticas', activa: false }),
  );
});

test('un nombre repetido que rechaza el servidor se muestra en el campo', async () => {
  crearMock.mockRejectedValue({
    error: {
      code: 'validation_error',
      message: 'x',
      details: { nombre: ['Ya existe una asignatura con ese nombre.'] },
    },
  });
  await abrir();
  await fireEvent.press(boton('Agregar asignatura'));
  await fireEvent.changeText(screen.getByLabelText('Nombre de la asignatura'), 'MATEMÁTICAS');
  await fireEvent.press(boton('Guardar'));

  expect(await screen.findByText('Ya existe una asignatura con ese nombre.')).toBeTruthy();
});

test('falla de red al guardar: mensaje general', async () => {
  crearMock.mockRejectedValue(new TypeError('Network request failed'));
  await abrir();
  await fireEvent.press(boton('Agregar asignatura'));
  await fireEvent.changeText(screen.getByLabelText('Nombre de la asignatura'), 'Ajedrez');
  await fireEvent.press(boton('Guardar'));

  expect(await screen.findByText(/No pudimos guardar/)).toBeTruthy();
});

test('la coordinación solo lee', async () => {
  comoRol('coordinador');
  await abrir();

  expect(screen.getByText(/Solo lectura/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Agregar asignatura' })).toBeNull();
  await fireEvent.press(screen.getByLabelText('Asignatura Matemáticas'));
  expect(screen.queryByText('Editar asignatura')).toBeNull();
});

test.each(['estudiante', 'tutor'])('%s no accede', async (rol) => {
  comoRol(rol);
  await render(<CatalogoScreen />);

  expect(
    await screen.findByText('No tienes permiso para ver el catálogo de asignaturas.'),
  ).toBeTruthy();
  expect(listarMock).not.toHaveBeenCalled();
});

test('error al cargar: permite reintentar', async () => {
  listarMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  await render(<CatalogoScreen />);

  expect(await screen.findByText(/No pudimos cargar el catálogo/)).toBeTruthy();
  await fireEvent.press(boton('Reintentar'));
  expect(await screen.findByLabelText('Asignatura Matemáticas')).toBeTruthy();
});

test('si no hay asignaturas lo explica', async () => {
  listarMock.mockResolvedValue([]);
  await render(<CatalogoScreen embedded />);
  expect(await screen.findByText('No hay asignaturas para mostrar.')).toBeTruthy();
});

test('el botón atrás y Cancelar cierran el panel', async () => {
  await abrir();
  await fireEvent.press(boton('Agregar asignatura'));
  await fireEvent.press(boton('cerrar modal'));
  expect(screen.queryByText('Nueva asignatura')).toBeNull();
  await fireEvent.press(boton('Agregar asignatura'));
  await fireEvent.press(boton('Cancelar'));
  expect(screen.queryByText('Nueva asignatura')).toBeNull();
});
