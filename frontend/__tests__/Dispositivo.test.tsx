import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { iniciarSesionApi, verificarDispositivoApi } from '@/api/auth';
import { LoginScreen } from '@/screens/LoginScreen';
import { SessionProvider } from '@/store/session';
import {
  generarId,
  obtenerIdDispositivo,
  reiniciarDispositivoEnMemoria,
} from '@/utils/dispositivo';

const almacen: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => almacen[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    almacen[k] = v;
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    delete almacen[k];
  }),
}));

jest.mock('@/api/auth', () => ({
  ...jest.requireActual('@/api/auth'),
  iniciarSesionApi: jest.fn(),
  verificarDispositivoApi: jest.fn(),
}));

const loginMock = iniciarSesionApi as jest.Mock;
const verificarMock = verificarDispositivoApi as jest.Mock;
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

async function entrar() {
  await fireEvent.changeText(screen.getByLabelText('Correo institucional'), 'ana@colegio.edu.co');
  await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'Clave-segura-2026');
  await fireEvent.press(screen.getByRole('button', { name: 'Entrar' }));
}

const NUEVO = { dispositivo_nuevo: true, desafio_token: 'tok', correo: 'a***@colegio.edu.co' };

beforeEach(() => {
  loginMock.mockReset();
  verificarMock.mockReset();
});

test('dispositivo nuevo: no bloquea, pide el código del correo y entra al verificarlo', async () => {
  loginMock.mockResolvedValue(NUEVO);
  verificarMock.mockResolvedValue({
    access: 'a',
    refresh: 'r',
    usuario: { id: 1, email: 'ana@colegio.edu.co', nombres: 'Ana' },
  });
  const navigation = await setup();
  await entrar();

  expect(await screen.findByText('Verifica este dispositivo')).toBeTruthy();
  expect(screen.getByText(/a\*\*\*@colegio\.edu\.co/)).toBeTruthy();
  expect(navigation.replace).not.toHaveBeenCalled();

  await fireEvent.changeText(screen.getByLabelText('Código de verificación'), '123456');
  await fireEvent.press(screen.getByRole('button', { name: 'Verificar' }));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Home'));
  expect(verificarMock).toHaveBeenCalledWith({ desafio_token: 'tok', codigo: '123456' });
});

test('código de dispositivo incorrecto: muestra el error y permite reintentar', async () => {
  loginMock.mockResolvedValue(NUEVO);
  verificarMock.mockRejectedValue({
    error: { code: 'codigo_dispositivo_invalido', message: 'El código no es válido o ya venció.' },
  });
  const navigation = await setup();
  await entrar();
  await screen.findByText('Verifica este dispositivo');
  await fireEvent.changeText(screen.getByLabelText('Código de verificación'), '000000');
  await fireEvent.press(screen.getByRole('button', { name: 'Verificar' }));

  expect(await screen.findByText('El código no es válido o ya venció.')).toBeTruthy();
  expect(screen.getByLabelText('Código de verificación')).toBeTruthy();
  expect(navigation.replace).not.toHaveBeenCalled();
});

test('código vacío no llama a la API', async () => {
  loginMock.mockResolvedValue(NUEVO);
  await setup();
  await entrar();
  await screen.findByText('Verifica este dispositivo');
  await fireEvent.press(screen.getByRole('button', { name: 'Verificar' }));
  expect(await screen.findByText('Ingresa el código de verificación.')).toBeTruthy();
  expect(verificarMock).not.toHaveBeenCalled();
});

test('Volver regresa al formulario de inicio de sesión', async () => {
  loginMock.mockResolvedValue(NUEVO);
  await setup();
  await entrar();
  await screen.findByText('Verifica este dispositivo');
  await fireEvent.press(screen.getByRole('button', { name: 'Volver' }));
  expect(await screen.findByText('Iniciar sesión')).toBeTruthy();
});

test('si el desafío venció (error distinto) vuelve al primer paso con el mensaje', async () => {
  loginMock.mockResolvedValue(NUEVO);
  verificarMock.mockRejectedValue({ error: { code: 'cuenta_bloqueada', message: 'Bloqueada.' } });
  await setup();
  await entrar();
  await screen.findByText('Verifica este dispositivo');
  await fireEvent.changeText(screen.getByLabelText('Código de verificación'), '123456');
  await fireEvent.press(screen.getByRole('button', { name: 'Verificar' }));
  expect(await screen.findByText('Bloqueada.')).toBeTruthy();
  expect(screen.getByText('Iniciar sesión')).toBeTruthy();
});

describe('identificador del dispositivo', () => {
  beforeEach(() => {
    reiniciarDispositivoEnMemoria();
    for (const k of Object.keys(almacen)) delete almacen[k];
  });

  test('genera un id de 32 hex y lo reutiliza', async () => {
    const a = await obtenerIdDispositivo();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(await obtenerIdDispositivo()).toBe(a);
    reiniciarDispositivoEnMemoria();
    expect(await obtenerIdDispositivo()).toBe(a); // lo recupera del almacenamiento
  });

  test('un almacenamiento vacío (incógnito) produce otro id', async () => {
    const a = await obtenerIdDispositivo();
    reiniciarDispositivoEnMemoria();
    for (const k of Object.keys(almacen)) delete almacen[k];
    expect(await obtenerIdDispositivo()).not.toBe(a);
  });

  test('descarta un id guardado con formato inválido', async () => {
    almacen.dispositivo_id = '<script>';
    const id = await obtenerIdDispositivo();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  test('generarId no se repite', () => {
    expect(generarId()).not.toBe(generarId());
  });

  test('sin crypto.getRandomValues usa el respaldo', () => {
    const original = (globalThis as { crypto?: unknown }).crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      expect(generarId()).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });
});
