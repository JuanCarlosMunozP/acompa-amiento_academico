import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { iniciarSesionApi, registrar } from '@/api/auth';
import { RegistroScreen } from '@/screens/RegistroScreen';

jest.mock('@/api/auth', () => ({
  ...jest.requireActual('@/api/auth'),
  registrar: jest.fn(),
  iniciarSesionApi: jest.fn(),
}));
const mockIniciar = jest.fn();
jest.mock('@/store/session', () => ({ useSession: () => ({ iniciar: mockIniciar }) }));

const registrarMock = registrar as jest.Mock;
const loginMock = iniciarSesionApi as jest.Mock;
const route = { key: 'Registro', name: 'Registro' } as never;

async function setup() {
  const navigation = { replace: jest.fn() };
  await render(<RegistroScreen navigation={navigation as never} route={route} />);
  return navigation;
}

async function llenar(overrides: Record<string, string> = {}) {
  const valores: Record<string, string> = {
    Nombres: 'Ana',
    Apellidos: 'Ruiz',
    'Correo institucional': 'ana@colegio.edu.co',
    Contraseña: 'Clave-segura-2026',
    'Confirmar contraseña': 'Clave-segura-2026',
    ...overrides,
  };
  for (const [label, valor] of Object.entries(valores)) {
    await fireEvent.changeText(screen.getByLabelText(label), valor);
  }
}

beforeEach(() => {
  registrarMock.mockReset();
  loginMock.mockReset();
  mockIniciar.mockReset();
});

test('si la cuenta nace verificada, inicia sesión sola y va al inicio', async () => {
  registrarMock.mockResolvedValue({ email: 'ana@colegio.edu.co', email_verificado: true });
  const sesion = { access: 'a', refresh: 'r', usuario: { id: 1 } };
  loginMock.mockResolvedValue(sesion);
  const navigation = await setup();
  await llenar();
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cuenta' }));
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Home'));
  expect(loginMock).toHaveBeenCalledWith({
    email: 'ana@colegio.edu.co',
    password: 'Clave-segura-2026',
  });
  expect(mockIniciar).toHaveBeenCalledWith(sesion);
});

test('si el inicio automático falla, manda al login', async () => {
  registrarMock.mockResolvedValue({ email: 'ana@colegio.edu.co', email_verificado: true });
  loginMock.mockRejectedValue(new Error('red'));
  const navigation = await setup();
  await llenar();
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cuenta' }));
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Login'));
});

test('alta exitosa: envía los datos y pasa a la pantalla de éxito', async () => {
  registrarMock.mockResolvedValue({ email: 'ana@colegio.edu.co' });
  const navigation = await setup();
  await llenar();
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cuenta' }));

  await waitFor(() =>
    expect(navigation.replace).toHaveBeenCalledWith('RegistroExito', {
      email: 'ana@colegio.edu.co',
    }),
  );
  expect(registrarMock).toHaveBeenCalledWith(
    expect.objectContaining({ email: 'ana@colegio.edu.co', password: 'Clave-segura-2026' }),
  );
});

test('duplicado: muestra el error del servidor bajo el campo correo', async () => {
  registrarMock.mockRejectedValue({
    error: {
      code: 'validation_error',
      message: 'Datos inválidos.',
      details: { email: ['Ya existe una cuenta con este correo.'] },
    },
  });
  const navigation = await setup();
  await llenar();
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cuenta' }));

  expect(await screen.findByText('Ya existe una cuenta con este correo.')).toBeTruthy();
  expect(navigation.replace).not.toHaveBeenCalled();
});

test('validación local: no llama a la API con datos inválidos', async () => {
  await setup();
  await llenar({ 'Correo institucional': 'no-es-correo', 'Confirmar contraseña': 'otra' });
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cuenta' }));

  expect(await screen.findByText('Ingresa un correo válido.')).toBeTruthy();
  expect(screen.getByText('Las contraseñas no coinciden.')).toBeTruthy();
  expect(registrarMock).not.toHaveBeenCalled();
});

test('falla de red: muestra un mensaje general', async () => {
  registrarMock.mockRejectedValue(new TypeError('Network request failed'));
  await setup();
  await llenar();
  await fireEvent.press(screen.getByRole('button', { name: 'Crear cuenta' }));

  expect(await screen.findByText(/No pudimos crear tu cuenta/)).toBeTruthy();
});
