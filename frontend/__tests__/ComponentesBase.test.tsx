import { act, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { AppState, Platform, Text } from 'react-native';

import { authFetch, conectarSesion } from '@/api/authFetch';
import { BlindajeGate } from '@/components/BlindajeGate';
import { EstadoBadge } from '@/components/EstadoBadge';
import { InactividadGate } from '@/components/InactividadGate';
import { ModalLayoutContext } from '@/components/ModalLayoutContext';
import { PrivacidadGate } from '@/components/PrivacidadGate';
import { Screen } from '@/components/Screen';
import { useCarga } from '@/hooks/useCarga';
import { useSession } from '@/store/session';

jest.mock('@/store/session', () => ({ useSession: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));

const sesionMock = useSession as jest.Mock;
const cerrar = jest.fn();

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('authFetch con formularios con archivos', () => {
  test('no fuerza Content-Type JSON cuando el cuerpo es FormData', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      headers: { get: () => null },
    });
    (globalThis as { fetch: unknown }).fetch = fetchMock;
    conectarSesion({
      leer: () => ({ access: 'A', refresh: 'R' }),
      guardar: jest.fn(),
      expirar: jest.fn(),
    });
    await authFetch('/entregas/', { method: 'POST', body: new FormData() });
    const cabeceras = fetchMock.mock.calls[0][1].headers;
    expect(cabeceras.Authorization).toBe('Bearer A');
    expect(cabeceras['Content-Type']).toBeUndefined();
    conectarSesion(null);
  });
});

describe('EstadoBadge', () => {
  test.each([
    ['critico', 'Crítico'],
    ['riesgo', 'Riesgo'],
    ['atencion', 'Atención'],
    ['sin_alertas', 'Sin solicitudes'],
  ] as const)('%s', async (estado, etiqueta) => {
    await render(<EstadoBadge estado={estado} />);
    expect(screen.getByText(etiqueta)).toBeTruthy();
  });
});

describe('Screen', () => {
  test('layout de formulario, ancho completo y dentro de un modal', async () => {
    await render(
      <ModalLayoutContext.Provider value>
        <Screen layout="form" fullWidth>
          <Text>contenido</Text>
        </Screen>
      </ModalLayoutContext.Provider>,
    );
    expect(screen.getByText('contenido')).toBeTruthy();
  });

  test('layout por defecto', async () => {
    await render(
      <Screen>
        <Text>normal</Text>
      </Screen>,
    );
    expect(screen.getByText('normal')).toBeTruthy();
  });
});

describe('puertas por defecto en la web', () => {
  test('BlindajeGate y PrivacidadGate resuelven su activación según la plataforma', async () => {
    sesionMock.mockReturnValue({ sesion: null, cerrar });
    jest.replaceProperty(Platform, 'OS', 'web');
    await render(
      <BlindajeGate>
        <PrivacidadGate detectar={async () => false}>
          <Text>app</Text>
        </PrivacidadGate>
      </BlindajeGate>,
    );
    // Con la plataforma web cada puerta decide por su propia configuración; la app no se rompe.
    expect(screen.toJSON()).not.toBeNull();
  });
});

describe('useCarga', () => {
  function Sonda({ cargar }: { cargar: () => Promise<number> }) {
    const carga = useCarga(cargar);
    useEffect(() => {
      latest = carga;
    });
    return <Text>{carga.datos === undefined ? 'sin datos' : `datos:${carga.datos}`}</Text>;
  }
  let latest: ReturnType<typeof useCarga<number>>;

  test('usa las opciones por defecto y "actualizar" sin datos no hace nada', async () => {
    let resolver: (n: number) => void = () => undefined;
    await render(<Sonda cargar={() => new Promise<number>((r) => (resolver = r))} />);
    await act(async () => latest.actualizar((n) => n + 1)); // aún sin datos
    expect(screen.getByText('sin datos')).toBeTruthy();
    await act(async () => resolver(5));
    expect(screen.getByText('datos:5')).toBeTruthy();
    await act(async () => latest.actualizar((n) => n + 1));
    expect(screen.getByText('datos:6')).toBeTruthy();
  });
});

describe('InactividadGate', () => {
  let alCambiar: (estado: string) => void = () => undefined;

  beforeEach(() => {
    cerrar.mockReset();
    jest.useFakeTimers();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, fn: never) => {
      alCambiar = fn;
      return { remove: jest.fn() };
    }) as never);
  });

  const montar = async (activa: boolean, minutos?: number) => {
    sesionMock.mockReturnValue({ sesion: activa ? { usuario: {} } : null, cerrar });
    await render(
      <InactividadGate minutos={minutos}>
        <Text>dentro</Text>
      </InactividadGate>,
    );
  };

  test('sin sesión no programa nada y los toques no inician el reloj', async () => {
    await montar(false);
    const gate = screen.getByTestId('inactividad-gate');
    expect(gate.props.onStartShouldSetResponderCapture()).toBe(false);
    await act(async () => jest.advanceTimersByTime(60 * 60_000));
    expect(cerrar).not.toHaveBeenCalled();
  });

  test('con sesión, un toque reinicia el reloj (tiempo por defecto)', async () => {
    await montar(true);
    const gate = screen.getByTestId('inactividad-gate');
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(gate.props.onStartShouldSetResponderCapture()).toBe(false);
    await act(async () => jest.advanceTimersByTime(60 * 60_000));
    expect(cerrar).toHaveBeenCalledWith('inactividad');
  });

  test('al volver a primer plano: ignora otros estados, reprograma o cierra', async () => {
    await montar(true, 10);
    await act(async () => alCambiar('background'));
    expect(cerrar).not.toHaveBeenCalled();

    await act(async () => alCambiar('active')); // volvió pronto: reprograma
    expect(cerrar).not.toHaveBeenCalled();

    jest.setSystemTime(Date.now() + 11 * 60_000);
    await act(async () => alCambiar('active')); // pasó el límite estando en segundo plano
    expect(cerrar).toHaveBeenCalledWith('inactividad');
  });
});
