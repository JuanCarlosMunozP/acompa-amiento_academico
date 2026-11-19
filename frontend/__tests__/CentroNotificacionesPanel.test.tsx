import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  guardarPreferenciasNotificacion,
  listarMisNotificaciones,
  listarPreferenciasNotificacion,
  marcarNotificacionLeida,
} from '@/api/planes';
import { CentroNotificacionesPanel } from '@/screens/notificaciones/CentroNotificacionesPanel';

jest.mock('@/api/planes');

const listarMock = listarMisNotificaciones as jest.Mock;
const prefsMock = listarPreferenciasNotificacion as jest.Mock;
const guardarMock = guardarPreferenciasNotificacion as jest.Mock;
const leerMock = marcarNotificacionLeida as jest.Mock;

const AVISO = {
  id: 1,
  tipo: 'plan',
  titulo: 'Nuevo plan',
  mensaje: 'Te asignaron un plan',
  creada: '2026-11-10T10:00:00Z',
  leida: null,
  plan: 5,
  sesion: null,
};
const ALERTA = { ...AVISO, id: 2, tipo: 'alerta', titulo: 'Alerta de notas', mensaje: 'Bajó' };
const LEIDA = { ...AVISO, id: 3, titulo: 'Ya vista', leida: '2026-11-09T10:00:00Z' };
const PREFS = [
  { tipo: 'plan', nombre: 'Planes', habilitada: true },
  { tipo: 'alerta', nombre: 'Alertas', habilitada: false },
];

async function montar() {
  await render(<CentroNotificacionesPanel />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  listarMock.mockResolvedValue({ no_leidas: 2, resultados: [AVISO, ALERTA, LEIDA] });
  prefsMock.mockResolvedValue(PREFS);
});

test('muestra avisos y preferencias; los leídos no ofrecen marcar como leída', async () => {
  await montar();
  expect(await screen.findByText('Nuevo plan')).toBeTruthy();
  expect(screen.getByText('Ya vista')).toBeTruthy();
  expect(screen.getAllByText('Sin leer')).toHaveLength(2);
  expect(screen.getAllByText('Marcar como leída')).toHaveLength(2);
  expect(screen.getByLabelText('Planes')).toBeTruthy();
});

test('sin notificaciones muestra el mensaje vacío', async () => {
  listarMock.mockResolvedValue({ no_leidas: 0, resultados: [] });
  await montar();
  expect(await screen.findByText('Todavía no tienes notificaciones.')).toBeTruthy();
  expect(screen.queryByLabelText('Solo alertas académicas')).toBeNull();
});

test('marcar como leída actualiza la lista', async () => {
  leerMock.mockResolvedValue(undefined);
  await montar();
  await screen.findByText('Nuevo plan');
  await fireEvent.press(screen.getAllByText('Marcar como leída')[0]);
  await waitFor(() => expect(leerMock).toHaveBeenCalledWith(1));
  await waitFor(() => expect(screen.getAllByText('Sin leer')).toHaveLength(1));
});

test('si marcar como leída falla muestra el error de la API', async () => {
  leerMock.mockRejectedValue({ error: { message: 'No se pudo marcar' } });
  await montar();
  await screen.findByText('Nuevo plan');
  await fireEvent.press(screen.getAllByText('Marcar como leída')[0]);
  expect(await screen.findByText('No se pudo marcar')).toBeTruthy();
});

test('el filtro «solo alertas» oculta los demás avisos', async () => {
  await montar();
  await screen.findByText('Nuevo plan');
  await fireEvent(screen.getByLabelText('Solo alertas académicas'), 'valueChange', true);
  await waitFor(() => expect(screen.queryByText('Nuevo plan')).toBeNull());
  expect(screen.getByText('Alerta de notas')).toBeTruthy();
});

test('cambiar una preferencia la guarda con la respuesta del servidor', async () => {
  guardarMock.mockResolvedValue([{ ...PREFS[0], habilitada: false }, PREFS[1]]);
  await montar();
  await screen.findByText('Nuevo plan');
  await fireEvent(screen.getByLabelText('Planes'), 'valueChange', false);
  await waitFor(() =>
    expect(guardarMock).toHaveBeenCalledWith([{ ...PREFS[0], habilitada: false }, PREFS[1]]),
  );
});

test('si guardar la preferencia falla, la revierte y muestra el error', async () => {
  guardarMock.mockRejectedValue(new Error('Sin conexión'));
  await montar();
  await screen.findByText('Nuevo plan');
  await fireEvent(screen.getByLabelText('Planes'), 'valueChange', false);
  expect(await screen.findByText('Sin conexión')).toBeTruthy();
  expect(screen.getByLabelText('Planes').props.value).toBe(true);
});

test('errores de carga: usa el mensaje de la API o uno genérico', async () => {
  listarMock.mockRejectedValue({ error: { message: 'Servidor caído' } });
  prefsMock.mockRejectedValue('algo raro');
  await montar();
  expect(await screen.findByText(/Servidor caído/)).toBeTruthy();
  expect(screen.getByText(/No pudimos cargar las notificaciones/)).toBeTruthy();
});

test('un error con forma de API pero sin mensaje usa el texto genérico', async () => {
  listarMock.mockRejectedValue({ error: {} });
  await montar();
  expect(await screen.findByText(/No pudimos cargar las notificaciones/)).toBeTruthy();
});

test('Actualizar vuelve a cargar los datos', async () => {
  await montar();
  await screen.findByText('Nuevo plan');
  await fireEvent.press(screen.getByText('Actualizar'));
  await waitFor(() => expect(listarMock).toHaveBeenCalledTimes(2));
});
