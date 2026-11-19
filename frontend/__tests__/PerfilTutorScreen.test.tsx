import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { obtenerMiDesempenoTutorias } from '@/api/planes';
import { actualizarMiPerfil, listarAsignaturas, obtenerMiPerfil } from '@/api/tutores';
import { PerfilTutorScreen } from '@/screens/perfil/PerfilTutorScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/tutores', () => ({
  ...jest.requireActual('@/api/tutores'),
  obtenerMiPerfil: jest.fn(),
  actualizarMiPerfil: jest.fn(),
  listarAsignaturas: jest.fn(),
}));
jest.mock('@/api/planes', () => ({
  ...jest.requireActual('@/api/planes'),
  obtenerMiDesempenoTutorias: jest.fn(),
}));
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));

const obtenerMock = obtenerMiPerfil as jest.Mock;
const actualizarMock = actualizarMiPerfil as jest.Mock;
const asignaturasMock = listarAsignaturas as jest.Mock;
const sesionMock = useSession as jest.Mock;
const desempenoMock = obtenerMiDesempenoTutorias as jest.Mock;

const CATALOGO = [
  { id: 1, nombre: 'Matemáticas' },
  { id: 2, nombre: 'Física' },
  { id: 3, nombre: 'Inglés' },
];

const perfil = (extra: Record<string, unknown> = {}) => ({
  id: 10,
  usuario: { id: 5, email: 'luis@colegio.edu.co', nombres: 'Luis', apellidos: 'Pérez' },
  biografia: '',
  asignaturas: [],
  disponible: false,
  ...extra,
});

beforeEach(() => {
  obtenerMock.mockReset().mockResolvedValue(perfil());
  actualizarMock.mockReset();
  desempenoMock.mockReset().mockReturnValue(new Promise(() => undefined));
  asignaturasMock.mockReset().mockResolvedValue(CATALOGO);
  sesionMock.mockReturnValue({ sesion: { usuario: { rol: 'tutor' } } });
});

async function abrir() {
  await render(<PerfilTutorScreen />);
  await screen.findByText('Asignaturas que dictas');
}

const guardar = () => screen.getByRole('button', { name: 'Guardar perfil' });
const disponible = () => screen.getByLabelText('Disponible para asignación');
const chip = (nombre: string) => screen.getByRole('button', { name: nombre });

test('muestra el perfil guardado: datos, asignaturas elegidas y disponibilidad', async () => {
  obtenerMock.mockResolvedValue(
    perfil({
      biografia: 'Licenciado en física.',
      asignaturas: [CATALOGO[1]],
      disponible: true,
    }),
  );
  await abrir();

  expect(screen.getByText('Luis Pérez · luis@colegio.edu.co')).toBeTruthy();
  expect(screen.getByDisplayValue('Licenciado en física.')).toBeTruthy();
  expect(chip('Física').props.accessibilityState.selected).toBe(true);
  expect(chip('Matemáticas').props.accessibilityState.selected).toBe(false);
  expect(disponible().props.value).toBe(true);
});

test('el botón de guardar está deshabilitado mientras no haya cambios', async () => {
  await abrir();
  expect(guardar().props.accessibilityState.disabled).toBe(true);

  await fireEvent.changeText(screen.getByLabelText('Presentación'), 'Hola');
  expect(guardar().props.accessibilityState.disabled).toBe(false);
});

test('guardar la presentación envía solo ese campo y confirma', async () => {
  actualizarMock.mockResolvedValue(perfil({ biografia: 'Hola' }));
  await abrir();
  await fireEvent.changeText(screen.getByLabelText('Presentación'), '  Hola  ');
  await fireEvent.press(guardar());

  await waitFor(() => expect(actualizarMock).toHaveBeenCalledWith({ biografia: 'Hola' }));
  expect(await screen.findByText('Perfil guardado.')).toBeTruthy();
  expect(guardar().props.accessibilityState.disabled).toBe(true); // ya no hay cambios
});

test('elegir asignaturas y activar la disponibilidad envía ambos cambios', async () => {
  actualizarMock.mockResolvedValue(
    perfil({ asignaturas: [CATALOGO[0], CATALOGO[2]], disponible: true }),
  );
  await abrir();
  await fireEvent.press(chip('Matemáticas'));
  await fireEvent.press(chip('Inglés'));
  await fireEvent(disponible(), 'valueChange', true);
  await fireEvent.press(guardar());

  await waitFor(() =>
    expect(actualizarMock).toHaveBeenCalledWith({ asignaturas: [1, 3], disponible: true }),
  );
  expect(await screen.findByText('Perfil guardado.')).toBeTruthy();
});

test('tocar una asignatura elegida la quita', async () => {
  obtenerMock.mockResolvedValue(perfil({ asignaturas: [CATALOGO[0]] }));
  actualizarMock.mockResolvedValue(perfil());
  await abrir();
  await fireEvent.press(chip('Matemáticas'));
  expect(chip('Matemáticas').props.accessibilityState.selected).toBe(false);
  await fireEvent.press(guardar());

  await waitFor(() => expect(actualizarMock).toHaveBeenCalledWith({ asignaturas: [] }));
});

test('volver al valor original deja de contar como cambio', async () => {
  await abrir();
  await fireEvent.press(chip('Inglés'));
  expect(guardar().props.accessibilityState.disabled).toBe(false);
  await fireEvent.press(chip('Inglés'));
  expect(guardar().props.accessibilityState.disabled).toBe(true);
});

test('no se puede estar disponible sin asignaturas: avisa y no llama al servidor', async () => {
  await abrir();
  await fireEvent(disponible(), 'valueChange', true);
  await fireEvent.press(guardar());

  expect(
    await screen.findByText('Elige al menos una asignatura para estar disponible.'),
  ).toBeTruthy();
  expect(actualizarMock).not.toHaveBeenCalled();
});

test('muestra bajo el campo el error de validación que devuelve el servidor', async () => {
  actualizarMock.mockRejectedValue({
    error: {
      code: 'validation_error',
      message: 'Datos inválidos.',
      details: { asignaturas: ['Asignaturas inexistentes o inactivas: 2.'] },
    },
  });
  await abrir();
  await fireEvent.press(chip('Física'));
  await fireEvent.press(guardar());

  expect(await screen.findByText('Asignaturas inexistentes o inactivas: 2.')).toBeTruthy();
  expect(guardar().props.accessibilityState.disabled).toBe(false); // se puede corregir y reintentar
});

test('falla de red al guardar: mensaje general y conserva lo escrito', async () => {
  actualizarMock.mockRejectedValue(new TypeError('Network request failed'));
  await abrir();
  await fireEvent.changeText(screen.getByLabelText('Presentación'), 'Texto importante');
  await fireEvent.press(guardar());

  expect(await screen.findByText(/No pudimos guardar tu perfil/)).toBeTruthy();
  expect(screen.getByDisplayValue('Texto importante')).toBeTruthy();
});

test('editar después de guardar oculta el aviso de guardado', async () => {
  actualizarMock.mockResolvedValue(perfil({ biografia: 'Hola' }));
  await abrir();
  await fireEvent.changeText(screen.getByLabelText('Presentación'), 'Hola');
  await fireEvent.press(guardar());
  await screen.findByText('Perfil guardado.');

  await fireEvent.changeText(screen.getByLabelText('Presentación'), 'Hola de nuevo');
  expect(screen.queryByText('Perfil guardado.')).toBeNull();
});

test('muestra el contador de caracteres con el tope de 1000', async () => {
  await abrir();
  expect(screen.getByText('0/1000')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Presentación'), 'Hola');
  expect(screen.getByText('4/1000')).toBeTruthy();
});

test('sin asignaturas en el catálogo avisa a coordinación', async () => {
  asignaturasMock.mockResolvedValue([]);
  await abrir();
  expect(screen.getByText(/Aún no hay asignaturas disponibles/)).toBeTruthy();
});

test('error al cargar: muestra el aviso y permite reintentar', async () => {
  obtenerMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  await render(<PerfilTutorScreen />);

  expect(await screen.findByText(/No pudimos cargar tu perfil/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));

  expect(await screen.findByText('Asignaturas que dictas')).toBeTruthy();
  expect(screen.queryByText(/No pudimos cargar tu perfil/)).toBeNull();
});

test.each(['estudiante', 'coordinador', 'administrador'])(
  '%s no accede y no se consulta nada',
  async (rol) => {
    sesionMock.mockReturnValue({ sesion: { usuario: { rol } } });
    await render(<PerfilTutorScreen />);

    expect(await screen.findByText('El perfil de tutor es solo para tutores.')).toBeTruthy();
    expect(obtenerMock).not.toHaveBeenCalled();
  },
);

test('sin sesión tampoco se muestra', async () => {
  sesionMock.mockReturnValue({ sesion: null });
  await render(<PerfilTutorScreen />);

  expect(await screen.findByText('Sin acceso')).toBeTruthy();
  expect(obtenerMock).not.toHaveBeenCalled();
});

describe('desempeño como docente', () => {
  test('muestra "Cargando…" y luego las tutorías realizadas', async () => {
    let resolver: (v: unknown) => void = () => undefined;
    desempenoMock.mockReturnValue(new Promise((r) => (resolver = r)));
    await abrir();
    expect(screen.getByText('Cargando tu desempeño…')).toBeTruthy();
    await act(async () => resolver({ rol: 'tutor', tutorias_realizadas: 6 }));
    expect(await screen.findByText('Tutorías realizadas: 6')).toBeTruthy();
  });

  test('si falla la consulta lo avisa', async () => {
    desempenoMock.mockRejectedValue({ error: { message: 'Sin permiso para ver el desempeño' } });
    await abrir();
    expect(await screen.findByText('Sin permiso para ver el desempeño')).toBeTruthy();
  });
});

describe('salir de la pantalla antes de las respuestas', () => {
  test('no se actualiza nada si llegan tarde, con éxito o con error', async () => {
    let resolverPerfil: (v: unknown) => void = () => undefined;
    let resolverDesempeno: (v: unknown) => void = () => undefined;
    obtenerMock.mockReturnValueOnce(new Promise((r) => (resolverPerfil = r)));
    desempenoMock.mockReturnValueOnce(new Promise((r) => (resolverDesempeno = r)));
    const vista = await render(<PerfilTutorScreen />);
    await vista.unmount();
    resolverPerfil(perfil());
    resolverDesempeno({ rol: 'tutor', tutorias_realizadas: 1 });
    await Promise.resolve();

    let rechazarPerfil: (e: unknown) => void = () => undefined;
    let rechazarDesempeno: (e: unknown) => void = () => undefined;
    obtenerMock.mockReturnValueOnce(new Promise((_ok, no) => (rechazarPerfil = no)));
    desempenoMock.mockReturnValueOnce(new Promise((_ok, no) => (rechazarDesempeno = no)));
    const otra = await render(<PerfilTutorScreen />);
    await otra.unmount();
    rechazarPerfil(new Error('tarde'));
    rechazarDesempeno(new Error('tarde'));
    await Promise.resolve();
    expect(obtenerMock).toHaveBeenCalledTimes(2);
  });
});
