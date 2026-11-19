import { authFetch, authFetchRaw, conectarSesion } from '@/api/authFetch';
import { apiFetch, errorDeTiempo, precalentarApi, resolveApiUrl } from '@/api/client';
import { descargarInforme, obtenerInformeAcompanamiento, obtenerMatriz } from '@/api/seguimiento';
import { listarEstudiantes, listarUsuarios } from '@/api/usuarios';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));

const respuesta = (cuerpo: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => cuerpo,
    headers: { get: () => null },
  }) as unknown as Response;

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue(respuesta({ ok: true }));
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

afterEach(() => {
  conectarSesion(null);
  jest.useRealTimers();
});

const urls = () => fetchMock.mock.calls.map(([u]) => String(u));

describe('construcción de consultas', () => {
  beforeEach(() =>
    conectarSesion({
      leer: () => ({ access: 'A', refresh: 'R' }),
      guardar: jest.fn(),
      expirar: jest.fn(),
    }),
  );

  test('obtenerMatriz', async () => {
    await obtenerMatriz();
    await obtenerMatriz({ grupo: 2, estado: 'critico', q: ' Ana ', page: 3 });
    await obtenerMatriz({ q: '  ', page: 1 });
    expect(urls()[0]).toMatch(/\/matriz-desempeno\/$/);
    expect(urls()[1]).toMatch(/\?grupo=2&estado=critico&q=Ana&page=3$/);
    expect(urls()[2]).toMatch(/\/matriz-desempeno\/$/);
  });

  test('listarUsuarios y listarEstudiantes', async () => {
    await listarUsuarios();
    await listarUsuarios({ q: ' Luis ', rol: 'tutor', page: 2 });
    await listarEstudiantes();
    await listarEstudiantes({ q: ' Ana ', page: 4 });
    expect(urls()[0]).toMatch(/\/usuarios\/$/);
    expect(urls()[1]).toMatch(/\/usuarios\/\?q=Luis&rol=tutor&page=2$/);
    expect(urls()[2]).toMatch(/\/estudiantes\/$/);
    expect(urls()[3]).toMatch(/\/estudiantes\/\?q=Ana&page=4$/);
  });

  test('informes de acompañamiento y su exportación', async () => {
    await obtenerInformeAcompanamiento();
    await obtenerInformeAcompanamiento({ grupo: 1, asignatura: null, tutor: 3, periodo: 2 });
    await descargarInforme('grupos');
    await descargarInforme('tutores', { grupo: 1, asignatura: 2 });
    expect(urls()[0]).toMatch(/\/informes-acompanamiento\/$/);
    expect(urls()[1]).toMatch(/grupo=1&tutor=3&periodo=2$/);
    expect(urls()[2]).toMatch(/exportar=grupos$/);
    expect(urls()[3]).toMatch(/exportar=tutores&grupo=1&asignatura=2$/);
  });
});

describe('sesión y renovación', () => {
  test('sin sesión no se hacen peticiones autenticadas', async () => {
    conectarSesion(null);
    await expect(authFetch('/x/')).rejects.toMatchObject({ error: { code: 'sin_sesion' } });
    await expect(authFetchRaw('/x/')).rejects.toMatchObject({ error: { code: 'sin_sesion' } });
  });

  test('renovar sin sesión conectada falla', async () => {
    const lecturas = [{ access: 'A', refresh: 'R' }, null];
    conectarSesion({
      leer: () => lecturas.shift() ?? null,
      guardar: jest.fn(),
      expirar: jest.fn(),
    });
    fetchMock.mockResolvedValueOnce(respuesta({}, 401));
    await expect(authFetch('/x/')).rejects.toMatchObject({ error: { code: 'sin_sesion' } });
  });

  test('un 401 renueva el token una sola vez y reintenta', async () => {
    const guardar = jest.fn();
    conectarSesion({ leer: () => ({ access: 'A', refresh: 'R' }), guardar, expirar: jest.fn() });
    fetchMock
      .mockResolvedValueOnce(respuesta({}, 401))
      .mockResolvedValueOnce(respuesta({ access: 'NUEVO' }))
      .mockResolvedValueOnce(respuesta({ dato: 1 }));
    expect(await authFetch('/x/')).toEqual({ dato: 1 });
    expect(guardar).toHaveBeenCalledWith({ access: 'NUEVO', refresh: 'R' });
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer NUEVO');
  });

  test('la descarga cruda renueva igual y propaga errores del servidor', async () => {
    conectarSesion({
      leer: () => ({ access: 'A', refresh: 'R' }),
      guardar: jest.fn(),
      expirar: jest.fn(),
    });
    fetchMock
      .mockResolvedValueOnce(respuesta({}, 401))
      .mockResolvedValueOnce(respuesta({ access: 'N2', refresh: 'R2' }))
      .mockResolvedValueOnce(respuesta({}, 200));
    expect((await authFetchRaw('/x/')).status).toBe(200);
    fetchMock.mockResolvedValueOnce(respuesta({ error: { code: 'x', message: 'm' } }, 404));
    await expect(authFetchRaw('/x/')).rejects.toMatchObject({ error: { code: 'x' } });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('no json');
      },
    });
    await expect(authFetchRaw('/x/')).rejects.toBeNull();
  });

  test('si no se puede renovar, expira la sesión', async () => {
    const expirar = jest.fn();
    conectarSesion({ leer: () => ({ access: 'A', refresh: 'R' }), guardar: jest.fn(), expirar });
    fetchMock.mockResolvedValueOnce(respuesta({}, 401)).mockResolvedValueOnce(respuesta({}, 401));
    await expect(authFetch('/x/')).rejects.toMatchObject({ error: { code: 'sesion_expirada' } });
    expect(expirar).toHaveBeenCalled();
  });
});

describe('apiFetch', () => {
  test('devuelve el cuerpo o lanza el error de la API', async () => {
    fetchMock.mockResolvedValueOnce(respuesta({ a: 1 }));
    expect(await apiFetch('/ok/', { headers: { 'X-Test': '1' } })).toEqual({ a: 1 });
    fetchMock.mockResolvedValueOnce(respuesta({ error: { code: 'malo' } }, 400));
    await expect(apiFetch('/mal/')).rejects.toEqual({ error: { code: 'malo' } });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('html');
      },
    });
    await expect(apiFetch('/html/')).rejects.toBeNull();
  });

  test('un fallo de red se propaga', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(apiFetch('/x/')).rejects.toThrow('Network request failed');
  });

  test('si se agota el tiempo se informa con un mensaje claro', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_ok, fallo) => {
          init.signal?.addEventListener('abort', () => fallo(new Error('abortado')));
        }),
    );
    const promesa = apiFetch('/lento/');
    const resultado = expect(promesa).rejects.toEqual(errorDeTiempo());
    await jest.advanceTimersByTimeAsync(20_000);
    await resultado;
  });

  test('precalentarApi no propaga fallos', async () => {
    fetchMock.mockRejectedValueOnce(new Error('frío'));
    expect(() => precalentarApi()).not.toThrow();
    await Promise.resolve();
    expect(urls()[0]).toMatch(/\/health\/$/);
  });
});

describe('resolveApiUrl', () => {
  test('rechaza 0.0.0.0', () => {
    expect(() => resolveApiUrl({ configuredUrl: 'http://0.0.0.0:8000/api' })).toThrow(/0\.0\.0\.0/);
  });

  test('una API remota solo pierde la barra final', () => {
    expect(resolveApiUrl({ configuredUrl: 'https://api.colegio.edu.co/api/' })).toBe(
      'https://api.colegio.edu.co/api',
    );
  });

  test.each([
    ['web con host privado', { platform: 'web', browserHost: '192.168.1.20' }, '192.168.1.20'],
    ['web con host 10.x', { platform: 'web', browserHost: '10.1.2.3' }, '10.1.2.3'],
    ['web con host 172.16-31', { platform: 'web', browserHost: '172.20.0.5' }, '172.20.0.5'],
    ['web con host público', { platform: 'web', browserHost: '8.8.8.8' }, 'localhost'],
    [
      'web con host 172 fuera de rango',
      { platform: 'web', browserHost: '172.40.0.1' },
      'localhost',
    ],
    ['web con un nombre de host', { platform: 'web', browserHost: 'mi-pc' }, 'localhost'],
    ['web con IP inválida', { platform: 'web', browserHost: '300.1.1.1' }, 'localhost'],
    ['web sin host', { platform: 'web' }, 'localhost'],
    ['ios con host de Expo', { platform: 'ios', expoHostUri: '192.168.0.9:8081' }, '192.168.0.9'],
    ['ios sin host de Expo', { platform: 'ios' }, 'localhost'],
    ['android con host público', { platform: 'android', expoHostUri: '8.8.8.8:1' }, '10.0.2.2'],
    ['android sin Expo', { platform: 'android' }, '10.0.2.2'],
  ] as const)('%s', (_caso, opciones, host) => {
    const url = resolveApiUrl({ configuredUrl: 'http://localhost:8001/api', ...opciones });
    expect(new URL(url).hostname).toBe(host);
  });

  test('sin URL configurada usa el puerto local por defecto', () => {
    expect(resolveApiUrl()).toBe('http://localhost:8001/api');
  });
});

describe('arranque del módulo en la app instalada', () => {
  function cargar(entorno: { dev: boolean; os: string; url?: string }) {
    jest.resetModules();
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = entorno.dev;
    jest.doMock('react-native', () => ({ Platform: { OS: entorno.os } }));
    jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig: {} } }));
    const anterior = process.env.EXPO_PUBLIC_API_URL;
    if (entorno.url) process.env.EXPO_PUBLIC_API_URL = entorno.url;
    else delete process.env.EXPO_PUBLIC_API_URL;
    try {
      return require('@/api/client') as typeof import('@/api/client');
    } finally {
      if (anterior === undefined) delete process.env.EXPO_PUBLIC_API_URL;
      else process.env.EXPO_PUBLIC_API_URL = anterior;
    }
  }

  afterEach(() => {
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = true;
    jest.dontMock('react-native');
    jest.dontMock('expo-constants');
    jest.resetModules();
  });

  test('el APK sin API pública no arranca', () => {
    expect(() => cargar({ dev: false, os: 'ios' })).toThrow(/API pública HTTPS/);
  });

  test('el APK con API pública arranca', () => {
    const cliente = cargar({ dev: false, os: 'android', url: 'https://api.colegio.edu.co/api' });
    expect(cliente.API_URL).toBe('https://api.colegio.edu.co/api');
  });

  test('en la web toma el host del navegador cuando es una red privada', () => {
    const g = globalThis as unknown as { window?: unknown };
    const anterior = g.window;
    g.window = { location: { hostname: '192.168.1.20' } };
    try {
      const cliente = cargar({ dev: false, os: 'web' });
      expect(new URL(cliente.API_URL).hostname).toBe('192.168.1.20');
    } finally {
      if (anterior === undefined) delete g.window;
      else g.window = anterior;
    }
  });

  test('la versión web con localhost es válida', () => {
    expect(cargar({ dev: false, os: 'web' }).API_URL).toBe('http://localhost:8001/api');
  });
});
