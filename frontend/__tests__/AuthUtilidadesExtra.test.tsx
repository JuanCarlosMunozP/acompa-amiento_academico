import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { reenviarVerificacion, solicitarRecuperacion, verificarCorreo } from '@/api/auth';
import { RecuperarContrasenaScreen } from '@/screens/auth/RecuperarContrasenaScreen';
import { RegistroExitoScreen } from '@/screens/auth/RegistroExitoScreen';
import { VerificarCorreoScreen } from '@/screens/auth/VerificarCorreoScreen';
import { validar } from '@/screens/RegistroScreen';
import { exigirHttps } from '@/api/client';
import { activarBlindaje, silenciarConsola, silenciarRegistrosNativos } from '@/utils/blindaje';
import { obtenerIdDispositivo, reiniciarDispositivoEnMemoria } from '@/utils/dispositivo';

const almacenSeguro: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => almacenSeguro[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    almacenSeguro[k] = v;
  }),
}));
jest.mock('@/api/auth', () => ({
  ...jest.requireActual('@/api/auth'),
  reenviarVerificacion: jest.fn(),
  solicitarRecuperacion: jest.fn(),
  verificarCorreo: jest.fn(),
}));

const reenviarMock = reenviarVerificacion as jest.Mock;
const solicitarMock = solicitarRecuperacion as jest.Mock;
const verificarMock = verificarCorreo as jest.Mock;

afterEach(() => jest.restoreAllMocks());

describe('recuperar contraseña', () => {
  test('tras enviar, "Volver a iniciar sesión" regresa al inicio de la pila', async () => {
    solicitarMock.mockResolvedValue({});
    const navigation = { popToTop: jest.fn() };
    await render(
      <RecuperarContrasenaScreen navigation={navigation as never} route={{} as never} />,
    );
    await fireEvent.changeText(screen.getByLabelText(/correo/i), 'ana@colegio.edu.co');
    await fireEvent.press(screen.getByRole('button', { name: /Enviar/ }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Volver a iniciar sesión' }));
    expect(navigation.popToTop).toHaveBeenCalled();
  });
});

describe('registro exitoso', () => {
  const abrir = async () => {
    const navigation = { popToTop: jest.fn() };
    await render(
      <RegistroExitoScreen
        navigation={navigation as never}
        route={{ params: { email: 'ana@colegio.edu.co' } } as never}
      />,
    );
    return navigation;
  };

  test('reenvía el correo y vuelve al inicio', async () => {
    reenviarMock.mockResolvedValue(undefined);
    const navigation = await abrir();
    await fireEvent.press(screen.getByRole('button', { name: 'Reenviar correo' }));
    expect(await screen.findByText('Listo, te enviamos otro correo.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Volver al inicio' }));
    expect(navigation.popToTop).toHaveBeenCalled();
  });

  test('avisa si el reenvío falla', async () => {
    reenviarMock.mockRejectedValue(new Error('red'));
    await abrir();
    await fireEvent.press(screen.getByRole('button', { name: 'Reenviar correo' }));
    expect(await screen.findByText(/No pudimos reenviar el correo/)).toBeTruthy();
  });
});

describe('verificar correo', () => {
  test('un error sin mensaje usa el texto por defecto y lleva al login', async () => {
    verificarMock.mockRejectedValue(new Error('red'));
    const navigation = { replace: jest.fn() };
    await render(
      <VerificarCorreoScreen
        navigation={navigation as never}
        route={{ params: { token: 'eyJabc' } } as never}
      />,
    );
    expect(await screen.findByText(/No pudimos verificar tu correo/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Ir a iniciar sesión' }));
    expect(navigation.replace).toHaveBeenCalledWith('Login');
  });
});

describe('verificar correo (desmontaje)', () => {
  test('si se sale antes de la respuesta con error, no se actualiza la pantalla', async () => {
    let rechazar: (e: unknown) => void = () => undefined;
    verificarMock.mockReturnValue(new Promise((_ok, no) => (rechazar = no)));
    const vista = await render(
      <VerificarCorreoScreen
        navigation={{ replace: jest.fn() } as never}
        route={{ params: { token: 'eyJabc' } } as never}
      />,
    );
    await vista.unmount();
    rechazar(new Error('tarde'));
    await Promise.resolve();
    expect(verificarMock).toHaveBeenCalled();
  });
});

describe('validación del registro', () => {
  test('señala cada campo obligatorio vacío o inválido', () => {
    const errores = validar({
      nombres: ' ',
      apellidos: '',
      email: 'no-es-correo',
      password: 'corta',
      password_confirmacion: 'otra',
    } as never);
    expect(Object.keys(errores).sort()).toEqual([
      'apellidos',
      'email',
      'nombres',
      'password',
      'password_confirmacion',
    ]);
  });
});

describe('identificador del dispositivo en la web', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
    reiniciarDispositivoEnMemoria();
  });

  test('lo guarda y lo recupera de localStorage', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const datos: Record<string, string> = {};
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => datos[k] ?? null,
        setItem: (k: string, v: string) => {
          datos[k] = v;
        },
      },
    });
    reiniciarDispositivoEnMemoria();
    const id = await obtenerIdDispositivo();
    expect(Object.values(datos)).toContain(id);
    reiniciarDispositivoEnMemoria();
    expect(await obtenerIdDispositivo()).toBe(id);
  });

  test('si localStorage falla el dispositivo sigue identificándose en memoria', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('bloqueado');
        },
        setItem: () => {
          throw new Error('bloqueado');
        },
      },
    });
    reiniciarDispositivoEnMemoria();
    const id = await obtenerIdDispositivo();
    expect(id.length).toBeGreaterThanOrEqual(16);
    expect(await obtenerIdDispositivo()).toBe(id);
  });
});

describe('blindaje con valores por defecto', () => {
  test('silenciarConsola sin argumentos usa la consola real y se puede restaurar', () => {
    const log = console.log;
    const restaurar = silenciarConsola();
    expect(console.log).not.toBe(log);
    restaurar();
    expect(console.log).toBe(log);
  });

  test('activarBlindaje sin ventana disponible no hace nada', () => {
    const quitar = activarBlindaje({ alDetectarHerramientas: jest.fn() });
    expect(typeof quitar).toBe('function');
    quitar();
  });

  test('BLINDAJE_ACTIVO depende del modo de producción', async () => {
    const dev = (globalThis as unknown as { __DEV__: boolean }).__DEV__;
    jest.resetModules();
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
    const produccion = require('@/utils/blindaje') as typeof import('@/utils/blindaje');
    expect(produccion.BLINDAJE_ACTIVO).toBe(true);
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = dev;
    await waitFor(() => expect(produccion.BLINDAJE_ACTIVO).toBe(true));
  });
});

describe('seguridad del APK', () => {
  test('silenciarRegistrosNativos apaga la consola sin avisos y se restaura', () => {
    const consola = { log: jest.fn(), warn: jest.fn(), otro: 1 };
    const original = consola.log;
    const restaurar = silenciarRegistrosNativos(consola as never);
    consola.log('secreto');
    expect(original).not.toHaveBeenCalled();
    expect(consola.warn).not.toBe(undefined);
    restaurar();
    expect(consola.log).toBe(original);
  });

  test('silenciarRegistrosNativos usa la consola real por defecto', () => {
    const log = console.log;
    const restaurar = silenciarRegistrosNativos();
    expect(console.log).not.toBe(log);
    restaurar();
    expect(console.log).toBe(log);
  });

  test('en la app instalada solo se acepta HTTPS', () => {
    expect(() => exigirHttps('http://api.colegio.edu.co/api', true)).toThrow(/HTTPS/);
    expect(() => exigirHttps('https://api.colegio.edu.co/api', true)).not.toThrow();
    expect(() => exigirHttps('http://localhost:8001/api', false)).not.toThrow();
  });
});
