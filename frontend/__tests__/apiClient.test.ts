import { resolveApiUrl } from '@/api/client';

test('web reemplaza localhost por la IP local desde la que se abrió Expo', () => {
  expect(
    resolveApiUrl({
      configuredUrl: 'http://localhost:8001/api',
      platform: 'web',
      browserHost: '192.168.1.45',
    }),
  ).toBe('http://192.168.1.45:8001/api');
});

test('móvil usa el host local anunciado por Expo', () => {
  expect(
    resolveApiUrl({
      configuredUrl: 'http://localhost:8001/api',
      platform: 'android',
      expoHostUri: '192.168.1.45:8081',
    }),
  ).toBe('http://192.168.1.45:8001/api');
});

test('Android usa el puente del emulador si Expo no anuncia una IP local', () => {
  expect(
    resolveApiUrl({
      configuredUrl: 'http://localhost:8001/api',
      platform: 'android',
      expoHostUri: 'localhost:8081',
    }),
  ).toBe('http://10.0.2.2:8001/api');
});

test('usa el puerto local de la API de tutorías cuando no se configura una URL', () => {
  expect(resolveApiUrl({ platform: 'web', browserHost: 'localhost' })).toBe(
    'http://localhost:8001/api',
  );
});

test('mantiene intacta la URL explícita de una API remota', () => {
  expect(
    resolveApiUrl({
      configuredUrl: 'https://api.ejemplo.com/api/',
      platform: 'android',
      expoHostUri: '192.168.1.45:8081',
    }),
  ).toBe('https://api.ejemplo.com/api');
});
