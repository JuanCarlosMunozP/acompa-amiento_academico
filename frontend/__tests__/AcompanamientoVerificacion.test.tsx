import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  darVistoBueno,
  descargarEntrega,
  escribirDuda,
  listarDudas,
  listarEntregas,
  listarObservaciones,
  obtenerReporteImprimible,
  registrarObservacion,
  retroalimentarEntrega,
  subirEntrega,
  type Actividad,
  type Entrega,
  type SeguimientoPlan,
} from '@/api/planes';
import { AcompanamientoPlan } from '@/screens/planes/AcompanamientoPlan';
import { VerificacionPlan } from '@/screens/planes/VerificacionPlan';
import { abrirParaImprimir, elegirArchivo, guardarRespuesta } from '@/utils/archivos';

jest.mock('@/api/planes', () => ({
  ...jest.requireActual('@/api/planes'),
  darVistoBueno: jest.fn(),
  descargarEntrega: jest.fn(),
  escribirDuda: jest.fn(),
  listarDudas: jest.fn(),
  listarEntregas: jest.fn(),
  listarObservaciones: jest.fn(),
  obtenerReporteImprimible: jest.fn(),
  registrarObservacion: jest.fn(),
  retroalimentarEntrega: jest.fn(),
  subirEntrega: jest.fn(),
}));
jest.mock('@/utils/archivos', () => ({
  abrirParaImprimir: jest.fn(),
  elegirArchivo: jest.fn(),
  guardarRespuesta: jest.fn(),
}));

const dudasMock = listarDudas as jest.Mock;
const escribirMock = escribirDuda as jest.Mock;
const entregasMock = listarEntregas as jest.Mock;
const subirMock = subirEntrega as jest.Mock;
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

const retroMock = retroalimentarEntrega as jest.Mock;
const descargarMock = descargarEntrega as jest.Mock;
const elegirMock = elegirArchivo as jest.Mock;
const guardarMock = guardarRespuesta as jest.Mock;
const observacionesMock = listarObservaciones as jest.Mock;
const observarMock = registrarObservacion as jest.Mock;
const vistoMock = darVistoBueno as jest.Mock;
const reporteMock = obtenerReporteImprimible as jest.Mock;
const imprimirMock = abrirParaImprimir as jest.Mock;

const ACTIVIDAD: Actividad = {
  id: 4,
  titulo: 'Taller 1',
  descripcion: '',
  fecha_limite: '2030-01-01',
  completada: false,
  fecha_completada: null,
  vencida: false,
};

const DUDA = {
  id: 1,
  autor: 7,
  autor_nombre: 'Beatriz',
  autor_rol: 'estudiante',
  texto: '¿Cómo resuelvo el punto 3?',
  respuesta_a: null,
  creada: '2026-10-01T10:00:00Z',
};

const entrega = (extra: Partial<Entrega> = {}): Entrega => ({
  id: 20,
  actividad: 4,
  tipo: 'entrega',
  archivo_nombre: 'taller.pdf',
  comentario: '',
  fecha: '2026-10-02T10:00:00Z',
  retroalimentacion: null,
  ...extra,
});

const onCambio = jest.fn();

async function abrirAcompanamiento(
  props: Partial<React.ComponentProps<typeof AcompanamientoPlan>> = {},
) {
  await render(
    <AcompanamientoPlan
      planId={5}
      actividades={[ACTIVIDAD]}
      rol="estudiante"
      esDocenteResponsable={false}
      abierto
      onCambio={onCambio}
      {...props}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  dudasMock.mockResolvedValue([]);
  entregasMock.mockResolvedValue([]);
  observacionesMock.mockResolvedValue([]);
});

describe('dudas y aclaraciones', () => {
  test('sin actividades ni mensajes', async () => {
    await abrirAcompanamiento({ actividades: [] });
    expect(await screen.findByText('Aún no hay mensajes.')).toBeTruthy();
    expect(screen.getByText(/Cuando el docente cree actividades/)).toBeTruthy();
  });

  test('el estudiante escribe y recibe la lista actualizada', async () => {
    escribirMock.mockResolvedValue({});
    await abrirAcompanamiento();
    await fireEvent.changeText(
      await screen.findByLabelText('Escribe tu duda o aclaración'),
      '  Hola  ',
    );
    await fireEvent.press(screen.getByText('Enviar mensaje'));
    await waitFor(() => expect(escribirMock).toHaveBeenCalledWith(5, 'Hola', undefined));
    await waitFor(() => expect(dudasMock).toHaveBeenCalledTimes(2));
  });

  test('no se envía un mensaje vacío y los fallos se muestran', async () => {
    await abrirAcompanamiento();
    await fireEvent.press(await screen.findByText('Enviar mensaje'));
    expect(await screen.findByText('Escribe tu mensaje.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Escribe tu duda o aclaración'), 'x');
    escribirMock.mockRejectedValue(new Error('red'));
    await fireEvent.press(screen.getByText('Enviar mensaje'));
    expect(await screen.findByText(/No pudimos enviar el mensaje/)).toBeTruthy();
  });

  test('el docente responde a una duda', async () => {
    dudasMock.mockResolvedValue([
      DUDA,
      { ...DUDA, id: 2, respuesta_a: 1, texto: 'Mira el ejemplo' },
    ]);
    escribirMock.mockResolvedValue({});
    await abrirAcompanamiento({ rol: 'tutor', esDocenteResponsable: true });
    await fireEvent.press(await screen.findByText('Responder a Beatriz'));
    expect(screen.getByText('Respondiendo a Beatriz.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Tu respuesta'), 'Usa la fórmula');
    await fireEvent.press(screen.getByText('Enviar mensaje'));
    await waitFor(() => expect(escribirMock).toHaveBeenCalledWith(5, 'Usa la fórmula', 1));
    expect(screen.getAllByText('Responder a Beatriz')).toHaveLength(1); // la respuesta no se responde
  });

  test('quien solo lee no escribe y un error de carga se muestra', async () => {
    dudasMock.mockRejectedValue(new Error('x'));
    await abrirAcompanamiento({ rol: 'coordinador' });
    expect(await screen.findByText(/No pudimos cargar las dudas/)).toBeTruthy();
    expect(screen.queryByText('Enviar mensaje')).toBeNull();
  });

  test('con el expediente cerrado nadie escribe', async () => {
    dudasMock.mockResolvedValue([DUDA]);
    await abrirAcompanamiento({ abierto: false });
    await screen.findByText(DUDA.texto);
    expect(screen.queryByText('Enviar mensaje')).toBeNull();
    expect(screen.queryByText('Responder a Beatriz')).toBeNull();
  });
});

describe('entregas del estudiante', () => {
  test('sin entregas carga el archivo con su comentario', async () => {
    elegirMock.mockResolvedValue({ formulario: new FormData(), nombre: 'a.pdf' });
    subirMock.mockResolvedValue({});
    await abrirAcompanamiento();
    expect(await screen.findByText('Sin entregas todavía.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Comentario (opcional)'), ' listo ');
    await fireEvent.press(screen.getByText('Cargar entrega'));
    await waitFor(() => expect(subirMock).toHaveBeenCalledWith(4, expect.anything(), 'listo'));
    await waitFor(() => expect(onCambio).toHaveBeenCalled());
  });

  test('si no elige archivo no sube nada; los fallos se muestran', async () => {
    await abrirAcompanamiento();
    elegirMock.mockResolvedValueOnce(null);
    await fireEvent.press(await screen.findByText('Cargar entrega'));
    expect(subirMock).not.toHaveBeenCalled();
    elegirMock.mockResolvedValue({ formulario: new FormData(), nombre: 'a.pdf' });
    subirMock.mockRejectedValue(new Error('x'));
    await fireEvent.press(screen.getByText('Cargar entrega'));
    expect(await screen.findByText(/No pudimos cargar el archivo/)).toBeTruthy();
  });

  test('espera al docente mientras la entrega no tiene retroalimentación', async () => {
    entregasMock.mockResolvedValue([entrega({ comentario: 'Aquí va' })]);
    await abrirAcompanamiento();
    expect(await screen.findByText('Entrega · taller.pdf')).toBeTruthy();
    expect(screen.getByText('Aquí va')).toBeTruthy();
    expect(screen.queryByText('Cargar entrega')).toBeNull();
  });

  test('si el docente pide corrección, permite cargarla', async () => {
    entregasMock.mockResolvedValue([
      entrega({
        retroalimentacion: {
          id: 1,
          docente_nombre: null,
          comentario: 'Falta el procedimiento',
          requiere_correccion: true,
          fecha: '2026-10-03T10:00:00Z',
        },
      }),
      entrega({ id: 21, tipo: 'correccion', archivo_nombre: 'v2.pdf' }),
    ]);
    // la última entrega es una corrección aún sin revisar: espera
    await abrirAcompanamiento();
    expect(
      await screen.findByText(/Docente: Falta el procedimiento \(requiere corrección\)/),
    ).toBeTruthy();
    expect(screen.getByText('Corrección · v2.pdf')).toBeTruthy();
  });

  test('pedida la corrección, el botón cambia de texto', async () => {
    entregasMock.mockResolvedValue([
      entrega({
        retroalimentacion: {
          id: 1,
          docente_nombre: 'Luis',
          comentario: 'Corrige',
          requiere_correccion: true,
          fecha: '2026-10-03T10:00:00Z',
        },
      }),
    ]);
    await abrirAcompanamiento();
    expect(await screen.findByText('Cargar corrección')).toBeTruthy();
    expect(screen.getByText(/El docente pidió una corrección/)).toBeTruthy();
  });

  test('una actividad aceptada ya no admite cargas', async () => {
    entregasMock.mockResolvedValue([
      entrega({
        retroalimentacion: {
          id: 1,
          docente_nombre: 'Luis',
          comentario: 'Bien',
          requiere_correccion: false,
          fecha: '2026-10-03T10:00:00Z',
        },
      }),
    ]);
    await abrirAcompanamiento();
    expect(await screen.findByText('Actividad aceptada por el docente.')).toBeTruthy();
    expect(screen.getByText(/Luis: Bien \(aceptada\)/)).toBeTruthy();
    expect(screen.queryByText('Cargar entrega')).toBeNull();
  });

  test('descarga una entrega y avisa si falla', async () => {
    entregasMock.mockResolvedValue([entrega()]);
    descargarMock.mockResolvedValue({ ok: true });
    await abrirAcompanamiento();
    await fireEvent.press(await screen.findByText('Descargar taller.pdf'));
    await waitFor(() => expect(guardarMock).toHaveBeenCalledWith({ ok: true }, 'taller.pdf'));
    descargarMock.mockRejectedValue(new Error('x'));
    await fireEvent.press(screen.getByText('Descargar taller.pdf'));
    expect(await screen.findByText('No pudimos descargar el archivo.')).toBeTruthy();
  });

  test('error al cargar las entregas', async () => {
    entregasMock.mockRejectedValue(new Error('x'));
    await abrirAcompanamiento();
    expect(await screen.findByText(/No pudimos cargar las entregas/)).toBeTruthy();
  });
});

describe('retroalimentación del docente', () => {
  async function abrirRetro() {
    entregasMock.mockResolvedValue([entrega()]);
    await abrirAcompanamiento({ rol: 'tutor', esDocenteResponsable: true });
    await fireEvent.press(await screen.findByText('Retroalimentar'));
  }

  test('guarda la retroalimentación y pide corrección', async () => {
    retroMock.mockResolvedValue({});
    await abrirRetro();
    await fireEvent.changeText(
      screen.getByLabelText('Observaciones para el estudiante'),
      ' Revisa el punto 2 ',
    );
    await fireEvent(screen.getByLabelText('Requiere corrección'), 'valueChange', true);
    await fireEvent.press(screen.getByText('Guardar retroalimentación'));
    await waitFor(() =>
      expect(retroMock).toHaveBeenCalledWith(20, {
        comentario: 'Revisa el punto 2',
        requiere_correccion: true,
      }),
    );
  });

  test('exige el texto, muestra los fallos y se puede cancelar', async () => {
    await abrirRetro();
    await fireEvent.press(screen.getByText('Guardar retroalimentación'));
    expect(await screen.findByText('Escribe la retroalimentación.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Observaciones para el estudiante'), 'x');
    retroMock.mockRejectedValue(new Error('x'));
    await fireEvent.press(screen.getByText('Guardar retroalimentación'));
    expect(await screen.findByText(/No pudimos guardar la retroalimentación/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Cancelar'));
    await waitFor(() => expect(screen.queryByText('Guardar retroalimentación')).toBeNull());
  });

  test('el botón atrás cierra la retroalimentación', async () => {
    await abrirRetro();
    await fireEvent.press(screen.getByRole('button', { name: 'cerrar modal' }));
    await waitFor(() => expect(screen.queryByText('Guardar retroalimentación')).toBeNull());
  });

  test('el docente no retroalimenta en un expediente cerrado', async () => {
    entregasMock.mockResolvedValue([entrega()]);
    await abrirAcompanamiento({ rol: 'tutor', esDocenteResponsable: true, abierto: false });
    await screen.findByText('Entrega · taller.pdf');
    expect(screen.queryByText('Retroalimentar')).toBeNull();
  });
});

// ------------------------------------------------------------------ verificación de coordinación

const PLAN = { id: 5, estado: 'cerrado', visto_bueno: false } as SeguimientoPlan;

async function abrirVerificacion(
  props: Partial<React.ComponentProps<typeof VerificacionPlan>> = {},
) {
  await render(
    <VerificacionPlan
      plan={PLAN}
      coordina
      esDocenteResponsable={false}
      onCambio={onCambio}
      {...props}
    />,
  );
}

describe('VerificacionPlan', () => {
  test('quien no coordina ni es el docente no ve nada', async () => {
    await abrirVerificacion({ coordina: false });
    expect(screen.queryByText('Verificación de coordinación')).toBeNull();
    expect(observacionesMock).not.toHaveBeenCalled();
  });

  test('el docente ve las observaciones pero no registra', async () => {
    observacionesMock.mockResolvedValue([
      { id: 1, autor_nombre: null, texto: 'Todo en orden', creada: '2026-10-01' },
    ]);
    await abrirVerificacion({ coordina: false, esDocenteResponsable: true });
    expect(await screen.findByText('Todo en orden')).toBeTruthy();
    expect(screen.getByText('Coordinación')).toBeTruthy();
    expect(screen.queryByText('Registrar observación')).toBeNull();
    expect(screen.queryByText('Dar visto bueno')).toBeNull();
  });

  test('sin observaciones y con error de carga', async () => {
    await abrirVerificacion();
    expect(await screen.findByText('Todavía no hay observaciones.')).toBeTruthy();
    observacionesMock.mockRejectedValue(new Error('x'));
    await abrirVerificacion();
    expect(await screen.findByText(/No pudimos cargar las observaciones/)).toBeTruthy();
  });

  test('registra una observación', async () => {
    observarMock.mockResolvedValue({});
    await abrirVerificacion();
    await fireEvent.changeText(await screen.findByLabelText('Nueva observación'), ' Falta nota ');
    await fireEvent.press(screen.getByText('Registrar observación'));
    await waitFor(() => expect(observarMock).toHaveBeenCalledWith(5, 'Falta nota'));
    expect(await screen.findByText('Observación registrada.')).toBeTruthy();
    await waitFor(() => expect(observacionesMock).toHaveBeenCalledTimes(2));
  });

  test('exige texto y muestra el fallo', async () => {
    await abrirVerificacion();
    await fireEvent.press(await screen.findByText('Registrar observación'));
    expect(await screen.findByText('Escribe la observación.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Nueva observación'), 'x');
    observarMock.mockRejectedValue(new Error('x'));
    await fireEvent.press(screen.getByText('Registrar observación'));
    expect(await screen.findByText(/No pudimos registrar la observación/)).toBeTruthy();
  });

  test('da el visto bueno a un plan cerrado y avisa del cambio', async () => {
    vistoMock.mockResolvedValue({});
    await abrirVerificacion();
    expect(await screen.findByText('Pendiente del visto bueno de coordinación.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Dar visto bueno'));
    await waitFor(() => expect(onCambio).toHaveBeenCalled());
    expect(await screen.findByText('Visto bueno registrado.')).toBeTruthy();
  });

  test('el visto bueno fallido muestra el error', async () => {
    vistoMock.mockRejectedValue(new Error('x'));
    await abrirVerificacion();
    await fireEvent.press(await screen.findByText('Dar visto bueno'));
    expect(await screen.findByText(/No pudimos registrar el visto bueno/)).toBeTruthy();
    expect(onCambio).not.toHaveBeenCalled();
  });

  test('un plan con visto bueno lo indica y no vuelve a pedirlo', async () => {
    await abrirVerificacion({
      plan: { ...PLAN, visto_bueno: true, visto_bueno_por_nombre: 'Marta' } as SeguimientoPlan,
    });
    expect(await screen.findByText('Visto bueno de Marta.')).toBeTruthy();
    expect(screen.queryByText('Dar visto bueno')).toBeNull();
  });

  test('sin nombre del revisor, dice coordinación', async () => {
    await abrirVerificacion({ plan: { ...PLAN, visto_bueno: true } as SeguimientoPlan });
    expect(await screen.findByText('Visto bueno de coordinación.')).toBeTruthy();
  });

  test('genera el reporte imprimible o avisa si falla', async () => {
    reporteMock.mockResolvedValue({ ok: true });
    await abrirVerificacion({ coordina: false, esDocenteResponsable: true });
    await fireEvent.press(await screen.findByText('Reporte imprimible'));
    await waitFor(() => expect(imprimirMock).toHaveBeenCalledWith({ ok: true }, 'reporte.html'));
    expect(await screen.findByText('Reporte listo para imprimir.')).toBeTruthy();
    reporteMock.mockRejectedValue(new Error('x'));
    await fireEvent.press(screen.getByText('Reporte imprimible'));
    expect(await screen.findByText(/No pudimos generar el reporte/)).toBeTruthy();
  });

  test('un plan abierto no muestra visto bueno ni reporte', async () => {
    await abrirVerificacion({ plan: { ...PLAN, estado: 'asignado' } as SeguimientoPlan });
    await screen.findByText('Verificación de coordinación');
    expect(screen.queryByText('Reporte imprimible')).toBeNull();
  });
});
