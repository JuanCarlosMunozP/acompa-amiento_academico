import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { asignarRol, listarRoles, listarUsuarios } from '@/api/usuarios';
import { AsignarRolScreen } from '@/screens/usuarios/AsignarRolScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/usuarios', () => ({
  listarUsuarios: jest.fn(),
  listarRoles: jest.fn(),
  asignarRol: jest.fn(),
}));
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));
jest.mock('@/components/FormModal', () => {
  const React = require('react');
  const { Pressable, View } = require('react-native');
  return {
    FormModal: ({
      visible,
      onClose,
      children,
    }: {
      visible: boolean;
      onClose: () => void;
      children: unknown;
    }) =>
      visible
        ? React.createElement(
            View,
            null,
            React.createElement(Pressable, {
              accessibilityRole: 'button',
              accessibilityLabel: 'cerrar modal',
              onPress: onClose,
            }),
            children,
          )
        : null,
  };
});

const listarMock = listarUsuarios as jest.Mock;
const rolesMock = listarRoles as jest.Mock;
const asignarMock = asignarRol as jest.Mock;
const sesionMock = useSession as jest.Mock;

const usuario = (id: number, nombres: string, apellidos: string, rol = 'estudiante') => ({
  id,
  email: `${nombres.toLowerCase()}@colegio.edu.co`,
  nombres,
  apellidos,
  rol,
  rol_nombre: rol.charAt(0).toUpperCase() + rol.slice(1),
  is_active: true,
});

const ADMIN = usuario(1, 'Admin', 'Zeta', 'administrador');
const ANA = usuario(2, 'Ana', 'Ruiz');
const CATALOGO = [
  { codigo: 'estudiante', nombre: 'Estudiante', descripcion: 'Recibe tutorías.' },
  { codigo: 'tutor', nombre: 'Tutor', descripcion: 'Dicta tutorías.' },
];
const pagina = (results: unknown[], next: string | null = null) => ({
  count: results.length,
  next,
  previous: null,
  results,
});

const comoUsuario = (u: ReturnType<typeof usuario>) =>
  sesionMock.mockReturnValue({ sesion: { usuario: u } });
const buscador = () => screen.getByLabelText('Buscar por nombre o correo');

beforeEach(() => {
  jest.clearAllMocks();
  listarMock.mockReset().mockResolvedValue(pagina([ADMIN, ANA]));
  rolesMock.mockReset().mockResolvedValue(CATALOGO);
  asignarMock.mockReset();
  comoUsuario(ADMIN);
});

test('un tutor ve sus estudiantes sin filtros por rol', async () => {
  comoUsuario(usuario(4, 'Tito', 'Gil', 'tutor'));
  await render(<AsignarRolScreen embedded />);
  expect(await screen.findByText(/Estudiantes con planes de tutoría asignados a ti/)).toBeTruthy();
  expect(screen.queryByText('Estudiantes')).toBeNull();
  expect(rolesMock).not.toHaveBeenCalled();
});

test('si el catálogo de roles falla la pantalla sigue funcionando', async () => {
  rolesMock.mockRejectedValue(new Error('x'));
  await render(<AsignarRolScreen />);
  expect(await screen.findByLabelText('Ana Ruiz, Estudiante')).toBeTruthy();
});

describe('lista desplegable de coincidencias', () => {
  test('mientras busca y al elegir un usuario abre el panel', async () => {
    await render(<AsignarRolScreen />);
    await screen.findByLabelText('Ana Ruiz, Estudiante');
    await fireEvent.changeText(buscador(), 'ana');
    expect(await screen.findByText('Usuarios encontrados')).toBeTruthy();
    await waitFor(() =>
      expect(listarMock).toHaveBeenLastCalledWith({ q: 'ana', rol: null, page: 1 }),
    );
    await fireEvent.press(await screen.findByRole('button', { name: 'Ana Ruiz, Estudiante' }));
    expect(await screen.findByText('Asignar rol a Ana Ruiz')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'cerrar modal' }));
    expect(screen.queryByText('Asignar rol a Ana Ruiz')).toBeNull();
  });

  test('sin coincidencias, con inactivos y borrando el texto vuelve al listado', async () => {
    await render(<AsignarRolScreen />);
    await screen.findByLabelText('Ana Ruiz, Estudiante');

    listarMock.mockResolvedValue(pagina([]));
    await fireEvent.changeText(buscador(), 'zzz');
    expect(await screen.findByText('No encontramos usuarios con ese filtro.')).toBeTruthy();

    listarMock.mockResolvedValue(pagina([{ ...ANA, is_active: false }]));
    await fireEvent.changeText(buscador(), 'ana');
    expect(await screen.findByText('Ana Ruiz (inactivo)')).toBeTruthy();

    listarMock.mockResolvedValue(pagina([ADMIN, ANA]));
    await fireEvent.changeText(buscador(), '');
    await waitFor(() => expect(listarMock).toHaveBeenLastCalledWith({ q: '', rol: null, page: 1 }));
    expect(await screen.findByText('2 usuarios')).toBeTruthy();
  });

  test('si falla la búsqueda ofrece reintentar', async () => {
    await render(<AsignarRolScreen />);
    await screen.findByLabelText('Ana Ruiz, Estudiante');
    listarMock.mockRejectedValueOnce({ error: { message: 'Servidor ocupado' } });
    await fireEvent.changeText(buscador(), 'ana');
    expect(await screen.findByText('Servidor ocupado')).toBeTruthy();

    listarMock.mockResolvedValue(pagina([ANA]));
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('button', { name: 'Ana Ruiz, Estudiante' })).toBeTruthy();
  });
});

describe('respuestas atrasadas y paginación', () => {
  test('una respuesta vieja que llega tarde se ignora', async () => {
    let resolverViejo: (v: unknown) => void = () => undefined;
    let rechazarViejo: (v: unknown) => void = () => undefined;
    listarMock
      .mockReturnValueOnce(new Promise((r) => (resolverViejo = r)))
      .mockResolvedValue(pagina([ANA]));
    await render(<AsignarRolScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByLabelText('Ana Ruiz, Estudiante')).toBeTruthy();
    await act(async () => resolverViejo(pagina([ADMIN])));
    expect(screen.queryByLabelText('Admin Zeta, Administrador')).toBeNull();

    listarMock.mockReset();
    listarMock
      .mockReturnValueOnce(new Promise((_r, rechazo) => (rechazarViejo = rechazo)))
      .mockResolvedValue(pagina([ANA]));
    await fireEvent.press(screen.getByRole('button', { name: 'Buscar' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Buscar' }));
    await act(async () => rechazarViejo(new Error('tarde')));
    expect(screen.queryByText(/No pudimos cargar los usuarios/)).toBeNull();
  });

  test('si falla "cargar más" conserva la lista y muestra el error', async () => {
    listarMock
      .mockResolvedValueOnce(pagina([ADMIN, ANA], 'http://api/usuarios/?page=2'))
      .mockRejectedValueOnce(new Error('red'));
    await render(<AsignarRolScreen />);
    await screen.findByLabelText('Ana Ruiz, Estudiante');
    await fireEvent.press(screen.getByRole('button', { name: 'Cargar más' }));
    expect(await screen.findByText(/No pudimos cargar los usuarios/)).toBeTruthy();
    expect(screen.getByLabelText('Ana Ruiz, Estudiante')).toBeTruthy();
  });
});

describe('guardar', () => {
  test('el botón atrás no cierra mientras guarda', async () => {
    let terminar: (v: unknown) => void = () => undefined;
    asignarMock.mockReturnValue(new Promise((r) => (terminar = r)));
    await render(<AsignarRolScreen />);
    await fireEvent.press(await screen.findByLabelText('Ana Ruiz, Estudiante'));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Tutor' }));
    void fireEvent.press(screen.getByRole('button', { name: 'Guardar rol' }));
    await waitFor(() => expect(asignarMock).toHaveBeenCalled());
    await fireEvent.press(screen.getByRole('button', { name: 'cerrar modal' }));
    expect(screen.getByText('Asignar rol a Ana Ruiz')).toBeTruthy();
    await act(async () => terminar({ id: 2, rol: 'tutor', rol_nombre: 'Tutor' }));
    expect(await screen.findByText('Ana Ruiz ahora es Tutor.')).toBeTruthy();
  });

  test('elegir otro rol y volver al actual deja el botón inactivo', async () => {
    await render(<AsignarRolScreen />);
    await fireEvent.press(await screen.findByLabelText('Ana Ruiz, Estudiante'));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Tutor' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Estudiante' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar rol' }));
    expect(asignarMock).not.toHaveBeenCalled();
  });
});

describe('rol de superadministrador', () => {
  const CATALOGO_COMPLETO = [
    ...CATALOGO,
    { codigo: 'superadmin', nombre: 'Superadministrador', descripcion: 'Responsable técnico.' },
  ];

  test('un administrador no ve el filtro ni la opción de superadmin', async () => {
    rolesMock.mockResolvedValue(CATALOGO_COMPLETO);
    await render(<AsignarRolScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Ana Ruiz, Estudiante' }));
    expect(await screen.findByText('Asignar rol a Ana Ruiz')).toBeTruthy();
    expect(screen.queryByText('Superadmin')).toBeNull();
    expect(screen.queryByLabelText('Superadministrador')).toBeNull();
  });

  test('un superadmin sí los ve y puede asignar el rol', async () => {
    comoUsuario(usuario(9, 'Yo', 'Ingeniero', 'superadmin'));
    rolesMock.mockResolvedValue(CATALOGO_COMPLETO);
    asignarMock.mockResolvedValue({});
    await render(<AsignarRolScreen />);
    expect(await screen.findByText('Superadmin')).toBeTruthy();
    await fireEvent.press(await screen.findByRole('button', { name: 'Ana Ruiz, Estudiante' }));
    expect(await screen.findByLabelText('Superadministrador')).toBeTruthy();
  });
});
