import { render, screen, waitFor } from '@testing-library/react-native';

import { HomeScreen } from '@/screens/HomeScreen';
import { SessionProvider } from '@/store/session';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const navigation = { navigate: jest.fn(), replace: jest.fn() };
const route = { key: 'Home', name: 'Home' } as never;

test('sin sesión no hay página de inicio: lleva al login y no muestra botones sueltos', async () => {
  await render(
    <SessionProvider>
      <HomeScreen navigation={navigation as never} route={route} />
    </SessionProvider>,
  );
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Login'));
  expect(screen.queryByRole('button', { name: 'Iniciar sesión' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Crear cuenta' })).toBeNull();
});
