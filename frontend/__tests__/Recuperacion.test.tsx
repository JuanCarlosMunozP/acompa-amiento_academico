import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { confirmarRecuperacion, solicitarRecuperacion } from '@/api/auth';
import { NuevaContrasenaScreen } from '@/screens/auth/NuevaContrasenaScreen';
import { RecuperarContrasenaScreen } from '@/screens/auth/RecuperarContrasenaScreen';

jest.mock('@/api/auth', () => ({
  ...jest.requireActual('@/api/auth'),
  solicitarRecuperacion: jest.fn(),
  confirmarRecuperacion: jest.fn(),
}));

const solicitarMock = solicitarRecuperacion as jest.Mock;
const confirmarMock = confirmarRecuperacion as jest.Mock;

beforeEach(() => {
  solicitarMock.mockReset();
  confirmarMock.mockReset();
});

// --- Solicitud ---

async function abrirSolicitud() {
  const navigation = { popToTop: jest.fn() };
  await render(<RecuperarContrasenaScreen navigation={navigation as never} route={{} as never} />);
  return navigation;
}

test('solicitud: envía el correo y confirma sin revelar si la cuenta existe', async () => {
  solicitarMock.mockResolvedValue({ detail: 'ok' });
  await abrirSolicitud();
  await fireEvent.changeText(screen.getByLabelText('Correo institucional'), 'ana@colegio.edu.co');
  await fireEvent.press(screen.getByRole('button', { name: 'Enviar enlace' }));

  expect(await screen.findByText('Revisa tu correo')).toBeTruthy();
  expect(screen.getByText(/Si hay una cuenta con ana@colegio.edu.co/)).toBeTruthy();
  expect(solicitarMock).toHaveBeenCalledWith('ana@colegio.edu.co');
});

test('solicitud: correo inválido no llama a la API', async () => {
  await abrirSolicitud();
  await fireEvent.changeText(screen.getByLabelText('Correo institucional'), 'no-es-correo');
  await fireEvent.press(screen.getByRole('button', { name: 'Enviar enlace' }));

  expect(await screen.findByText('Ingresa un correo válido.')).toBeTruthy();
  expect(solicitarMock).not.toHaveBeenCalled();
});

test('solicitud: muestra el mensaje del servidor si hay demasiadas solicitudes', async () => {
  solicitarMock.mockRejectedValue({
    error: { code: 'throttled', message: 'Demasiadas solicitudes. Inténtalo más tarde.' },
  });
  await abrirSolicitud();
  await fireEvent.changeText(screen.getByLabelText('Correo institucional'), 'ana@colegio.edu.co');
  await fireEvent.press(screen.getByRole('button', { name: 'Enviar enlace' }));

  expect(await screen.findByText('Demasiadas solicitudes. Inténtalo más tarde.')).toBeTruthy();
});

test('solicitud: falla de red muestra un mensaje general', async () => {
  solicitarMock.mockRejectedValue(new TypeError('Network request failed'));
  await abrirSolicitud();
  await fireEvent.changeText(screen.getByLabelText('Correo institucional'), 'ana@colegio.edu.co');
  await fireEvent.press(screen.getByRole('button', { name: 'Enviar enlace' }));

  expect(await screen.findByText(/No pudimos enviar el correo/)).toBeTruthy();
});

// --- Nueva contraseña ---

async function abrirNueva(params?: { uid?: string; token?: string }) {
  const navigation = { replace: jest.fn() };
  await render(
    <NuevaContrasenaScreen
      navigation={navigation as never}
      route={{ key: 'n', name: 'NuevaContrasena', params } as never}
    />,
  );
  return navigation;
}

async function llenar(password: string, confirmacion: string) {
  await fireEvent.changeText(screen.getByLabelText('Nueva contraseña'), password);
  await fireEvent.changeText(screen.getByLabelText('Confirmar nueva contraseña'), confirmacion);
  await fireEvent.press(screen.getByRole('button', { name: 'Cambiar contraseña' }));
}

test('nueva contraseña: cambia la contraseña con uid y token del enlace', async () => {
  confirmarMock.mockResolvedValue({ detail: 'ok' });
  const navigation = await abrirNueva({ uid: 'MQ', token: 'abc-123' });
  await llenar('Otra-clave-2027!', 'Otra-clave-2027!');

  expect(await screen.findByText('Contraseña actualizada')).toBeTruthy();
  expect(confirmarMock).toHaveBeenCalledWith({
    uid: 'MQ',
    token: 'abc-123',
    password: 'Otra-clave-2027!',
    password_confirmacion: 'Otra-clave-2027!',
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Iniciar sesión' }));
  expect(navigation.replace).toHaveBeenCalledWith('Login');
});

test('nueva contraseña: valida longitud y coincidencia sin llamar a la API', async () => {
  await abrirNueva({ uid: 'MQ', token: 't' });
  await llenar('corta', 'distinta');

  expect(await screen.findByText('La contraseña debe tener al menos 8 caracteres.')).toBeTruthy();
  expect(screen.getByText('Las contraseñas no coinciden.')).toBeTruthy();
  expect(confirmarMock).not.toHaveBeenCalled();
});

test('nueva contraseña: muestra los errores de la contraseña que devuelve el servidor', async () => {
  confirmarMock.mockRejectedValue({
    error: {
      code: 'validation_error',
      message: 'Datos inválidos.',
      details: { password: ['Esta contraseña es demasiado común.'] },
    },
  });
  await abrirNueva({ uid: 'MQ', token: 't' });
  await llenar('password123', 'password123');

  expect(await screen.findByText('Esta contraseña es demasiado común.')).toBeTruthy();
});

test('enlace usado o vencido: ofrece solicitar otro', async () => {
  confirmarMock.mockRejectedValue({
    error: { code: 'enlace_invalido', message: 'El enlace no es válido o ya venció.' },
  });
  const navigation = await abrirNueva({ uid: 'MQ', token: 'viejo' });
  await llenar('Otra-clave-2027!', 'Otra-clave-2027!');

  expect(await screen.findByText('Enlace no válido')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Solicitar otro enlace' }));
  expect(navigation.replace).toHaveBeenCalledWith('RecuperarContrasena');
});

test('abrir la pantalla sin uid ni token muestra enlace no válido', async () => {
  await abrirNueva(undefined);

  expect(await screen.findByText('Enlace no válido')).toBeTruthy();
  expect(confirmarMock).not.toHaveBeenCalled();
});

test('falla de red al cambiar: mensaje general y se puede reintentar', async () => {
  confirmarMock.mockRejectedValue(new TypeError('Network request failed'));
  await abrirNueva({ uid: 'MQ', token: 't' });
  await llenar('Otra-clave-2027!', 'Otra-clave-2027!');

  expect(await screen.findByText(/No pudimos cambiar tu contraseña/)).toBeTruthy();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Cambiar contraseña' })).toBeTruthy(),
  );
});
