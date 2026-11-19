import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { guardarDisponibilidadTutor, obtenerDisponibilidadTutor } from '@/api/tutores';
import { DisponibilidadTutorScreen } from '@/screens/tutorias/DisponibilidadTutorScreen';
import { useSession } from '@/store/session';

jest.mock('@/store/session', () => ({ useSession: jest.fn() }));
jest.mock('@/api/tutores', () => ({
  ...jest.requireActual('@/api/tutores'),
  obtenerDisponibilidadTutor: jest.fn(),
  guardarDisponibilidadTutor: jest.fn(),
}));

const obtenerMock = obtenerDisponibilidadTutor as jest.Mock;
const guardarMock = guardarDisponibilidadTutor as jest.Mock;
const sesionMock = useSession as jest.Mock;

const VACIA = { horarios: [], bloqueos: [] };

async function abrir(datos: unknown = VACIA, rol = 'tutor') {
  sesionMock.mockReturnValue({ sesion: { usuario: { rol } } });
  if (datos instanceof Error) obtenerMock.mockRejectedValue(datos);
  else obtenerMock.mockResolvedValue(datos);
  await render(<DisponibilidadTutorScreen />);
}

const desde = () => screen.getAllByLabelText('Desde (HH:MM)');
const hasta = () => screen.getAllByLabelText('Hasta (HH:MM)');

beforeEach(() => jest.clearAllMocks());

test('solo el docente edita su disponibilidad', async () => {
  await abrir(VACIA, 'estudiante');
  expect(screen.getByText(/solo la puede editar el docente/)).toBeTruthy();
});

test('carga los horarios y bloqueos existentes', async () => {
  await abrir({
    horarios: [{ dia_semana: 2, hora_inicio: '08:00:00', hora_fin: '10:00:00' }],
    bloqueos: [
      { fecha: '2026-12-01', hora_inicio: '09:00:00', hora_fin: '10:00:00', motivo: 'Reunión' },
      { fecha: '2026-12-02', hora_inicio: '09:00:00', hora_fin: '10:00:00', motivo: '' },
    ],
  });
  expect(await screen.findByText('Miércoles · 08:00–10:00')).toBeTruthy();
  expect(screen.getByText('2026-12-01 · 09:00–10:00 · Reunión')).toBeTruthy();
  expect(screen.getByText('2026-12-02 · 09:00–10:00')).toBeTruthy();
});

test('muestra el mensaje cuando la carga falla (del servidor o genérico)', async () => {
  await abrir(new Error('x'));
  expect(await screen.findByText(/No se pudo guardar la disponibilidad/)).toBeTruthy();
});

test('sin horarios muestra la nota', async () => {
  await abrir();
  expect(await screen.findByText('Aún no has agregado horarios semanales.')).toBeTruthy();
});

describe('horarios semanales', () => {
  test('agrega, ordena por día y quita', async () => {
    await abrir();
    await screen.findByText('Aún no has agregado horarios semanales.');
    await fireEvent.press(screen.getByText('Viernes'));
    await fireEvent.press(screen.getByText('Agregar horario · Viernes'));
    await fireEvent.press(screen.getByText('Lunes'));
    await fireEvent.press(screen.getByText('Agregar horario · Lunes'));
    const filas = screen.getAllByText(/ · 08:00–09:00$/);
    expect(filas[0].props.children.join('')).toContain('Lunes');
    await fireEvent.press(screen.getAllByText('Quitar')[0]);
    expect(screen.queryByText(/Lunes · 08:00–09:00/)).toBeNull();
  });

  test.each([
    ['hora mal escrita', '8:00', '09:00'],
    ['hora fuera de rango', '25:00', '26:00'],
    ['minutos fuera de rango', '08:70', '09:00'],
    ['fin anterior al inicio', '10:00', '09:00'],
  ])('rechaza %s', async (_caso, inicio, fin) => {
    await abrir();
    await fireEvent.changeText(desde()[0], inicio);
    await fireEvent.changeText(hasta()[0], fin);
    await fireEvent.press(screen.getByText('Agregar horario · Lunes'));
    expect(await screen.findByText(/Usa horas válidas en formato HH:MM/)).toBeTruthy();
  });

  test('rechaza un horario que se cruza con otro del mismo día', async () => {
    await abrir({
      horarios: [{ dia_semana: 0, hora_inicio: '08:00:00', hora_fin: '10:00:00' }],
      bloqueos: [],
    });
    await screen.findByText('Lunes · 08:00–10:00');
    await fireEvent.changeText(desde()[0], '09:00');
    await fireEvent.changeText(hasta()[0], '11:00');
    await fireEvent.press(screen.getByText('Agregar horario · Lunes'));
    expect(await screen.findByText('Ese horario se cruza con otro del mismo día.')).toBeTruthy();
  });
});

describe('bloqueos puntuales', () => {
  test('agrega un bloqueo ordenado por fecha, limpia el motivo y lo quita', async () => {
    await abrir();
    await screen.findByText('Aún no has agregado horarios semanales.');
    await fireEvent.changeText(screen.getByLabelText('Fecha (AAAA-MM-DD)'), '2026-12-05');
    await fireEvent.changeText(screen.getByLabelText('Motivo (opcional)'), 'Cita');
    await fireEvent.press(screen.getByText('Agregar bloqueo'));
    await fireEvent.changeText(screen.getByLabelText('Fecha (AAAA-MM-DD)'), '2026-12-01');
    await fireEvent.press(screen.getByText('Agregar bloqueo'));
    expect(screen.getByText('2026-12-05 · 08:00–09:00 · Cita')).toBeTruthy();
    expect(screen.getByText('2026-12-01 · 08:00–09:00')).toBeTruthy();
    expect(screen.getByLabelText('Motivo (opcional)').props.value).toBe('');
    await fireEvent.press(screen.getAllByText('Quitar')[0]);
    expect(screen.queryByText('2026-12-01 · 08:00–09:00')).toBeNull();
  });

  test('valida fecha, horas y cruces', async () => {
    await abrir({
      horarios: [],
      bloqueos: [
        { fecha: '2026-12-01', hora_inicio: '08:00:00', hora_fin: '10:00:00', motivo: '' },
      ],
    });
    await screen.findByText('2026-12-01 · 08:00–10:00');
    const fecha = screen.getByLabelText('Fecha (AAAA-MM-DD)');
    await fireEvent.changeText(fecha, '01/12/2026');
    await fireEvent.press(screen.getByText('Agregar bloqueo'));
    expect(await screen.findByText(/Indica una fecha AAAA-MM-DD/)).toBeTruthy();

    await fireEvent.changeText(fecha, '2026-12-01');
    await fireEvent.changeText(desde()[1], '10:00');
    await fireEvent.changeText(hasta()[1], '09:00');
    await fireEvent.press(screen.getByText('Agregar bloqueo'));
    expect(await screen.findByText('La hora de fin debe ser posterior al inicio.')).toBeTruthy();

    await fireEvent.changeText(desde()[1], '09:00');
    await fireEvent.changeText(hasta()[1], '11:00');
    await fireEvent.press(screen.getByText('Agregar bloqueo'));
    expect(
      await screen.findByText('Ese bloqueo se cruza con otro de la misma fecha.'),
    ).toBeTruthy();
  });
});

describe('guardar', () => {
  test('guarda y muestra la confirmación con los datos del servidor', async () => {
    const guardada = {
      horarios: [{ dia_semana: 1, hora_inicio: '08:00:00', hora_fin: '09:00:00' }],
      bloqueos: [],
    };
    guardarMock.mockResolvedValue(guardada);
    await abrir();
    await fireEvent.press(await screen.findByText('Guardar disponibilidad'));
    expect(await screen.findByText('Disponibilidad guardada.')).toBeTruthy();
    expect(guardarMock).toHaveBeenCalledWith(VACIA);
    expect(screen.getByText('Martes · 08:00–09:00')).toBeTruthy();
  });

  test('muestra el error del servidor o uno genérico', async () => {
    guardarMock.mockRejectedValueOnce({ error: { message: 'Horario duplicado' } });
    await abrir();
    await fireEvent.press(await screen.findByText('Guardar disponibilidad'));
    expect(await screen.findByText('Horario duplicado')).toBeTruthy();
    guardarMock.mockRejectedValueOnce(new Error('red'));
    await fireEvent.press(screen.getByText('Guardar disponibilidad'));
    await waitFor(() =>
      expect(screen.getByText(/No se pudo guardar la disponibilidad/)).toBeTruthy(),
    );
  });
});

test('desmontar antes de que responda la carga no actualiza el estado', async () => {
  sesionMock.mockReturnValue({ sesion: { usuario: { rol: 'tutor' } } });
  let resolver: (v: unknown) => void = () => undefined;
  obtenerMock.mockReturnValue(new Promise((r) => (resolver = r)));
  const vista = await render(<DisponibilidadTutorScreen />);
  await vista.unmount();
  resolver(VACIA);
});
