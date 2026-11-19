import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  actualizarInstitucion,
  actualizarSede,
  crearSede,
  listarSedes,
  obtenerInstitucion,
} from '@/api/academico';
import { InstitucionScreen } from '@/screens/academica/InstitucionScreen';
import { useSession } from '@/store/session';

jest.mock('@/api/academico', () => ({
  obtenerInstitucion: jest.fn(),
  actualizarInstitucion: jest.fn(),
  listarSedes: jest.fn(),
  crearSede: jest.fn(),
  actualizarSede: jest.fn(),
}));
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));

const obtenerMock = obtenerInstitucion as jest.Mock;
const actualizarMock = actualizarInstitucion as jest.Mock;
const sedesMock = listarSedes as jest.Mock;
const crearSedeMock = crearSede as jest.Mock;
const actualizarSedeMock = actualizarSede as jest.Mock;
const sesionMock = useSession as jest.Mock;

const INST = {
  nombre: 'Colegio San Martín',
  nit: '900.123',
  direccion: 'Calle 1',
  ciudad: 'Bogotá',
  telefono: '601',
  correo: 'info@colegio.edu.co',
  sede_unica: false,
};
const CENTRAL = {
  id: 1,
  nombre: 'Central',
  nit: '',
  direccion: 'Cra 5',
  ciudad: '',
  telefono: '',
  correo: '',
  activa: true,
  principal: true,
};
const NORTE = {
  id: 2,
  nombre: 'Norte',
  nit: '',
  direccion: '',
  ciudad: '',
  telefono: '',
  correo: '',
  activa: false,
  principal: false,
};

const comoRol = (rol: string) => sesionMock.mockReturnValue({ sesion: { usuario: { rol } } });

beforeEach(() => {
  [obtenerMock, actualizarMock, sedesMock, crearSedeMock, actualizarSedeMock].forEach((m) =>
    m.mockReset(),
  );
  obtenerMock.mockResolvedValue(INST);
  sedesMock.mockResolvedValue([CENTRAL, NORTE]);
  comoRol('administrador');
});

async function abrir() {
  await render(<InstitucionScreen />);
  await screen.findByText('Colegio San Martín');
  const editarDatos =
    screen.queryByRole('button', { name: 'Editar institución' }) ??
    screen.queryByRole('button', { name: 'Ver datos' });
  if (editarDatos) await fireEvent.press(editarDatos);
}

const boton = (nombre: string) => screen.getByRole('button', { name: nombre });

test('muestra los datos de la institución y sus sedes', async () => {
  await abrir();
  expect(screen.getByDisplayValue('900.123')).toBeTruthy();
  expect(screen.getByDisplayValue('info@colegio.edu.co')).toBeTruthy();
  expect(screen.getByLabelText('Sede Central')).toBeTruthy();
  expect(screen.getByText('Principal')).toBeTruthy();
  expect(screen.getByText('Inactiva')).toBeTruthy();
});

test('los campos institucionales están contraídos al entrar y se muestran al pedir editarlos', async () => {
  await render(<InstitucionScreen />);
  await screen.findByText('Colegio San Martín');

  expect(screen.queryByLabelText('Nombre de la institución')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Guardar datos' })).toBeNull();
  expect(screen.queryByText('Nueva sede')).toBeNull();

  await fireEvent.press(boton('Editar institución'));
  expect(screen.getByLabelText('Nombre de la institución')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Guardar datos' })).toBeTruthy();
});

test('los botones de institución y sede usan ancho compacto y se adaptan al espacio disponible', async () => {
  await render(<InstitucionScreen />);
  await screen.findByText('Colegio San Martín');

  for (const nombre of ['Editar institución', 'Agregar sede']) {
    expect(boton(nombre).props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ alignSelf: 'flex-start', maxWidth: '100%' }),
      ]),
    );
  }
});

test('Agregar sede abre solo el formulario de sede y no el de datos institucionales', async () => {
  await render(<InstitucionScreen />);
  await screen.findByText('Colegio San Martín');
  expect(screen.queryByText('Nueva sede')).toBeNull();
  expect(screen.queryByLabelText('Nombre de la institución')).toBeNull();

  await fireEvent.press(boton('Agregar sede'));

  expect(await screen.findByText('Nueva sede')).toBeTruthy();
  expect(screen.getByLabelText('Nombre de la sede')).toBeTruthy();
  expect(screen.queryByLabelText('Nombre de la institución')).toBeNull();
});

test('guardar está deshabilitado mientras no haya cambios', async () => {
  await abrir();
  expect(boton('Guardar datos').props.accessibilityState.disabled).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('Ciudad'), 'Medellín');
  expect(boton('Guardar datos').props.accessibilityState.disabled).toBe(false);
});

test('el administrador guarda solo lo que cambió y se confirma', async () => {
  actualizarMock.mockResolvedValue({ ...INST, ciudad: 'Medellín' });
  await abrir();
  await fireEvent.changeText(screen.getByLabelText('Ciudad'), 'Medellín');
  await fireEvent.press(boton('Guardar datos'));

  await waitFor(() => expect(actualizarMock).toHaveBeenCalledWith({ ciudad: 'Medellín' }));
  expect(await screen.findByText('Datos de la institución guardados.')).toBeTruthy();
  expect(screen.queryByLabelText('Ciudad')).toBeNull();
  expect(boton('Editar institución')).toBeTruthy();
});

test('el nombre de la institución no puede quedar vacío', async () => {
  await abrir();
  await fireEvent.changeText(screen.getByLabelText('Nombre de la institución'), '  ');
  await fireEvent.press(boton('Guardar datos'));

  expect(await screen.findByText('Ingresa el nombre de la institución.')).toBeTruthy();
  expect(actualizarMock).not.toHaveBeenCalled();
});

test('muestra el error de validación del servidor bajo su campo', async () => {
  actualizarMock.mockRejectedValue({
    error: {
      code: 'validation_error',
      message: 'Datos inválidos.',
      details: { correo: ['Introduzca una dirección de correo válida.'] },
    },
  });
  await abrir();
  await fireEvent.changeText(screen.getByLabelText('Correo de contacto'), 'malo');
  await fireEvent.press(boton('Guardar datos'));

  expect(await screen.findByText('Introduzca una dirección de correo válida.')).toBeTruthy();
});

test('falla de red al guardar: mensaje general y conserva lo escrito', async () => {
  actualizarMock.mockRejectedValue(new TypeError('Network request failed'));
  await abrir();
  await fireEvent.changeText(screen.getByLabelText('Ciudad'), 'Cali');
  await fireEvent.press(boton('Guardar datos'));

  expect(await screen.findByText(/No pudimos guardar/)).toBeTruthy();
  expect(screen.getByDisplayValue('Cali')).toBeTruthy();
});

test('la coordinación ve todo en solo lectura', async () => {
  comoRol('coordinador');
  await abrir();

  expect(screen.getByText(/Solo lectura/)).toBeTruthy();
  expect(screen.getByLabelText('Nombre de la institución').props.editable).toBe(false);
  expect(screen.queryByRole('button', { name: 'Guardar datos' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Agregar sede' })).toBeNull();
  await fireEvent.press(screen.getByLabelText('Sede Central')); // no abre ningún panel
  expect(screen.queryByText('Editar sede')).toBeNull();
});

test.each(['estudiante', 'tutor'])('%s no accede y no se consulta nada', async (rol) => {
  comoRol(rol);
  await render(<InstitucionScreen />);

  expect(
    await screen.findByText('No tienes permiso para ver los datos de la institución.'),
  ).toBeTruthy();
  expect(obtenerMock).not.toHaveBeenCalled();
});

test('error al cargar: avisa y permite reintentar', async () => {
  obtenerMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  await render(<InstitucionScreen />);

  expect(await screen.findByText(/No pudimos cargar los datos de la institución/)).toBeTruthy();
  await fireEvent.press(boton('Reintentar'));
  expect(await screen.findByText('Colegio San Martín')).toBeTruthy();
  await fireEvent.press(boton('Editar institución'));
  expect(screen.getByDisplayValue('Colegio San Martín')).toBeTruthy();
});

// --- sedes ---

test('crear una sede y ver la lista actualizada', async () => {
  crearSedeMock.mockResolvedValue({});
  sedesMock.mockResolvedValueOnce([CENTRAL, NORTE]).mockResolvedValueOnce([
    CENTRAL,
    NORTE,
    {
      id: 3,
      nombre: 'Sur',
      nit: '900.123',
      direccion: 'Av 9',
      ciudad: 'Cali',
      telefono: '',
      correo: 'sur@colegio.edu.co',
      activa: true,
      principal: false,
    },
  ]);
  await abrir();
  await fireEvent.press(boton('Agregar sede'));
  await fireEvent.changeText(screen.getByLabelText('Nombre de la sede'), 'Sur');
  await fireEvent.changeText(screen.getByLabelText('NIT de la sede'), '900.123');
  await fireEvent.changeText(screen.getByLabelText('Dirección de la sede'), 'Av 9');
  await fireEvent.changeText(screen.getByLabelText('Ciudad de la sede'), 'Cali');
  await fireEvent.changeText(
    screen.getByLabelText('Correo de contacto de la sede'),
    'sur@colegio.edu.co',
  );
  await fireEvent.press(boton('Guardar sede'));

  await waitFor(() =>
    expect(crearSedeMock).toHaveBeenCalledWith({
      nombre: 'Sur',
      nit: '900.123',
      direccion: 'Av 9',
      ciudad: 'Cali',
      telefono: '',
      correo: 'sur@colegio.edu.co',
      activa: true,
      principal: false,
    }),
  );
  expect(await screen.findByText('Sede creada.')).toBeTruthy();
  expect(screen.getByLabelText('Sede Sur')).toBeTruthy();
  expect(screen.queryByText('Nueva sede')).toBeNull(); // el panel se cerró
});

test('el formulario de sede incluye NIT, ciudad y correo de contacto', async () => {
  await abrir();
  await fireEvent.press(boton('Agregar sede'));

  expect(screen.getByLabelText('NIT de la sede')).toBeTruthy();
  expect(screen.getByLabelText('Ciudad de la sede')).toBeTruthy();
  expect(screen.getByLabelText('Correo de contacto de la sede')).toBeTruthy();
});

test('oculta editar institución y agregar sede cuando ya está registrada la sede única', async () => {
  obtenerMock.mockResolvedValue({ ...INST, sede_unica: true });
  sedesMock.mockResolvedValue([CENTRAL]);
  await render(<InstitucionScreen />);
  await screen.findByText('Colegio San Martín');

  expect(screen.getByText('Sede única')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Editar institución' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Agregar sede' })).toBeNull();
  expect(screen.queryByText('Aún no hay sedes registradas.')).toBeNull();
  expect(screen.getByLabelText('Sede Central')).toBeTruthy();
});

test('permite registrar la primera sede de una institución configurada como sede única', async () => {
  obtenerMock.mockResolvedValue({ ...INST, sede_unica: true });
  sedesMock.mockResolvedValue([]);
  await render(<InstitucionScreen />);
  await screen.findByText('Colegio San Martín');

  expect(screen.getByText('Sede única')).toBeTruthy();
  expect(screen.queryByText('Aún no hay sedes registradas.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Editar institución' })).toBeTruthy();
  await fireEvent.press(boton('Agregar sede'));
  expect(await screen.findByText('Nueva sede')).toBeTruthy();
});

test('guarda la configuración de sede única junto a los datos institucionales', async () => {
  actualizarMock.mockResolvedValue({ ...INST, sede_unica: true });
  await abrir();
  await fireEvent(screen.getByLabelText('Sede única'), 'valueChange', true);
  await fireEvent.press(boton('Guardar datos'));

  await waitFor(() => expect(actualizarMock).toHaveBeenCalledWith({ sede_unica: true }));
});

test('el nombre de la sede es obligatorio', async () => {
  await abrir();
  await fireEvent.press(boton('Agregar sede'));
  await fireEvent.press(boton('Guardar sede'));

  expect(await screen.findByText('Ingresa el nombre de la sede.')).toBeTruthy();
  expect(crearSedeMock).not.toHaveBeenCalled();
});

test('editar una sede existente: el panel trae sus datos y se guarda con su id', async () => {
  actualizarSedeMock.mockResolvedValue({});
  await abrir();
  await fireEvent.press(screen.getByLabelText('Sede Norte'));

  expect(await screen.findByText('Editar sede')).toBeTruthy();
  expect(screen.getByLabelText('Sede activa').props.value).toBe(false);
  await fireEvent(screen.getByLabelText('Sede activa'), 'valueChange', true);
  await fireEvent.press(boton('Guardar sede'));

  await waitFor(() =>
    expect(actualizarSedeMock).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ nombre: 'Norte', activa: true }),
    ),
  );
  expect(await screen.findByText('Sede actualizada.')).toBeTruthy();
});

test('marcar una sede como principal envía ese valor', async () => {
  actualizarSedeMock.mockResolvedValue({});
  await abrir();
  await fireEvent.press(screen.getByLabelText('Sede Norte'));
  await fireEvent(await screen.findByLabelText('Sede principal'), 'valueChange', true);
  await fireEvent.press(boton('Guardar sede'));

  await waitFor(() =>
    expect(actualizarSedeMock).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ principal: true }),
    ),
  );
});

test('el error del servidor por nombre repetido se muestra en la sede', async () => {
  crearSedeMock.mockRejectedValue({
    error: {
      code: 'validation_error',
      message: 'Datos inválidos.',
      details: { nombre: ['Ya existe una sede con ese nombre.'] },
    },
  });
  await abrir();
  await fireEvent.press(boton('Agregar sede'));
  await fireEvent.changeText(screen.getByLabelText('Nombre de la sede'), 'Central');
  await fireEvent.press(boton('Guardar sede'));

  expect(await screen.findByText('Ya existe una sede con ese nombre.')).toBeTruthy();
  expect(screen.getByText('Nueva sede')).toBeTruthy(); // el panel sigue abierto para corregir
});

test('cancelar cierra el panel sin guardar', async () => {
  await abrir();
  await fireEvent.press(boton('Agregar sede'));
  await fireEvent.press(boton('Cancelar'));

  expect(screen.queryByText('Nueva sede')).toBeNull();
  expect(crearSedeMock).not.toHaveBeenCalled();
});
