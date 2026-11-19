import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  iniciarSesionApi,
  reenviarVerificacion,
  verificarDispositivoApi,
  verificarMfaApi,
} from '@/api/auth';
import { LoginScreen } from '@/screens/LoginScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/auth', () => ({
  ...jest.requireActual('@/api/auth'),
  iniciarSesionApi: jest.fn(),
  reenviarVerificacion: jest.fn(),
  verificarDispositivoApi: jest.fn(),
  verificarMfaApi: jest.fn(),
}));
jest.mock('@/api/client', () => ({
  ...jest.requireActual('@/api/client'),
  precalentarApi: jest.fn(),
}));
const mockAncho = { valor: 400 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockAncho.valor, height: 800, scale: 1, fontScale: 1 }),
}));
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));

const loginMock = iniciarSesionApi as jest.Mock;
const dispositivoMock = verificarDispositivoApi as jest.Mock;
const mfaMock = verificarMfaApi as jest.Mock;
const reenviarMock = reenviarVerificacion as jest.Mock;
const sesionMock = useSession as jest.Mock;
const iniciar = jest.fn();
const route = { key: 'Login', name: 'Login' } as never;
const SESION = { access: 'a', refresh: 'r', usuario: { id: 1, nombres: 'Ana' } };

async function setup(aviso: string | null = null) {
  sesionMock.mockReturnValue({ iniciar, aviso });
  const navigation = { replace: jest.fn(), navigate: jest.fn() };
  await render(<LoginScreen navigation={navigation as never} route={route} />);
  return navigation;
}

async function entrar(email = 'ana@colegio.edu.co', clave = 'Clave-2026') {
  await fireEvent.changeText(screen.getByLabelText('Correo institucional'), email);
  await fireEvent.changeText(screen.getByLabelText('Contraseña'), clave);
  await fireEvent.press(screen.getByRole('button', { name: 'Entrar' }));
}

const DESAFIO = { dispositivo_nuevo: true, desafio_token: 'D1', correo: 'a***@colegio.edu.co' };

beforeEach(() => {
  jest.clearAllMocks();
  iniciar.mockResolvedValue(undefined);
});

describe('avisos de cierre de sesión', () => {
  test.each([
    ['inactividad', /cerró por inactividad/],
    ['seguridad', /herramientas de desarrollo abiertas/],
    ['expirada', /Tu sesión venció/],
  ])('%s', async (motivo, texto) => {
    await setup(motivo);
    expect(screen.getByText(texto)).toBeTruthy();
  });
});

describe('navegación', () => {
  test('oculta recuperar contraseña y lleva a registrarse', async () => {
    const navigation = await setup();
    expect(screen.queryByText('¿Olvidaste tu contraseña?')).toBeNull();
    await fireEvent.press(screen.getByRole('link'));
    expect(navigation.navigate).toHaveBeenCalledWith('Registro');
  });
});

describe('dispositivo nuevo', () => {
  test('pide el código del correo y completa el ingreso', async () => {
    loginMock.mockResolvedValue(DESAFIO);
    dispositivoMock.mockResolvedValue(SESION);
    const navigation = await setup();
    await entrar();

    expect(await screen.findByText('Verifica este dispositivo')).toBeTruthy();
    expect(screen.getByText(/a\*\*\*@colegio.edu.co/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Código de verificación'), ' 123456 ');
    await fireEvent.press(screen.getByRole('button', { name: 'Verificar' }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Home'));
    expect(dispositivoMock).toHaveBeenCalledWith({ desafio_token: 'D1', codigo: '123456' });
    expect(iniciar).toHaveBeenCalledWith(SESION);
  });

  test('un código vacío no se envía y "Volver" regresa al primer paso', async () => {
    loginMock.mockResolvedValue(DESAFIO);
    await setup();
    await entrar();
    await screen.findByText('Verifica este dispositivo');
    await fireEvent.press(screen.getByRole('button', { name: 'Verificar' }));
    expect(await screen.findByText('Ingresa el código de verificación.')).toBeTruthy();
    expect(dispositivoMock).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Volver' }));
    expect(await screen.findByText('Iniciar sesión')).toBeTruthy();
  });

  test('un código incorrecto permite reintentar; uno vencido reinicia el proceso', async () => {
    loginMock.mockResolvedValue(DESAFIO);
    dispositivoMock.mockRejectedValueOnce({
      error: { code: 'codigo_dispositivo_invalido', message: 'Código incorrecto.' },
    });
    await setup();
    await entrar();
    await screen.findByText('Verifica este dispositivo');
    await fireEvent.changeText(screen.getByLabelText('Código de verificación'), '000000');
    await fireEvent.press(screen.getByRole('button', { name: 'Verificar' }));
    expect(await screen.findByText('Código incorrecto.')).toBeTruthy();

    dispositivoMock.mockRejectedValueOnce({
      error: { code: 'desafio_vencido', message: 'El código venció.' },
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Verificar' }));
    expect(await screen.findByText('Iniciar sesión')).toBeTruthy();
    expect(screen.getByText('El código venció.')).toBeTruthy();
  });
});

describe('segundo factor con app autenticadora', () => {
  test('usa el desafío MFA al verificar', async () => {
    loginMock.mockResolvedValue({ mfa_requerido: true, mfa_token: 'M1' });
    mfaMock.mockResolvedValue(SESION);
    const navigation = await setup();
    await entrar();
    expect(await screen.findByText('Verificación en dos pasos')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Código de verificación'), '654321');
    await fireEvent.press(screen.getByRole('button', { name: 'Verificar' }));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Home'));
    expect(mfaMock).toHaveBeenCalledWith({ mfa_token: 'M1', codigo: '654321' });
  });
});

describe('correo sin verificar', () => {
  const sinVerificar = {
    error: { code: 'correo_no_verificado', message: 'Verifica tu correo.' },
  };

  test('reenvía el correo y lo confirma', async () => {
    loginMock.mockRejectedValue(sinVerificar);
    reenviarMock.mockResolvedValue(undefined);
    await setup();
    await entrar();
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Reenviar correo de verificación' }),
    );
    expect(await screen.findByText('Te enviamos otro correo de verificación.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reenviar correo de verificación' })).toBeNull();
  });

  test('si el reenvío falla lo avisa', async () => {
    loginMock.mockRejectedValue(sinVerificar);
    reenviarMock.mockRejectedValue(new Error('red'));
    await setup();
    await entrar();
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Reenviar correo de verificación' }),
    );
    expect(await screen.findByText(/No pudimos reenviar el correo/)).toBeTruthy();
  });
});

describe('envíos repetidos y pantallas anchas', () => {
  test('en pantallas anchas usa el diseño de dos columnas', async () => {
    mockAncho.valor = 1200;
    await setup();
    expect(screen.getByText('Iniciar sesión')).toBeTruthy();
    loginMock.mockResolvedValue(DESAFIO);
    await entrar();
    expect(await screen.findByText('Verifica este dispositivo')).toBeTruthy();
  });
});
