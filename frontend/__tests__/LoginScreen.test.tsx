import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { iniciarSesionApi, reenviarVerificacion, verificarMfaApi } from '@/api/auth';
import { LoginScreen } from '@/screens/LoginScreen';
import { SessionProvider } from '@/store/session';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/api/auth', () => ({
  ...jest.requireActual('@/api/auth'),
  iniciarSesionApi: jest.fn(),
  reenviarVerificacion: jest.fn(),
  verificarMfaApi: jest.fn(),
}));

const loginMock = iniciarSesionApi as jest.Mock;
const mfaMock = verificarMfaApi as jest.Mock;
const reenviarMock = reenviarVerificacion as jest.Mock;
const route = { key: 'Login', name: 'Login' } as never;

async function setup() {
  const navigation = { replace: jest.fn(), navigate: jest.fn() };
  await render(
    <SessionProvider>
      <LoginScreen navigation={navigation as never} route={route} />
    </SessionProvider>,
  );
  return navigation;
}

async function llenar(email: string, password: string) {
  await fireEvent.changeText(screen.getByLabelText('Correo institucional'), email);
  await fireEvent.changeText(screen.getByLabelText('Contraseña'), password);
  await fireEvent.press(screen.getByRole('button', { name: 'Entrar' }));
}

beforeEach(() => {
  loginMock.mockReset();
  mfaMock.mockReset();
});

test('login exitoso: guarda la sesión y vuelve al inicio', async () => {
  loginMock.mockResolvedValue({
    access: 'a',
    refresh: 'r',
    usuario: { id: 1, email: 'ana@colegio.edu.co', nombres: 'Ana' },
  });
  const navigation = await setup();
  await llenar('ana@colegio.edu.co', 'Clave-segura-2026');

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Home'));
  expect(loginMock).toHaveBeenCalledWith({
    email: 'ana@colegio.edu.co',
    password: 'Clave-segura-2026',
  });
});

test('credenciales inválidas: muestra el mensaje del servidor y no navega', async () => {
  loginMock.mockRejectedValue({
    error: { code: 'credenciales_invalidas', message: 'Correo o contraseña incorrectos.' },
  });
  const navigation = await setup();
  await llenar('ana@colegio.edu.co', 'mala');

  expect(await screen.findByText('Correo o contraseña incorrectos.')).toBeTruthy();
  expect(navigation.replace).not.toHaveBeenCalled();
});

test('cuenta bloqueada: muestra el aviso de bloqueo', async () => {
  loginMock.mockRejectedValue({
    error: {
      code: 'cuenta_bloqueada',
      message: 'Demasiados intentos fallidos. Inténtalo de nuevo en 15 min.',
    },
  });
  await setup();
  await llenar('ana@colegio.edu.co', 'mala');

  expect(await screen.findByText(/Demasiados intentos fallidos/)).toBeTruthy();
});

test('campos vacíos: valida localmente sin llamar a la API', async () => {
  await setup();
  await fireEvent.press(screen.getByRole('button', { name: 'Entrar' }));

  expect(await screen.findByText('Ingresa tu correo.')).toBeTruthy();
  expect(screen.getByText('Ingresa tu contraseña.')).toBeTruthy();
  expect(loginMock).not.toHaveBeenCalled();
});

test('falla de red: muestra un mensaje general', async () => {
  loginMock.mockRejectedValue(new TypeError('Network request failed'));
  await setup();
  await llenar('ana@colegio.edu.co', 'x');

  expect(await screen.findByText(/No pudimos iniciar sesión/)).toBeTruthy();
});

test('correo sin verificar: ofrece reenviar el correo de verificación', async () => {
  loginMock.mockRejectedValue({
    error: { code: 'correo_no_verificado', message: 'Verifica tu correo antes de iniciar sesión.' },
  });
  reenviarMock.mockResolvedValue({ detail: 'ok' });
  await setup();
  await llenar('ana@colegio.edu.co', 'Clave-segura-2026');

  expect(await screen.findByText('Verifica tu correo antes de iniciar sesión.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Reenviar correo de verificación' }));

  await waitFor(() => expect(reenviarMock).toHaveBeenCalledWith('ana@colegio.edu.co'));
  expect(await screen.findByText('Te enviamos otro correo de verificación.')).toBeTruthy();
});

// --- Verificación en dos pasos ---

const SESION = {
  access: 'a',
  refresh: 'r',
  usuario: { id: 1, email: 'ana@colegio.edu.co', nombres: 'Ana', mfa_activo: true },
};

async function llegarAlSegundoPaso() {
  loginMock.mockResolvedValue({ mfa_requerido: true, mfa_token: 'desafio-firmado' });
  const navigation = await setup();
  await llenar('ana@colegio.edu.co', 'Clave-segura-2026');
  await screen.findByText('Verificación en dos pasos');
  return navigation;
}

test('con MFA activo pide el código y no inicia sesión solo con la contraseña', async () => {
  const navigation = await llegarAlSegundoPaso();

  expect(screen.getByLabelText('Código de verificación')).toBeTruthy();
  expect(screen.queryByLabelText('Contraseña')).toBeNull();
  expect(navigation.replace).not.toHaveBeenCalled();
});

test('el código correcto completa el inicio de sesión con el desafío del servidor', async () => {
  mfaMock.mockResolvedValue(SESION);
  const navigation = await llegarAlSegundoPaso();

  await fireEvent.changeText(screen.getByLabelText('Código de verificación'), ' 123456 ');
  await fireEvent.press(screen.getByRole('button', { name: 'Verificar' }));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Home'));
  expect(mfaMock).toHaveBeenCalledWith({ mfa_token: 'desafio-firmado', codigo: '123456' });
});

test('un código incorrecto muestra el error y permite reintentar sin repetir la contraseña', async () => {
  mfaMock.mockRejectedValue({
    error: { code: 'codigo_mfa_invalido', message: 'El código de verificación no es válido.' },
  });
  const navigation = await llegarAlSegundoPaso();

  await fireEvent.changeText(screen.getByLabelText('Código de verificación'), '000000');
  await fireEvent.press(screen.getByRole('button', { name: 'Verificar' }));

  expect(await screen.findByText('El código de verificación no es válido.')).toBeTruthy();
  expect(screen.getByLabelText('Código de verificación')).toBeTruthy();
  expect(navigation.replace).not.toHaveBeenCalled();
});

test('si el desafío venció vuelve al inicio con el aviso', async () => {
  mfaMock.mockRejectedValue({
    error: {
      code: 'mfa_token_invalido',
      message: 'La verificación venció. Vuelve a iniciar sesión.',
    },
  });
  await llegarAlSegundoPaso();

  await fireEvent.changeText(screen.getByLabelText('Código de verificación'), '123456');
  await fireEvent.press(screen.getByRole('button', { name: 'Verificar' }));

  expect(await screen.findByText('La verificación venció. Vuelve a iniciar sesión.')).toBeTruthy();
  expect(screen.getByLabelText('Contraseña')).toBeTruthy();
});

test('no se envía un código vacío', async () => {
  await llegarAlSegundoPaso();
  await fireEvent.press(screen.getByRole('button', { name: 'Verificar' }));

  expect(await screen.findByText('Ingresa el código de verificación.')).toBeTruthy();
  expect(mfaMock).not.toHaveBeenCalled();
});
