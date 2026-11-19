/**
 * Endurecimiento del APK (OWASP Mobile Top 10 2024: M5, M7, M8, M9).
 * Se aplica en cada `expo prebuild`, de modo que no depende de editar android/ a mano.
 *
 *  - Sin copias de seguridad ni extracción de datos de la app (M9): los tokens no salen del equipo.
 *  - Network Security Config (M5): solo HTTPS, solo autoridades del sistema (un certificado que el
 *    usuario instale a mano para interceptar tráfico no es de confianza). Fijación opcional de
 *    certificado con API_PIN_DOMINIO y API_PIN_SHA256 (ver abajo).
 *  - FLAG_SECURE (M6/M8): bloquea capturas de pantalla, grabación y la miniatura en "recientes".
 *    Se desactiva con APK_PERMITIR_CAPTURA=1 (p. ej. para grabar demostraciones).
 *  - Filtra toques cuando otra app se superpone (tapjacking).
 */
const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withDangerousMod,
  withMainActivity,
  AndroidConfig,
} = require('@expo/config-plugins');

const SIN_RESPALDO = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <exclude domain="root" />
  <exclude domain="file" />
  <exclude domain="database" />
  <exclude domain="sharedpref" />
  <exclude domain="external" />
</full-backup-content>
`;

const SIN_EXTRACCION = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
    <exclude domain="root" />
    <exclude domain="file" />
    <exclude domain="database" />
    <exclude domain="sharedpref" />
    <exclude domain="external" />
  </cloud-backup>
  <device-transfer>
    <exclude domain="root" />
    <exclude domain="file" />
    <exclude domain="database" />
    <exclude domain="sharedpref" />
    <exclude domain="external" />
  </device-transfer>
</data-extraction-rules>
`;

/**
 * Fijación de certificado: API_PIN_DOMINIO=api.midominio.com y
 * API_PIN_SHA256=<hash1>,<hash2> (SPKI en base64, mínimo dos: el vigente y uno de respaldo; mejor
 * fijar la CA intermedia que el certificado hoja, porque el hoja rota cada pocos meses).
 * Sin esas variables no se fija nada, para no dejar sin servicio a la app tras una rotación.
 */
function redDeSeguridad(env = process.env) {
  const dominio = (env.API_PIN_DOMINIO || '').trim();
  const pines = (env.API_PIN_SHA256 || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  let fijacion = '';
  if (dominio && pines.length >= 2) {
    fijacion = `  <domain-config cleartextTrafficPermitted="false">
    <domain includeSubdomains="true">${dominio}</domain>
    <pin-set>
${pines.map((p) => `      <pin digest="SHA-256">${p}</pin>`).join('\n')}
    </pin-set>
  </domain-config>
`;
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
${fijacion}</network-security-config>
`;
}

const IMPORTS = ['android.view.WindowManager'];

function endurecerActividad(contenido, permitirCaptura) {
  if (contenido.includes('FLAG_SECURE') || contenido.includes('filterTouchesWhenObscured')) {
    return contenido;
  }
  let salida = contenido;
  for (const imp of IMPORTS) {
    if (!salida.includes(`import ${imp}`)) {
      salida = salida.replace(/(import android\.os\.Bundle)/, `$1\nimport ${imp}`);
    }
  }
  const bloque = [
    permitirCaptura
      ? ''
      : '    window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)',
    '    window.decorView.filterTouchesWhenObscured = true',
  ]
    .filter(Boolean)
    .join('\n');
  const parchado = salida.replace(/(super\.onCreate\([^)]*\)\n)/, `$1${bloque}\n`);
  if (parchado === salida) {
    throw new Error('seguridad-android: no se encontró super.onCreate en MainActivity.');
  }
  return parchado;
}

const withSeguridadAndroid = (config) => {
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const xml = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(xml, { recursive: true });
      fs.writeFileSync(path.join(xml, 'sin_respaldo.xml'), SIN_RESPALDO);
      fs.writeFileSync(path.join(xml, 'sin_extraccion.xml'), SIN_EXTRACCION);
      fs.writeFileSync(path.join(xml, 'network_security_config.xml'), redDeSeguridad());
      return cfg;
    },
  ]);

  config = withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$['android:allowBackup'] = 'false';
    app.$['android:fullBackupContent'] = '@xml/sin_respaldo';
    app.$['android:dataExtractionRules'] = '@xml/sin_extraccion';
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    app.$['android:usesCleartextTraffic'] = 'false';
    app.$['android:debuggable'] = 'false';
    return cfg;
  });

  config = withMainActivity(config, (cfg) => {
    cfg.modResults.contents = endurecerActividad(
      cfg.modResults.contents,
      process.env.APK_PERMITIR_CAPTURA === '1',
    );
    return cfg;
  });

  return config;
};

module.exports = withSeguridadAndroid;
module.exports.redDeSeguridad = redDeSeguridad;
module.exports.endurecerActividad = endurecerActividad;
