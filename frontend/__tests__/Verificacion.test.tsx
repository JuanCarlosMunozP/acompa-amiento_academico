import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { reenviarVerificacion, verificarCorreo } from '@/api/auth';
import { RegistroExitoScreen } from '@/screens/auth/RegistroExitoScreen';
import { VerificarCorreoScreen } from '@/screens/auth/VerificarCorreoScreen';

jest.mock('@/api/auth', () => ({
  ...jest.requireActual('@/api/auth'),
  verificarCorreo: jest.fn(),
  reenviarVerificacion: jest.fn(),
}));

const verificarMock = verificarCorreo as jest.Mock;
const reenviarMock = reenviarVerificacion as jest.Mock;

beforeEach(() => {
  verificarMock.mockReset();
  reenviarMock.mockReset();
});

async function abrirVerificar(params?: { token?: string }) {
  const navigation = { replace: jest.fn() };
  await render(
    <VerificarCorreoScreen
      navigation={navigation as never}
      route={{ key: 'v', name: 'VerificarCorreo', params } as never}
    />,
  );
  return navigation;
}

test('enlace válido: muestra correo verificado y lleva al login', async () => {
  verificarMock.mockResolvedValue({ email: 'ana@colegio.edu.co', email_verificado: true });
  const navigation = await abrirVerificar({ token: 'tok' });

  expect(await screen.findByText('Correo verificado')).toBeTruthy();
  expect(verificarMock).toHaveBeenCalledWith('tok');
  await fireEvent.press(screen.getByRole('button', { name: 'Iniciar sesión' }));
  expect(navigation.replace).toHaveBeenCalledWith('Login');
});

test('enlace vencido: muestra el mensaje del servidor', async () => {
  verificarMock.mockRejectedValue({
    error: {
      code: 'token_expirado',
      message: 'El enlace de verificación venció. Solicita uno nuevo.',
    },
  });
  await abrirVerificar({ token: 'viejo' });

  expect(await screen.findByText('No se pudo verificar')).toBeTruthy();
  expect(screen.getByText(/venció/)).toBeTruthy();
});

test('sin token en el enlace: error sin llamar a la API', async () => {
  await abrirVerificar(undefined);

  expect(await screen.findByText('El enlace no es válido.')).toBeTruthy();
  expect(verificarMock).not.toHaveBeenCalled();
});

test('falla de red al verificar: mensaje general', async () => {
  verificarMock.mockRejectedValue(new TypeError('Network request failed'));
  await abrirVerificar({ token: 'tok' });

  expect(await screen.findByText(/No pudimos verificar tu correo/)).toBeTruthy();
});

test('reenviar correo desde la pantalla de registro exitoso', async () => {
  reenviarMock.mockResolvedValue({ detail: 'ok' });
  await render(
    <RegistroExitoScreen
      navigation={{ popToTop: jest.fn() } as never}
      route={{ key: 'r', name: 'RegistroExito', params: { email: 'ana@colegio.edu.co' } } as never}
    />,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Reenviar correo' }));

  await waitFor(() => expect(reenviarMock).toHaveBeenCalledWith('ana@colegio.edu.co'));
  expect(await screen.findByText('Listo, te enviamos otro correo.')).toBeTruthy();
});
