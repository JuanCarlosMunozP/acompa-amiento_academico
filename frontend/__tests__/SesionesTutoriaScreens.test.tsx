import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  obtenerDisponibilidadPlan,
  programarSesion,
  registrarAsistenciaSesion,
  reprogramarSesion,
  type SesionTutoria,
} from '@/api/planes';
import { AsistenciaTutoriaScreen } from '@/screens/tutorias/AsistenciaTutoriaScreen';
import { ProgramarSesionScreen } from '@/screens/tutorias/ProgramarSesionScreen';
import { useSession } from '@/store/session';

jest.mock('@/store/session', () => ({ useSession: jest.fn() }));
jest.mock('@/api/planes', () => ({
  ...jest.requireActual('@/api/planes'),
  obtenerDisponibilidadPlan: jest.fn(),
  programarSesion: jest.fn(),
  reprogramarSesion: jest.fn(),
  registrarAsistenciaSesion: jest.fn(),
}));

const disponibilidadMock = obtenerDisponibilidadPlan as jest.Mock;
const programarMock = programarSesion as jest.Mock;
const reprogramarMock = reprogramarSesion as jest.Mock;
const asistenciaMock = registrarAsistenciaSesion as jest.Mock;
const sesionMock = useSession as jest.Mock;

const navigation = { goBack: jest.fn(), setOptions: jest.fn(), navigate: jest.fn() };

const hora = 3600_000;
const en = (ms: number) => new Date(Date.now() + ms).toISOString();

function tutoria(extra: Partial<SesionTutoria> = {}): SesionTutoria {
  return {
    id: 8,
    plan: 5,
    tutor: 9,
    tutor_nombre: 'Luis Tutor',
    estudiante_nombre: 'Beatriz Castro',
    asignatura_nombre: 'Matemáticas',
    inicio: en(-3 * hora),
    fin: en(-2 * hora),
    modalidad: 'presencial',
    lugar: 'Aula 1',
    enlace_virtual: '',
    notas: 'Trae calculadora',
    estado: 'programada',
    motivo_cancelacion: '',
    asistencia: 'pendiente',
    asistencia_fecha: null,
    inasistencias_tutorias: 0,
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  sesionMock.mockReturnValue({ sesion: { usuario: { rol: 'tutor' } } });
});

// ------------------------------------------------------------------ programar / reprogramar

async function abrirProgramar(session?: SesionTutoria, datos: unknown = undefined) {
  if (datos instanceof Error) disponibilidadMock.mockRejectedValue(datos);
  else
    disponibilidadMock.mockResolvedValue(
      datos ?? {
        horarios: [{ dia_semana: 1, hora_inicio: '08:00:00', hora_fin: '12:00:00' }],
        bloqueos: [{ id: 1, fecha: '2026-12-01', hora_inicio: '08:00', hora_fin: '09:00' }],
      },
    );
  await render(
    <ProgramarSesionScreen
      navigation={navigation as never}
      route={{ key: 'p', name: 'ProgramarSesion', params: { planId: 5, session } } as never}
    />,
  );
}

const fecha = () => screen.getByLabelText('Fecha (AAAA-MM-DD)');

describe('ProgramarSesionScreen', () => {
  test('muestra el horario semanal y las fechas bloqueadas del tutor', async () => {
    await abrirProgramar();
    expect(await screen.findByText('Martes · 08:00–12:00')).toBeTruthy();
    expect(screen.getByText('Fechas bloqueadas: 2026-12-01')).toBeTruthy();
    expect(screen.getByText('Programar sesión')).toBeTruthy();
  });

  test('avisa si el tutor no tiene horarios ni bloqueos', async () => {
    await abrirProgramar(undefined, { horarios: [], bloqueos: [] });
    expect(await screen.findByText('El tutor aún no ha configurado horarios.')).toBeTruthy();
    expect(screen.queryByText(/Fechas bloqueadas/)).toBeNull();
  });

  test('avisa si no se pudo cargar la disponibilidad', async () => {
    await abrirProgramar(undefined, new Error('x'));
    expect(await screen.findByText(/No pudimos cargar la disponibilidad del tutor/)).toBeTruthy();
  });

  test('programa una sesión presencial y vuelve', async () => {
    programarMock.mockResolvedValue({});
    await abrirProgramar();
    await screen.findByText('Martes · 08:00–12:00');
    await fireEvent.changeText(fecha(), '2030-03-05');
    await fireEvent.changeText(screen.getByLabelText('Lugar'), '  Aula 3 ');
    await fireEvent.changeText(screen.getByLabelText('Notas (opcional)'), ' nota ');
    await fireEvent.press(screen.getByText('Guardar sesión'));
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    const [plan, datos] = programarMock.mock.calls[0];
    expect(plan).toBe(5);
    expect(datos).toMatchObject({
      modalidad: 'presencial',
      lugar: 'Aula 3',
      enlace_virtual: '',
      notas: 'nota',
    });
  });

  test('programa una sesión virtual con enlace', async () => {
    programarMock.mockResolvedValue({});
    await abrirProgramar();
    await screen.findByText('Martes · 08:00–12:00');
    await fireEvent.press(screen.getByText('Virtual'));
    await fireEvent.changeText(fecha(), '2030-03-05');
    await fireEvent.changeText(screen.getByLabelText('Enlace de reunión'), ' https://meet.test/x ');
    await fireEvent.press(screen.getByText('Guardar sesión'));
    await waitFor(() => expect(programarMock).toHaveBeenCalled());
    expect(programarMock.mock.calls[0][1]).toMatchObject({
      modalidad: 'virtual',
      lugar: '',
      enlace_virtual: 'https://meet.test/x',
    });
    await fireEvent.press(screen.getByText('Presencial'));
    expect(screen.getByLabelText('Lugar')).toBeTruthy();
  });

  test.each([
    ['fecha mal escrita', '05/03/2030', '09:00', '10:00'],
    ['hora inválida', '2030-03-05', '9:00', '10:00'],
    ['minutos inválidos', '2030-03-05', '09:00', '10:75'],
  ])('rechaza %s', async (_c, f, ini, fin) => {
    await abrirProgramar();
    await screen.findByText('Martes · 08:00–12:00');
    await fireEvent.changeText(fecha(), f);
    await fireEvent.changeText(screen.getByLabelText('Hora de inicio (HH:MM)'), ini);
    await fireEvent.changeText(screen.getByLabelText('Hora de fin (HH:MM)'), fin);
    await fireEvent.press(screen.getByText('Guardar sesión'));
    expect(await screen.findByText(/Indica una fecha AAAA-MM-DD y horas válidas/)).toBeTruthy();
    expect(programarMock).not.toHaveBeenCalled();
  });

  test('rechaza una fecha que no existe en el calendario', async () => {
    await abrirProgramar();
    await screen.findByText('Martes · 08:00–12:00');
    await fireEvent.changeText(fecha(), '2030-02-31');
    await fireEvent.press(screen.getByText('Guardar sesión'));
    expect(await screen.findByText('La fecha no es válida.')).toBeTruthy();
  });

  test('muestra los detalles de validación del servidor o un mensaje', async () => {
    await abrirProgramar();
    await screen.findByText('Martes · 08:00–12:00');
    await fireEvent.changeText(fecha(), '2030-03-05');
    programarMock.mockRejectedValueOnce({
      error: { details: { inicio: ['Fuera de horario.'], lugar: 'Falta el lugar.' } },
    });
    await fireEvent.press(screen.getByText('Guardar sesión'));
    expect(await screen.findByText('Fuera de horario. Falta el lugar.')).toBeTruthy();
    programarMock.mockRejectedValueOnce({ error: { message: 'Sesión duplicada' } });
    await fireEvent.press(screen.getByText('Guardar sesión'));
    expect(await screen.findByText('Sesión duplicada')).toBeTruthy();
    programarMock.mockRejectedValueOnce(new Error('red'));
    await fireEvent.press(screen.getByText('Guardar sesión'));
    expect(await screen.findByText(/No se pudo programar la sesión/)).toBeTruthy();
  });

  test('reprograma una sesión existente con sus datos precargados', async () => {
    reprogramarMock.mockResolvedValue({});
    const futura = tutoria({
      id: 12,
      inicio: new Date(2030, 2, 5, 14, 30).toISOString(),
      fin: new Date(2030, 2, 5, 15, 30).toISOString(),
      modalidad: 'virtual',
      lugar: '',
      enlace_virtual: 'https://meet.test/old',
    });
    await abrirProgramar(futura);
    expect(await screen.findByText('Reprogramar sesión')).toBeTruthy();
    expect(fecha().props.value).toBe('2030-03-05');
    expect(screen.getByLabelText('Hora de inicio (HH:MM)').props.value).toBe('14:30');
    expect(screen.getByLabelText('Enlace de reunión').props.value).toBe('https://meet.test/old');
    await fireEvent.press(screen.getByText('Guardar nueva fecha'));
    await waitFor(() => expect(reprogramarMock).toHaveBeenCalledWith(12, expect.anything()));
    expect(programarMock).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ asistencia

function abrirAsistencia(s: SesionTutoria, rol = 'estudiante') {
  sesionMock.mockReturnValue({ sesion: { usuario: { rol } } });
  return render(
    <AsistenciaTutoriaScreen
      navigation={navigation as never}
      route={{ key: 'a', name: 'Asistencia', params: { sesion: s } } as never}
    />,
  );
}

describe('AsistenciaTutoriaScreen', () => {
  test('solo el estudiante registra su asistencia', async () => {
    await abrirAsistencia(tutoria(), 'tutor');
    expect(screen.getByText(/Solo el estudiante puede registrar/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Volver'));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  test('antes de que termine la tutoría todavía no se registra', async () => {
    await abrirAsistencia(tutoria({ inicio: en(hora), fin: en(2 * hora) }));
    expect(screen.getByText(/Podrás registrar la asistencia cuando termine/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Volver a mi agenda'));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  test('si ya está registrada lo indica', async () => {
    await abrirAsistencia(tutoria({ estado: 'realizada' }));
    expect(screen.getByText('Esta tutoría ya tiene asistencia registrada.')).toBeTruthy();
  });

  test('registra la opción elegida y vuelve', async () => {
    asistenciaMock.mockResolvedValue({});
    await abrirAsistencia(tutoria());
    expect(screen.getByText('Docente: Luis Tutor')).toBeTruthy();
    await fireEvent.press(screen.getByText('Tuve una excusa'));
    await fireEvent.press(screen.getByText('Guardar asistencia'));
    await waitFor(() => expect(asistenciaMock).toHaveBeenCalledWith(8, 'excusa'));
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
  });

  test('permite elegir las otras opciones y cancelar', async () => {
    asistenciaMock.mockResolvedValue({});
    await abrirAsistencia(tutoria());
    await fireEvent.press(screen.getByText('No asistí'));
    await fireEvent.press(screen.getByText('Asistí'));
    await fireEvent.press(screen.getByText('Cancelar'));
    expect(navigation.goBack).toHaveBeenCalled();
    expect(asistenciaMock).not.toHaveBeenCalled();
  });

  test('muestra el error del servidor o uno genérico', async () => {
    await abrirAsistencia(tutoria());
    asistenciaMock.mockRejectedValueOnce({ error: { message: 'Ya fue registrada' } });
    await fireEvent.press(screen.getByText('Guardar asistencia'));
    expect(await screen.findByText('Ya fue registrada')).toBeTruthy();
    asistenciaMock.mockRejectedValueOnce(new Error('red'));
    await fireEvent.press(screen.getByText('Guardar asistencia'));
    expect(await screen.findByText(/No se pudo registrar la asistencia/)).toBeTruthy();
  });
});
