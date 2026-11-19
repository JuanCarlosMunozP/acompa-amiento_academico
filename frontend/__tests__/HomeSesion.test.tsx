import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { HomeScreen } from '@/screens/HomeScreen';
import { useSession } from '@/store/session';

jest.mock('@/store/session', () => ({ useSession: jest.fn() }));

const sesionMock = useSession as jest.Mock;
const route = { key: 'Home', name: 'Home' } as never;

async function abrirComo(rol: string, cerrar = jest.fn().mockResolvedValue(undefined)) {
  sesionMock.mockReturnValue({ sesion: { usuario: { nombres: 'Ana', rol } }, cerrar });
  const navigation = { navigate: jest.fn() };
  await render(<HomeScreen navigation={navigation as never} route={route} />);
  return { navigation, cerrar };
}

const boton = (nombre: string) => screen.getByRole('button', { name: nombre });
const sinBoton = (nombre: string) => screen.queryByRole('button', { name: nombre });

test.each(['estudiante', 'tutor', 'coordinador', 'administrador'])(
  '%s ve la navegación y puede abrir "Mi perfil" dentro de Inicio',
  async (rol) => {
    const { navigation } = await abrirComo(rol);
    await fireEvent.press(boton('Mi perfil'));
    expect(await screen.findAllByText('Mi perfil')).toHaveLength(2);
    expect(navigation.navigate).not.toHaveBeenCalled();
  },
);

test('solo el estudiante ve "Mi ficha"', async () => {
  const { navigation } = await abrirComo('estudiante');
  await fireEvent.press(boton('Mi ficha'));
  expect(navigation.navigate).toHaveBeenCalledWith('MiFicha');
});

test.each(['tutor', 'coordinador', 'administrador'])('%s no ve "Mi ficha"', async (rol) => {
  await abrirComo(rol);
  expect(sinBoton('Mi ficha')).toBeNull();
});

test('sin sesión no se ofrecen los datos personales', async () => {
  sesionMock.mockReturnValue({ sesion: null, cerrar: jest.fn() });
  await render(
    <HomeScreen navigation={{ navigate: jest.fn(), replace: jest.fn() } as never} route={route} />,
  );

  expect(sinBoton('Mi perfil')).toBeNull();
  expect(sinBoton('Cerrar sesión')).toBeNull();
});

// --- cierre de sesión (HU-01.10.T2) ---

test('cerrar sesión pide confirmación antes de hacer nada', async () => {
  const { cerrar } = await abrirComo('estudiante');
  await fireEvent.press(boton('Cerrar sesión'));

  expect(screen.getByText('¿Quieres cerrar la sesión en este dispositivo?')).toBeTruthy();
  expect(cerrar).not.toHaveBeenCalled();
});

test.each(['Mi perfil', 'Usuarios', 'Académica'])(
  'cerrar sesión funciona también estando en "%s", no solo en Inicio',
  async (seccion) => {
    const { cerrar } = await abrirComo('administrador');
    await fireEvent.press(boton(seccion));
    await fireEvent.press(boton('Cerrar sesión'));

    expect(await screen.findByText('¿Quieres cerrar la sesión en este dispositivo?')).toBeTruthy();
    expect(cerrar).not.toHaveBeenCalled();

    await fireEvent.press(boton('Sí, cerrar sesión'));
    await waitFor(() => expect(cerrar).toHaveBeenCalledTimes(1));
  },
);

test('cancelar desde otra sección no deja la confirmación pendiente para Inicio', async () => {
  await abrirComo('administrador');
  await fireEvent.press(boton('Mi perfil'));
  await fireEvent.press(boton('Cerrar sesión'));
  await fireEvent.press(boton('Cancelar'));
  await fireEvent.press(boton('Inicio'));

  expect(screen.queryByText('¿Quieres cerrar la sesión en este dispositivo?')).toBeNull();
});

test('cancelar vuelve a mostrar el botón sin cerrar la sesión', async () => {
  const { cerrar } = await abrirComo('estudiante');
  await fireEvent.press(boton('Cerrar sesión'));
  await fireEvent.press(boton('Cancelar'));

  expect(screen.queryByText('¿Quieres cerrar la sesión en este dispositivo?')).toBeNull();
  expect(boton('Cerrar sesión')).toBeTruthy();
  expect(cerrar).not.toHaveBeenCalled();
});

test('confirmar cierra la sesión una sola vez', async () => {
  const { cerrar } = await abrirComo('estudiante');
  await fireEvent.press(boton('Cerrar sesión'));
  await fireEvent.press(boton('Sí, cerrar sesión'));

  await waitFor(() => expect(cerrar).toHaveBeenCalledTimes(1));
  expect(cerrar).toHaveBeenCalledWith(); // cierre voluntario: sin motivo de expiración
});

test('mientras se cierra, el botón queda bloqueado para evitar dobles envíos', async () => {
  let terminar: () => void = () => undefined;
  const cerrar = jest.fn(() => new Promise<void>((resolver) => (terminar = resolver)));
  await abrirComo('estudiante', cerrar);
  await fireEvent.press(boton('Cerrar sesión'));
  // No se espera (await): el cierre queda pendiente a propósito para ver el estado intermedio.
  void fireEvent.press(boton('Sí, cerrar sesión'));

  await waitFor(() => expect(boton('Cancelar').props.accessibilityState.disabled).toBe(true));
  expect(cerrar).toHaveBeenCalledTimes(1);

  await act(async () => terminar());
  expect(await screen.findByRole('button', { name: 'Cerrar sesión' })).toBeTruthy();
  expect(cerrar).toHaveBeenCalledTimes(1);
});
