import { prefijosDeEnlaces } from '@/navigation/RootNavigator';

describe('prefijos de enlaces', () => {
  test('en el celular `window` no tiene location y no debe romper el arranque', () => {
    expect(() => prefijosDeEnlaces({})).not.toThrow();
    expect(prefijosDeEnlaces({})).toEqual(['tutorias://', 'http://localhost:8081']);
  });

  test('sin ventana usa solo los prefijos fijos', () => {
    expect(prefijosDeEnlaces(undefined)).toEqual(['tutorias://', 'http://localhost:8081']);
  });

  test('en el navegador añade su propio origen', () => {
    expect(prefijosDeEnlaces({ location: { origin: 'https://app.colegio.edu.co' } })).toContain(
      'https://app.colegio.edu.co',
    );
  });
});
