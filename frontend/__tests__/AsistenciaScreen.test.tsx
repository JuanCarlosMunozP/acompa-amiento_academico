import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  fechaLocal,
  guardarAsistencia,
  listarGradosConGrupos,
  obtenerListaAsistencia,
} from '@/api/seguimiento';
import { AsistenciaScreen } from '@/screens/academica/AsistenciaScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/seguimiento', () => ({
  ...jest.requireActual('@/api/seguimiento'),
  listarGradosConGrupos: jest.fn(),
  obtenerListaAsistencia: jest.fn(),
  guardarAsistencia: jest.fn(),
}));
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));

const gradosMock = listarGradosConGrupos as jest.Mock;
const listaMock = obtenerListaAsistencia as jest.Mock;
const guardarMock = guardarAsistencia as jest.Mock;
const sesionMock = useSession as jest.Mock;

const GRADOS = [
  {
    id: 1,
    nombre: 'Sexto',
    grupos: [
      { id: 10, nombre: 'A' },
      { id: 11, nombre: 'B' },
    ],
  },
  { id: 2, nombre: 'Séptimo', grupos: [{ id: 20, nombre: 'A' }] },
];

const lista = (extra: Record<string, unknown> = {}) => ({
  fecha: fechaLocal(),
  grupo: 'Sexto A',
  periodo: 1,
  habil: true,
  motivo: null,
  estudiantes: [
    { estudiante: 1, nombre: 'Ana Ruiz', email: 'ana@c.co', estado: null },
    { estudiante: 2, nombre: 'Luis Pérez', email: 'luis@c.co', estado: 'ausente' },
  ],
  ...extra,
});

const comoRol = (rol: string) => sesionMock.mockReturnValue({ sesion: { usuario: { rol } } });
const boton = (nombre: string) => screen.getByRole('button', { name: nombre });
const marcado = (nombre: string) => boton(nombre).props.accessibilityState.selected;

beforeEach(() => {
  [gradosMock, listaMock, guardarMock].forEach((m) => m.mockReset());
  gradosMock.mockResolvedValue(GRADOS);
  listaMock.mockResolvedValue(lista());
  comoRol('tutor');
});

async function abrirConGrupo() {
  await render(<AsistenciaScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Sexto A' }));
  await screen.findByText('Ana Ruiz');
}

test('sin elegir grupo pide elegir uno y no consulta ninguna lista', async () => {
  await render(<AsistenciaScreen />);

  expect(await screen.findByText('Elige un grupo para ver su lista.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Séptimo A' })).toBeTruthy();
  expect(listaMock).not.toHaveBeenCalled();
});

test('al elegir el grupo carga su lista con lo ya registrado', async () => {
  await abrirConGrupo();

  expect(listaMock).toHaveBeenCalledWith(10, fechaLocal());
  expect(marcado('Luis Pérez: Ausente')).toBe(true); // ya estaba guardado
  expect(marcado('Ana Ruiz: Presente')).toBe(false);
});

test('marcar estados y guardar envía solo lo marcado y confirma', async () => {
  guardarMock.mockResolvedValue(
    lista({
      guardados: 1,
      estudiantes: [
        { estudiante: 1, nombre: 'Ana Ruiz', email: 'ana@c.co', estado: 'tarde' },
        { estudiante: 2, nombre: 'Luis Pérez', email: 'luis@c.co', estado: 'ausente' },
      ],
    }),
  );
  await abrirConGrupo();
  await fireEvent.press(boton('Ana Ruiz: Tarde'));
  expect(marcado('Ana Ruiz: Tarde')).toBe(true);
  await fireEvent.press(boton('Guardar asistencia'));

  await waitFor(() =>
    expect(guardarMock).toHaveBeenCalledWith(10, fechaLocal(), [
      { estudiante: 1, estado: 'tarde' },
    ]),
  );
  expect(await screen.findByText('Asistencia guardada (1).')).toBeTruthy();
  expect(boton('Guardar asistencia').props.accessibilityState.disabled).toBe(true); // ya no hay pendientes
});

test('guardar está deshabilitado mientras no se marque nada', async () => {
  await abrirConGrupo();
  expect(boton('Guardar asistencia').props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(boton('Ana Ruiz: Presente'));
  expect(boton('Guardar asistencia').props.accessibilityState.disabled).toBe(false);
});

test('cambiar de opinión sobre un estudiante deja solo la última marca', async () => {
  guardarMock.mockResolvedValue(lista({ guardados: 1 }));
  await abrirConGrupo();
  await fireEvent.press(boton('Ana Ruiz: Ausente'));
  await fireEvent.press(boton('Ana Ruiz: Excusa'));
  await fireEvent.press(boton('Guardar asistencia'));

  await waitFor(() =>
    expect(guardarMock).toHaveBeenCalledWith(10, fechaLocal(), [
      { estudiante: 1, estado: 'excusa' },
    ]),
  );
});

test('«Marcar todos presentes» marca a todo el grupo', async () => {
  guardarMock.mockResolvedValue(lista({ guardados: 2 }));
  await abrirConGrupo();
  await fireEvent.press(boton('Marcar todos presentes'));

  expect(marcado('Ana Ruiz: Presente')).toBe(true);
  expect(marcado('Luis Pérez: Presente')).toBe(true);
  await fireEvent.press(boton('Guardar asistencia'));
  await waitFor(() =>
    expect(guardarMock).toHaveBeenCalledWith(10, fechaLocal(), [
      { estudiante: 1, estado: 'presente' },
      { estudiante: 2, estado: 'presente' },
    ]),
  );
});

test('un día no hábil avisa el motivo y no deja guardar', async () => {
  listaMock.mockResolvedValue(lista({ habil: false, motivo: 'fin de semana' }));
  await abrirConGrupo();
  await fireEvent.press(boton('Ana Ruiz: Presente'));

  expect(
    screen.getByText(
      'Esta fecha no es un día hábil (fin de semana): no se puede tomar asistencia.',
    ),
  ).toBeTruthy();
  expect(boton('Guardar asistencia').props.accessibilityState.disabled).toBe(true);
});

test('una fecha futura se avisa y no deja guardar', async () => {
  await abrirConGrupo();
  await fireEvent.changeText(screen.getByLabelText('Fecha (AAAA-MM-DD)'), fechaLocal(3));
  await fireEvent.press(boton('Ana Ruiz: Presente'));

  expect(await screen.findByText('No se puede tomar asistencia de una fecha futura.')).toBeTruthy();
  expect(boton('Guardar asistencia').props.accessibilityState.disabled).toBe(true);
});

test('una fecha mal escrita avisa el formato y no consulta', async () => {
  await abrirConGrupo();
  listaMock.mockClear();
  await fireEvent.changeText(screen.getByLabelText('Fecha (AAAA-MM-DD)'), '12/10/2026');

  expect(await screen.findByText('Usa el formato AAAA-MM-DD.')).toBeTruthy();
  expect(listaMock).not.toHaveBeenCalled();
});

test('los botones de fecha mueven un día y vuelven a hoy, y limpian lo marcado', async () => {
  await abrirConGrupo();
  await fireEvent.press(boton('Ana Ruiz: Presente'));
  await fireEvent.press(boton('‹ Anterior'));

  expect(screen.getByDisplayValue(fechaLocal(-1))).toBeTruthy();
  await waitFor(() => expect(listaMock).toHaveBeenLastCalledWith(10, fechaLocal(-1)));
  expect(marcado('Ana Ruiz: Presente')).toBe(false); // las marcas eran de otro día
  await fireEvent.press(boton('Hoy'));
  expect(screen.getByDisplayValue(fechaLocal())).toBeTruthy();
});

test('cambiar de grupo carga su lista y descarta las marcas', async () => {
  await abrirConGrupo();
  await fireEvent.press(boton('Ana Ruiz: Presente'));
  listaMock.mockResolvedValue(
    lista({
      grupo: 'Sexto B',
      estudiantes: [{ estudiante: 3, nombre: 'Eva Gil', email: 'e@c.co', estado: null }],
    }),
  );
  await fireEvent.press(boton('Sexto B'));

  expect(await screen.findByText('Eva Gil')).toBeTruthy();
  expect(listaMock).toHaveBeenLastCalledWith(11, fechaLocal());
  expect(screen.queryByText('Ana Ruiz')).toBeNull();
  expect(boton('Guardar asistencia').props.accessibilityState.disabled).toBe(true);
});

test('un grupo sin estudiantes lo explica y no ofrece guardar', async () => {
  listaMock.mockResolvedValue(lista({ estudiantes: [] }));
  await render(<AsistenciaScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Sexto A' }));
  expect(
    await screen.findByText('No hay estudiantes matriculados en este grupo en esa fecha.'),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Guardar asistencia' })).toBeNull();
});

test('el servidor rechaza el guardado: se muestra su motivo y se conservan las marcas', async () => {
  guardarMock.mockRejectedValue({
    error: {
      code: 'validation_error',
      message: 'Datos inválidos.',
      details: { fecha: ['El 2026-12-25 no es un día hábil (Navidad).'] },
    },
  });
  await abrirConGrupo();
  await fireEvent.press(boton('Ana Ruiz: Presente'));
  await fireEvent.press(boton('Guardar asistencia'));

  expect(await screen.findByText('El 2026-12-25 no es un día hábil (Navidad).')).toBeTruthy();
  expect(marcado('Ana Ruiz: Presente')).toBe(true);
});

test('falla de red al guardar: mensaje general', async () => {
  guardarMock.mockRejectedValue(new TypeError('Network request failed'));
  await abrirConGrupo();
  await fireEvent.press(boton('Ana Ruiz: Presente'));
  await fireEvent.press(boton('Guardar asistencia'));

  expect(await screen.findByText(/No pudimos guardar la asistencia/)).toBeTruthy();
});

test('error al cargar la lista: permite reintentar', async () => {
  listaMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  await render(<AsistenciaScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Sexto A' }));

  expect(await screen.findByText('No pudimos cargar la lista del grupo.')).toBeTruthy();
  await fireEvent.press(boton('Reintentar'));
  expect(await screen.findByText('Ana Ruiz')).toBeTruthy();
});

test('error al cargar los grupos: permite reintentar', async () => {
  gradosMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  await render(<AsistenciaScreen />);

  expect(await screen.findByText(/No pudimos cargar los grupos/)).toBeTruthy();
  await fireEvent.press(boton('Reintentar'));
  expect(await screen.findByRole('button', { name: 'Sexto A' })).toBeTruthy();
});

test.each(['tutor', 'coordinador', 'administrador'])('%s puede tomar asistencia', async (rol) => {
  comoRol(rol);
  await render(<AsistenciaScreen />);
  expect(await screen.findByRole('button', { name: 'Sexto A' })).toBeTruthy();
});

test('un estudiante no puede tomar asistencia y no se consulta nada', async () => {
  comoRol('estudiante');
  await render(<AsistenciaScreen />);

  expect(await screen.findByText('No tienes permiso para tomar asistencia.')).toBeTruthy();
  expect(gradosMock).not.toHaveBeenCalled();
});

test('si el servidor no informa cuántos guardó, cuenta los enviados', async () => {
  guardarMock.mockResolvedValue(lista());
  await abrirConGrupo();
  await fireEvent.press(boton('Ana Ruiz: Presente'));
  await fireEvent.press(boton('Guardar asistencia'));
  expect(await screen.findByText('Asistencia guardada (1).')).toBeTruthy();
});

test('con grados sin grupos lo explica', async () => {
  gradosMock.mockResolvedValue([{ id: 1, nombre: 'Sexto', grupos: [] }]);
  await render(<AsistenciaScreen />);
  expect(await screen.findByText('Aún no hay grupos registrados.')).toBeTruthy();
});

test('con una fecha inválida los botones de día no cambian nada', async () => {
  await abrirConGrupo();
  await fireEvent.changeText(screen.getByLabelText('Fecha (AAAA-MM-DD)'), '12/10/2026');
  await fireEvent.press(boton('‹ Anterior'));
  await fireEvent.press(boton('Siguiente ›'));
  expect(screen.getByDisplayValue('12/10/2026')).toBeTruthy();
});

test('«Siguiente» avanza un día', async () => {
  await abrirConGrupo();
  await fireEvent.press(boton('Siguiente ›'));
  expect(screen.getByDisplayValue(fechaLocal(1))).toBeTruthy();
});
