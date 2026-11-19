import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { activarMfa, configurarMfa, desactivarMfa, regenerarCodigosRecuperacion } from '@/api/mfa';
import { SeguridadMfa } from '@/screens/perfil/SeguridadMfa';
import { useSession } from '@/store/session';

jest.mock('@/api/mfa');
jest.mock('@/store/session', () => ({ useSession: jest.fn() }));

const configurarMock = configurarMfa as jest.Mock;
const activarMock = activarMfa as jest.Mock;
const desactivarMock = desactivarMfa as jest.Mock;
const regenerarMock = regenerarCodigosRecuperacion as jest.Mock;
const sesionMock = useSession as jest.Mock;
const actualizarUsuario = jest.fn();

const USUARIO = { id: 7, email: 'ana@colegio.edu.co', nombres: 'Ana', rol: 'estudiante' };
const CONFIG = {
  secreto: 'JBSWY3DPEHPK3PXP',
  otpauth_uri: 'otpauth://totp/x',
  qr: 'data:image/png;base64,AAAA',
};

function conSesion(mfaActivo: boolean) {
  sesionMock.mockReturnValue({
    sesion: { usuario: { ...USUARIO, mfa_activo: mfaActivo } },
    actualizarUsuario,
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  actualizarUsuario.mockResolvedValue(undefined);
  conSesion(false);
});

const boton = (nombre: string) => screen.getByRole('button', { name: nombre });

async function abrirAlta() {
  configurarMock.mockResolvedValue(CONFIG);
  await render(<SeguridadMfa />);
  await fireEvent.press(boton('Activar con código QR'));
  await screen.findByLabelText(/Código QR para configurar/);
}

test('sin MFA explica el beneficio y ofrece activarlo', async () => {
  await render(<SeguridadMfa />);

  expect(screen.getByText(/aunque alguien conozca o robe tu contraseña/)).toBeTruthy();
  expect(boton('Activar con código QR')).toBeTruthy();
});

test('activar: muestra el QR y la clave manual, y al confirmar entrega los códigos de recuperación', async () => {
  activarMock.mockResolvedValue({
    mfa_activo: true,
    codigos_recuperacion: ['AAAAA-BBBBB', 'CCCCC-DDDDD'],
  });
  await abrirAlta();
  expect(screen.getByText(/JBSWY3DPEHPK3PXP/)).toBeTruthy();

  await fireEvent.changeText(screen.getByLabelText('Código de 6 dígitos'), '123456');
  await fireEvent.press(boton('Confirmar y activar'));

  await waitFor(() => expect(activarMock).toHaveBeenCalledWith('123456'));
  expect(await screen.findByText('AAAAA-BBBBB')).toBeTruthy();
  expect(screen.getByText('CCCCC-DDDDD')).toBeTruthy();
  expect(actualizarUsuario).toHaveBeenCalledWith(expect.objectContaining({ mfa_activo: true }));
});

test('un código erróneo al activar muestra el mensaje y no activa nada', async () => {
  activarMock.mockRejectedValue({
    error: {
      code: 'codigo_mfa_invalido',
      message: 'El código de verificación no es válido o ya venció.',
    },
  });
  await abrirAlta();

  await fireEvent.changeText(screen.getByLabelText('Código de 6 dígitos'), '000000');
  await fireEvent.press(boton('Confirmar y activar'));

  expect(await screen.findByText(/no es válido o ya venció/)).toBeTruthy();
  expect(actualizarUsuario).not.toHaveBeenCalled();
});

test('no se intenta activar con el código vacío', async () => {
  await abrirAlta();

  await fireEvent.press(boton('Confirmar y activar'));

  expect(await screen.findByText('Ingresa el código de 6 dígitos de tu app.')).toBeTruthy();
  expect(activarMock).not.toHaveBeenCalled();
});

test('con MFA activo, desactivar exige contraseña y código', async () => {
  conSesion(true);
  desactivarMock.mockResolvedValue({ mfa_activo: false });
  await render(<SeguridadMfa />);

  await fireEvent.press(boton('Desactivar'));
  await fireEvent.press(boton('Desactivar verificación'));
  expect(await screen.findByText('Ingresa tu contraseña y un código de tu app.')).toBeTruthy();
  expect(desactivarMock).not.toHaveBeenCalled();

  await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'Clave-segura-2026');
  await fireEvent.changeText(screen.getByLabelText('Código de 6 dígitos'), '123456');
  await fireEvent.press(boton('Desactivar verificación'));

  await waitFor(() =>
    expect(desactivarMock).toHaveBeenCalledWith({
      password: 'Clave-segura-2026',
      codigo: '123456',
    }),
  );
  expect(actualizarUsuario).toHaveBeenCalledWith(expect.objectContaining({ mfa_activo: false }));
});

test('con MFA activo se pueden generar códigos de recuperación nuevos', async () => {
  conSesion(true);
  regenerarMock.mockResolvedValue({ codigos_recuperacion: ['ZZZZZ-YYYYY'] });
  await render(<SeguridadMfa />);

  await fireEvent.press(boton('Generar nuevos códigos de recuperación'));
  await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'Clave-segura-2026');
  await fireEvent.changeText(screen.getByLabelText('Código de 6 dígitos'), '654321');
  await fireEvent.press(boton('Generar códigos nuevos'));

  expect(await screen.findByText('ZZZZZ-YYYYY')).toBeTruthy();
  expect(regenerarMock).toHaveBeenCalledWith({ password: 'Clave-segura-2026', codigo: '654321' });
});

test('sin sesión no muestra nada', async () => {
  sesionMock.mockReturnValue({ sesion: null, actualizarUsuario });
  await render(<SeguridadMfa />);
  expect(screen.queryByText('Verificación en dos pasos')).toBeNull();
});

test('si no se puede generar el QR muestra el motivo o un mensaje genérico', async () => {
  configurarMock.mockRejectedValueOnce({ error: { message: 'Demasiados intentos.' } });
  await render(<SeguridadMfa />);
  await fireEvent.press(boton('Activar con código QR'));
  expect(await screen.findByText('Demasiados intentos.')).toBeTruthy();

  configurarMock.mockRejectedValueOnce(new Error('red'));
  await fireEvent.press(boton('Activar con código QR'));
  expect(await screen.findByText(/No pudimos generar el código QR/)).toBeTruthy();
});

test('cancelar el alta vuelve al inicio del módulo', async () => {
  await abrirAlta();
  await fireEvent.press(boton('Cancelar'));
  expect(await screen.findByText('Activar con código QR')).toBeTruthy();
});

test('«Ya los guardé» cierra la lista de códigos de recuperación', async () => {
  activarMock.mockResolvedValue({ mfa_activo: true, codigos_recuperacion: ['AAAAA-BBBBB'] });
  await abrirAlta();
  await fireEvent.changeText(screen.getByLabelText('Código de 6 dígitos'), '123456');
  await fireEvent.press(boton('Confirmar y activar'));
  await screen.findByText('AAAAA-BBBBB');
  await fireEvent.press(boton('Ya los guardé'));
  expect(screen.queryByText('AAAAA-BBBBB')).toBeNull();
});
