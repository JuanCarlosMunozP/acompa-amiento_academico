import { fireEvent, render, screen } from '@testing-library/react-native';

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

const SIN_PARENTESCO = {
  id: 4,
  acudiente: 20,
  acudiente_nombre: 'Marta Cuesta',
  estudiante: 7,
  estudiante_nombre: 'Sofía Ramírez',
  parentesco: '',
};
const pagina = <T,>(results: T[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});
const ACUDIENTE = {
  id: 21,
  email: 'j@c.co',
  nombres: 'Jorge',
  apellidos: 'Gómez',
  rol: 'acudiente',
  rol_nombre: 'Acudiente',
  is_active: true,
};
const FICHA = {
  id: 1,
  usuario: { id: 8, email: 'm@c.co', nombres: 'Mateo', apellidos: 'Gómez' },
  grado: null,
  grupo: null,
};
const boton = (nombre: string) => screen.getByRole('button', { name: nombre });

beforeEach(() => {
  [crearMock, estudiantesMock, usuariosMock, vinculosMock, retirarMock].forEach((m) =>
    m.mockReset(),
  );
  vinculosMock.mockResolvedValue([SIN_PARENTESCO]);
  usuariosMock.mockResolvedValue(pagina([ACUDIENTE]));
  estudiantesMock.mockResolvedValue(pagina([FICHA]));
});

test('un vínculo sin parentesco no muestra el separador', async () => {
  await render(<VinculosAcudienteScreen embedded />);
  expect(await screen.findByText('Acudiente de Sofía Ramírez')).toBeTruthy();
});

test('busca acudientes y estudiantes por nombre y avisa si no hay resultados', async () => {
  await render(<VinculosAcudienteScreen />);
  await screen.findByText('Marta Cuesta');
  usuariosMock.mockResolvedValue(pagina([]));
  await fireEvent.changeText(screen.getByLabelText('Buscar acudiente'), 'zzz');
  await fireEvent.press(boton('Buscar acudiente'));
  expect(await screen.findByText(/No hay acudientes con ese nombre/)).toBeTruthy();
  expect(usuariosMock).toHaveBeenLastCalledWith({ rol: 'acudiente', q: 'zzz' });

  await fireEvent.changeText(screen.getByLabelText('Buscar estudiante'), 'mat');
  await fireEvent.press(boton('Buscar estudiante'));
  expect(estudiantesMock).toHaveBeenLastCalledWith({ q: 'mat' });
});

test('si fallan las listas de acudientes o estudiantes lo avisa', async () => {
  usuariosMock.mockRejectedValue(new Error('x'));
  estudiantesMock.mockRejectedValue(new Error('x'));
  await render(<VinculosAcudienteScreen />);
  expect(await screen.findByText('No pudimos cargar los acudientes.')).toBeTruthy();
  expect(screen.getByText('No pudimos cargar los estudiantes.')).toBeTruthy();
});

test('si falla la lista de vínculos permite reintentar', async () => {
  vinculosMock.mockRejectedValueOnce(new Error('x'));
  await render(<VinculosAcudienteScreen />);
  expect(await screen.findByText('No pudimos cargar los vínculos.')).toBeTruthy();
  await fireEvent.press(boton('Reintentar'));
  expect(await screen.findByText('Marta Cuesta')).toBeTruthy();
});

test('muestra quién se va a vincular y un error genérico al vincular', async () => {
  crearMock.mockRejectedValue(new Error('red'));
  await render(<VinculosAcudienteScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Acudiente Jorge Gómez' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Estudiante Mateo Gómez' }));
  expect(screen.getByText('Jorge Gómez → Mateo Gómez')).toBeTruthy();
  await fireEvent.press(boton('Vincular'));
  expect(await screen.findByText(/No pudimos crear el vínculo/)).toBeTruthy();
});

test('si falla al retirar un vínculo lo avisa', async () => {
  retirarMock.mockRejectedValue(new Error('red'));
  await render(<VinculosAcudienteScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: /Retirar vínculo de Marta/ }));
  expect(await screen.findByText(/No pudimos retirar el vínculo/)).toBeTruthy();
});
