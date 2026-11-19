import {
  esAdministrador,
  esSuperadmin,
  puedeAsignarRoles,
  puedeTomarAsistencia,
  puedeVerRoles,
} from '@/types/roles';

describe('el superadministrador hereda lo del administrador', () => {
  test.each([
    [esAdministrador, true],
    [puedeAsignarRoles, true],
    [puedeVerRoles, true],
    [puedeTomarAsistencia, true],
  ] as const)('%p', (regla, esperado) => {
    expect(regla('superadmin')).toBe(esperado);
    expect(regla('administrador')).toBe(esperado);
  });

  test('solo el superadmin es superadmin', () => {
    expect(esSuperadmin('superadmin')).toBe(true);
    expect(esSuperadmin('administrador')).toBe(false);
    expect(esSuperadmin(undefined)).toBe(false);
  });

  test('estudiantes y acudientes no administran', () => {
    expect(esAdministrador('estudiante')).toBe(false);
    expect(puedeAsignarRoles('acudiente')).toBe(false);
  });
});
