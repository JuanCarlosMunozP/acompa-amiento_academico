import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import {
  actualizarInformeBitacora,
  cerrarSesionConBitacora,
  listarAgendaSesiones,
  listarInformesBitacora,
  type InformeBitacora,
  type SesionTutoria,
} from '@/api/planes';
import { descargarInforme, obtenerInformeAcompanamiento } from '@/api/seguimiento';
import { InformesPanel, InformesScreen } from '@/screens/informes/InformesScreen';
import { useSession } from '@/store/session';

jest.mock('@/store/session', () => ({ useSession: jest.fn() }));
// Modal simplificado: expone el cierre del botón atrás como un botón.
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
jest.mock('@/api/planes', () => ({
  ...jest.requireActual('@/api/planes'),
  actualizarInformeBitacora: jest.fn(),
  cerrarSesionConBitacora: jest.fn(),
  listarAgendaSesiones: jest.fn(),
  listarInformesBitacora: jest.fn(),
}));
jest.mock('@/api/seguimiento', () => ({
  ...jest.requireActual('@/api/seguimiento'),
  descargarInforme: jest.fn(),
  obtenerInformeAcompanamiento: jest.fn(),
}));
jest.mock(
  'expo-file-system/legacy',
  () => ({
    cacheDirectory: 'file:///cache/',
    EncodingType: { Base64: 'base64' },
    writeAsStringAsync: jest.fn(async () => undefined),
  }),
  { virtual: true },
);
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

const sesionMock = useSession as jest.Mock;
const informeMock = obtenerInformeAcompanamiento as jest.Mock;
const descargarMock = descargarInforme as jest.Mock;
const bitacorasMock = listarInformesBitacora as jest.Mock;
const agendaMock = listarAgendaSesiones as jest.Mock;
const cerrarMock = cerrarSesionConBitacora as jest.Mock;
const actualizarMock = actualizarInformeBitacora as jest.Mock;

const dia = 24 * 3600_000;
const en = (ms: number) => new Date(Date.now() + ms).toISOString();

const REPORTE = {
  periodo: { id: 1, nombre: 'Periodo 2026' },
  cards: {
    estudiantes: 30,
    criticos: 2,
    en_riesgo: 0,
    planes_en_curso: 4,
    recuperaciones_efectivas: 1,
  },
  grupos: [
    {
      grupo_id: 1,
      grupo: 'Sexto A',
      grado: 'Sexto',
      estudiantes: 30,
      criticos: 2,
      en_riesgo: 1,
      planes_en_curso: 4,
      recuperaciones_efectivas: 1,
      asistencia_porcentaje: '92.5',
    },
  ],
  grados: [
    {
      grado_id: 1,
      grado: 'Sexto',
      grupos: 1,
      estudiantes: 30,
      criticos: 2,
      en_riesgo: 1,
      planes_en_curso: 4,
      recuperaciones_efectivas: 1,
      asistencia_porcentaje: null,
    },
  ],
  asistencia_por_grupo: [
    {
      grupo: 'Sexto A',
      presentes: 9,
      tardes: 1,
      ausentes: 1,
      excusas: 0,
      total: 11,
      porcentaje: '90.9',
    },
  ],
  asistencia_estudiantes: [
    {
      estudiante: 'Ana Ruiz',
      grupo: 'Sexto A',
      presente: 9,
      tarde: 1,
      ausente: 1,
      excusa: 0,
      porcentaje: null,
    },
  ],
  asignaturas: [
    {
      asignatura_id: 1,
      asignatura: 'Matemáticas',
      estudiantes: 30,
      promedio: 3.4,
      bajo_umbral: 5,
      recuperaciones_efectivas: 1,
    },
    {
      asignatura_id: 2,
      asignatura: 'Física',
      estudiantes: 10,
      promedio: null,
      bajo_umbral: 0,
      recuperaciones_efectivas: 0,
    },
  ],
  tutores: [
    { tutor: 'Luis Tutor', estudiantes: 3, planes: 4, sesiones: 6, recuperaciones_efectivas: 1 },
  ],
  recuperaciones: [
    {
      id: 1,
      plan: 5,
      estudiante_nombre: 'Ana Ruiz',
      asignatura_nombre: 'Matemáticas',
      grupo_nombre: 'Sexto A',
      nota_inicial: '2.0',
      nota_posterior: '4.0',
      mejora: '2.0',
      recuperacion_efectiva: true,
      observaciones: '',
      fecha_registro: '2026-10-01',
    },
    {
      id: 2,
      plan: 6,
      estudiante_nombre: 'Beto Díaz',
      asignatura_nombre: 'Física',
      grupo_nombre: 'Sexto A',
      nota_inicial: '2.0',
      nota_posterior: '2.1',
      mejora: '0.1',
      recuperacion_efectiva: false,
      observaciones: '',
      fecha_registro: '2026-10-01',
    },
  ],
  filtros: {
    grupos: [{ id: 1, nombre: 'Sexto A' }],
    asignaturas: [{ id: 1, nombre: 'Matemáticas' }],
    tutores: [{ id: 9, nombre: 'Luis Tutor' }],
  },
};

const BITACORA: InformeBitacora = {
  id: 3,
  sesion: 8,
  estudiante: 'Ana Ruiz',
  grado: 'Sexto',
  asignatura: 'Matemáticas',
  tutor: 'Luis Tutor',
  fecha_sesion: '2026-10-01T10:00:00Z',
  temas: 'Fracciones',
  desarrollo: 'Ejercicios',
  acuerdos: '',
  observaciones: '',
  fecha_cierre: '2026-10-01T11:00:00Z',
  creada_por_nombre: 'Luis Tutor',
};

function sesionTerminada(extra: Partial<SesionTutoria> = {}): SesionTutoria {
  return {
    id: 8,
    plan: 5,
    tutor: 9,
    tutor_nombre: 'Luis Tutor',
    estudiante_nombre: 'Ana Ruiz',
    asignatura_nombre: 'Matemáticas',
    inicio: en(-dia),
    fin: en(-dia + 3600_000),
    modalidad: 'presencial',
    lugar: 'Aula',
    enlace_virtual: '',
    notas: '',
    estado: 'programada',
    motivo_cancelacion: '',
    asistencia: 'pendiente',
    asistencia_fecha: null,
    inasistencias_tutorias: 0,
    bitacora: null,
    ...extra,
  };
}

function comoRol(rol: string | null) {
  sesionMock.mockReturnValue({ sesion: rol ? { usuario: { rol } } : null });
}

beforeEach(() => {
  jest.clearAllMocks();
  informeMock.mockResolvedValue(REPORTE);
  bitacorasMock.mockResolvedValue([BITACORA]);
  agendaMock.mockResolvedValue([]);
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
});

afterEach(() => jest.restoreAllMocks());

describe('acceso y contenedor', () => {
  test('InformesScreen titula según el rol y abre la agenda', async () => {
    comoRol('tutor');
    const navigation = { setOptions: jest.fn(), navigate: jest.fn() };
    await render(<InformesScreen navigation={navigation as never} route={{} as never} />);
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Mis informes' });
    await fireEvent.press(await screen.findByText('Ver mi agenda'));
    expect(navigation.navigate).toHaveBeenCalledWith('Agenda');
  });

  test('coordinación ve el título general', async () => {
    comoRol('coordinador');
    const navigation = { setOptions: jest.fn(), navigate: jest.fn() };
    await render(<InformesScreen navigation={navigation as never} route={{} as never} />);
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Informes de acompañamiento' });
  });

  test.each(['estudiante', 'acudiente'])('un %s no accede', async (rol) => {
    comoRol(rol);
    await render(<InformesPanel embedded onOpenAgenda={jest.fn()} />);
    expect(screen.getByText(/para tutores y coordinación/)).toBeTruthy();
  });
});

describe('informes del tutor', () => {
  async function abrir(sesiones: SesionTutoria[]) {
    comoRol('tutor');
    agendaMock.mockResolvedValue(sesiones);
    await render(<InformesPanel onOpenAgenda={jest.fn()} />);
  }

  test('sin sesiones pendientes y con informes ya registrados', async () => {
    await abrir([]);
    expect(await screen.findByText(/No tienes sesiones terminadas/)).toBeTruthy();
    expect(await screen.findByText('Ana Ruiz · Matemáticas')).toBeTruthy();
    expect(screen.queryByText('Editar informe')).toBeNull();
  });

  test('sin informes aún', async () => {
    bitacorasMock.mockResolvedValue([]);
    await abrir([]);
    expect(await screen.findByText('Todavía no has registrado informes de sesión.')).toBeTruthy();
  });

  test('errores de carga', async () => {
    agendaMock.mockRejectedValue(new Error('x'));
    bitacorasMock.mockRejectedValue(new Error('x'));
    comoRol('tutor');
    await render(<InformesPanel onOpenAgenda={jest.fn()} />);
    expect(await screen.findByText(/No pudimos cargar tus sesiones asignadas/)).toBeTruthy();
    expect(await screen.findByText(/No pudimos cargar los informes de sesión/)).toBeTruthy();
  });

  test('registra el informe de una sesión terminada', async () => {
    cerrarMock.mockResolvedValue({});
    await abrir([
      sesionTerminada(),
      sesionTerminada({ id: 9, estado: 'cancelada' }),
      sesionTerminada({ id: 10, inicio: en(dia), fin: en(dia + 3600_000) }),
    ]);
    await fireEvent.press(await screen.findByText(/Ana Ruiz · Matemáticas · /));
    expect(screen.getAllByText('Registrar informe de tutoría').length).toBeGreaterThan(0);
    const guardar = screen.getByText('Guardar informe');
    await fireEvent.changeText(screen.getByLabelText('Temas tratados'), ' T ');
    await fireEvent.changeText(screen.getByLabelText('Desarrollo de la tutoría'), ' D ');
    await fireEvent.changeText(screen.getByLabelText('Acuerdos y próximos pasos'), ' A ');
    await fireEvent.changeText(screen.getByLabelText('Observaciones'), ' O ');
    await fireEvent.press(guardar);
    await waitFor(() =>
      expect(cerrarMock).toHaveBeenCalledWith(8, {
        temas: 'T',
        desarrollo: 'D',
        acuerdos: 'A',
        observaciones: 'O',
      }),
    );
    await waitFor(() => expect(agendaMock).toHaveBeenCalledTimes(2));
  });

  test('el botón atrás cierra el formulario del informe', async () => {
    await abrir([sesionTerminada()]);
    await fireEvent.press(await screen.findByText(/Ana Ruiz · Matemáticas · /));
    await fireEvent.press(screen.getByRole('button', { name: 'cerrar modal' }));
    expect(screen.queryByText('Guardar informe')).toBeNull();
  });

  test('sin desarrollo no se guarda y los errores se muestran', async () => {
    await abrir([sesionTerminada()]);
    await fireEvent.press(await screen.findByText(/Ana Ruiz · Matemáticas · /));
    await fireEvent.press(screen.getByText('Guardar informe'));
    expect(cerrarMock).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Desarrollo de la tutoría'), 'D');
    cerrarMock.mockRejectedValueOnce({ error: { message: 'Sesión cerrada' } });
    await fireEvent.press(screen.getByText('Guardar informe'));
    expect(await screen.findByText('Sesión cerrada')).toBeTruthy();
    cerrarMock.mockRejectedValueOnce(new Error('red'));
    await fireEvent.press(screen.getByText('Guardar informe'));
    expect(await screen.findByText(/No se pudo guardar el informe/)).toBeTruthy();
  });
});

describe('informe de coordinación', () => {
  async function abrir() {
    comoRol('coordinador');
    await render(<InformesPanel embedded onOpenAgenda={jest.fn()} />);
    await screen.findByText('Periodo 2026');
  }

  test('muestra indicadores y el tablero por grado', async () => {
    await abrir();
    expect(screen.getByText('Recuperaciones efectivas')).toBeTruthy();
    expect(screen.getByText('Grado Sexto')).toBeTruthy();
    expect(screen.getByText('Sexto · Sexto A')).toBeTruthy();
    expect(screen.getByText(/Asistencia registrada: Sin dato/)).toBeTruthy();
    expect(screen.getByText(/Asistencia promedio registrada: 92.5%/)).toBeTruthy();
  });

  test('cada pestaña muestra su tabla', async () => {
    await abrir();
    await fireEvent.press(screen.getByText('Asistencia'));
    expect(screen.getByText('Grupo Sexto A')).toBeTruthy();
    expect(
      screen.getByText(/9 presentes · 1 tardes · 1 ausentes · 0 excusas · Sin dato/),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText('Asignaturas'));
    expect(screen.getByText(/Promedio: 3.4 · 30 estudiantes/)).toBeTruthy();
    expect(screen.getByText(/Promedio: Sin notas/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Tutores'));
    expect(screen.getByText(/3 estudiantes · 4 planes · 6 sesiones/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Recuperación'));
    expect(screen.getByText('Recuperación efectiva')).toBeTruthy();
    expect(screen.getByText('No alcanzó la nota aprobatoria')).toBeTruthy();
  });

  test('las pestañas sin datos avisan', async () => {
    informeMock.mockResolvedValue({
      ...REPORTE,
      grupos: [],
      asignaturas: [],
      tutores: [],
      recuperaciones: [],
    });
    await abrir();
    expect(screen.getByText('No hay matrículas para esos filtros.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Asignaturas'));
    expect(screen.getByText('No hay notas para los filtros.')).toBeTruthy();
    await fireEvent.press(screen.getAllByText('Tutores')[0]);
    expect(screen.getByText('No hay planes asignados.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Recuperación'));
    expect(screen.getByText(/Todavía no se han registrado evaluaciones posteriores/)).toBeTruthy();
  });

  test('los filtros por grupo, asignatura y tutor se aplican y se deseleccionan', async () => {
    await abrir();
    for (const nombre of ['Sexto A', 'Matemáticas', 'Luis Tutor']) {
      await fireEvent.press(screen.getAllByText(nombre)[0]);
      await waitFor(() => expect(informeMock).toHaveBeenCalledTimes(informeMock.mock.calls.length));
    }
    await waitFor(() =>
      expect(informeMock).toHaveBeenLastCalledWith({ grupo: 1, asignatura: 1, tutor: 9 }),
    );
    for (const nombre of ['Sexto A', 'Matemáticas', 'Luis Tutor']) {
      await fireEvent.press(screen.getAllByText(nombre)[0]);
    }
    await waitFor(() =>
      expect(informeMock).toHaveBeenLastCalledWith({ grupo: null, asignatura: null, tutor: null }),
    );
    await fireEvent.press(screen.getAllByText('Todos')[0]);
    await fireEvent.press(screen.getByText('Todas'));
    await fireEvent.press(screen.getAllByText('Todos')[1]);
  });

  test('sin tutores no muestra el filtro de tutor', async () => {
    informeMock.mockResolvedValue({ ...REPORTE, filtros: { ...REPORTE.filtros, tutores: [] } });
    await abrir();
    expect(screen.queryByText('Filtrar por tutor')).toBeNull();
  });

  test('error al cargar el informe', async () => {
    informeMock.mockRejectedValue(new Error('x'));
    comoRol('coordinador');
    await render(<InformesPanel onOpenAgenda={jest.fn()} />);
    expect(await screen.findByText(/No pudimos cargar los informes\./)).toBeTruthy();
  });

  test('busca informes de sesión con filtros recortados', async () => {
    await abrir();
    await fireEvent.changeText(screen.getByLabelText('Nombre del docente'), ' Luis ');
    await fireEvent.changeText(screen.getByLabelText('Grado del estudiante'), ' Sexto ');
    await fireEvent.changeText(screen.getByLabelText('Nombre del estudiante'), ' Ana ');
    await fireEvent.changeText(screen.getByLabelText('Materia de la tutoría'), ' Mate ');
    await fireEvent.press(screen.getByText('Buscar informes'));
    await waitFor(() =>
      expect(bitacorasMock).toHaveBeenLastCalledWith({
        docente: 'Luis',
        grado: 'Sexto',
        estudiante: 'Ana',
        materia: 'Mate',
      }),
    );
    await fireEvent.press(screen.getByText('Buscar informes')); // con el borrador vacío
  });

  test('avisa si no hay informes y si falla la carga de informes de sesión', async () => {
    bitacorasMock.mockResolvedValueOnce([]);
    await abrir();
    expect(await screen.findByText(/No hay informes que coincidan/)).toBeTruthy();
    bitacorasMock.mockRejectedValueOnce(new Error('x'));
    await fireEvent.press(screen.getByText('Buscar informes'));
    expect(await screen.findByText(/No pudimos cargar los informes de sesión/)).toBeTruthy();
  });

  test('coordinación edita un informe guardado', async () => {
    actualizarMock.mockResolvedValue({});
    await abrir();
    await fireEvent.press(await screen.findByText('Editar informe'));
    await fireEvent.changeText(screen.getByLabelText('Temas'), 'Nuevos temas');
    await fireEvent.press(screen.getByText('Guardar cambios'));
    await waitFor(() =>
      expect(actualizarMock).toHaveBeenCalledWith(3, {
        temas: 'Nuevos temas',
        desarrollo: 'Ejercicios',
        acuerdos: '',
        observaciones: '',
      }),
    );
    await waitFor(() => expect(bitacorasMock).toHaveBeenCalledTimes(2));
  });

  test('el botón atrás cierra el editor y un informe sin grado lo indica', async () => {
    bitacorasMock.mockResolvedValue([{ ...BITACORA, grado: '' }]);
    await abrir();
    expect(await screen.findByText(/Grado: Sin grado/)).toBeTruthy();
    await fireEvent.press(await screen.findByText('Editar informe'));
    await fireEvent.press(screen.getByRole('button', { name: 'cerrar modal' }));
    expect(screen.queryByText('Guardar cambios')).toBeNull();
  });

  test('un fallo al editar muestra el error y se puede cancelar', async () => {
    actualizarMock.mockRejectedValue(new Error('x'));
    await abrir();
    await fireEvent.press(await screen.findByText('Editar informe'));
    await fireEvent.press(screen.getByText('Guardar cambios'));
    expect(await screen.findByText(/No se pudo guardar el informe/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Cancelar'));
    await waitFor(() => expect(screen.queryByText('Guardar cambios')).toBeNull());
  });
});

describe('exportar a CSV', () => {
  async function abrir() {
    comoRol('administrador');
    await render(<InformesPanel onOpenAgenda={jest.fn()} />);
    await screen.findByText('Periodo 2026');
  }

  test('en móvil guarda el archivo y lo comparte', async () => {
    descargarMock.mockResolvedValue({
      headers: { get: () => 'attachment; filename="informe-grupos-1.csv"' },
      arrayBuffer: async () => new Uint8Array([97, 98]).buffer,
    });
    await abrir();
    await fireEvent.press(screen.getByText('Exportar grupos a CSV'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled(), { timeout: 5000 });
    expect(descargarMock).toHaveBeenCalledWith('grupos', {
      grupo: null,
      asignatura: null,
      tutor: null,
    });
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
      'file:///cache/informe-grupos-1.csv',
      btoa('ab'),
      { encoding: 'base64' },
    );
  });

  test('sin cabecera usa un nombre por defecto y, sin compartir, no comparte', async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false);
    descargarMock.mockResolvedValue({
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    await abrir();
    await fireEvent.press(screen.getByText('Asistencia'));
    await fireEvent.press(screen.getByText('Exportar asistencia a CSV'));
    await waitFor(() => expect(FileSystem.writeAsStringAsync).toHaveBeenCalled(), {
      timeout: 5000,
    });
    expect((FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0][0]).toBe(
      'file:///cache/informe-asistencia.csv',
    );
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  test('en la web descarga mediante un enlace temporal', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const click = jest.fn();
    const ancla: Record<string, unknown> = { click };
    (globalThis as Record<string, unknown>).document = { createElement: () => ancla };
    (globalThis.URL as unknown as Record<string, unknown>).createObjectURL = jest.fn(
      () => 'blob:x',
    );
    (globalThis.URL as unknown as Record<string, unknown>).revokeObjectURL = jest.fn();
    descargarMock.mockResolvedValue({
      headers: { get: () => 'attachment; filename=informe.csv' },
      blob: async () => new Blob(['x']),
    });
    await abrir();
    await fireEvent.press(screen.getByText('Exportar grupos a CSV'));
    await waitFor(() => expect(click).toHaveBeenCalled(), { timeout: 5000 });
    expect(ancla.download).toBe('informe.csv');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1100));
    });
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    delete (globalThis as Record<string, unknown>).document;
  });

  test('si falla muestra el aviso', async () => {
    descargarMock.mockRejectedValue(new Error('x'));
    await abrir();
    await act(async () => {
      await fireEvent.press(screen.getByText('Exportar grupos a CSV'));
    });
    expect(await screen.findByText('No pudimos generar el archivo.')).toBeTruthy();
  });
});
