import { fireEvent, render, screen } from '@testing-library/react-native';

import { listarMisPlanes } from '@/api/planes';
import { HomeExpedientesPanel } from '@/screens/dashboard/HomeExpedientesPanel';

jest.mock('@/api/planes', () => ({
  ...jest.requireActual('@/api/planes'),
  listarMisPlanes: jest.fn(),
}));

const listarMock = listarMisPlanes as jest.Mock;

const plan = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  estudiante_nombre: `Estudiante ${id}`,
  asignatura_nombre: `Materia ${id}`,
  docente_nombre: null,
  estado: 'asignado',
  progreso: null,
  actividades_completadas: 0,
  actividades_total: 0,
  nota_final: null,
  ...extra,
});

beforeEach(() => listarMock.mockReset());

test('el estudiante ve sus planes con avance, docente y nota', async () => {
  listarMock.mockResolvedValue([
    plan(1, { progreso: 50, actividades_completadas: 1, actividades_total: 2 }),
    plan(2, { docente_nombre: 'Luis Tutor', estado: 'cerrado', nota_final: '4.50' }),
  ]);
  const onOpenPlan = jest.fn();
  await render(<HomeExpedientesPanel rol="estudiante" onOpenPlan={onOpenPlan} />);

  expect(await screen.findByText('Mis planes de nivelación')).toBeTruthy();
  expect(screen.getByText(/Consulta tu plan, pregunta tus dudas/)).toBeTruthy();
  expect(screen.getByText(/50 % · 1 de 2 actividades/)).toBeTruthy();
  expect(screen.getByText(/Aún sin actividades/)).toBeTruthy();
  expect(screen.getByText('Sin docente asignado')).toBeTruthy();
  expect(screen.getByText('Docente: Luis Tutor')).toBeTruthy();
  expect(screen.getByText('Nota: 4,50')).toBeTruthy();
  expect(screen.queryByText(/Estudiante: /)).toBeNull();

  await fireEvent.press(screen.getByLabelText('Plan de Materia 2, Estudiante 2'));
  expect(onOpenPlan).toHaveBeenCalledWith(2);
});

test('el acudiente ve a qué estudiante corresponde cada plan', async () => {
  listarMock.mockResolvedValue([plan(3)]);
  await render(<HomeExpedientesPanel rol="acudiente" onOpenPlan={jest.fn()} />);

  expect(await screen.findByText('Proceso de nivelación del estudiante')).toBeTruthy();
  expect(screen.getByText('Estudiante: Estudiante 3')).toBeTruthy();
  expect(screen.getByText(/Solo el docente modifica el plan/)).toBeTruthy();
});

test.each([
  ['estudiante', 'No tienes planes de nivelación registrados.'],
  ['acudiente', 'No hay planes de nivelación para los estudiantes vinculados a tu cuenta.'],
] as const)('%s sin planes lo explica', async (rol, texto) => {
  listarMock.mockResolvedValue([]);
  await render(<HomeExpedientesPanel rol={rol} onOpenPlan={jest.fn()} />);
  expect(await screen.findByText(texto)).toBeTruthy();
});

test('muestra "Cargando…" y, si falla, permite reintentar', async () => {
  let rechazar: (e: unknown) => void = () => undefined;
  listarMock.mockReturnValueOnce(new Promise((_ok, no) => (rechazar = no)));
  await render(<HomeExpedientesPanel rol="estudiante" onOpenPlan={jest.fn()} />);
  expect(screen.getByText('Cargando…')).toBeTruthy();

  await (async () => rechazar(new Error('red')))();
  expect(await screen.findByText(/No pudimos cargar tus planes de nivelación/)).toBeTruthy();

  listarMock.mockResolvedValue([plan(4)]);
  await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('Materia 4')).toBeTruthy();
});
