import { fireEvent, render, screen } from '@testing-library/react-native';

import { actualizarSede, crearSede, listarSedes, obtenerInstitucion } from '@/api/academico';
import { InstitucionScreen } from '@/screens/academica/InstitucionScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/academico', () => ({
  obtenerInstitucion: jest.fn(),
  actualizarInstitucion: jest.fn(),
  listarSedes: jest.fn(),
  crearSede: jest.fn(),
  actualizarSede: jest.fn(),
}));
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));
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

const obtenerMock = obtenerInstitucion as jest.Mock;
const sedesMock = listarSedes as jest.Mock;
const crearSedeMock = crearSede as jest.Mock;
const actualizarSedeMock = actualizarSede as jest.Mock;
const sesionMock = useSession as jest.Mock;

const INST = {
  nombre: 'Colegio San Martín',
  nit: '',
  direccion: '',
  ciudad: '',
  telefono: '',
  correo: '',
  sede_unica: false,
};
const NORTE = {
  id: 2,
  nombre: 'Norte',
  nit: '',
  direccion: '',
  ciudad: '',
  telefono: '',
  correo: '',
  activa: false,
  principal: false,
};
const boton = (nombre: string) => screen.getByRole('button', { name: nombre });

beforeEach(() => {
  jest.clearAllMocks();
  obtenerMock.mockReset().mockResolvedValue(INST);
  sedesMock.mockReset().mockResolvedValue([NORTE]);
  crearSedeMock.mockReset();
  actualizarSedeMock.mockReset();
  sesionMock.mockReturnValue({ sesion: { usuario: { rol: 'administrador' } } });
});

test('sin sedes registradas lo explica', async () => {
  sedesMock.mockResolvedValue([]);
  await render(<InstitucionScreen embedded />);
  expect(await screen.findByText('Aún no hay sedes registradas.')).toBeTruthy();
});

test('el botón atrás cierra el panel de la sede', async () => {
  await render(<InstitucionScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Agregar sede' }));
  expect(screen.getByText('Nueva sede')).toBeTruthy();
  await fireEvent.press(boton('cerrar modal'));
  expect(screen.queryByText('Nueva sede')).toBeNull();
});

test('los interruptores de la sede activa y principal cambian el formulario', async () => {
  crearSedeMock.mockResolvedValue({});
  await render(<InstitucionScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Agregar sede' }));
  await fireEvent.changeText(screen.getByLabelText('Nombre de la sede'), 'Sur');
  await fireEvent(screen.getByLabelText('Sede activa'), 'valueChange', false);
  await fireEvent(screen.getByLabelText('Sede principal'), 'valueChange', true);
  await fireEvent.changeText(screen.getByLabelText('Teléfono de la sede'), '601');
  await fireEvent.press(boton('Guardar sede'));
  await screen.findByText('Sede creada.');
  expect(crearSedeMock).toHaveBeenCalledWith(
    expect.objectContaining({ nombre: 'Sur', activa: false, principal: true, telefono: '601' }),
  );
});

test('muestra los errores de la sede: activa, generales, sede única y de red', async () => {
  crearSedeMock.mockRejectedValueOnce({
    error: {
      details: {
        activa: ['No puede desactivar la principal.'],
        non_field_errors: ['Datos incoherentes.'],
        sede_unica: ['La institución es de sede única.'],
      },
    },
  });
  await render(<InstitucionScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Agregar sede' }));
  await fireEvent.changeText(screen.getByLabelText('Nombre de la sede'), 'Sur');
  await fireEvent.press(boton('Guardar sede'));
  expect(await screen.findByText('No puede desactivar la principal.')).toBeTruthy();
  expect(screen.getByText('Datos incoherentes.')).toBeTruthy();
  expect(screen.getByText('La institución es de sede única.')).toBeTruthy();

  crearSedeMock.mockRejectedValueOnce(new Error('red'));
  await fireEvent.press(boton('Guardar sede'));
  expect(await screen.findByText(/No pudimos guardar la sede/)).toBeTruthy();
});

test('actualizar una sede existente confirma el cambio', async () => {
  actualizarSedeMock.mockResolvedValue({});
  await render(<InstitucionScreen />);
  await fireEvent.press(await screen.findByLabelText(/Norte/));
  await fireEvent.press(boton('Guardar sede'));
  expect(await screen.findByText('Sede actualizada.')).toBeTruthy();
  expect(actualizarSedeMock).toHaveBeenCalledWith(2, expect.objectContaining({ nombre: 'Norte' }));
});
