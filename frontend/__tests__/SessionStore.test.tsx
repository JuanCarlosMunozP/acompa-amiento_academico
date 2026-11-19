import { act, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { Text } from 'react-native';

import { logoutApi } from '@/api/auth';
import { authFetch, conectarSesion } from '@/api/authFetch';
import { irAlLogin } from '@/navigation/ref';
import { SessionProvider, useSession } from '@/store/session';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('@/api/auth', () => ({ logoutApi: jest.fn() }));
jest.mock('@/api/authFetch', () => ({ authFetch: jest.fn(), conectarSesion: jest.fn() }));
jest.mock('@/navigation/ref', () => ({ irAlLogin: jest.fn() }));

const getMock = SecureStore.getItemAsync as jest.Mock;
const setMock = SecureStore.setItemAsync as jest.Mock;
const deleteMock = SecureStore.deleteItemAsync as jest.Mock;
const logoutMock = logoutApi as jest.Mock;
const fetchMock = authFetch as jest.Mock;
const conectarMock = conectarSesion as jest.Mock;

const USUARIO = {
  id: 1,
  email: 'a@c.co',
  nombres: 'Ana',
  apellidos: 'Ruiz',
  rol: 'estudiante',
  email_verificado: true,
};
const SESION = { access: 'A', refresh: 'R', usuario: USUARIO } as never;

type Ctx = ReturnType<typeof useSession>;
let ctx: Ctx;

function Sonda() {
  ctx = useSession();
  return (
    <Text>
      {ctx.cargando
        ? 'cargando'
        : ctx.sesion
          ? `sesion:${ctx.sesion.usuario.nombres}`
          : 'sin sesion'}
    </Text>
  );
}

const montar = () =>
  render(
    <SessionProvider>
      <Sonda />
    </SessionProvider>,
  );

/** Conector que el proveedor registra en la capa HTTP. */
const conector = () => {
  const llamadas = conectarMock.mock.calls.filter(([c]) => c !== null);
  return llamadas[llamadas.length - 1][0] as {
    leer: () => { access: string; refresh: string } | null;
    guardar: (t: { access: string; refresh: string }) => void;
    expirar: () => void;
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  getMock.mockResolvedValue(null);
  setMock.mockResolvedValue(undefined);
  deleteMock.mockResolvedValue(undefined);
  logoutMock.mockResolvedValue(undefined);
  fetchMock.mockResolvedValue({ ...USUARIO, nombres: 'Ana María' });
});

test('sin sesión guardada arranca sin sesión', async () => {
  await montar();
  expect(await screen.findByText('sin sesion')).toBeTruthy();
});

test('recupera la sesión guardada y refresca los datos del usuario', async () => {
  getMock.mockResolvedValue(JSON.stringify(SESION));
  await montar();
  expect(await screen.findByText('sesion:Ana María')).toBeTruthy();
  expect(setMock).toHaveBeenCalled();
});

test('si no se pueden refrescar los datos conserva los guardados', async () => {
  getMock.mockResolvedValue(JSON.stringify(SESION));
  fetchMock.mockRejectedValue(new Error('red'));
  await montar();
  expect(await screen.findByText('sesion:Ana')).toBeTruthy();
});

test('si el refresco cierra la sesión mientras tanto no la reabre', async () => {
  getMock.mockResolvedValue(JSON.stringify(SESION));
  fetchMock.mockImplementation(async () => {
    await act(async () => conector().expirar());
    return USUARIO;
  });
  await montar();
  await waitFor(() => expect(screen.queryByText('cargando')).toBeNull());
  expect(screen.getByText('sin sesion')).toBeTruthy();
});

test('un dato guardado corrupto se ignora', async () => {
  getMock.mockResolvedValue('{no es json');
  await montar();
  expect(await screen.findByText('sin sesion')).toBeTruthy();
});

test('iniciar guarda la sesión y limpia el aviso', async () => {
  await montar();
  await screen.findByText('sin sesion');
  await act(async () => ctx.iniciar(SESION));
  expect(screen.getByText('sesion:Ana')).toBeTruthy();
  expect(setMock).toHaveBeenCalledWith('sesion', JSON.stringify(SESION), expect.any(Object));
  expect(ctx.aviso).toBeNull();
});

test('sin almacenamiento seguro la sesión sigue en memoria', async () => {
  setMock.mockRejectedValue(new Error('sin keystore'));
  await montar();
  await screen.findByText('sin sesion');
  await act(async () => ctx.iniciar(SESION));
  expect(screen.getByText('sesion:Ana')).toBeTruthy();
});

test('actualizarUsuario cambia los datos; sin sesión no hace nada', async () => {
  await montar();
  await screen.findByText('sin sesion');
  await act(async () => ctx.actualizarUsuario({ ...USUARIO, nombres: 'Nadie' }));
  expect(screen.getByText('sin sesion')).toBeTruthy();

  await act(async () => ctx.iniciar(SESION));
  await act(async () => ctx.actualizarUsuario({ ...USUARIO, nombres: 'Luisa' }));
  expect(screen.getByText('sesion:Luisa')).toBeTruthy();
});

test('cerrar sin motivo vuelve al inicio e invalida el refresh en el servidor', async () => {
  await montar();
  await screen.findByText('sin sesion');
  await act(async () => ctx.iniciar(SESION));
  await act(async () => ctx.cerrar());
  expect(screen.getByText('sin sesion')).toBeTruthy();
  expect(logoutMock).toHaveBeenCalledWith('R');
  expect(deleteMock).toHaveBeenCalled();
  expect(irAlLogin).toHaveBeenCalled();
  expect(ctx.aviso).toBeNull();
});

test('cerrar con motivo lleva al login y no falla si no hay red', async () => {
  logoutMock.mockRejectedValue(new Error('red'));
  await montar();
  await screen.findByText('sin sesion');
  await act(async () => ctx.iniciar(SESION));
  await act(async () => ctx.cerrar('inactividad'));
  expect(irAlLogin).toHaveBeenCalled();
  expect(ctx.aviso).toBe('inactividad');
});

test('cerrar sin sesión activa no llama al servidor', async () => {
  await montar();
  await screen.findByText('sin sesion');
  await act(async () => ctx.cerrar('seguridad'));
  expect(logoutMock).not.toHaveBeenCalled();
  expect(ctx.aviso).toBe('seguridad');
});

describe('conector con la capa HTTP', () => {
  test('lee los tokens, guarda los renovados y expira la sesión', async () => {
    await montar();
    await screen.findByText('sin sesion');
    expect(conector().leer()).toBeNull();
    conector().guardar({ access: 'X', refresh: 'Y' }); // sin sesión: se ignora
    expect(screen.getByText('sin sesion')).toBeTruthy();

    await act(async () => ctx.iniciar(SESION));
    expect(conector().leer()).toEqual({ access: 'A', refresh: 'R' });
    await act(async () => conector().guardar({ access: 'X', refresh: 'Y' }));
    expect(conector().leer()).toEqual({ access: 'X', refresh: 'Y' });

    await act(async () => conector().expirar());
    expect(ctx.aviso).toBe('expirada');
    expect(irAlLogin).toHaveBeenCalled();
  });

  test('al desmontar se desconecta', async () => {
    const vista = await montar();
    await screen.findByText('sin sesion');
    await vista.unmount();
    expect(conectarMock).toHaveBeenLastCalledWith(null);
  });
});

test('useSession fuera del proveedor lanza un error claro', async () => {
  const consola = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await expect(render(<Sonda />)).rejects.toThrow(
    'useSession debe usarse dentro de <SessionProvider>',
  );
  consola.mockRestore();
});
