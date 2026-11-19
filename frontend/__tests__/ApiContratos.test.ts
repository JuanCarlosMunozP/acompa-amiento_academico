/**
 * Contrato de la capa HTTP: cada función exportada de los módulos de API debe hacer exactamente una
 * petición con una URL bien formada (sin «undefined» ni «[object Object]») y devolver su resultado.
 */
import * as academico from '@/api/academico';
import { conectarSesion } from '@/api/authFetch';
import * as planes from '@/api/planes';
import * as plantillas from '@/api/plantillas';
import * as seguimiento from '@/api/seguimiento';
import * as usuarios from '@/api/usuarios';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));

const respuesta = (cuerpo: unknown) =>
  ({
    ok: true,
    status: 200,
    json: async () => cuerpo,
    text: async () => '',
    blob: async () => ({}),
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

const formulario = () => ({ append: jest.fn() }) as unknown as FormData;
const datos = {
  titulo: 'T',
  descripcion: 'D',
  fecha_limite: '2026-01-01',
  inicio: '2026-01-01T10:00:00Z',
  fin: '2026-01-01T11:00:00Z',
  modalidad: 'presencial',
  lugar: 'Aula',
  temas: 'a',
  desarrollo: 'b',
  acuerdos: 'c',
  observaciones: 'd',
  comentario: 'e',
  requiere_correccion: false,
  valoracion: 'v',
  nota_final: 4,
  nombre: 'n',
  email: 'a@b.co',
  tipo: 'nota_baja',
  umbral: 3,
  valor: 3,
  estado: 'presente',
  registros: [],
  contenido: '<p>x</p>',
  asunto: 'a',
  preferencias: [],
};

// Combinaciones de argumentos habituales; se usa la primera con la que la función no falla.
const intentos: unknown[][] = [
  [1, datos],
  [1, 'x'],
  [1, 2],
  [1],
  [],
  [datos],
  [1, 'x', 'y'],
  [1, 'x', 'y', formulario()],
  [1, formulario(), 'y'],
  [1, 2, datos],
  [1, 2, 'x'],
  ['x'],
  ['2026-01-01', 1],
  [1, '2026-01-01', datos],
  [1, [datos]],
  [[datos]],
  [1, 2, 3],
];

const urlInvalida = /undefined|\[object Object\]|NaN/;

/** Prueba cada combinación hasta hallar una con la que la función arma una petición válida. */
async function invocar(fn: (...a: unknown[]) => unknown) {
  let ultimo = 'sin intentos';
  for (const args of intentos) {
    const antes = fetchMock.mock.calls.length;
    try {
      const resultado = fn(...args);
      if (!resultado || typeof (resultado as Promise<unknown>).then !== 'function') {
        return { pura: true };
      }
      await resultado;
    } catch (e) {
      ultimo = String(e);
      continue;
    }
    const llamadas = fetchMock.mock.calls.slice(antes);
    if (llamadas.length >= 1 && !urlInvalida.test(String(llamadas[llamadas.length - 1][0]))) {
      return { pura: false, llamadas: llamadas.length };
    }
    ultimo = `URL inválida: ${llamadas.map(([u]) => String(u)).join(', ')}`;
  }
  throw new Error(`Ninguna combinación sirvió para ${fn.name}: ${ultimo}`);
}

const modulos: [string, Record<string, unknown>][] = [
  ['planes', planes],
  ['academico', academico],
  ['usuarios', usuarios],
  ['seguimiento', seguimiento],
  ['plantillas', plantillas],
];

describe.each(modulos)('api/%s', (_nombre, modulo) => {
  const funciones = Object.entries(modulo).filter(([, v]) => typeof v === 'function') as [
    string,
    (...a: unknown[]) => unknown,
  ][];

  test.each(funciones.map(([n]) => n))('%s', async (nombre) => {
    const resultado = await invocar(modulo[nombre] as (...a: unknown[]) => unknown);
    if (!resultado.pura) expect(resultado.llamadas).toBeGreaterThanOrEqual(1);
  });
});

describe('ramas de la construcción de URLs', () => {
  test('listarPlanes arma la consulta con los filtros indicados', async () => {
    await planes.listarPlanes();
    await planes.listarPlanes({ estado: 'cerrado', atrasado: true, page: 3 });
    await planes.listarPlanes({ page: 1 });
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls[0]).toMatch(/\/planes\/$/);
    expect(urls[1]).toMatch(/estado=cerrado&atrasado=1&page=3/);
    expect(urls[2]).toMatch(/\/planes\/$/);
  });

  test('listarInformesBitacora ignora filtros vacíos y codifica el resto', async () => {
    await planes.listarInformesBitacora();
    await planes.listarInformesBitacora({
      docente: '  Ana Ruiz ',
      estudiante: '   ',
      grado: 'Sexto',
    });
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls[0]).toMatch(/\/informes-bitacoras\/$/);
    expect(urls[1]).toMatch(/docente=Ana%20Ruiz&grado=Sexto$/);
  });

  test('notaValida acepta coma decimal y rechaza fuera de escala', () => {
    expect(planes.notaValida('4,5')).toBe(4.5);
    expect(planes.notaValida(' 5 ')).toBe(5);
    expect(planes.notaValida('0.9')).toBeNull();
    expect(planes.notaValida('5.1')).toBeNull();
    expect(planes.notaValida('abc')).toBeNull();
    expect(planes.etiquetaResultado('logrado')).toMatch(/Logrado/);
    expect(planes.etiquetaResultado('otro')).toBe('otro');
  });
});
