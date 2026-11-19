import { fireEvent, render, screen } from '@testing-library/react-native';

import { fechaValida } from '@/api/academico';
import { fechaLocal } from '@/api/seguimiento';
import { GestionAcademicaScreen } from '@/screens/academica/GestionAcademicaScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { useSession } from '@/store/session';
import { erroresDeCampos, mensajeDe } from '@/utils/errores';

jest.mock('@/store/session', () => ({ useSession: jest.fn() }));

const sesionMock = useSession as jest.Mock;
const comoRol = (rol: string) =>
  sesionMock.mockReturnValue({ sesion: { usuario: { nombres: 'Ana', rol } }, cerrar: jest.fn() });

// --- menú de gestión académica ---

test.each([
  'Institución y sedes',
  'Grados y grupos',
  'Catálogo de asignaturas',
  'Periodos académicos',
  'Plantillas de correo',
  'Reglas y umbrales',
])('el menú selecciona «%s» sin navegar a otra pantalla', async (titulo) => {
  comoRol('coordinador');
  const navigation = { navigate: jest.fn() };
  await render(<GestionAcademicaScreen navigation={navigation as never} route={{} as never} />);
  await fireEvent.press(screen.getByRole('button', { name: titulo }));

  expect(navigation.navigate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: titulo }).props.accessibilityState.selected).toBe(true);
});

test('muestra el tablero debajo del menú sin navegar a otra pantalla', async () => {
  comoRol('coordinador');
  const navigation = { navigate: jest.fn() };
  await render(<GestionAcademicaScreen navigation={navigation as never} route={{} as never} />);

  expect(await screen.findAllByText('Tablero de desempeño')).toHaveLength(2);
  expect(navigation.navigate).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'Tablero de desempeño' }).props.accessibilityState.selected,
  ).toBe(true);
});

test.each(['estudiante', 'tutor'])('%s no ve el menú de gestión', async (rol) => {
  comoRol(rol);
  await render(
    <GestionAcademicaScreen navigation={{ navigate: jest.fn() } as never} route={{} as never} />,
  );
  expect(
    await screen.findByText('No tienes permiso para acceder a la sección académica.'),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Grados y grupos' })).toBeNull();
});

// --- accesos desde el inicio ---

async function inicio(rol: string) {
  comoRol(rol);
  const navigation = { navigate: jest.fn() };
  await render(<HomeScreen navigation={navigation as never} route={{} as never} />);
  return navigation;
}

test.each(['administrador', 'coordinador'])('%s abre Académica dentro de Inicio', async (rol) => {
  const navigation = await inicio(rol);
  await fireEvent.press(screen.getByRole('button', { name: 'Académica' }));
  expect(screen.getByRole('button', { name: 'Académica' }).props.accessibilityState.selected).toBe(
    true,
  );
  expect(await screen.findAllByText('Tablero de desempeño')).toHaveLength(2);
  expect(navigation.navigate).not.toHaveBeenCalled();
});

test.each([
  ['Mi perfil', 'Mi perfil'],
  ['Usuarios', 'Usuarios'],
  ['Expedientes de nivelación', 'Expedientes de nivelación'],
  ['Informes', 'Informes de acompañamiento'],
])('el acceso «%s» cambia el contenido de Inicio sin navegar', async (acceso, titulo) => {
  const navigation = await inicio('coordinador');
  await fireEvent.press(screen.getByRole('button', { name: acceso }));

  expect(screen.getByRole('button', { name: acceso }).props.accessibilityState.selected).toBe(true);
  expect(await screen.findAllByText(titulo)).not.toHaveLength(0);
  expect(navigation.navigate).not.toHaveBeenCalled();
});

test('el tutor ve «Mis informes» pero no la gestión académica', async () => {
  const navigation = await inicio('tutor');
  expect(screen.queryByRole('button', { name: 'Académica' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Mis informes' }));
  expect(await screen.findAllByText('Mis informes')).not.toHaveLength(0);
  expect(navigation.navigate).not.toHaveBeenCalled();
});

test('el estudiante no ve ninguno de los dos', async () => {
  await inicio('estudiante');
  expect(screen.queryByRole('button', { name: 'Académica' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Informes' })).toBeNull();
});

test('notificaciones no aparece como una pantalla adicional del menú', async () => {
  await inicio('coordinador');
  expect(screen.queryByRole('button', { name: 'Notificaciones' })).toBeNull();
});

// --- utilidades ---

test('fechaValida acepta solo fechas reales en formato AAAA-MM-DD', () => {
  expect(fechaValida('2026-02-28')).toBe(true);
  expect(fechaValida('2028-02-29')).toBe(true); // bisiesto
  for (const mala of [
    '2026-02-29',
    '2026-02-30',
    '2026-13-01',
    '2026-00-10',
    '26-01-01',
    '2026/01/01',
    '',
    'hoy',
  ]) {
    expect(fechaValida(mala)).toBe(false);
  }
});

test('fechaLocal formatea en hora local y desplaza días entre meses y años', () => {
  const base = new Date(2026, 11, 31, 23, 30); // 31-dic-2026 23:30
  expect(fechaLocal(0, base)).toBe('2026-12-31');
  expect(fechaLocal(1, base)).toBe('2027-01-01');
  expect(fechaLocal(-31, base)).toBe('2026-11-30');
  expect(fechaLocal(0, new Date(2026, 0, 5))).toBe('2026-01-05'); // con ceros a la izquierda
});

test('erroresDeCampos y mensajeDe interpretan los errores de la API', () => {
  const error = {
    error: { message: 'Datos inválidos.', details: { nombre: ['a', 'b'], orden: 'c' } },
  };
  expect(erroresDeCampos(error)).toEqual({ nombre: 'a b', orden: 'c' });
  expect(mensajeDe(error, 'por defecto')).toBe('Datos inválidos.');
  expect(erroresDeCampos(new TypeError('red'))).toEqual({});
  expect(erroresDeCampos({ error: { details: ['no es un objeto'] } })).toEqual({});
  expect(mensajeDe(new TypeError('red'), 'por defecto')).toBe('por defecto');
});
