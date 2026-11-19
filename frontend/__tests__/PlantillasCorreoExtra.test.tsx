import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { guardarPlantillaCorreo, listarPlantillasCorreo } from '@/api/plantillas';
import { PlantillasCorreoScreen } from '@/screens/academica/PlantillasCorreoScreen';

jest.mock('@/api/plantillas', () => ({
  guardarPlantillaCorreo: jest.fn(),
  listarPlantillasCorreo: jest.fn(),
}));

const listarMock = listarPlantillasCorreo as jest.Mock;
const guardarMock = guardarPlantillaCorreo as jest.Mock;

const TUTOR = {
  clave: 'asignacion_tutor' as const,
  asunto: 'Plan tutor',
  cuerpo_texto: 'Hola tutor',
  cuerpo_html: '<p>Hola tutor</p>',
  actualizado: '2026-01-01T00:00:00Z',
};
const ESTUDIANTE = { ...TUTOR, clave: 'asignacion_estudiante' as const, asunto: 'Plan estudiante' };

beforeEach(() => {
  listarMock.mockReset().mockResolvedValue([TUTOR, ESTUDIANTE]);
  guardarMock.mockReset();
});

test('si falla la carga muestra el mensaje del servidor o el genérico', async () => {
  listarMock.mockRejectedValueOnce({ error: { message: 'Sin permiso' } });
  const vista = await render(<PlantillasCorreoScreen embedded={false} />);
  expect(await screen.findByText('Sin permiso')).toBeTruthy();
  expect(screen.queryByText('No se encontró la plantilla seleccionada.')).toBeNull();
  await vista.unmount();

  listarMock.mockRejectedValueOnce(new Error('red'));
  await render(<PlantillasCorreoScreen embedded />);
  expect(await screen.findByText(/No pudimos guardar la plantilla/)).toBeTruthy();
});

test('por defecto se muestra como pantalla independiente', async () => {
  await render(<PlantillasCorreoScreen />);
  expect(await screen.findByDisplayValue('Plan tutor')).toBeTruthy();
});

test('sin plantillas avisa que no se encontró la seleccionada', async () => {
  listarMock.mockResolvedValue([]);
  await render(<PlantillasCorreoScreen embedded />);
  expect(await screen.findByText('No se encontró la plantilla seleccionada.')).toBeTruthy();
});

test('permite cambiar de plantilla y editar texto y HTML', async () => {
  guardarMock.mockImplementation(async (_clave, cambios) => ({ ...ESTUDIANTE, ...cambios }));
  await render(<PlantillasCorreoScreen embedded />);
  await screen.findByDisplayValue('Plan tutor');
  await fireEvent.press(screen.getByRole('button', { name: 'Aviso de asignación al estudiante' }));
  expect(await screen.findByDisplayValue('Plan estudiante')).toBeTruthy();

  await fireEvent.changeText(screen.getByLabelText('Contenido de texto del correo'), 'Texto nuevo');
  await fireEvent.changeText(screen.getByLabelText('Contenido HTML del correo'), '<b>Nuevo</b>');
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar plantilla' }));
  await waitFor(() =>
    expect(guardarMock).toHaveBeenCalledWith('asignacion_estudiante', {
      asunto: 'Plan estudiante',
      cuerpo_texto: 'Texto nuevo',
      cuerpo_html: '<b>Nuevo</b>',
    }),
  );
  expect(await screen.findByText('La plantilla se guardó correctamente.')).toBeTruthy();
});

test('si el servidor rechaza el guardado muestra el error', async () => {
  guardarMock.mockRejectedValue({ error: { message: 'Variable desconocida' } });
  await render(<PlantillasCorreoScreen embedded />);
  await screen.findByDisplayValue('Plan tutor');
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar plantilla' }));
  expect(await screen.findByText('Variable desconocida')).toBeTruthy();
});
