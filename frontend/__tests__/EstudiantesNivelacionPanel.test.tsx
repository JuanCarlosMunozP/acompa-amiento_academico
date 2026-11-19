import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { listarEstudiantes } from '@/api/usuarios';
import { EstudiantesNivelacionPanel } from '@/screens/planes/EstudiantesNivelacionPanel';

jest.mock('@/api/usuarios', () => ({
  ...jest.requireActual('@/api/usuarios'),
  listarEstudiantes: jest.fn(),
}));

const listarMock = listarEstudiantes as jest.Mock;

const ficha = (id: number, conGrupo = true) => ({
  id,
  usuario: { id: 100 + id, nombres: 'Ana', apellidos: `Pérez ${id}` },
  grado: conGrupo ? { nombre: 'Sexto' } : null,
  grupo: conGrupo ? { nombre: 'A' } : null,
});

beforeEach(() => {
  listarMock.mockReset();
});

test('lista los estudiantes y registra la nivelación del elegido', async () => {
  listarMock.mockResolvedValue({ results: [ficha(1), ficha(2, false)], next: null });
  const onRegistrar = jest.fn();
  await render(<EstudiantesNivelacionPanel onRegistrar={onRegistrar} />);

  expect(await screen.findByText('Sexto · grupo A')).toBeTruthy();
  expect(screen.getByText('Sin grupo asignado')).toBeTruthy();
  expect(screen.queryByText(/Hay más resultados/)).toBeNull();

  await fireEvent.press(
    screen.getByRole('button', { name: 'Registrar nivelación de Ana Pérez 1' }),
  );
  expect(onRegistrar).toHaveBeenCalledWith(101, 'Ana Pérez 1');
});

test('busca por nombre y avisa si no hay resultados', async () => {
  listarMock.mockResolvedValueOnce({ results: [ficha(1)], next: 'siguiente' });
  await render(<EstudiantesNivelacionPanel embedded onRegistrar={jest.fn()} />);
  expect(await screen.findByText(/Hay más resultados/)).toBeTruthy();

  listarMock.mockResolvedValue({ results: [], next: null });
  await fireEvent.changeText(screen.getByLabelText('Buscar por nombre o apellido'), 'zzz');
  await fireEvent.press(screen.getByRole('button', { name: 'Buscar' }));

  expect(await screen.findByText('No se encontraron estudiantes.')).toBeTruthy();
  await waitFor(() => expect(listarMock).toHaveBeenLastCalledWith({ q: 'zzz' }));
});

test('si falla la consulta permite reintentar', async () => {
  listarMock.mockRejectedValueOnce(new Error('red'));
  await render(<EstudiantesNivelacionPanel onRegistrar={jest.fn()} />);
  expect(await screen.findByText(/No pudimos cargar los estudiantes/)).toBeTruthy();

  listarMock.mockResolvedValue({ results: [ficha(3)], next: null });
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('Ana Pérez 3')).toBeTruthy();
});
