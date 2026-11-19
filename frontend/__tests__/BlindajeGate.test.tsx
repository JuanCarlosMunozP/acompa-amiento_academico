import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { BlindajeGate } from '@/components/BlindajeGate';
import { LoginScreen } from '@/screens/LoginScreen';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const mockSesion: { cerrar: jest.Mock; iniciar: jest.Mock; aviso: string | null } = {
  cerrar: jest.fn(),
  iniciar: jest.fn(),
  aviso: null,
};
jest.mock('@/store/session', () => ({ useSession: () => mockSesion }));

jest.mock('@/utils/blindaje', () => ({
  ...jest.requireActual('@/utils/blindaje'),
  activarBlindaje: jest.fn(),
}));

describe('BlindajeGate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('inactivo: solo muestra a los hijos', async () => {
    const { activarBlindaje: activar } = jest.requireMock('@/utils/blindaje');
    await render(
      <BlindajeGate activo={false}>
        <Text>app</Text>
      </BlindajeGate>,
    );
    expect(screen.getByText('app')).toBeTruthy();
    expect(activar).not.toHaveBeenCalled();
  });

  test('activo: al detectar herramientas cierra la sesión por seguridad y limpia al salir', async () => {
    const { activarBlindaje: activar } = jest.requireMock('@/utils/blindaje');
    const limpiar = jest.fn();
    activar.mockReturnValue(limpiar);
    const vista = await render(
      <BlindajeGate activo>
        <Text>app</Text>
      </BlindajeGate>,
    );
    activar.mock.calls[0][0].alDetectarHerramientas();
    expect(mockSesion.cerrar).toHaveBeenCalledWith('seguridad');
    await vista.unmount();
    expect(limpiar).toHaveBeenCalled();
  });

  test('por defecto no se activa fuera de la web', async () => {
    const { activarBlindaje: activar } = jest.requireMock('@/utils/blindaje');
    await render(
      <BlindajeGate>
        <Text>app</Text>
      </BlindajeGate>,
    );
    expect(activar).not.toHaveBeenCalled();
  });
});

describe('aviso de cierre por seguridad en el login', () => {
  test('explica por qué se cerró la sesión', async () => {
    mockSesion.aviso = 'seguridad';
    const navigation = { replace: jest.fn(), navigate: jest.fn() };
    await render(
      <LoginScreen
        navigation={navigation as never}
        route={{ key: 'Login', name: 'Login' } as never}
      />,
    );
    await waitFor(() => expect(screen.getByText(/herramientas de desarrollo/)).toBeTruthy());
    mockSesion.aviso = null;
  });
});
