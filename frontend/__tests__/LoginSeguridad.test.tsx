/**
 * Seguridad del login: la contraseña no debe filtrarse a logs, almacenamiento,
 * mensajes de error ni quedar en memoria más de lo necesario, y el repositorio
 * no debe contener credenciales.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { iniciarSesionApi, verificarMfaApi } from '@/api/auth';
import { LoginScreen } from '@/screens/LoginScreen';
import { SessionProvider } from '@/store/session';

// El proyecto no incluye @types/node: se declaran solo los globales que usan estas pruebas.
declare const __dirname: string;
declare const require: (modulo: string) => any;
const fs = require('fs');
const path = require('path');

const mockSetItem = jest.fn().mockResolvedValue(undefined);
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: (...args: unknown[]) => mockSetItem(...args),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));

jest.mock('@/api/auth', () => ({
  ...jest.requireActual('@/api/auth'),
  iniciarSesionApi: jest.fn(),
  verificarMfaApi: jest.fn(),
}));
jest.mock('@/api/client', () => ({
  ...jest.requireActual('@/api/client'),
  precalentarApi: jest.fn(),
}));

const loginMock = iniciarSesionApi as jest.Mock;
const mfaMock = verificarMfaApi as jest.Mock;
const route = { key: 'Login', name: 'Login' } as never;

// Valor de prueba inventado; no corresponde a ninguna cuenta real.
const CLAVE_PRUEBA = 'Zx9-clave-de-prueba-NO-REAL';
const EMAIL_PRUEBA = 'persona.prueba@example.test';

async function setup() {
  const navigation = { replace: jest.fn(), navigate: jest.fn() };
  await render(
    <SessionProvider>
      <LoginScreen navigation={navigation as never} route={route} />
    </SessionProvider>,
  );
  return navigation;
}

async function llenar(email = EMAIL_PRUEBA, password = CLAVE_PRUEBA) {
  await fireEvent.changeText(screen.getByLabelText('Correo institucional'), email);
  await fireEvent.changeText(screen.getByLabelText('Contraseña'), password);
  await fireEvent.press(screen.getByRole('button', { name: 'Entrar' }));
}

let espias: jest.SpyInstance[] = [];

beforeEach(() => {
  loginMock.mockReset();
  mfaMock.mockReset();
  mockSetItem.mockClear();
  espias = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    jest.spyOn(console, m).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  espias.forEach((e) => e.mockRestore());
});

function textoDeConsola(): string {
  return espias
    .flatMap((e) => e.mock.calls)
    .map((args) =>
      args.map((a: unknown) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
    )
    .join('\n');
}

describe('campo de contraseña', () => {
  test('oculta lo escrito y evita autocorrección', async () => {
    await setup();
    const campo = screen.getByLabelText('Contraseña');
    expect(campo.props.secureTextEntry).toBe(true);
    expect(campo.props.autoComplete).toBe('password');
    expect(campo.props.autoCapitalize).toBe('none');
  });

  test('el correo no se oculta pero tampoco se autocapitaliza', async () => {
    await setup();
    const campo = screen.getByLabelText('Correo institucional');
    expect(campo.props.secureTextEntry).toBeFalsy();
    expect(campo.props.autoCapitalize).toBe('none');
  });

  test('no muestra la contraseña escrita en ningún texto visible', async () => {
    await setup();
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), CLAVE_PRUEBA);
    expect(screen.queryByText(CLAVE_PRUEBA)).toBeNull();
  });
});

describe('la contraseña no se filtra', () => {
  test('un login fallido no la repite en el mensaje ni en la consola', async () => {
    loginMock.mockRejectedValue({
      error: { code: 'credenciales_invalidas', message: 'Correo o contraseña incorrectos.' },
    });
    await setup();
    await llenar();

    expect(await screen.findByText('Correo o contraseña incorrectos.')).toBeTruthy();
    expect(screen.queryByText(new RegExp(CLAVE_PRUEBA))).toBeNull();
    expect(textoDeConsola()).not.toContain(CLAVE_PRUEBA);
  });

  test('un fallo de red tampoco la deja en consola ni en pantalla', async () => {
    loginMock.mockRejectedValue(new TypeError('Network request failed'));
    await setup();
    await llenar();

    expect(await screen.findByText(/No pudimos iniciar sesión/)).toBeTruthy();
    expect(screen.queryByText(new RegExp(CLAVE_PRUEBA))).toBeNull();
    expect(textoDeConsola()).not.toContain(CLAVE_PRUEBA);
  });

  test('un login exitoso no guarda la contraseña en el almacenamiento seguro', async () => {
    loginMock.mockResolvedValue({
      access: 'tok-acceso',
      refresh: 'tok-refresco',
      usuario: { id: 1, email: EMAIL_PRUEBA, nombres: 'Persona' },
    });
    const navigation = await setup();
    await llenar();

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Home'));
    expect(mockSetItem).toHaveBeenCalled();
    for (const llamada of mockSetItem.mock.calls) {
      expect(JSON.stringify(llamada)).not.toContain(CLAVE_PRUEBA);
    }
    expect(textoDeConsola()).not.toContain(CLAVE_PRUEBA);
  });

  test('la sesión se guarda solo en el almacén seguro y limitada a este dispositivo', async () => {
    loginMock.mockResolvedValue({
      access: 'a',
      refresh: 'r',
      usuario: { id: 1, email: EMAIL_PRUEBA, nombres: 'Persona' },
    });
    const navigation = await setup();
    await llenar();

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Home'));
    const opciones = mockSetItem.mock.calls[0][2];
    expect(opciones).toEqual({ keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' });
  });

  test('no escribe en localStorage durante el login', async () => {
    const setItem = jest.fn();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: jest.fn(() => null), setItem, removeItem: jest.fn() },
    });
    try {
      loginMock.mockResolvedValue({
        access: 'a',
        refresh: 'r',
        usuario: { id: 1, email: EMAIL_PRUEBA, nombres: 'Persona' },
      });
      const navigation = await setup();
      await llenar();
      await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Home'));

      for (const llamada of setItem.mock.calls) {
        expect(JSON.stringify(llamada)).not.toContain(CLAVE_PRUEBA);
        expect(JSON.stringify(llamada)).not.toContain('tok');
      }
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('contraseña en memoria', () => {
  test('al pasar al segundo factor se borra el campo de contraseña', async () => {
    loginMock.mockResolvedValue({ mfa_requerido: true, mfa_token: 'desafio-firmado' });
    await setup();
    await llenar();

    await screen.findByText('Verificación en dos pasos');
    // El formulario inicial ya no está y la contraseña no se reenvía al verificar el código.
    expect(screen.queryByLabelText('Contraseña')).toBeNull();
    mfaMock.mockResolvedValue({ access: 'a', refresh: 'r', usuario: { id: 1, nombres: 'P' } });
    await fireEvent.changeText(screen.getByLabelText('Código de verificación'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: /verificar|continuar|entrar/i }));

    await waitFor(() => expect(mfaMock).toHaveBeenCalled());
    expect(JSON.stringify(mfaMock.mock.calls)).not.toContain(CLAVE_PRUEBA);
  });

  test('si el segundo factor vence, al volver el campo de contraseña está vacío', async () => {
    loginMock.mockResolvedValue({ mfa_requerido: true, mfa_token: 'desafio-firmado' });
    mfaMock.mockRejectedValue({
      error: { code: 'desafio_expirado', message: 'El desafío venció. Inicia de nuevo.' },
    });
    await setup();
    await llenar();
    await screen.findByText('Verificación en dos pasos');

    await fireEvent.changeText(screen.getByLabelText('Código de verificación'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: /verificar|continuar|entrar/i }));

    expect(await screen.findByText('El desafío venció. Inicia de nuevo.')).toBeTruthy();
    expect(screen.getByLabelText('Contraseña').props.value).toBe('');
  });
});

describe('validación local', () => {
  test('con campos vacíos no se envía nada al servidor', async () => {
    await setup();
    await fireEvent.press(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('Ingresa tu correo.')).toBeTruthy();
    expect(loginMock).not.toHaveBeenCalled();
  });

  test('el correo se recorta pero la contraseña se envía tal cual (sin alterarla)', async () => {
    loginMock.mockRejectedValue({ error: { code: 'x', message: 'Error.' } });
    await setup();
    await llenar(`  ${EMAIL_PRUEBA}  `, ` ${CLAVE_PRUEBA} `);

    await waitFor(() => expect(loginMock).toHaveBeenCalled());
    expect(loginMock).toHaveBeenCalledWith({
      email: EMAIL_PRUEBA,
      password: ` ${CLAVE_PRUEBA} `,
    });
  });

  test('un segundo toque mientras envía no repite la petición (evita doble envío)', async () => {
    let resolver: (v: unknown) => void = () => undefined;
    loginMock.mockReturnValue(new Promise((r) => (resolver = r)));
    await setup();
    await fireEvent.changeText(screen.getByLabelText('Correo institucional'), EMAIL_PRUEBA);
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), CLAVE_PRUEBA);
    const boton = screen.getByRole('button', { name: 'Entrar' });
    // Sin await: la primera petición queda pendiente y bloquearía el act() de la prueba.
    const primero = fireEvent.press(boton);
    await waitFor(() => expect(loginMock).toHaveBeenCalled());
    const segundo = fireEvent.press(boton); // el usuario toca otra vez tras ver el cambio a "enviando"
    expect(loginMock).toHaveBeenCalledTimes(1);
    resolver({ access: 'a', refresh: 'r', usuario: { id: 1, nombres: 'P' } });
    await Promise.all([primero, segundo]);
    await waitFor(() => expect(mockSetItem).toHaveBeenCalled());
  });
});

describe('higiene del repositorio', () => {
  const raiz = path.resolve(__dirname, '..');
  const repo = path.resolve(raiz, '..');

  function archivosFuente(dir: string, salida: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const ruta = path.join(dir, e.name);
      if (e.isDirectory()) archivosFuente(ruta, salida);
      else if (/\.(ts|tsx|js|json)$/.test(e.name)) salida.push(ruta);
    }
    return salida;
  }

  test('el código fuente del frontend no trae contraseñas ni tokens escritos a mano', () => {
    const patrones = [
      /(password|passwd|secret)\s*[:=]\s*['"][^'"\s]{6,}['"]/i,
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWT
      /AKIA[0-9A-Z]{16}/, // clave de AWS
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /xkeysib-[A-Za-z0-9-]{20,}/, // clave de Brevo
    ];
    const hallazgos: string[] = [];
    for (const archivo of archivosFuente(path.join(raiz, 'src'))) {
      const contenido = fs.readFileSync(archivo, 'utf8');
      for (const p of patrones) {
        if (p.test(contenido)) hallazgos.push(`${path.relative(raiz, archivo)} -> ${p}`);
      }
    }
    expect(hallazgos).toEqual([]);
  });

  test('la pantalla de login no trae credenciales precargadas', () => {
    const fuente = fs.readFileSync(path.join(raiz, 'src', 'screens', 'LoginScreen.tsx'), 'utf8');
    expect(fuente).toMatch(/useState\(''\)/);
    expect(fuente).not.toMatch(/setEmail\(\s*['"][^'"]+['"]\s*\)/);
    expect(fuente).not.toMatch(/setPassword\(\s*['"][^'"]+['"]\s*\)/);
  });

  test('.gitignore excluye archivos sensibles', () => {
    const ruta = path.join(repo, '.gitignore');
    if (!fs.existsSync(ruta)) return; // el frontend puede ejecutarse fuera del monorepo
    const lineas = fs
      .readFileSync(ruta, 'utf8')
      .split(/\r?\n/)
      .map((l: string) => l.trim());
    for (const requerido of ['.env', '.env.*', '!.env.example', 'backups/', '*.sql', '*.dump']) {
      expect(lineas).toContain(requerido);
    }
    expect(lineas.some((l: string) => l.startsWith('credenciales'))).toBe(true);
    expect(lineas).toContain('*.pem');
    expect(lineas).toContain('*.key');
  });

  test('.env.example solo trae valores de ejemplo, no secretos reales', () => {
    const ruta = path.join(raiz, '.env.example');
    if (!fs.existsSync(ruta)) return;
    const contenido = fs.readFileSync(ruta, 'utf8');
    expect(contenido).not.toMatch(/(password|secret|token|key)\s*=\s*[A-Za-z0-9+/_-]{20,}/i);
  });
});
