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
  asunto: 'Plan para {{ estudiante }}',
  cuerpo_texto: 'Hola {{ nombres }}',
  cuerpo_html: '<p>Hola {{ nombres }}</p>',
  actualizado: '2026-01-01T00:00:00Z',
};

const ESTUDIANTE = {
  ...TUTOR,
  clave: 'asignacion_estudiante' as const,
  asunto: 'Tu plan',
};

beforeEach(() => {
  listarMock.mockReset().mockResolvedValue([TUTOR, ESTUDIANTE]);
  guardarMock.mockReset();
});

test('lista plantillas editables y muestra las variables admitidas', async () => {
  await render(<PlantillasCorreoScreen embedded />);

  expect(await screen.findByDisplayValue('Plan para {{ estudiante }}')).toBeTruthy();
  expect(screen.getByText('Variables disponibles')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Aviso de asignación al estudiante' })).toBeTruthy();
});

test('guarda el asunto y los contenidos de la plantilla seleccionada', async () => {
  guardarMock.mockImplementation(async (_clave, cambios) => ({ ...TUTOR, ...cambios }));
  await render(<PlantillasCorreoScreen embedded />);
  await screen.findByDisplayValue('Plan para {{ estudiante }}');
  await fireEvent.changeText(screen.getByLabelText('Asunto del correo'), 'Nuevo asunto');
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar plantilla' }));

  await waitFor(() =>
    expect(guardarMock).toHaveBeenCalledWith('asignacion_tutor', {
      asunto: 'Nuevo asunto',
      cuerpo_texto: TUTOR.cuerpo_texto,
      cuerpo_html: TUTOR.cuerpo_html,
    }),
  );
  expect(await screen.findByText('La plantilla se guardó correctamente.')).toBeTruthy();
});
