import { render, screen } from '@testing-library/react-native';
import { Platform, Text } from 'react-native';

import { PrivacidadGate } from '@/components/PrivacidadGate';
import { activarBlindaje, esAtajoDeHerramientas, silenciarConsola } from '@/utils/blindaje';
import { esNavegacionPrivada } from '@/utils/privacidad';

const global_ = globalThis as Record<string, unknown>;

function conGlobal<T>(nombre: string, valor: unknown, fn: () => Promise<T> | T) {
  const original = Object.getOwnPropertyDescriptor(globalThis, nombre);
  Object.defineProperty(globalThis, nombre, { value: valor, configurable: true, writable: true });
  const restaurar = () => {
    if (original) Object.defineProperty(globalThis, nombre, original);
    else delete global_[nombre];
  };
  return Promise.resolve().then(fn).finally(restaurar);
}

// ------------------------------------------------------------------ detección de incógnito

describe('esNavegacionPrivada', () => {
  afterEach(() => jest.restoreAllMocks());

  test('fuera de la web nunca bloquea', async () => {
    expect(await esNavegacionPrivada()).toBe(false);
  });

  describe('en la web', () => {
    beforeEach(() => {
      jest.replaceProperty(Platform, 'OS', 'web');
    });

    test('cuota reducida = ventana privada', async () => {
      const nav = { storage: { estimate: async () => ({ quota: 50 * 1024 * 1024 }) } };
      await conGlobal('navigator', nav, async () => expect(await esNavegacionPrivada()).toBe(true));
    });

    test('cuota normal = navegación normal', async () => {
      const nav = { storage: { estimate: async () => ({ quota: 300 * 1024 ** 3 }) } };
      await conGlobal('navigator', nav, async () =>
        expect(await esNavegacionPrivada()).toBe(false),
      );
    });

    test('sin API de almacenamiento o sin cuota, no bloquea', async () => {
      await conGlobal('navigator', {}, async () => expect(await esNavegacionPrivada()).toBe(false));
      const sinCuota = { storage: { estimate: async () => ({}) } };
      await conGlobal('navigator', sinCuota, async () =>
        expect(await esNavegacionPrivada()).toBe(false),
      );
    });

    test('si la comprobación falla, no bloquea al usuario', async () => {
      const nav = {
        storage: {
          estimate: async () => {
            throw new Error('x');
          },
        },
      };
      await conGlobal('navigator', nav, async () =>
        expect(await esNavegacionPrivada()).toBe(false),
      );
    });

    test('Firefox privado rechaza IndexedDB', async () => {
      const nav = { userAgent: 'Mozilla Firefox/130', storage: {} };
      const abre = (fallo: 'error' | 'ok' | 'lanza') => ({
        open: () => {
          if (fallo === 'lanza') throw new Error('InvalidStateError');
          const peticion: { result: { close: jest.Mock }; [k: string]: unknown } = {
            result: { close: jest.fn() },
          };
          setTimeout(() => {
            const manejador = fallo === 'error' ? peticion.onerror : peticion.onsuccess;
            (manejador as (() => void) | undefined)?.();
          }, 0);
          return peticion;
        },
      });
      await conGlobal('navigator', nav, async () => {
        await conGlobal('indexedDB', abre('error'), async () =>
          expect(await esNavegacionPrivada()).toBe(true),
        );
        await conGlobal('indexedDB', abre('lanza'), async () =>
          expect(await esNavegacionPrivada()).toBe(true),
        );
        await conGlobal('indexedDB', abre('ok'), async () =>
          expect(await esNavegacionPrivada()).toBe(false),
        );
      });
    });

    test('un navegador que no es Firefox no consulta IndexedDB', async () => {
      const nav = { userAgent: 'Chrome/130', storage: {} };
      await conGlobal('navigator', nav, async () =>
        conGlobal('indexedDB', {}, async () => expect(await esNavegacionPrivada()).toBe(false)),
      );
    });
  });
});

// ------------------------------------------------------------------ pantalla de rechazo

describe('PrivacidadGate', () => {
  const hijo = <Text>contenido privado</Text>;

  test('inactivo: muestra la app sin comprobar nada', async () => {
    const detectar = jest.fn();
    await render(
      <PrivacidadGate activo={false} detectar={detectar}>
        {hijo}
      </PrivacidadGate>,
    );
    expect(screen.getByText('contenido privado')).toBeTruthy();
    expect(detectar).not.toHaveBeenCalled();
  });

  test('ventana privada: conexión rechazada y la app no se monta', async () => {
    await render(
      <PrivacidadGate activo detectar={async () => true}>
        {hijo}
      </PrivacidadGate>,
    );
    expect(await screen.findByTestId('conexion-rechazada')).toBeTruthy();
    expect(screen.getByText('ERR_CONNECTION_REFUSED')).toBeTruthy();
    expect(screen.getByText(/rechazó la conexión/)).toBeTruthy();
    expect(screen.queryByText('contenido privado')).toBeNull();
  });

  test('muestra el nombre del sitio cuando existe', async () => {
    await conGlobal('location', { hostname: 'tutorias.colegio.edu.co' }, async () => {
      await render(
        <PrivacidadGate activo detectar={async () => true}>
          {hijo}
        </PrivacidadGate>,
      );
      expect(await screen.findByText('tutorias.colegio.edu.co rechazó la conexión.')).toBeTruthy();
    });
  });

  test('mientras comprueba no muestra la app; navegación normal entra', async () => {
    let resolver: (v: boolean) => void = () => undefined;
    const pendiente = new Promise<boolean>((r) => (resolver = r));
    await render(
      <PrivacidadGate activo detectar={() => pendiente}>
        {hijo}
      </PrivacidadGate>,
    );
    expect(screen.getByTestId('privacidad-comprobando')).toBeTruthy();
    expect(screen.queryByText('contenido privado')).toBeNull();
    resolver(false);
    expect(await screen.findByText('contenido privado')).toBeTruthy();
  });

  test('si la detección falla, el usuario registrado no queda bloqueado', async () => {
    await render(
      <PrivacidadGate
        activo
        detectar={async () => {
          throw new Error('x');
        }}
      >
        {hijo}
      </PrivacidadGate>,
    );
    expect(await screen.findByText('contenido privado')).toBeTruthy();
  });

  test('desmontar antes de resolver no actualiza el estado', async () => {
    let resolver: (v: boolean) => void = () => undefined;
    const pendiente = new Promise<boolean>((r) => (resolver = r));
    const vista = await render(
      <PrivacidadGate activo detectar={() => pendiente}>
        {hijo}
      </PrivacidadGate>,
    );
    await vista.unmount();
    resolver(true);
    await pendiente;
  });

  test('por defecto está inactivo fuera de la web', async () => {
    await render(<PrivacidadGate>{hijo}</PrivacidadGate>);
    expect(screen.getByText('contenido privado')).toBeTruthy();
  });
});

// ------------------------------------------------------------------ blindaje de la consola

describe('silenciarConsola', () => {
  test('anula los métodos, avisa del self-XSS y se puede restaurar', () => {
    const aviso = jest.fn();
    const log = jest.fn();
    const consola: Record<string, unknown> = { warn: aviso, log, error: jest.fn(), table: 'no' };
    const restaurar = silenciarConsola(consola);
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(String(aviso.mock.calls[0][0])).toContain('Detente');
    (consola.log as () => void)();
    expect(log).not.toHaveBeenCalled();
    expect(consola.table).toBe('no');
    restaurar();
    expect(consola.log).toBe(log);
  });

  test('tolera una consola sin warn', () => {
    const restaurar = silenciarConsola({ log: jest.fn() });
    restaurar();
  });
});

describe('esAtajoDeHerramientas', () => {
  const e = (key: string, extra = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...extra,
  });

  test.each([
    [e('F12'), true],
    [e('I', { ctrlKey: true, shiftKey: true }), true],
    [e('j', { metaKey: true, shiftKey: true }), true],
    [e('c', { ctrlKey: true, shiftKey: true }), true],
    [e('i', { metaKey: true, altKey: true }), true],
    [e('u', { ctrlKey: true }), true],
    [e('U', { metaKey: true }), true],
    [e('u', { ctrlKey: true, shiftKey: true }), false],
    [e('a', { ctrlKey: true }), false],
    [e('i', { shiftKey: true }), false],
    [e('Enter'), false],
  ])('%j -> %s', (evento, esperado) => {
    expect(esAtajoDeHerramientas(evento)).toBe(esperado);
  });
});

type Manejador = (e: Record<string, unknown>) => void;

function crearVentana(opciones: { top?: unknown; topLanza?: boolean } = {}) {
  const manejadores: Record<string, Manejador[]> = {};
  const abierta = { valor: false };
  const consola = {
    warn: jest.fn(),
    log: jest.fn(),
    debug: jest.fn((x: { id?: string }) => {
      if (abierta.valor) void x.id; // la consola abierta lee las propiedades del objeto
    }),
  };
  let tick: () => void = () => undefined;
  const ventana: Record<string, unknown> = {
    document: {
      addEventListener: (t: string, f: Manejador) => (manejadores[t] ??= []).push(f),
      removeEventListener: (t: string, f: Manejador) => {
        manejadores[t] = (manejadores[t] ?? []).filter((x) => x !== f);
      },
      createElement: () => ({}),
    },
    console: consola,
    location: { href: 'https://app/' },
    setInterval: (f: () => void) => {
      tick = f;
      return 7;
    },
    clearInterval: jest.fn(),
  };
  ventana.self = ventana;
  if (opciones.topLanza) {
    Object.defineProperty(ventana, 'top', {
      get() {
        throw new Error('cross-origin');
      },
    });
  } else {
    ventana.top = opciones.top ?? ventana;
  }
  return { ventana, manejadores, abierta, consola, tick: () => tick() };
}

describe('activarBlindaje', () => {
  test('sin documento no hace nada', () => {
    const quitar = activarBlindaje({
      alDetectarHerramientas: jest.fn(),
      ventana: {} as never,
    });
    expect(quitar()).toBeUndefined();
  });

  test('bloquea atajos y menú contextual salvo en campos de texto', () => {
    const v = crearVentana();
    const quitar = activarBlindaje({
      alDetectarHerramientas: jest.fn(),
      ventana: v.ventana as never,
    });
    const evento = (extra: object) => ({
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      ...extra,
    });
    const f12 = evento({
      key: 'F12',
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    });
    v.manejadores.keydown[0](f12);
    expect(f12.preventDefault).toHaveBeenCalled();
    const normal = evento({
      key: 'a',
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    });
    v.manejadores.keydown[0](normal);
    expect(normal.preventDefault).not.toHaveBeenCalled();

    const sobreDiv = evento({ target: { tagName: 'DIV' } });
    v.manejadores.contextmenu[0](sobreDiv);
    expect(sobreDiv.preventDefault).toHaveBeenCalled();
    for (const etiqueta of ['INPUT', 'TEXTAREA']) {
      const sobreCampo = evento({ target: { tagName: etiqueta } });
      v.manejadores.contextmenu[0](sobreCampo);
      expect(sobreCampo.preventDefault).not.toHaveBeenCalled();
    }
    const sinDestino = evento({ target: null });
    v.manejadores.contextmenu[0](sinDestino);
    expect(sinDestino.preventDefault).toHaveBeenCalled();

    quitar();
    expect(v.manejadores.keydown).toEqual([]);
    expect(v.manejadores.contextmenu).toEqual([]);
    expect(v.ventana.clearInterval).toHaveBeenCalledWith(7);
  });

  test('detecta la consola abierta una vez por apertura', () => {
    const v = crearVentana();
    const alDetectar = jest.fn();
    activarBlindaje({ alDetectarHerramientas: alDetectar, ventana: v.ventana as never });
    v.tick();
    expect(alDetectar).not.toHaveBeenCalled();
    v.abierta.valor = true;
    v.tick();
    v.tick();
    expect(alDetectar).toHaveBeenCalledTimes(1);
    v.abierta.valor = false;
    v.tick();
    v.abierta.valor = true;
    v.tick();
    expect(alDetectar).toHaveBeenCalledTimes(2);
  });

  test('la consola queda silenciada mientras está activo y se restaura al salir', () => {
    const v = crearVentana();
    const original = v.consola.log;
    const quitar = activarBlindaje({
      alDetectarHerramientas: jest.fn(),
      ventana: v.ventana as never,
    });
    expect(v.consola.log).not.toBe(original);
    quitar();
    expect(v.consola.log).toBe(original);
  });

  test('sale de un marco ajeno (clickjacking)', () => {
    const top = { location: { href: '' } };
    const v = crearVentana({ top });
    activarBlindaje({ alDetectarHerramientas: jest.fn(), ventana: v.ventana as never });
    expect(top.location.href).toBe('https://app/');
  });

  test('un marco de otro origen no rompe la app', () => {
    const v = crearVentana({ topLanza: true });
    expect(() =>
      activarBlindaje({ alDetectarHerramientas: jest.fn(), ventana: v.ventana as never }),
    ).not.toThrow();
  });
});
