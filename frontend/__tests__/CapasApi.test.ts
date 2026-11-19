import * as auth from '@/api/auth';
import { authFetch, authFetchRaw, conectarSesion } from '@/api/authFetch';
import { activarMfa, configurarMfa, desactivarMfa, regenerarCodigosRecuperacion } from '@/api/mfa';
import { actualizarMisDatos, obtenerMiFicha } from '@/api/perfil';
import {
  actualizarMiPerfil,
  guardarDisponibilidadTutor,
  listarAsignaturas,
  obtenerDisponibilidadTutor,
  obtenerMiPerfil,
} from '@/api/tutores';

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
  conectarSesion({
    leer: () => ({ access: 'ACC', refresh: 'REF' }),
    guardar: jest.fn(),
    expirar: jest.fn(),
  });
});

afterEach(() => conectarSesion(null));

function ultima() {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return { url: String(url), init: init as RequestInit };
}

describe('api/mfa', () => {
  test('configurar usa POST sin cuerpo', async () => {
    await configurarMfa();
    expect(ultima().url).toMatch(/\/auth\/mfa\/configurar\/$/);
    expect(ultima().init.method).toBe('POST');
  });

  test('activar envía el código', async () => {
    await activarMfa('123456');
    expect(ultima().url).toMatch(/\/auth\/mfa\/activar\/$/);
    expect(JSON.parse(String(ultima().init.body))).toEqual({ codigo: '123456' });
  });

  test('desactivar y regenerar envían contraseña y código', async () => {
    await desactivarMfa({ password: 'p', codigo: '1' });
    expect(ultima().url).toMatch(/\/auth\/mfa\/desactivar\/$/);
    expect(JSON.parse(String(ultima().init.body))).toEqual({ password: 'p', codigo: '1' });
    await regenerarCodigosRecuperacion({ password: 'p', codigo: '2' });
    expect(ultima().url).toMatch(/\/auth\/mfa\/codigos-recuperacion\/$/);
  });

  test('todas llevan el token de acceso', async () => {
    await configurarMfa();
    expect((ultima().init.headers as Record<string, string>).Authorization).toBe('Bearer ACC');
  });
});

describe('api/tutores (perfil del tutor y disponibilidad)', () => {
  test('lee su perfil y las asignaturas', async () => {
    await obtenerMiPerfil();
    expect(ultima().url).toMatch(/\/perfil-tutor\/$/);
    await listarAsignaturas();
    expect(ultima().url).toMatch(/\/asignaturas\/$/);
  });

  test('actualiza solo los campos enviados con PATCH', async () => {
    await actualizarMiPerfil({ biografia: 'Hola', disponible: true });
    expect(ultima().init.method).toBe('PATCH');
    expect(JSON.parse(String(ultima().init.body))).toEqual({ biografia: 'Hola', disponible: true });
  });

  test('lee y guarda la disponibilidad (PUT)', async () => {
    await obtenerDisponibilidadTutor();
    expect(ultima().url).toMatch(/\/perfil-tutor\/disponibilidad\/$/);
    const datos = {
      horarios: [{ dia_semana: 1, hora_inicio: '08:00:00', hora_fin: '10:00:00' }],
      bloqueos: [],
    };
    await guardarDisponibilidadTutor(datos);
    expect(ultima().init.method).toBe('PUT');
    expect(JSON.parse(String(ultima().init.body))).toEqual(datos);
  });
});

describe('api/perfil', () => {
  test('edita los datos personales con PATCH a /auth/me/', async () => {
    await actualizarMisDatos({ nombres: 'Ana' });
    expect(ultima().url).toMatch(/\/auth\/me\/$/);
    expect(ultima().init.method).toBe('PATCH');
  });

  test('obtiene la ficha del estudiante', async () => {
    await obtenerMiFicha();
    expect(ultima().url).toMatch(/\/mi-ficha\/$/);
  });
});

describe('api/auth', () => {
  test('cada operación pública llama a su ruta con el cuerpo esperado', async () => {
    const casos: [() => Promise<unknown>, RegExp, unknown][] = [
      [() => auth.verificarCorreo('tok'), /\/auth\/verificar-correo\/$/, { token: 'tok' }],
      [
        () => auth.reenviarVerificacion('a@b.co'),
        /\/auth\/reenviar-verificacion\/$/,
        { email: 'a@b.co' },
      ],
      [() => auth.solicitarRecuperacion('a@b.co'), /\/auth\/recuperar\/$/, { email: 'a@b.co' }],
      [() => auth.logoutApi('REF'), /\/auth\/logout\/$/, { refresh: 'REF' }],
      [
        () => auth.verificarMfaApi({ mfa_token: 't', codigo: '1' }),
        /\/auth\/mfa\/verificar\/$/,
        { mfa_token: 't', codigo: '1' },
      ],
      [
        () => auth.verificarDispositivoApi({ desafio_token: 't', codigo: '1' }),
        /\/auth\/dispositivo\/verificar\/$/,
        { desafio_token: 't', codigo: '1' },
      ],
    ];
    for (const [llamar, ruta, cuerpo] of casos) {
      await llamar();
      expect(ultima().url).toMatch(ruta);
      expect(JSON.parse(String(ultima().init.body))).toEqual(cuerpo);
    }
  });

  test('confirmarRecuperacion y registrar envían el formulario completo', async () => {
    const rec = { uid: 'u', token: 't', password: 'x', password_confirmacion: 'x' };
    await auth.confirmarRecuperacion(rec);
    expect(ultima().url).toMatch(/\/auth\/recuperar\/confirmar\/$/);
    expect(JSON.parse(String(ultima().init.body))).toEqual(rec);
    const reg = {
      email: 'a@b.co',
      nombres: 'A',
      apellidos: 'B',
      password: 'x',
      password_confirmacion: 'x',
    };
    await auth.registrar(reg);
    expect(ultima().url).toMatch(/\/auth\/registro\/$/);
  });

  test('iniciarSesionApi añade el identificador del dispositivo', async () => {
    await auth.iniciarSesionApi({ email: 'a@b.co', password: 'x' });
    const cuerpo = JSON.parse(String(ultima().init.body));
    expect(cuerpo.email).toBe('a@b.co');
    expect(cuerpo.dispositivo).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  });

  test('requiereMfa y requiereDispositivo distinguen las respuestas', () => {
    expect(auth.requiereMfa({ mfa_requerido: true, mfa_token: 't' })).toBe(true);
    expect(
      auth.requiereDispositivo({ dispositivo_nuevo: true, desafio_token: 't', correo: 'a***@b' }),
    ).toBe(true);
    const sesion = { access: 'a', refresh: 'r', usuario: {} } as never;
    expect(auth.requiereMfa(sesion)).toBe(false);
    expect(auth.requiereDispositivo(sesion)).toBe(false);
  });

  test('erroresPorCampo aplana mensajes y tolera formatos inesperados', () => {
    expect(
      auth.erroresPorCampo({ error: { details: { email: ['Mal', 'Peor'], nombres: 'Falta' } } }),
    ).toEqual({ email: 'Mal Peor', nombres: 'Falta' });
    expect(auth.erroresPorCampo(null)).toEqual({});
    expect(auth.erroresPorCampo({ error: { details: 'texto' } })).toEqual({});
  });

  test('mensajeDeLogin y codigoDeError leen el error de la API o dan un texto por defecto', () => {
    expect(auth.mensajeDeLogin({ error: { message: 'Bloqueada' } })).toBe('Bloqueada');
    expect(auth.mensajeDeLogin(new Error('red'))).toMatch(/No pudimos iniciar sesión/);
    expect(auth.codigoDeError({ error: { code: 'x' } })).toBe('x');
    expect(auth.codigoDeError(undefined)).toBeUndefined();
  });
});

describe('authFetch', () => {
  test('sin sesión conectada lanza sin_sesion y no llama a la red', async () => {
    conectarSesion(null);
    await expect(authFetch('/x/')).rejects.toMatchObject({ error: { code: 'sin_sesion' } });
    await expect(authFetchRaw('/x/')).rejects.toMatchObject({ error: { code: 'sin_sesion' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('renueva el token una vez ante 401 y reintenta', async () => {
    const guardar = jest.fn();
    conectarSesion({
      leer: () => ({ access: 'VIEJO', refresh: 'REF' }),
      guardar,
      expirar: jest.fn(),
    });
    fetchMock
      .mockResolvedValueOnce(respuesta({}, 401))
      .mockResolvedValueOnce(respuesta({ access: 'NUEVO' }))
      .mockResolvedValueOnce(respuesta({ dato: 1 }));
    await expect(authFetch('/x/')).resolves.toEqual({ dato: 1 });
    expect(guardar).toHaveBeenCalledWith({ access: 'NUEVO', refresh: 'REF' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('si la renovación falla expira la sesión', async () => {
    const expirar = jest.fn();
    conectarSesion({ leer: () => ({ access: 'A', refresh: 'R' }), guardar: jest.fn(), expirar });
    fetchMock.mockResolvedValueOnce(respuesta({}, 401)).mockResolvedValueOnce(respuesta({}, 401));
    await expect(authFetch('/x/')).rejects.toMatchObject({ error: { code: 'sesion_expirada' } });
    expect(expirar).toHaveBeenCalled();
  });

  test('los errores de la API se propagan con su cuerpo', async () => {
    fetchMock.mockResolvedValueOnce(respuesta({ error: { code: 'prohibido' } }, 403));
    await expect(authFetch('/x/')).rejects.toEqual({ error: { code: 'prohibido' } });
  });

  test('authFetchRaw devuelve la respuesta y renueva ante 401', async () => {
    fetchMock
      .mockResolvedValueOnce(respuesta({}, 401))
      .mockResolvedValueOnce(respuesta({ access: 'N2' }))
      .mockResolvedValueOnce(respuesta({ ok: 1 }));
    const r = await authFetchRaw('/descarga/');
    expect(r.ok).toBe(true);
  });

  test('authFetchRaw propaga el cuerpo de error si la respuesta no es ok', async () => {
    fetchMock.mockResolvedValueOnce(respuesta({ error: { code: 'no_existe' } }, 404));
    await expect(authFetchRaw('/descarga/')).rejects.toBeDefined();
  });
});
