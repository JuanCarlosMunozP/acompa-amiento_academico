import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Linking, Platform } from 'react-native';

import {
  cancelarSesionConMotivo,
  cerrarSesionConBitacora,
  descargarMaterialSesion,
  listarAgendaSesiones,
  subirMaterialSesion,
  type SesionTutoria,
} from '@/api/planes';
import { AgendaScreen } from '@/screens/tutorias/AgendaScreen';
import { useSession } from '@/store/session';

const mockNav = {
  navigate: jest.fn(),
  setOptions: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
};
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav }));
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
  listarAgendaSesiones: jest.fn(),
  cancelarSesionConMotivo: jest.fn(),
  cerrarSesionConBitacora: jest.fn(),
  descargarMaterialSesion: jest.fn(),
  subirMaterialSesion: jest.fn(),
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
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

const agendaMock = listarAgendaSesiones as jest.Mock;
const cancelarMock = cancelarSesionConMotivo as jest.Mock;
const cerrarMock = cerrarSesionConBitacora as jest.Mock;
const descargarMock = descargarMaterialSesion as jest.Mock;
const subirMock = subirMaterialSesion as jest.Mock;
const sesionMock = useSession as jest.Mock;
const pickerMock = DocumentPicker.getDocumentAsync as jest.Mock;

const dia = 24 * 3600 * 1000;
const en = (ms: number) => new Date(Date.now() + ms).toISOString();

function sesion(extra: Partial<SesionTutoria> = {}): SesionTutoria {
  return {
    id: 1,
    plan: 5,
    tutor: 9,
    tutor_nombre: 'Luis Tutor',
    estudiante_nombre: 'Beatriz Castro',
    asignatura_nombre: 'Matemáticas',
    inicio: en(dia),
    fin: en(dia + 3600_000),
    modalidad: 'presencial',
    lugar: 'Aula 1',
    enlace_virtual: '',
    notas: '',
    estado: 'programada',
    motivo_cancelacion: '',
    asistencia: 'pendiente',
    asistencia_fecha: null,
    inasistencias_tutorias: 0,
    bitacora: null,
    materiales: [],
    ...extra,
  };
}

const pasada = (extra: Partial<SesionTutoria> = {}) =>
  sesion({ inicio: en(-dia), fin: en(-dia + 3600_000), ...extra });

function comoRol(rol: string | null) {
  sesionMock.mockReturnValue({ sesion: rol ? { usuario: { rol } } : null });
}

async function abrir(rol: string | null, sesiones: SesionTutoria[] = []) {
  comoRol(rol);
  agendaMock.mockResolvedValue(sesiones);
  await render(<AgendaScreen />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNav.addListener.mockReturnValue(jest.fn());
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
});

afterEach(() => jest.restoreAllMocks());

describe('acceso', () => {
  test('sin sesión pide iniciar sesión', async () => {
    await abrir(null);
    expect(screen.getByText(/Inicia sesión para consultar/)).toBeTruthy();
  });

  test('un rol sin agenda vuelve al inicio', async () => {
    await abrir('coordinador');
    expect(screen.getByText(/exclusiva para tutores y estudiantes/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Volver al inicio'));
    expect(mockNav.navigate).toHaveBeenCalledWith('Home');
  });
});

describe('agenda del tutor', () => {
  test('título, lista vacía y recarga al enfocar', async () => {
    await abrir('tutor');
    expect(await screen.findByText(/Todavía no tienes sesiones asignadas/)).toBeTruthy();
    expect(mockNav.setOptions).toHaveBeenCalledWith({ title: 'Agenda de tutorías' });
    const alEnfocar = (mockNav.addListener.mock.calls as unknown as [string, () => void][])[0][1];
    await act(async () => alEnfocar());
    expect(agendaMock).toHaveBeenCalledTimes(2);
  });

  test('error de carga', async () => {
    comoRol('tutor');
    agendaMock.mockRejectedValue(new Error('x'));
    await render(<AgendaScreen />);
    expect(await screen.findByText(/No pudimos cargar la agenda/)).toBeTruthy();
  });

  test('muestra los detalles de cada sesión ordenados por fecha', async () => {
    await abrir('tutor', [
      sesion({
        id: 2,
        inicio: en(3 * dia),
        fin: en(3 * dia + 3600_000),
        modalidad: 'virtual',
        lugar: '',
        enlace_virtual: 'https://meet.test/abc',
        notas: 'Trae el taller',
        inasistencias_tutorias: 2,
      }),
      sesion({ id: 1, asignatura_nombre: 'Física' }),
      pasada({
        id: 3,
        estado: 'realizada',
        asistencia: 'excusa',
        bitacora: {
          temas: 'Fracciones',
          desarrollo: 'Ejercicios',
          acuerdos: '',
          observaciones: '',
          fecha_cierre: en(-dia),
        },
        materiales: [{ id: 4, titulo: 'Guía', descripcion: '', fecha_creacion: en(-dia) }],
      }),
      sesion({
        id: 5,
        estado: 'cancelada',
        motivo_cancelacion: 'Enfermedad',
        asignatura_nombre: 'Química',
      }),
    ]);
    expect(await screen.findByText('Física')).toBeTruthy();
    expect(screen.getByText('https://meet.test/abc')).toBeTruthy();
    expect(screen.getByText('Trae el taller')).toBeTruthy();
    expect(screen.getByText(/Inasistencias de tutoría del estudiante: 2/)).toBeTruthy();
    expect(screen.getByText(/asistencia: justificada/)).toBeTruthy();
    expect(screen.getByText('Temas: Fracciones')).toBeTruthy();
    expect(screen.getByText('Cancelada')).toBeTruthy();
    expect(screen.getByText('Motivo: Enfermedad')).toBeTruthy();
    expect(screen.getByText('Descargar · Guía')).toBeTruthy();
    const abrirUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await fireEvent.press(screen.getByText('https://meet.test/abc'));
    expect(abrirUrl).toHaveBeenCalledWith('https://meet.test/abc');
  });

  test('reprogramar lleva a la pantalla de programación', async () => {
    const s = sesion();
    await abrir('tutor', [s]);
    await fireEvent.press(await screen.findByText('Reprogramar'));
    expect(mockNav.navigate).toHaveBeenCalledWith('ProgramarSesion', { planId: 5, session: s });
  });

  describe('cancelar', () => {
    test('exige un motivo', async () => {
      await abrir('tutor', [sesion()]);
      await fireEvent.press(await screen.findByText('Cancelar sesión'));
      await fireEvent.press(screen.getByText('Sí, cancelar'));
      expect(await screen.findByText('Indica el motivo de cancelación.')).toBeTruthy();
      expect(cancelarMock).not.toHaveBeenCalled();
    });

    test('cancela con motivo y recarga', async () => {
      cancelarMock.mockResolvedValue({});
      await abrir('tutor', [sesion()]);
      await fireEvent.press(await screen.findByText('Cancelar sesión'));
      await fireEvent.changeText(screen.getByLabelText('Motivo de cancelación'), ' Enfermedad ');
      await fireEvent.press(screen.getByText('Sí, cancelar'));
      await waitFor(() => expect(cancelarMock).toHaveBeenCalledWith(1, 'Enfermedad'));
      await waitFor(() => expect(agendaMock).toHaveBeenCalledTimes(2));
    });

    test('muestra el error del servidor o uno genérico, y se puede volver', async () => {
      cancelarMock.mockRejectedValueOnce({ error: { message: 'Ya no se puede' } });
      await abrir('tutor', [sesion()]);
      await fireEvent.press(await screen.findByText('Cancelar sesión'));
      await fireEvent.changeText(screen.getByLabelText('Motivo de cancelación'), 'x');
      await fireEvent.press(screen.getByText('Sí, cancelar'));
      expect(await screen.findByText('Ya no se puede')).toBeTruthy();
      cancelarMock.mockRejectedValueOnce(new Error('red'));
      await fireEvent.press(screen.getByText('Sí, cancelar'));
      expect(await screen.findByText('No se pudo cancelar.')).toBeTruthy();
      await fireEvent.press(screen.getByText('Volver'));
      expect(screen.getByText('Cancelar sesión')).toBeTruthy();
    });
  });

  describe('cerrar sesión con bitácora', () => {
    async function abrirCierre() {
      await abrir('tutor', [pasada()]);
      await fireEvent.press(await screen.findByText('Cerrar sesión y registrar bitácora'));
    }

    test('el botón atrás cierra el formulario de la bitácora', async () => {
      await abrirCierre();
      await fireEvent.press(screen.getByRole('button', { name: 'cerrar modal' }));
      expect(screen.queryByText('Guardar bitácora y cerrar')).toBeNull();
    });

    test('guarda la bitácora completa', async () => {
      cerrarMock.mockResolvedValue({});
      await abrirCierre();
      await fireEvent.changeText(screen.getByLabelText('Temas tratados'), 'T');
      await fireEvent.changeText(screen.getByLabelText('Desarrollo de la sesión'), 'D');
      await fireEvent.changeText(screen.getByLabelText('Acuerdos y próximos pasos'), 'A');
      await fireEvent.changeText(screen.getByLabelText('Observaciones'), 'O');
      await fireEvent.press(screen.getByText('Guardar bitácora y cerrar'));
      await waitFor(() =>
        expect(cerrarMock).toHaveBeenCalledWith(1, {
          temas: 'T',
          desarrollo: 'D',
          acuerdos: 'A',
          observaciones: 'O',
        }),
      );
    });

    test('muestra el error y permite cancelar el cierre', async () => {
      cerrarMock.mockRejectedValueOnce({ error: { message: 'Plan cerrado' } });
      await abrirCierre();
      await fireEvent.changeText(screen.getByLabelText('Desarrollo de la sesión'), 'D');
      await fireEvent.press(screen.getByText('Guardar bitácora y cerrar'));
      expect((await screen.findAllByText('Plan cerrado')).length).toBeGreaterThan(0);
      cerrarMock.mockRejectedValueOnce(new Error('x'));
      await fireEvent.press(screen.getByText('Guardar bitácora y cerrar'));
      expect((await screen.findAllByText('No se pudo cerrar la sesión.')).length).toBeGreaterThan(
        0,
      );
      await fireEvent.press(screen.getByText('Cancelar'));
      await waitFor(() => expect(screen.queryByText('Guardar bitácora y cerrar')).toBeNull());
    });
  });

  describe('materiales', () => {
    const material = { id: 4, titulo: 'Guía', descripcion: '', fecha_creacion: en(-dia) };

    test('subir: cancelado, archivo nativo y archivo web', async () => {
      subirMock.mockResolvedValue({});
      await abrir('tutor', [sesion()]);
      pickerMock.mockResolvedValueOnce({ canceled: true });
      await fireEvent.press(await screen.findByText('Seleccionar y subir archivo'));
      await waitFor(() => expect(pickerMock).toHaveBeenCalledTimes(1));
      expect(subirMock).not.toHaveBeenCalled();

      pickerMock.mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: 'file:///a.pdf', name: 'a.pdf', mimeType: 'application/pdf' }],
      });
      await fireEvent.press(screen.getByText('Seleccionar y subir archivo'));
      await waitFor(() =>
        expect(subirMock).toHaveBeenCalledWith(1, 'a.pdf', '', expect.anything()),
      );

      jest.replaceProperty(Platform, 'OS', 'web');
      pickerMock.mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: 'blob:x', name: 'b.pdf', file: new Blob(['x']) }],
      });
      await fireEvent.changeText(
        screen.getByLabelText('Título del material (opcional)'),
        'Mi guía',
      );
      await fireEvent.press(screen.getByText('Seleccionar y subir archivo'));
      await waitFor(() =>
        expect(subirMock).toHaveBeenCalledWith(1, 'Mi guía', '', expect.anything()),
      );
    });

    test('subir un archivo nativo sin tipo MIME usa el genérico', async () => {
      subirMock.mockResolvedValue({});
      await abrir('tutor', [sesion()]);
      pickerMock.mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: 'file:///x.bin', name: 'x.bin' }],
      });
      await fireEvent.press(await screen.findByText('Seleccionar y subir archivo'));
      await waitFor(() => expect(subirMock).toHaveBeenCalled());
    });

    test('una sesión sin lista de materiales no falla', async () => {
      await abrir('tutor', [sesion({ materiales: undefined })]);
      expect(await screen.findByText('Seleccionar y subir archivo')).toBeTruthy();
    });

    test('subir: errores', async () => {
      await abrir('tutor', [sesion()]);
      pickerMock.mockRejectedValueOnce({ error: { message: 'Archivo muy grande' } });
      await fireEvent.press(await screen.findByText('Seleccionar y subir archivo'));
      expect(await screen.findByText('Archivo muy grande')).toBeTruthy();
      pickerMock.mockRejectedValueOnce(new Error('x'));
      await fireEvent.press(screen.getByText('Seleccionar y subir archivo'));
      expect(await screen.findByText('No se pudo subir el material.')).toBeTruthy();
    });

    test('descargar en dispositivo móvil comparte el archivo', async () => {
      descargarMock.mockResolvedValue({
        headers: { get: () => 'attachment; filename="guia final.pdf"' },
        arrayBuffer: async () => new Uint8Array([72, 105]).buffer,
      });
      await abrir('tutor', [sesion({ materiales: [material] })]);
      await fireEvent.press(await screen.findByText('Descargar · Guía'));
      await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled(), { timeout: 8000 });
      expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
        'file:///cache/guia final.pdf',
        btoa('Hi'),
        { encoding: 'base64' },
      );
    });

    test('descargar sin cabecera usa el título y, si compartir no está disponible, no comparte', async () => {
      (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
      descargarMock.mockResolvedValue({
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
      });
      await abrir('tutor', [sesion({ materiales: [material] })]);
      await fireEvent.press(await screen.findByText('Descargar · Guía'));
      await waitFor(() => expect(FileSystem.writeAsStringAsync).toHaveBeenCalled(), {
        timeout: 8000,
      });
      expect((FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0][0]).toBe(
        'file:///cache/Guía',
      );
      expect(Sharing.shareAsync).not.toHaveBeenCalled();
    });

    test('descargar en la web crea un enlace temporal', async () => {
      jest.replaceProperty(Platform, 'OS', 'web');
      const click = jest.fn();
      const ancla: Record<string, unknown> = { click };
      (globalThis as Record<string, unknown>).document = { createElement: () => ancla };
      (globalThis.URL as unknown as Record<string, unknown>).createObjectURL = jest.fn(
        () => 'blob:u',
      );
      (globalThis.URL as unknown as Record<string, unknown>).revokeObjectURL = jest.fn();
      descargarMock.mockResolvedValue({
        headers: { get: () => 'attachment; filename=guia.pdf' },
        blob: async () => new Blob(['x']),
      });
      await abrir('tutor', [sesion({ materiales: [material] })]);
      await fireEvent.press(await screen.findByText('Descargar · Guía'));
      await waitFor(() => expect(click).toHaveBeenCalled());
      expect(ancla.download).toBe('guia.pdf');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1100));
      });
      expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:u');
      delete (globalThis as Record<string, unknown>).document;
    });

    test('descargar con error', async () => {
      descargarMock.mockRejectedValue(new Error('x'));
      await abrir('tutor', [sesion({ materiales: [material] })]);
      await fireEvent.press(await screen.findByText('Descargar · Guía'));
      expect(await screen.findByText('No se pudo descargar el material.')).toBeTruthy();
    });
  });
});

describe('agenda del estudiante', () => {
  test('lista vacía, título y reloj que revisa la hora', async () => {
    jest.useFakeTimers();
    try {
      await abrir('estudiante');
      expect(await screen.findByText(/Aún no tienes tutorías programadas/)).toBeTruthy();
      expect(mockNav.setOptions).toHaveBeenCalledWith({ title: 'Tutorías por asistir' });
      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test('registra la asistencia de una sesión ya terminada', async () => {
    const s = pasada();
    await abrir('estudiante', [s, sesion({ id: 2 })]);
    await fireEvent.press(await screen.findByText('Registrar asistencia'));
    expect(mockNav.navigate).toHaveBeenCalledWith('Asistencia', { sesion: s });
    expect(screen.queryByText('Reprogramar')).toBeNull();
    expect(screen.queryByText('Cancelar sesión')).toBeNull();
  });
});
