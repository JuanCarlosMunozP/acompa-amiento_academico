import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { listarMisNotificaciones, marcarNotificacionLeida } from '@/api/planes';
import { HomeScreen } from '@/screens/HomeScreen';
import { useSession } from '@/store/session';

jest.mock('@/store/session', () => ({ useSession: jest.fn() }));
jest.mock('@/api/planes', () => ({
  ...jest.requireActual('@/api/planes'),
  listarMisNotificaciones: jest.fn(),
  marcarNotificacionLeida: jest.fn(),
}));

// Los paneles internos ya tienen sus propias pruebas: aquí se verifica el cableado de HomeScreen.
jest.mock('@/screens/dashboard/HomeResponsiveLayout', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return {
    HomeResponsiveLayout: ({
      links,
      onLogout,
      children,
    }: {
      links: { label: string; active?: boolean; onPress: () => void }[];
      onLogout: () => void;
      children: unknown;
    }) =>
      React.createElement(
        View,
        null,
        links.map((l) =>
          React.createElement(
            Text,
            { key: l.label, onPress: l.onPress },
            `enlace:${l.label}${l.active ? ':activo' : ''}`,
          ),
        ),
        React.createElement(Text, { onPress: onLogout }, 'salir'),
        children,
      ),
  };
});
jest.mock('@/screens/dashboard/HomeMainContent', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  const acciones = [
    ['onOpenAgenda', 'agenda'],
    ['onGoHome', 'inicio'],
    ['onRetryNotifications', 'reintentar'],
  ];
  return {
    HomeMainContent: (p: Record<string, any>) =>
      React.createElement(
        View,
        null,
        React.createElement(Text, null, `seccion:${p.seccion}`),
        React.createElement(Text, null, `error:${p.errorNotificaciones}`),
        React.createElement(Text, null, `errorCarga:${p.errorCargaNotificaciones ?? ''}`),
        acciones.map(([prop, nombre]) =>
          React.createElement(Text, { key: nombre, onPress: p[prop] }, `accion:${nombre}`),
        ),
        React.createElement(
          Text,
          { onPress: () => p.onRegistrarNivelacion(3, 'Ana') },
          'accion:nivelar',
        ),
        React.createElement(Text, { onPress: () => p.onOpenFicha(4) }, 'accion:ficha'),
        React.createElement(Text, { onPress: () => p.onOpenPlan(5) }, 'accion:plan'),
        p.notificaciones.map((n: { id: number; titulo: string }) =>
          React.createElement(
            Text,
            { key: n.id, onPress: () => p.onOpenNotification(n) },
            `aviso:${n.id}:${n.titulo}`,
          ),
        ),
      ),
  };
});

const sesionMock = useSession as jest.Mock;
const listarMock = listarMisNotificaciones as jest.Mock;
const leerMock = marcarNotificacionLeida as jest.Mock;
const cerrarMock = jest.fn();

const navigation = { navigate: jest.fn(), replace: jest.fn() };
const route = { key: 'Home', name: 'Home' } as never;

const aviso = (id: number, extra: object = {}) => ({
  id,
  tipo: 'registro',
  titulo: `T${id}`,
  mensaje: 'm',
  creada: '2026-10-01T10:00:00Z',
  leida: null,
  plan: null,
  sesion: null,
  ...extra,
});

async function abrir(rol: string | null, avisos: object[] = []) {
  sesionMock.mockReturnValue({
    sesion: rol ? { usuario: { rol } } : null,
    cerrar: cerrarMock,
  });
  listarMock.mockResolvedValue({ no_leidas: avisos.length, resultados: avisos });
  await render(<HomeScreen navigation={navigation as never} route={route} />);
}

const enlace = (etiqueta: string) => screen.getByText(new RegExp(`^enlace:${etiqueta}`));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sin sesión', () => {
  test('el inicio de sesión es la página de inicio: se redirige y no consulta avisos', async () => {
    await abrir(null);
    expect(listarMock).not.toHaveBeenCalled();
    expect(screen.queryByText('salir')).toBeNull();
    expect(navigation.replace).toHaveBeenCalledWith('Login');
  });

  test('mientras se recupera la sesión guardada no redirige todavía', async () => {
    sesionMock.mockReturnValue({ sesion: null, cargando: true, cerrar: cerrarMock });
    listarMock.mockResolvedValue({ no_leidas: 0, resultados: [] });
    await render(<HomeScreen navigation={navigation as never} route={route} />);
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});

describe('menú según el rol', () => {
  test('tutor', async () => {
    await abrir('tutor');
    await fireEvent.press(enlace('Agenda de acompañamiento'));
    expect(navigation.navigate).toHaveBeenCalledWith('Agenda');
    await fireEvent.press(enlace('Perfil docente'));
    expect(navigation.navigate).toHaveBeenCalledWith('PerfilTutor');
    await fireEvent.press(enlace('Disponibilidad'));
    expect(navigation.navigate).toHaveBeenCalledWith('DisponibilidadTutor');
    for (const [etiqueta, seccion] of [
      ['Mi perfil', 'perfil'],
      ['Usuarios', 'usuarios'],
      ['Estudiantes', 'estudiantes'],
      ['Planes de nivelación', 'planes'],
      ['Mis informes', 'informes'],
    ]) {
      await fireEvent.press(enlace(etiqueta));
      expect(screen.getByText(`seccion:${seccion}`)).toBeTruthy();
      expect(enlace(etiqueta).props.children).toContain(':activo');
    }
    await fireEvent.press(enlace('Inicio'));
    expect(screen.getByText('seccion:null')).toBeTruthy();
    expect(screen.queryByText(/enlace:Acudientes/)).toBeNull();
    expect(screen.queryByText(/enlace:Académica/)).toBeNull();
  });

  test('estudiante', async () => {
    await abrir('estudiante');
    await fireEvent.press(enlace('Encuentros por asistir'));
    expect(navigation.navigate).toHaveBeenCalledWith('Agenda');
    await fireEvent.press(enlace('Mi ficha'));
    expect(navigation.navigate).toHaveBeenCalledWith('MiFicha');
    expect(screen.queryByText(/enlace:Usuarios/)).toBeNull();
    expect(screen.queryByText(/enlace:Informes/)).toBeNull();
  });

  test('administrador', async () => {
    await abrir('administrador');
    for (const [etiqueta, seccion] of [
      ['Usuarios', 'usuarios'],
      ['Acudientes', 'acudientes'],
      ['Académica', 'academica'],
      ['Expedientes de nivelación', 'solicitudes'],
      ['Informes', 'informes'],
    ]) {
      await fireEvent.press(enlace(etiqueta));
      expect(screen.getByText(`seccion:${seccion}`)).toBeTruthy();
    }
  });

  test('coordinador no ve acudientes ni opciones del tutor', async () => {
    await abrir('coordinador');
    expect(screen.queryByText(/enlace:Acudientes/)).toBeNull();
    expect(screen.queryByText(/enlace:Perfil docente/)).toBeNull();
    expect(enlace('Informes')).toBeTruthy();
  });

  test('acudiente solo ve inicio y perfil', async () => {
    await abrir('acudiente');
    expect(enlace('Inicio')).toBeTruthy();
    expect(enlace('Mi perfil')).toBeTruthy();
    expect(screen.queryByText(/enlace:Informes/)).toBeNull();
  });
});

describe('contenido principal', () => {
  test('reenvía las acciones a la navegación', async () => {
    await abrir('coordinador');
    await fireEvent.press(screen.getByText('accion:nivelar'));
    expect(navigation.navigate).toHaveBeenCalledWith('PlanRefuerzo', {
      estudianteId: 3,
      nombre: 'Ana',
    });
    await fireEvent.press(screen.getByText('accion:agenda'));
    expect(navigation.navigate).toHaveBeenCalledWith('Agenda');
    await fireEvent.press(screen.getByText('accion:ficha'));
    expect(navigation.navigate).toHaveBeenCalledWith('FichaEstudiante', { estudianteId: 4 });
    await fireEvent.press(screen.getByText('accion:plan'));
    expect(navigation.navigate).toHaveBeenCalledWith('PlanDetalle', { planId: 5 });
    await fireEvent.press(enlace('Informes'));
    await fireEvent.press(screen.getByText('accion:inicio'));
    expect(screen.getByText('seccion:null')).toBeTruthy();
  });
});

describe('avisos', () => {
  test('muestra solo los 4 primeros sin leer', async () => {
    await abrir('estudiante', [
      aviso(1),
      aviso(2, { leida: '2026-10-02T10:00:00Z' }),
      aviso(3),
      aviso(4),
      aviso(5),
      aviso(6),
    ]);
    expect(await screen.findByText('aviso:1:T1')).toBeTruthy();
    expect(screen.queryByText('aviso:2:T2')).toBeNull();
    expect(screen.getByText('aviso:5:T5')).toBeTruthy();
    expect(screen.queryByText('aviso:6:T6')).toBeNull();
  });

  test.each([
    ['con plan abre el expediente', { plan: 7 }, ['PlanDetalle', { planId: 7 }]],
    ['con sesión abre la agenda', { sesion: 9 }, ['Agenda']],
    ['de tipo sesión abre la agenda', { tipo: 'sesion' }, ['Agenda']],
    ['de tipo plan abre los planes', { tipo: 'plan' }, ['Planes']],
    ['de tipo solicitud abre los planes', { tipo: 'solicitud' }, ['Planes']],
  ])('un aviso %s', async (_caso, extra, destino) => {
    await abrir('estudiante', [aviso(1, extra)]);
    await fireEvent.press(await screen.findByText('aviso:1:T1'));
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith(...destino));
    expect(leerMock).toHaveBeenCalledWith(1);
    await waitFor(() => expect(screen.queryByText('aviso:1:T1')).toBeNull());
  });

  test('al leer un aviso los demás se conservan', async () => {
    await abrir('estudiante', [aviso(1, { tipo: 'alerta' }), aviso(2, { tipo: 'alerta' })]);
    await fireEvent.press(await screen.findByText('aviso:1:T1'));
    await waitFor(() => expect(screen.queryByText('aviso:1:T1')).toBeNull());
    expect(screen.getByText('aviso:2:T2')).toBeTruthy();
  });

  test('un aviso sin destino solo se marca como leído', async () => {
    await abrir('estudiante', [aviso(1, { tipo: 'alerta' })]);
    await fireEvent.press(await screen.findByText('aviso:1:T1'));
    await waitFor(() => expect(leerMock).toHaveBeenCalledWith(1));
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  test.each([
    ['un Error', new Error('Sin conexión'), 'Sin conexión'],
    ['un error de la API', { error: { message: 'No autorizado' } }, 'No autorizado'],
    ['un objeto sin mensaje', { error: {} }, 'No pudimos cargar o actualizar tus avisos'],
    ['un valor cualquiera', 'x', 'No pudimos cargar o actualizar tus avisos'],
  ])('al fallar con %s lo informa', async (_caso, fallo, texto) => {
    leerMock.mockRejectedValueOnce(fallo);
    await abrir('estudiante', [aviso(1)]);
    await fireEvent.press(await screen.findByText('aviso:1:T1'));
    expect(await screen.findByText(new RegExp(`^error:${texto}`))).toBeTruthy();
  });

  test('reintentar limpia el error y recarga', async () => {
    leerMock.mockRejectedValueOnce(new Error('Caído'));
    await abrir('estudiante', [aviso(1)]);
    await fireEvent.press(await screen.findByText('aviso:1:T1'));
    await screen.findByText('error:Caído');
    await fireEvent.press(screen.getByText('accion:reintentar'));
    expect(screen.getByText('error:')).toBeTruthy();
    await waitFor(() => expect(listarMock).toHaveBeenCalledTimes(2));
  });

  test('error al cargar los avisos', async () => {
    sesionMock.mockReturnValue({ sesion: { usuario: { rol: 'estudiante' } }, cerrar: cerrarMock });
    listarMock.mockRejectedValue(new Error('x'));
    await render(<HomeScreen navigation={navigation as never} route={route} />);
    expect(await screen.findByText(/^errorCarga:No pudimos cargar/)).toBeTruthy();
  });

  test('se actualizan cada 20 segundos', async () => {
    jest.useFakeTimers();
    try {
      await abrir('estudiante', [aviso(1)]);
      await act(async () => {
        jest.advanceTimersByTime(20_000);
      });
      await waitFor(() => expect(listarMock).toHaveBeenCalledTimes(2));
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('cerrar sesión', () => {
  test('pide confirmación, cierra y vuelve al inicio', async () => {
    cerrarMock.mockResolvedValue(undefined);
    await abrir('estudiante');
    expect(screen.queryByText('¿Quieres cerrar la sesión en este dispositivo?')).toBeNull();
    await fireEvent.press(screen.getByText('salir'));
    expect(screen.getByText('¿Quieres cerrar la sesión en este dispositivo?')).toBeTruthy();
    await fireEvent.press(screen.getByText('Sí, cerrar sesión'));
    await waitFor(() => expect(cerrarMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByText('¿Quieres cerrar la sesión en este dispositivo?')).toBeNull(),
    );
  });

  test('se puede cancelar', async () => {
    await abrir('estudiante');
    await fireEvent.press(screen.getByText('salir'));
    await fireEvent.press(screen.getByText('Cancelar'));
    await waitFor(() =>
      expect(screen.queryByText('¿Quieres cerrar la sesión en este dispositivo?')).toBeNull(),
    );
    expect(cerrarMock).not.toHaveBeenCalled();
  });
});
