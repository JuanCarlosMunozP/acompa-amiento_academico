import { act, render, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AppState, Text } from 'react-native';

import { authFetch, conectarSesion } from '@/api/authFetch';
import { InactividadGate } from '@/components/InactividadGate';
import { irAlLogin } from '@/navigation/ref';
import { SessionProvider, useSession } from '@/store/session';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/navigation/ref', () => ({ irAlLogin: jest.fn() }));

const fetchMock = jest.fn();
globalThis.fetch = fetchMock as never;

function respuesta(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

beforeEach(() => fetchMock.mockReset());
afterEach(() => conectarSesion(null));

// --- authFetch: renovación de la sesión ---

function conectar(tokens = { access: 'a1', refresh: 'r1' }) {
  const estado = { tokens: tokens as { access: string; refresh: string } | null };
  const expirar = jest.fn();
  conectarSesion({
    leer: () => estado.tokens,
    guardar: (t) => {
      estado.tokens = t;
    },
    expirar,
  });
  return { estado, expirar };
}

test('envía el access token en la cabecera Authorization', async () => {
  conectar();
  fetchMock.mockResolvedValue(respuesta(200, { ok: 1 }));
  await authFetch('/auth/me/');

  const [, init] = fetchMock.mock.calls[0];
  expect(init.headers.Authorization).toBe('Bearer a1');
});

test('si el access venció, renueva y reintenta con el token nuevo', async () => {
  const { estado } = conectar();
  fetchMock
    .mockResolvedValueOnce(respuesta(401, { error: { code: 'token_not_valid' } }))
    .mockResolvedValueOnce(respuesta(200, { access: 'a2', refresh: 'r2' }))
    .mockResolvedValueOnce(respuesta(200, { email: 'ana@colegio.edu.co' }));

  const r = await authFetch<{ email: string }>('/auth/me/');

  expect(r.email).toBe('ana@colegio.edu.co');
  expect(estado.tokens).toEqual({ access: 'a2', refresh: 'r2' });
  expect(fetchMock.mock.calls[1][0]).toMatch(/\/auth\/refresh\/$/);
  expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer a2');
});

test('si el refresh también venció, cierra la sesión como expirada', async () => {
  const { expirar } = conectar();
  fetchMock
    .mockResolvedValueOnce(respuesta(401, {}))
    .mockResolvedValueOnce(respuesta(401, { error: { code: 'token_not_valid' } }));

  await expect(authFetch('/auth/me/')).rejects.toMatchObject({
    error: { code: 'sesion_expirada' },
  });
  expect(expirar).toHaveBeenCalledTimes(1);
});

test('sin red al renovar: no cierra la sesión', async () => {
  const { expirar } = conectar();
  fetchMock
    .mockResolvedValueOnce(respuesta(401, {}))
    .mockRejectedValueOnce(new TypeError('Network request failed'));

  await expect(authFetch('/auth/me/')).rejects.toThrow('Network request failed');
  expect(expirar).not.toHaveBeenCalled();
});

test('peticiones simultáneas con el access vencido comparten una sola renovación', async () => {
  conectar();
  fetchMock.mockImplementation(
    async (url: string, init: { headers: { Authorization: string } }) => {
      if (url.endsWith('/auth/refresh/')) return respuesta(200, { access: 'a2', refresh: 'r2' });
      return init.headers.Authorization === 'Bearer a1'
        ? respuesta(401, {})
        : respuesta(200, { ok: true });
    },
  );

  await Promise.all([authFetch('/a'), authFetch('/b'), authFetch('/c')]);

  const renovaciones = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/auth/refresh/'));
  expect(renovaciones).toHaveLength(1);
});

test('sin sesión no hace ninguna petición', async () => {
  conectarSesion({ leer: () => null, guardar: jest.fn(), expirar: jest.fn() });
  await expect(authFetch('/auth/me/')).rejects.toMatchObject({ error: { code: 'sin_sesion' } });
  expect(fetchMock).not.toHaveBeenCalled();
});

// --- cierre por inactividad ---

const SESION = {
  access: 'a',
  refresh: 'r',
  usuario: {
    id: 1,
    email: 'ana@colegio.edu.co',
    nombres: 'Ana',
    apellidos: 'R',
    rol: 'estudiante',
    email_verificado: true,
  },
};

function Sonda() {
  const { sesion, aviso, iniciar } = useSession();
  return (
    <>
      <Text testID="estado">{sesion ? 'abierta' : 'cerrada'}</Text>
      <Text testID="aviso">{aviso ?? 'ninguno'}</Text>
      <Text testID="abrir" onPress={() => void iniciar(SESION)}>
        abrir
      </Text>
    </>
  );
}

async function montar(minutos = 10) {
  await render(
    <SessionProvider>
      <InactividadGate minutos={minutos}>
        <Sonda />
      </InactividadGate>
    </SessionProvider>,
  );
}

async function abrirSesion() {
  await act(async () => {
    screen.getByTestId('abrir').props.onPress();
  });
}

const estado = () => screen.getByTestId('estado').props.children;
const aviso = () => screen.getByTestId('aviso').props.children;

describe('inactividad', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue(respuesta(204, null));
  });
  afterEach(() => jest.useRealTimers());

  test('cierra la sesión al pasar el tiempo sin interacción', async () => {
    await montar(10);
    await abrirSesion();
    expect(estado()).toBe('abierta');

    await act(async () => {
      jest.advanceTimersByTime(10 * 60_000 - 1000);
    });
    expect(estado()).toBe('abierta');

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(estado()).toBe('cerrada');
    expect(aviso()).toBe('inactividad');
  });

  test('un toque reinicia la cuenta', async () => {
    await montar(10);
    await abrirSesion();

    await act(async () => {
      jest.advanceTimersByTime(9 * 60_000);
    });
    // Toque en cualquier parte de la app.
    await act(async () => {
      screen.getByTestId('inactividad-gate').props.onStartShouldSetResponderCapture();
    });
    await act(async () => {
      jest.advanceTimersByTime(9 * 60_000);
    });
    expect(estado()).toBe('abierta');
  });

  test('sin sesión no se cuenta inactividad', async () => {
    await montar(10);
    await act(async () => {
      jest.advanceTimersByTime(60 * 60_000);
    });
    expect(estado()).toBe('cerrada');
    expect(aviso()).toBe('ninguno');
  });

  test('al volver a primer plano tras mucho tiempo, cierra la sesión', async () => {
    let cambio: (e: string) => void = () => undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _: string,
      cb: (e: string) => void,
    ) => {
      cambio = cb;
      return { remove: jest.fn() };
    }) as never);

    await montar(10);
    await abrirSesion();

    // La app estuvo en segundo plano: los temporizadores no corrieron, pero el reloj sí.
    jest.setSystemTime(Date.now() + 11 * 60_000);
    await act(async () => {
      cambio('active');
    });
    expect(estado()).toBe('cerrada');
    expect(aviso()).toBe('inactividad');
  });

  test('al cerrar por inactividad se invalida el refresh en el servidor', async () => {
    await montar(1);
    await abrirSesion();
    await act(async () => {
      jest.advanceTimersByTime(61_000);
    });
    const llamada = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/auth/logout/'));
    expect(llamada).toBeTruthy();
    expect(JSON.parse(llamada![1].body)).toEqual({ refresh: 'r' });
  });
});

// --- datos del usuario y cierre voluntario ---

function SondaUsuario() {
  const { sesion, iniciar, actualizarUsuario, cerrar } = useSession();
  return (
    <>
      <Text testID="nombre">{sesion?.usuario.nombres ?? 'sin sesión'}</Text>
      <Text testID="abrir2" onPress={() => void iniciar(SESION)}>
        abrir
      </Text>
      <Text
        testID="renombrar"
        onPress={() => void actualizarUsuario({ ...SESION.usuario, nombres: 'Anita' })}
      >
        renombrar
      </Text>
      <Text testID="salir" onPress={() => void cerrar()}>
        salir
      </Text>
    </>
  );
}

async function montarUsuario() {
  await render(
    <SessionProvider>
      <SondaUsuario />
    </SessionProvider>,
  );
}

const pulsar = (id: string) =>
  act(async () => {
    screen.getByTestId(id).props.onPress();
  });

describe('usuario y cierre voluntario', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockResolvedValue(respuesta(204, null));
  });

  test('actualizar el usuario cambia lo que se muestra y se guarda de forma segura', async () => {
    await montarUsuario();
    await pulsar('abrir2');
    await pulsar('renombrar');

    expect(screen.getByTestId('nombre').props.children).toBe('Anita');
    const guardada = JSON.parse((SecureStore.setItemAsync as jest.Mock).mock.calls.at(-1)[1]);
    expect(guardada.usuario.nombres).toBe('Anita');
    expect(guardada.access).toBe(SESION.access); // los tokens se conservan
  });

  test('sin sesión, actualizar el usuario no hace nada', async () => {
    await montarUsuario();
    await pulsar('renombrar');

    expect(screen.getByTestId('nombre').props.children).toBe('sin sesión');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  test('cerrar la sesión a propósito: borra lo guardado, invalida el refresh y vuelve al inicio', async () => {
    await montarUsuario();
    await pulsar('abrir2');
    await pulsar('salir');

    expect(screen.getByTestId('nombre').props.children).toBe('sin sesión');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('sesion');
    const logout = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/auth/logout/'));
    expect(JSON.parse(logout![1].body)).toEqual({ refresh: SESION.refresh });
    expect(irAlLogin).toHaveBeenCalledTimes(1);
  });

  test('si no hay red al cerrar, la sesión se cierra igual en el dispositivo', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    await montarUsuario();
    await pulsar('abrir2');
    await pulsar('salir');

    expect(screen.getByTestId('nombre').props.children).toBe('sin sesión');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('sesion');
  });
});
