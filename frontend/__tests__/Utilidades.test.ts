import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { navigationRef, irAlLogin } from '@/navigation/ref';
import { abrirParaImprimir, elegirArchivo, guardarRespuesta } from '@/utils/archivos';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  EncodingType: { Base64: 'base64' },
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

const picker = DocumentPicker.getDocumentAsync as jest.Mock;
const disponible = Sharing.isAvailableAsync as jest.Mock;
const compartir = Sharing.shareAsync as jest.Mock;
const escribir = FileSystem.writeAsStringAsync as jest.Mock;

function respuesta(contenido: string, disposition: string | null = null) {
  const bytes = new TextEncoder().encode(contenido);
  return {
    headers: { get: (k: string) => (k === 'Content-Disposition' ? disposition : null) },
    blob: async () => new Blob([contenido]),
    arrayBuffer: async () => bytes.buffer,
  } as unknown as Response;
}

function conPlataforma(os: 'web' | 'android') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

afterEach(() => {
  jest.clearAllMocks();
  conPlataforma('android');
});

describe('elegirArchivo', () => {
  test('devuelve null si el usuario cancela', async () => {
    picker.mockResolvedValue({ canceled: true });
    expect(await elegirArchivo()).toBeNull();
  });

  test('en móvil arma el formulario con uri, nombre y tipo', async () => {
    conPlataforma('android');
    picker.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///a.pdf', name: 'a.pdf', mimeType: 'application/pdf' }],
    });
    const r = await elegirArchivo();
    expect(r?.nombre).toBe('a.pdf');
    expect(r?.formulario.get('archivo')).toBeTruthy();
  });

  test('sin tipo MIME usa application/octet-stream', async () => {
    conPlataforma('android');
    picker.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///b', name: 'b' }] });
    const r = await elegirArchivo();
    expect(r?.nombre).toBe('b');
  });

  test('en web usa el File nativo cuando existe', async () => {
    conPlataforma('web');
    const file = new File(['x'], 'w.pdf', { type: 'application/pdf' });
    picker.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:x', name: 'w.pdf', file }],
    });
    const r = await elegirArchivo();
    expect((r?.formulario.get('archivo') as File).name).toBe('w.pdf');
  });
});

describe('guardarRespuesta', () => {
  test('en móvil escribe el archivo con el nombre de la cabecera y abre el menú de compartir', async () => {
    conPlataforma('android');
    disponible.mockResolvedValue(true);
    await guardarRespuesta(respuesta('hola', 'attachment; filename="in:forme*.csv"'), 'alt.csv');
    const [uri, base64] = escribir.mock.calls[0];
    expect(uri).toBe('file:///cache/in_forme_.csv'); // caracteres inválidos saneados
    expect(base64).toBe(btoa('hola'));
    expect(compartir).toHaveBeenCalledWith(uri);
  });

  test('usa el nombre alternativo si no hay cabecera', async () => {
    conPlataforma('android');
    disponible.mockResolvedValue(true);
    await guardarRespuesta(respuesta('x'), 'alterno.csv');
    expect(escribir.mock.calls[0][0]).toBe('file:///cache/alterno.csv');
  });

  test('si compartir no está disponible solo guarda', async () => {
    conPlataforma('android');
    disponible.mockResolvedValue(false);
    await guardarRespuesta(respuesta('x'), 'a.csv');
    expect(escribir).toHaveBeenCalled();
    expect(compartir).not.toHaveBeenCalled();
  });

  test('en web dispara una descarga con el nombre correcto', async () => {
    conPlataforma('web');
    jest.useFakeTimers();
    const crear = jest.fn().mockReturnValue('blob:abc');
    const revocar = jest.fn();
    Object.assign(URL, { createObjectURL: crear, revokeObjectURL: revocar });
    const clic = jest.fn();
    const enlace = { click: clic } as unknown as HTMLAnchorElement;
    (globalThis as { document?: unknown }).document = { createElement: () => enlace };
    await guardarRespuesta(respuesta('x', 'attachment; filename=reporte.csv'), 'alt.csv');
    expect(enlace.download).toBe('reporte.csv');
    expect(enlace.href).toBe('blob:abc');
    expect(clic).toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(revocar).toHaveBeenCalledWith('blob:abc');
    jest.useRealTimers();
    delete (globalThis as { document?: unknown }).document;
  });
});

describe('abrirParaImprimir', () => {
  test('en web abre una pestaña nueva sin referrer ni opener', async () => {
    conPlataforma('web');
    jest.useFakeTimers();
    Object.assign(URL, {
      createObjectURL: jest.fn().mockReturnValue('blob:print'),
      revokeObjectURL: jest.fn(),
    });
    const abrir = jest.fn();
    (globalThis as { window?: unknown }).window = { open: abrir };
    await abrirParaImprimir(respuesta('<html/>'), 'r.html');
    expect(abrir).toHaveBeenCalledWith('blob:print', '_blank', 'noopener');
    jest.advanceTimersByTime(60000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:print');
    jest.useRealTimers();
  });

  test('en móvil lo comparte como archivo', async () => {
    conPlataforma('android');
    disponible.mockResolvedValue(true);
    await abrirParaImprimir(respuesta('<html/>'), 'r.html');
    expect(escribir.mock.calls[0][0]).toBe('file:///cache/r.html');
    expect(compartir).toHaveBeenCalled();
  });
});

describe('navegación', () => {
  const reset = jest.fn();

  beforeEach(() => {
    reset.mockClear();
    jest.spyOn(navigationRef, 'resetRoot').mockImplementation(reset);
  });

  afterEach(() => jest.restoreAllMocks());

  test('sin navegador listo no hace nada', () => {
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(false);
    irAlLogin();
    expect(reset).not.toHaveBeenCalled();
  });

  test('irAlLogin deja solo el inicio de sesión, sin historial', () => {
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(true);
    irAlLogin();
    expect(reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Login' }] });
  });
});
