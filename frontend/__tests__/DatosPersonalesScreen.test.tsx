import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { actualizarMisDatos } from '@/api/perfil';
import { obtenerMiDesempenoTutorias } from '@/api/planes';
import { DatosPersonalesScreen } from '@/screens/perfil/DatosPersonalesScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/perfil', () => ({
  ...jest.requireActual('@/api/perfil'),
  actualizarMisDatos: jest.fn(),
}));
jest.mock('@/api/planes', () => ({
  ...jest.requireActual('@/api/planes'),
  obtenerMiDesempenoTutorias: jest.fn(),
}));
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));

const actualizarMock = actualizarMisDatos as jest.Mock;
const desempenoMock = obtenerMiDesempenoTutorias as jest.Mock;
const sesionMock = useSession as jest.Mock;
const actualizarUsuario = jest.fn();

const USUARIO = {
  id: 7,
  email: 'ana@colegio.edu.co',
  nombres: 'Ana',
  apellidos: 'Ruiz',
  rol: 'estudiante',
  email_verificado: true,
};

beforeEach(() => {
  actualizarMock.mockReset();
  desempenoMock.mockReset().mockReturnValue(new Promise(() => undefined));
  actualizarUsuario.mockReset().mockResolvedValue(undefined);
  sesionMock.mockReturnValue({ sesion: { usuario: USUARIO }, actualizarUsuario });
});

const guardar = () => screen.getByRole('button', { name: 'Guardar cambios' });

test('muestra los datos actuales y explica que el correo lo administra la institución', async () => {
  await render(<DatosPersonalesScreen />);

  expect(screen.getByDisplayValue('Ana')).toBeTruthy();
  expect(screen.getByDisplayValue('Ruiz')).toBeTruthy();
  expect(screen.getByText(/ana@colegio.edu.co/)).toBeTruthy();
  expect(screen.getByText(/Como estudiante, aquí encuentras información/)).toBeTruthy();
  expect(screen.queryByLabelText('Correo institucional')).toBeNull(); // el correo no se edita
});

test('el botón de guardar está deshabilitado mientras no haya cambios', async () => {
  await render(<DatosPersonalesScreen />);
  expect(guardar().props.accessibilityState.disabled).toBe(true);

  await fireEvent.changeText(screen.getByLabelText('Nombres'), 'Ana María');
  expect(guardar().props.accessibilityState.disabled).toBe(false);

  await fireEvent.changeText(screen.getByLabelText('Nombres'), 'Ana');
  expect(guardar().props.accessibilityState.disabled).toBe(true);
});

test('guardar envía los datos limpios, actualiza la sesión y confirma', async () => {
  actualizarMock.mockResolvedValue({ ...USUARIO, nombres: 'Ana María', apellidos: 'Ruiz Gómez' });
  await render(<DatosPersonalesScreen />);
  await fireEvent.changeText(screen.getByLabelText('Nombres'), '  Ana   María ');
  await fireEvent.changeText(screen.getByLabelText('Apellidos'), 'Ruiz  Gómez');
  await fireEvent.press(guardar());

  await waitFor(() =>
    expect(actualizarMock).toHaveBeenCalledWith({ nombres: 'Ana María', apellidos: 'Ruiz Gómez' }),
  );
  expect(actualizarUsuario).toHaveBeenCalledWith(
    expect.objectContaining({ nombres: 'Ana María', apellidos: 'Ruiz Gómez' }),
  );
  expect(await screen.findByText('Datos guardados.')).toBeTruthy();
  expect(guardar().props.accessibilityState.disabled).toBe(true);
});

test('no se guardan nombres o apellidos vacíos y no se llama al servidor', async () => {
  await render(<DatosPersonalesScreen />);
  await fireEvent.changeText(screen.getByLabelText('Nombres'), '   ');
  await fireEvent.changeText(screen.getByLabelText('Apellidos'), '');
  await fireEvent.press(guardar());

  expect(await screen.findByText('Ingresa tus nombres.')).toBeTruthy();
  expect(screen.getByText('Ingresa tus apellidos.')).toBeTruthy();
  expect(actualizarMock).not.toHaveBeenCalled();
});

test('muestra bajo el campo el error de validación del servidor', async () => {
  actualizarMock.mockRejectedValue({
    error: {
      code: 'validation_error',
      message: 'Datos inválidos.',
      details: { nombres: ['Este campo no puede estar vacío.'] },
    },
  });
  await render(<DatosPersonalesScreen />);
  await fireEvent.changeText(screen.getByLabelText('Nombres'), 'Otro');
  await fireEvent.press(guardar());

  expect(await screen.findByText('Este campo no puede estar vacío.')).toBeTruthy();
  expect(actualizarUsuario).not.toHaveBeenCalled(); // la sesión no cambia si el servidor rechaza
});

test('falla de red: mensaje general y conserva lo escrito', async () => {
  actualizarMock.mockRejectedValue(new TypeError('Network request failed'));
  await render(<DatosPersonalesScreen />);
  await fireEvent.changeText(screen.getByLabelText('Nombres'), 'Anita');
  await fireEvent.press(guardar());

  expect(await screen.findByText(/No pudimos guardar tus datos/)).toBeTruthy();
  expect(screen.getByDisplayValue('Anita')).toBeTruthy();
});

test('si la sesión venció mientras editaba, lo avisa', async () => {
  actualizarMock.mockRejectedValue({
    error: { code: 'sesion_expirada', message: 'Tu sesión venció.' },
  });
  await render(<DatosPersonalesScreen />);
  await fireEvent.changeText(screen.getByLabelText('Nombres'), 'Anita');
  await fireEvent.press(guardar());

  expect(await screen.findByText('Tu sesión venció. Inicia sesión de nuevo.')).toBeTruthy();
});

test('editar después de guardar oculta el aviso de guardado', async () => {
  actualizarMock.mockResolvedValue({ ...USUARIO, nombres: 'Anita' });
  await render(<DatosPersonalesScreen />);
  await fireEvent.changeText(screen.getByLabelText('Nombres'), 'Anita');
  await fireEvent.press(guardar());
  await screen.findByText('Datos guardados.');

  await fireEvent.changeText(screen.getByLabelText('Nombres'), 'Anita M');
  expect(screen.queryByText('Datos guardados.')).toBeNull();
});

test('sin sesión no muestra el formulario', async () => {
  sesionMock.mockReturnValue({ sesion: null, actualizarUsuario });
  await render(<DatosPersonalesScreen />);

  expect(await screen.findByText('Inicia sesión para ver tus datos.')).toBeTruthy();
  expect(screen.queryByLabelText('Nombres')).toBeNull();
});

describe('desempeño del estudiante', () => {
  test('muestra el resumen con el porcentaje de asistencia', async () => {
    let resolver: (v: unknown) => void = () => undefined;
    desempenoMock.mockReturnValue(new Promise((r) => (resolver = r)));
    await render(<DatosPersonalesScreen />);
    expect(screen.getByText('Cargando tu resumen…')).toBeTruthy();
    await act(async () =>
      resolver({
        rol: 'estudiante',
        tutorias_realizadas: 4,
        asistencias: 3,
        porcentaje_asistencia: 75,
      }),
    );
    expect(await screen.findByText(/Tutorías realizadas: 4/)).toBeTruthy();
    expect(screen.getByText(/Porcentaje de asistencia: 75%/)).toBeTruthy();
  });

  test('sin datos de asistencia lo indica', async () => {
    desempenoMock.mockResolvedValue({
      rol: 'estudiante',
      tutorias_realizadas: 0,
      asistencias: 0,
      porcentaje_asistencia: null,
    });
    await render(<DatosPersonalesScreen />);
    expect(await screen.findByText(/Porcentaje de asistencia: Sin datos/)).toBeTruthy();
  });

  test('si falla la consulta lo avisa', async () => {
    desempenoMock.mockRejectedValue(new Error('x'));
    await render(<DatosPersonalesScreen />);
    expect(await screen.findByText(/No pudimos cargar tu desempeño/)).toBeTruthy();
  });
});

test('un rol sin descripción propia usa el texto general', async () => {
  sesionMock.mockReturnValue({
    sesion: { usuario: { ...USUARIO, rol: 'acudiente' } },
    actualizarUsuario,
  });
  await render(<DatosPersonalesScreen embedded />);
  expect(screen.getByText(/Desde tu perfil puedes mantener actualizados tus datos/)).toBeTruthy();
});
