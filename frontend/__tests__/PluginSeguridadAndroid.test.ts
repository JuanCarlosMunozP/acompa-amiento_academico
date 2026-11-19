const plugin = require('../plugins/seguridad-android');

describe('plugin de seguridad del APK', () => {
  test('la red solo admite HTTPS y autoridades del sistema', () => {
    const xml = plugin.redDeSeguridad({});
    expect(xml).toContain('cleartextTrafficPermitted="false"');
    expect(xml).toContain('<certificates src="system" />');
    expect(xml).not.toContain('user');
    expect(xml).not.toContain('pin-set');
  });

  test('con dominio y dos huellas fija el certificado', () => {
    const xml = plugin.redDeSeguridad({
      API_PIN_DOMINIO: 'api.x.com',
      API_PIN_SHA256: 'AAA=, BBB=',
    });
    expect(xml).toContain('<domain includeSubdomains="true">api.x.com</domain>');
    expect(xml).toContain('<pin digest="SHA-256">AAA=</pin>');
    expect(xml).toContain('<pin digest="SHA-256">BBB=</pin>');
  });

  test('con una sola huella no fija nada (evita dejar la app sin servicio)', () => {
    const xml = plugin.redDeSeguridad({ API_PIN_DOMINIO: 'api.x.com', API_PIN_SHA256: 'AAA=' });
    expect(xml).not.toContain('pin-set');
  });

  const actividad =
    'import android.os.Bundle\nclass M {\n  fun x() {\n    super.onCreate(null)\n  }\n}\n';

  test('bloquea capturas de pantalla y toques bajo otra app', () => {
    const kt = plugin.endurecerActividad(actividad, false);
    expect(kt).toContain('import android.view.WindowManager');
    expect(kt).toContain('FLAG_SECURE');
    expect(kt).toContain('filterTouchesWhenObscured = true');
  });

  test('permite capturas solo si se pide expresamente y no duplica el parche', () => {
    const kt = plugin.endurecerActividad(actividad, true);
    expect(kt).not.toContain('FLAG_SECURE');
    expect(plugin.endurecerActividad(kt, true)).toBe(kt);
  });

  test('falla en voz alta si la actividad no tiene onCreate', () => {
    expect(() => plugin.endurecerActividad('class M', false)).toThrow(/onCreate/);
  });
});

describe('plugin completo sobre la configuración de Expo', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  function cargar(capturaPermitida: string | undefined) {
    jest.resetModules();
    const mods: Record<string, (cfg: any) => any> = {};
    jest.doMock('@expo/config-plugins', () => {
      const registrar = (nombre: string) => (cfg: any, arg: any) => {
        mods[nombre] = arg;
        return cfg;
      };
      return {
        withAndroidManifest: (cfg: any, fn: (c: any) => any) => {
          mods.manifest = fn;
          return cfg;
        },
        withMainActivity: (cfg: any, fn: (c: any) => any) => {
          mods.actividad = fn;
          return cfg;
        },
        withDangerousMod: (cfg: any, [, fn]: [string, (c: any) => any]) => {
          mods.peligroso = fn;
          return cfg;
        },
        AndroidConfig: { Manifest: { getMainApplicationOrThrow: (m: any) => m.application } },
        __registrar: registrar,
      };
    });
    if (capturaPermitida === undefined) delete process.env.APK_PERMITIR_CAPTURA;
    else process.env.APK_PERMITIR_CAPTURA = capturaPermitida;
    const aplicar = require('../plugins/seguridad-android');
    aplicar({});
    return mods;
  }

  afterEach(() => {
    delete process.env.APK_PERMITIR_CAPTURA;
    jest.dontMock('@expo/config-plugins');
  });

  test('escribe los XML de seguridad en res/xml', async () => {
    const mods = cargar(undefined);
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'seg-'));
    await mods.peligroso({ modRequest: { platformProjectRoot: raiz } });
    const xml = path.join(raiz, 'app/src/main/res/xml');
    expect(fs.readdirSync(xml).sort()).toEqual([
      'network_security_config.xml',
      'sin_extraccion.xml',
      'sin_respaldo.xml',
    ]);
    fs.rmSync(raiz, { recursive: true, force: true });
  });

  test('el manifiesto desactiva respaldos, tráfico en claro y depuración', () => {
    const mods = cargar(undefined);
    const cfg = { modResults: { application: { $: {} as Record<string, string> } } };
    mods.manifest(cfg);
    expect(cfg.modResults.application.$).toMatchObject({
      'android:allowBackup': 'false',
      'android:usesCleartextTraffic': 'false',
      'android:debuggable': 'false',
      'android:networkSecurityConfig': '@xml/network_security_config',
    });
  });

  test('MainActivity bloquea capturas salvo que se permitan expresamente', () => {
    const base = 'import android.os.Bundle\nclass M {\n  fun x() {\n    super.onCreate(null)\n  }\n}\n';
    const a = { modResults: { contents: base } };
    cargar(undefined).actividad(a);
    expect(a.modResults.contents).toContain('FLAG_SECURE');
    const b = { modResults: { contents: base } };
    cargar('1').actividad(b);
    expect(b.modResults.contents).not.toContain('FLAG_SECURE');
    expect(b.modResults.contents).toContain('filterTouchesWhenObscured');
  });
});

test('no duplica la importación de WindowManager si ya existe', () => {
  const plugin2 = require('../plugins/seguridad-android');
  const base =
    'import android.os.Bundle\nimport android.view.WindowManager\nclass M {\n  fun x() {\n    super.onCreate(null)\n  }\n}\n';
  const salida = plugin2.endurecerActividad(base, false);
  expect(salida.match(/import android\.view\.WindowManager/g)).toHaveLength(1);
});
