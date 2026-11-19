import { fireEvent, render, screen } from '@testing-library/react-native';

import { GestionAcademicaScreen } from '@/screens/academica/GestionAcademicaScreen';
import { useSession } from '@/store/session';

jest.mock('@/store/session', () => ({ useSession: jest.fn() }));
jest.mock('@/screens/academica/TableroScreen', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    TableroPanel: ({ onOpenFicha }: { onOpenFicha: (id: number) => void }) =>
      React.createElement(
        Pressable,
        { accessibilityRole: 'button', onPress: () => onOpenFicha(7) },
        React.createElement(Text, null, 'abrir ficha 7'),
      ),
  };
});

test('desde el tablero se abre la ficha del estudiante', async () => {
  (useSession as jest.Mock).mockReturnValue({
    sesion: { usuario: { nombres: 'Ana', rol: 'coordinador' } },
    cerrar: jest.fn(),
  });
  const navigation = { navigate: jest.fn() };
  await render(<GestionAcademicaScreen navigation={navigation as never} route={{} as never} />);
  await fireEvent.press(screen.getByText('abrir ficha 7'));
  expect(navigation.navigate).toHaveBeenCalledWith('FichaEstudiante', { estudianteId: 7 });
});
