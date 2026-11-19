import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { crearPlan, DESEMPENOS_MAX, OBJETIVOS_MAX } from '@/api/planes';
import { listarAsignaturas } from '@/api/tutores';
import { PlanRefuerzoScreen } from '@/screens/planes/PlanRefuerzoScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/planes', () => ({ ...jest.requireActual('@/api/planes'), crearPlan: jest.fn() }));
jest.mock('@/api/tutores', () => ({
  ...jest.requireActual('@/api/tutores'),
  listarAsignaturas: jest.fn(),
}));
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));

const crearMock = crearPlan as jest.Mock;
const asignaturasMock = listarAsignaturas as jest.Mock;
const sesionMock = useSession as jest.Mock;
const navigation = { goBack: jest.fn() };

const comoRol = (rol: string) => sesionMock.mockReturnValue({ sesion: { usuario: { rol } } });
const boton = (nombre: string) => screen.getByRole('button', { name: nombre });

async function abrir() {
  await render(
    <PlanRefuerzoScreen
      navigation={navigation as never}
      route={{ params: { estudianteId: 7, nombre: 'Beatriz Castro' } } as never}
    />,
  );
  await screen.findByRole('button', { name: 'Matemáticas' });
}

beforeEach(() => {
  [crearMock, asignaturasMock, navigation.goBack].forEach((m) => m.mockReset());
  asignaturasMock.mockResolvedValue([
    { id: 1, nombre: 'Matemáticas' },
    { id: 2, nombre: 'Física' },
  ]);
  comoRol('coordinador');
});

test('crea el plan con los datos del formulario y vuelve a la ficha', async () => {
  crearMock.mockResolvedValue({});
  await abrir();
  await fireEvent.press(boton('Matemáticas'));
  await fireEvent.changeText(
    screen.getByLabelText('Desempeños no alcanzados'),
    ' No resuelve fracciones ',
  );
  await fireEvent.changeText(
    screen.getByLabelText('Plan de nivelación (objetivos)'),
    '  Reforzar fracciones ',
  );
  await fireEvent.changeText(screen.getByLabelText('Fecha de inicio (AAAA-MM-DD)'), '2026-10-16');
  await fireEvent.changeText(screen.getByLabelText('Fecha de fin (AAAA-MM-DD)'), '2026-11-13');
  await fireEvent.press(boton('Registrar expediente'));

  await waitFor(() =>
    expect(crearMock).toHaveBeenCalledWith({
      estudiante: 7,
      asignatura: 1,
      objetivos: 'Reforzar fracciones',
      desempenos_no_alcanzados: 'No resuelve fracciones',
      fecha_inicio: '2026-10-16',
      fecha_fin: '2026-11-13',
    }),
  );
  await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
});

test('exige asignatura y objetivos antes de llamar a la API', async () => {
  await abrir();
  await fireEvent.press(boton('Registrar expediente'));

  expect(await screen.findByText('Elige la asignatura.')).toBeTruthy();
  expect(screen.getByText('Indica los desempeños no alcanzados.')).toBeTruthy();
  expect(screen.getByText('Describe el plan de nivelación.')).toBeTruthy();
  expect(crearMock).not.toHaveBeenCalled();
});

test.each([
  ['fecha de inicio', 'Fecha de inicio (AAAA-MM-DD)', '2026-02-30'],
  ['fecha de fin', 'Fecha de fin (AAAA-MM-DD)', '13/11/2026'],
])('%s inválida se rechaza sin llamar a la API', async (_, campo, valor) => {
  await abrir();
  await fireEvent.press(boton('Matemáticas'));
  await fireEvent.changeText(screen.getByLabelText('Desempeños no alcanzados'), 'd');
  await fireEvent.changeText(screen.getByLabelText('Plan de nivelación (objetivos)'), 'x');
  await fireEvent.changeText(screen.getByLabelText(campo), valor);
  await fireEvent.press(boton('Registrar expediente'));

  expect(await screen.findByText('Usa el formato AAAA-MM-DD.')).toBeTruthy();
  expect(crearMock).not.toHaveBeenCalled();
});

test('el fin no puede ser anterior al inicio', async () => {
  await abrir();
  await fireEvent.press(boton('Matemáticas'));
  await fireEvent.changeText(screen.getByLabelText('Desempeños no alcanzados'), 'd');
  await fireEvent.changeText(screen.getByLabelText('Plan de nivelación (objetivos)'), 'x');
  await fireEvent.changeText(screen.getByLabelText('Fecha de inicio (AAAA-MM-DD)'), '2026-11-13');
  await fireEvent.changeText(screen.getByLabelText('Fecha de fin (AAAA-MM-DD)'), '2026-11-01');
  await fireEvent.press(boton('Registrar expediente'));

  expect(
    await screen.findByText('La fecha de fin no puede ser anterior a la de inicio.'),
  ).toBeTruthy();
  expect(crearMock).not.toHaveBeenCalled();
});

test('los errores del servidor se muestran bajo su campo y no se sale de la pantalla', async () => {
  crearMock.mockRejectedValue({
    error: {
      code: 'validation_error',
      message: 'x',
      details: { fecha_inicio: ['El 2026-10-17 no es un día hábil (sábado).'] },
    },
  });
  await abrir();
  await fireEvent.press(boton('Matemáticas'));
  await fireEvent.changeText(screen.getByLabelText('Desempeños no alcanzados'), 'd');
  await fireEvent.changeText(screen.getByLabelText('Plan de nivelación (objetivos)'), 'x');
  await fireEvent.press(boton('Registrar expediente'));

  expect(await screen.findByText('El 2026-10-17 no es un día hábil (sábado).')).toBeTruthy();
  expect(navigation.goBack).not.toHaveBeenCalled();
});

test('falla de red: mensaje general', async () => {
  crearMock.mockRejectedValue(new TypeError('Network request failed'));
  await abrir();
  await fireEvent.press(boton('Matemáticas'));
  await fireEvent.changeText(screen.getByLabelText('Desempeños no alcanzados'), 'd');
  await fireEvent.changeText(screen.getByLabelText('Plan de nivelación (objetivos)'), 'x');
  await fireEvent.press(boton('Registrar expediente'));

  expect(await screen.findByText(/No pudimos registrar el expediente/)).toBeTruthy();
});

test.each(['estudiante', 'acudiente'])('%s no accede al formulario', async (rol) => {
  comoRol(rol);
  await render(
    <PlanRefuerzoScreen
      navigation={navigation as never}
      route={{ params: { estudianteId: 7, nombre: 'B' } } as never}
    />,
  );

  expect(
    await screen.findByText('Solo el docente o coordinación registran expedientes de nivelación.'),
  ).toBeTruthy();
  expect(asignaturasMock).not.toHaveBeenCalled();
});

test('rechaza textos más largos que el máximo permitido', async () => {
  await abrir();
  await fireEvent.press(boton('Matemáticas'));
  await fireEvent.changeText(
    screen.getByLabelText('Desempeños no alcanzados'),
    'd'.repeat(DESEMPENOS_MAX + 1),
  );
  await fireEvent.changeText(
    screen.getByLabelText('Plan de nivelación (objetivos)'),
    'o'.repeat(OBJETIVOS_MAX + 1),
  );
  await fireEvent.press(boton('Registrar expediente'));
  expect(await screen.findByText(`Máximo ${DESEMPENOS_MAX} caracteres.`)).toBeTruthy();
  expect(screen.getByText(`Máximo ${OBJETIVOS_MAX} caracteres.`)).toBeTruthy();
  expect(crearMock).not.toHaveBeenCalled();
});

test('si no se pueden cargar las áreas lo avisa', async () => {
  asignaturasMock.mockRejectedValue(new Error('x'));
  await render(
    <PlanRefuerzoScreen
      navigation={navigation as never}
      route={{ params: { estudianteId: 7, nombre: 'Beatriz Castro' } } as never}
    />,
  );
  expect(await screen.findByText(/No pudimos cargar/)).toBeTruthy();
});

test('un error del servidor sobre el estudiante se muestra en el formulario', async () => {
  crearMock.mockRejectedValue({
    error: { details: { estudiante: ['El estudiante no está matriculado.'] } },
  });
  await abrir();
  await fireEvent.press(boton('Matemáticas'));
  await fireEvent.changeText(screen.getByLabelText('Desempeños no alcanzados'), 'd');
  await fireEvent.changeText(screen.getByLabelText('Plan de nivelación (objetivos)'), 'x');
  await fireEvent.press(boton('Registrar expediente'));
  expect(await screen.findByText('El estudiante no está matriculado.')).toBeTruthy();
});
