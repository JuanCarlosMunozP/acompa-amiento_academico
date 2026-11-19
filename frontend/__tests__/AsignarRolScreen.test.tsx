import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { asignarRol, listarRoles, listarUsuarios } from '@/api/usuarios';
import { AsignarRolScreen } from '@/screens/usuarios/AsignarRolScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/usuarios', () => ({
  listarUsuarios: jest.fn(),
  listarRoles: jest.fn(),
  asignarRol: jest.fn(),
}));
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));

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

const ANA = usuario(2, 'Ana', 'Ruiz');
const LUIS = usuario(3, 'Luis', 'Pérez', 'tutor');
const ADMIN = usuario(1, 'Admin', 'Zeta', 'administrador');

const CATALOGO = [
  { codigo: 'estudiante', nombre: 'Estudiante', descripcion: 'Recibe tutorías.' },
  { codigo: 'tutor', nombre: 'Tutor', descripcion: 'Dicta tutorías.' },
  { codigo: 'coordinador', nombre: 'Coordinador académico', descripcion: 'Supervisa.' },
  { codigo: 'administrador', nombre: 'Administrador', descripcion: 'Administra.' },
];

const pagina = (results: unknown[], next: string | null = null) => ({
  count: results.length,
  next,
  previous: null,
  results,
});

function comoUsuario(u: ReturnType<typeof usuario>) {
  sesionMock.mockReturnValue({ sesion: { usuario: u } });
}

beforeEach(() => {
  listarMock.mockReset().mockResolvedValue(pagina([ADMIN, ANA, LUIS]));
  rolesMock.mockReset().mockResolvedValue(CATALOGO);
  asignarMock.mockReset();
  comoUsuario(ADMIN);
});

async function abrir() {
  await render(<AsignarRolScreen />);
  await screen.findByLabelText('Ana Ruiz, Estudiante');
}

test('muestra los usuarios con su rol', async () => {
  await abrir();
  expect(screen.getByLabelText('Luis Pérez, Tutor')).toBeTruthy();
  expect(screen.getByText('3 usuarios')).toBeTruthy();
  expect(listarMock).toHaveBeenCalledWith({ q: '', rol: null, page: 1 });
});

test('buscar envía el texto al servidor', async () => {
  await abrir();
  await fireEvent.changeText(screen.getByLabelText('Buscar por nombre o correo'), 'ruiz');
  await fireEvent.press(screen.getByRole('button', { name: 'Buscar' }));

  await waitFor(() =>
    expect(listarMock).toHaveBeenLastCalledWith({ q: 'ruiz', rol: null, page: 1 }),
  );
});

test('al escribir muestra coincidencias en una lista desplegable', async () => {
  await abrir();
  await fireEvent.changeText(screen.getByLabelText('Buscar por nombre o correo'), 'ana');

  expect(await screen.findByText('Usuarios encontrados')).toBeTruthy();
  await waitFor(() =>
    expect(listarMock).toHaveBeenLastCalledWith({ q: 'ana', rol: null, page: 1 }),
  );
  expect(screen.getByRole('button', { name: 'Ana Ruiz, Estudiante' })).toBeTruthy();
});

test('filtrar por rol vuelve a consultar con ese rol', async () => {
  await abrir();
  await fireEvent.press(screen.getByRole('button', { name: 'Tutores' }));

  await waitFor(() =>
    expect(listarMock).toHaveBeenLastCalledWith({ q: '', rol: 'tutor', page: 1 }),
  );
});

test('el administrador asigna un rol y la lista lo refleja', async () => {
  asignarMock.mockResolvedValue({ id: 2, rol: 'tutor', rol_nombre: 'Tutor' });
  await abrir();

  await fireEvent.press(screen.getByLabelText('Ana Ruiz, Estudiante'));
  expect(await screen.findByText('Asignar rol a Ana Ruiz')).toBeTruthy();
  expect(screen.getByText('Dicta tutorías.')).toBeTruthy();

  await fireEvent.press(screen.getByRole('radio', { name: 'Tutor' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar rol' }));

  await waitFor(() => expect(asignarMock).toHaveBeenCalledWith(2, 'tutor'));
  expect(await screen.findByText('Ana Ruiz ahora es Tutor.')).toBeTruthy();
  expect(screen.getByLabelText('Ana Ruiz, Tutor')).toBeTruthy();
  expect(screen.queryByText('Asignar rol a Ana Ruiz')).toBeNull();
});

test('no se puede guardar sin cambiar el rol', async () => {
  await abrir();
  await fireEvent.press(screen.getByLabelText('Ana Ruiz, Estudiante'));
  const guardar = await screen.findByRole('button', { name: 'Guardar rol' });

  await fireEvent.press(guardar);
  expect(asignarMock).not.toHaveBeenCalled();
});

test('cancelar cierra el panel sin guardar', async () => {
  await abrir();
  await fireEvent.press(screen.getByLabelText('Ana Ruiz, Estudiante'));
  await fireEvent.press(await screen.findByRole('button', { name: 'Cancelar' }));

  expect(screen.queryByText('Asignar rol a Ana Ruiz')).toBeNull();
  expect(asignarMock).not.toHaveBeenCalled();
});

test('un administrador no puede cambiar su propio rol', async () => {
  await abrir();
  await fireEvent.press(screen.getByLabelText('Admin Zeta, Administrador'));

  expect(await screen.findByText(/No puedes cambiar tu propio rol/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Guardar rol' })).toBeNull();
});

test('muestra el mensaje del servidor si rechaza el cambio', async () => {
  asignarMock.mockRejectedValue({
    error: { code: 'permission_denied', message: 'Solo un administrador puede hacer esto.' },
  });
  await abrir();
  await fireEvent.press(screen.getByLabelText('Ana Ruiz, Estudiante'));
  await fireEvent.press(await screen.findByRole('radio', { name: 'Coordinador académico' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar rol' }));

  expect(await screen.findByText('Solo un administrador puede hacer esto.')).toBeTruthy();
  expect(screen.getByLabelText('Ana Ruiz, Estudiante')).toBeTruthy(); // sin cambios
  expect(screen.getByText('Asignar rol a Ana Ruiz')).toBeTruthy(); // se puede reintentar
});

test('falla de red al guardar: mensaje general', async () => {
  asignarMock.mockRejectedValue(new TypeError('Network request failed'));
  await abrir();
  await fireEvent.press(screen.getByLabelText('Ana Ruiz, Estudiante'));
  await fireEvent.press(await screen.findByRole('radio', { name: 'Tutor' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Guardar rol' }));

  expect(await screen.findByText(/No pudimos guardar el rol/)).toBeTruthy();
});

test('un coordinador ve los roles pero no puede cambiarlos', async () => {
  comoUsuario(usuario(9, 'Cora', 'Díaz', 'coordinador'));
  await abrir();

  expect(screen.getByText(/Solo lectura/)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Ana Ruiz, Estudiante'));
  expect(screen.queryByText('Asignar rol a Ana Ruiz')).toBeNull();
  expect(rolesMock).not.toHaveBeenCalled(); // ni siquiera pide el catálogo
});

test('un estudiante no ve la pantalla ni consulta nada', async () => {
  comoUsuario(usuario(5, 'Eva', 'Gil'));
  await render(<AsignarRolScreen />);

  expect(await screen.findByText('No tienes permiso para gestionar roles.')).toBeTruthy();
  expect(listarMock).not.toHaveBeenCalled();
});

test('sin sesión tampoco se muestra', async () => {
  sesionMock.mockReturnValue({ sesion: null });
  await render(<AsignarRolScreen />);

  expect(await screen.findByText('Sin acceso')).toBeTruthy();
  expect(listarMock).not.toHaveBeenCalled();
});

test('error al cargar: muestra el aviso, vacía la lista y permite reintentar', async () => {
  listarMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  await render(<AsignarRolScreen />);

  expect(await screen.findByText(/No pudimos cargar los usuarios/)).toBeTruthy();
  expect(screen.queryByLabelText('Ana Ruiz, Estudiante')).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByLabelText('Ana Ruiz, Estudiante')).toBeTruthy();
  expect(screen.queryByText(/No pudimos cargar los usuarios/)).toBeNull();
});

test('sin resultados muestra un aviso', async () => {
  listarMock.mockResolvedValue(pagina([]));
  await render(<AsignarRolScreen />);

  expect(await screen.findByText('No encontramos usuarios con ese filtro.')).toBeTruthy();
});

test('cargar más agrega la página siguiente', async () => {
  listarMock
    .mockResolvedValueOnce(pagina([ADMIN, ANA], 'http://api/usuarios/?page=2'))
    .mockResolvedValueOnce(pagina([LUIS]));
  await render(<AsignarRolScreen />);
  await screen.findByLabelText('Ana Ruiz, Estudiante');

  await fireEvent.press(screen.getByRole('button', { name: 'Cargar más' }));

  expect(await screen.findByLabelText('Luis Pérez, Tutor')).toBeTruthy();
  expect(screen.getByLabelText('Ana Ruiz, Estudiante')).toBeTruthy(); // se conservan las anteriores
  expect(listarMock).toHaveBeenLastCalledWith({ q: '', rol: null, page: 2 });
  expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull();
});

test('los usuarios inactivos se marcan', async () => {
  listarMock.mockResolvedValue(pagina([{ ...ANA, is_active: false }]));
  await render(<AsignarRolScreen />);

  expect(await screen.findByText('Ana Ruiz (inactivo)')).toBeTruthy();
});
