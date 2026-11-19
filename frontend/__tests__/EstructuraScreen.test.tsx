import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  actualizarGrado,
  actualizarGrupo,
  crearGrado,
  crearGrupo,
  listarGradosAdmin,
} from '@/api/academico';
import { EstructuraScreen } from '@/screens/academica/EstructuraScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/academico', () => ({
  listarGradosAdmin: jest.fn(),
  crearGrado: jest.fn(),
  actualizarGrado: jest.fn(),
  crearGrupo: jest.fn(),
  actualizarGrupo: jest.fn(),
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

const listarMock = listarGradosAdmin as jest.Mock;
const crearGradoMock = crearGrado as jest.Mock;
const actualizarGradoMock = actualizarGrado as jest.Mock;
const crearGrupoMock = crearGrupo as jest.Mock;
const actualizarGrupoMock = actualizarGrupo as jest.Mock;
const sesionMock = useSession as jest.Mock;

const SEXTO = {
  id: 1,
  nombre: 'Sexto',
  orden: 6,
  activo: true,
  grupos: [
    { id: 10, nombre: 'A', activo: true },
    { id: 11, nombre: 'B', activo: false },
  ],
};
const SEPTIMO = { id: 2, nombre: 'Séptimo', orden: 7, activo: false, grupos: [] };

const comoRol = (rol: string) => sesionMock.mockReturnValue({ sesion: { usuario: { rol } } });
const boton = (nombre: string) => screen.getByRole('button', { name: nombre });

beforeEach(() => {
  [listarMock, crearGradoMock, actualizarGradoMock, crearGrupoMock, actualizarGrupoMock].forEach(
    (m) => m.mockReset(),
  );
  listarMock.mockResolvedValue([SEXTO, SEPTIMO]);
  comoRol('administrador');
});

async function abrir() {
  await render(<EstructuraScreen />);
  await screen.findByLabelText('Grado Sexto');
}

test('lista los grados con sus grupos y marca lo inactivo', async () => {
  await abrir();
  expect(screen.getByText('Sexto')).toBeTruthy();
  expect(screen.getByText('Séptimo (inactivo)')).toBeTruthy();
  expect(screen.getByLabelText('Grupo A')).toBeTruthy();
  expect(screen.getByLabelText('Grupo B (inactivo)')).toBeTruthy();
  expect(screen.getByText('Sin grupos')).toBeTruthy();
});

test('agregar un grado propone el siguiente orden y lo envía', async () => {
  crearGradoMock.mockResolvedValue({});
  listarMock
    .mockResolvedValueOnce([SEXTO, SEPTIMO])
    .mockResolvedValueOnce([
      SEXTO,
      SEPTIMO,
      { id: 3, nombre: 'Octavo', orden: 3, activo: true, grupos: [] },
    ]);
  await abrir();
  await fireEvent.press(boton('Agregar grado'));

  expect(screen.getByDisplayValue('3')).toBeTruthy(); // 2 grados + 1
  await fireEvent.changeText(screen.getByLabelText('Nombre del grado'), 'Octavo');
  await fireEvent.press(boton('Guardar'));

  await waitFor(() => expect(crearGradoMock).toHaveBeenCalledWith({ nombre: 'Octavo', orden: 3 }));
  expect(await screen.findByText('Cambios guardados.')).toBeTruthy();
  expect(screen.getByLabelText('Grado Octavo')).toBeTruthy();
});

test('validaciones locales del grado: nombre y orden', async () => {
  await abrir();
  await fireEvent.press(boton('Agregar grado'));
  await fireEvent.changeText(screen.getByLabelText('Orden en la lista'), 'x');
  await fireEvent.press(boton('Guardar'));

  expect(await screen.findByText('Ingresa un nombre.')).toBeTruthy();
  expect(screen.getByText(/El orden debe ser un número entero/)).toBeTruthy();
  expect(crearGradoMock).not.toHaveBeenCalled();
});

test('agregar un grupo a un grado envía el grado y el nombre', async () => {
  crearGrupoMock.mockResolvedValue({});
  await abrir();
  await fireEvent.press(boton('Agregar grupo a Sexto'));
  await fireEvent.changeText(screen.getByLabelText('Nombre del grupo'), 'C');
  await fireEvent.press(boton('Guardar'));

  await waitFor(() => expect(crearGrupoMock).toHaveBeenCalledWith({ grado: 1, nombre: 'C' }));
});

test('editar un grado: el panel trae sus datos y se puede desactivar', async () => {
  actualizarGradoMock.mockResolvedValue({});
  await abrir();
  await fireEvent.press(screen.getByLabelText('Grado Sexto'));

  expect(await screen.findByText('Editar grado')).toBeTruthy();
  expect(screen.getByDisplayValue('Sexto')).toBeTruthy();
  await fireEvent(screen.getByLabelText('Grado activo'), 'valueChange', false);
  await fireEvent.press(boton('Guardar'));

  await waitFor(() =>
    expect(actualizarGradoMock).toHaveBeenCalledWith(1, {
      nombre: 'Sexto',
      orden: 6,
      activo: false,
    }),
  );
});

test('editar un grupo: se renombra y se activa o desactiva', async () => {
  actualizarGrupoMock.mockResolvedValue({});
  await abrir();
  await fireEvent.press(screen.getByLabelText('Grupo B (inactivo)'));

  expect(await screen.findByText('Editar grupo')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Nombre del grupo'), 'Beta');
  await fireEvent(screen.getByLabelText('Grupo activo'), 'valueChange', true);
  await fireEvent.press(boton('Guardar'));

  await waitFor(() =>
    expect(actualizarGrupoMock).toHaveBeenCalledWith(11, { nombre: 'Beta', activo: true }),
  );
});

test('un nombre repetido que rechaza el servidor aparece en el formulario', async () => {
  crearGrupoMock.mockRejectedValue({
    error: {
      code: 'validation_error',
      message: 'Datos inválidos.',
      details: { non_field_errors: ['Ese grado ya tiene un grupo con ese nombre.'] },
    },
  });
  await abrir();
  await fireEvent.press(boton('Agregar grupo a Sexto'));
  await fireEvent.changeText(screen.getByLabelText('Nombre del grupo'), 'A');
  await fireEvent.press(boton('Guardar'));

  expect(await screen.findByText('Ese grado ya tiene un grupo con ese nombre.')).toBeTruthy();
  expect(screen.getByText('Nuevo grupo')).toBeTruthy(); // sigue abierto para corregir
});

test('falla de red al guardar: mensaje general', async () => {
  crearGradoMock.mockRejectedValue(new TypeError('Network request failed'));
  await abrir();
  await fireEvent.press(boton('Agregar grado'));
  await fireEvent.changeText(screen.getByLabelText('Nombre del grado'), 'Noveno');
  await fireEvent.press(boton('Guardar'));

  expect(await screen.findByText(/No pudimos guardar/)).toBeTruthy();
});

test('cancelar cierra el panel sin guardar', async () => {
  await abrir();
  await fireEvent.press(boton('Agregar grado'));
  await fireEvent.press(boton('Cancelar'));

  expect(screen.queryByText('Nuevo grado')).toBeNull();
  expect(crearGradoMock).not.toHaveBeenCalled();
});

test('la coordinación solo lee: sin botones ni edición', async () => {
  comoRol('coordinador');
  await abrir();

  expect(screen.getByText(/Solo lectura/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Agregar grado' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Agregar grupo a Sexto' })).toBeNull();
  await fireEvent.press(screen.getByLabelText('Grado Sexto'));
  expect(screen.queryByText('Editar grado')).toBeNull();
});

test.each(['estudiante', 'tutor'])('%s no accede y no se consulta nada', async (rol) => {
  comoRol(rol);
  await render(<EstructuraScreen />);

  expect(await screen.findByText('No tienes permiso para ver los grados y grupos.')).toBeTruthy();
  expect(listarMock).not.toHaveBeenCalled();
});

test('error al cargar: avisa y permite reintentar', async () => {
  listarMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  await render(<EstructuraScreen />);

  expect(await screen.findByText(/No pudimos cargar los grados/)).toBeTruthy();
  await fireEvent.press(boton('Reintentar'));
  expect(await screen.findByLabelText('Grado Sexto')).toBeTruthy();
});

test('sin grados lo explica', async () => {
  listarMock.mockResolvedValue([]);
  await render(<EstructuraScreen />);
  expect(await screen.findByText('Aún no hay grados y grupos registrados.')).toBeTruthy();
});

test('el botón atrás cierra el panel', async () => {
  await abrir();
  await fireEvent.press(boton('Agregar grado'));
  await fireEvent.press(boton('cerrar modal'));
  expect(screen.queryByText('Guardar')).toBeNull();
});

test('un error del servidor sobre el grado se muestra en el grupo', async () => {
  crearGrupoMock.mockRejectedValue({
    error: { details: { grado: ['El grado está inactivo.'] } },
  });
  await abrir();
  await fireEvent.press(boton('Agregar grupo a Sexto'));
  await fireEvent.changeText(screen.getByLabelText('Nombre del grupo'), 'C');
  await fireEvent.press(boton('Guardar'));
  expect(await screen.findByText('El grado está inactivo.')).toBeTruthy();
});
