import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  crearVinculo,
  listarEstudiantes,
  listarUsuarios,
  listarVinculos,
  retirarVinculo,
} from '@/api/usuarios';
import { VinculosAcudienteScreen } from '@/screens/usuarios/VinculosAcudienteScreen';

jest.mock('@/api/usuarios', () => ({
  ...jest.requireActual('@/api/usuarios'),
  crearVinculo: jest.fn(),
  listarEstudiantes: jest.fn(),
  listarUsuarios: jest.fn(),
  listarVinculos: jest.fn(),
  retirarVinculo: jest.fn(),
}));

const crearMock = crearVinculo as jest.Mock;
const estudiantesMock = listarEstudiantes as jest.Mock;
const usuariosMock = listarUsuarios as jest.Mock;
const vinculosMock = listarVinculos as jest.Mock;
const retirarMock = retirarVinculo as jest.Mock;

const VINCULO = {
  id: 4,
  acudiente: 20,
  acudiente_nombre: 'Marta Cuesta',
  estudiante: 7,
  estudiante_nombre: 'Sofía Ramírez',
  parentesco: 'Madre',
};

const pagina = <T,>(results: T[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});
const boton = (nombre: string) => screen.getByRole('button', { name: nombre });

async function abrir() {
  await render(<VinculosAcudienteScreen />);
  await screen.findByText('Acudiente de Sofía Ramírez · Madre');
}

beforeEach(() => {
  [crearMock, estudiantesMock, usuariosMock, vinculosMock, retirarMock].forEach((m) =>
    m.mockReset(),
  );
  vinculosMock.mockResolvedValue([VINCULO]);
  usuariosMock.mockResolvedValue(
    pagina([
      {
        id: 21,
        email: 'jorge@c.co',
        nombres: 'Jorge',
        apellidos: 'Gómez',
        rol: 'acudiente',
        rol_nombre: 'Acudiente',
        is_active: true,
      },
    ]),
  );
  estudiantesMock.mockResolvedValue(
    pagina([
      {
        id: 1,
        usuario: { id: 8, email: 'm@c.co', nombres: 'Mateo', apellidos: 'Gómez' },
        grado: null,
        grupo: null,
      },
    ]),
  );
});

test('lista los vínculos y pide solo acudientes para elegir', async () => {
  await abrir();

  expect(screen.getByText('Marta Cuesta')).toBeTruthy();
  expect(usuariosMock).toHaveBeenCalledWith({ rol: 'acudiente', q: '' });
});

test('vincula al acudiente elegido con el estudiante elegido', async () => {
  crearMock.mockResolvedValue({});
  await abrir();
  await fireEvent.press(await screen.findByRole('button', { name: 'Acudiente Jorge Gómez' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Estudiante Mateo Gómez' }));
  await fireEvent.changeText(screen.getByLabelText('Parentesco (opcional)'), ' Padre ');
  await fireEvent.press(boton('Vincular'));

  await waitFor(() =>
    expect(crearMock).toHaveBeenCalledWith({ acudiente: 21, estudiante: 8, parentesco: 'Padre' }),
  );
  expect(await screen.findByText('Jorge Gómez quedó vinculado con Mateo Gómez.')).toBeTruthy();
  expect(vinculosMock).toHaveBeenCalledTimes(2);
});

test('exige elegir acudiente y estudiante antes de llamar a la API', async () => {
  await abrir();
  await fireEvent.press(boton('Vincular'));

  expect(await screen.findByText('Elige al acudiente.')).toBeTruthy();
  expect(screen.getByText('Elige al estudiante.')).toBeTruthy();
  expect(crearMock).not.toHaveBeenCalled();
});

test('muestra el rechazo del servidor (vínculo repetido)', async () => {
  crearMock.mockRejectedValue({
    error: {
      code: 'validation_error',
      message: 'x',
      details: { estudiante: ['Ese acudiente ya está vinculado a este estudiante.'] },
    },
  });
  await abrir();
  await fireEvent.press(await screen.findByRole('button', { name: 'Acudiente Jorge Gómez' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Estudiante Mateo Gómez' }));
  await fireEvent.press(boton('Vincular'));

  expect(
    await screen.findByText('Ese acudiente ya está vinculado a este estudiante.'),
  ).toBeTruthy();
});

test('retira un vínculo y recarga la lista', async () => {
  retirarMock.mockResolvedValue(null);
  await abrir();
  await fireEvent.press(boton('Retirar vínculo de Marta Cuesta con Sofía Ramírez'));

  await waitFor(() => expect(retirarMock).toHaveBeenCalledWith(4));
  expect(await screen.findByText('Vínculo retirado: Marta Cuesta con Sofía Ramírez.')).toBeTruthy();
  expect(vinculosMock).toHaveBeenCalledTimes(2);
});

test('sin vínculos lo explica', async () => {
  vinculosMock.mockResolvedValue([]);
  await render(<VinculosAcudienteScreen />);

  expect(await screen.findByText('Todavía no hay acudientes vinculados.')).toBeTruthy();
});
