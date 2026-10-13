/**
 * Plugin de configuración de Expo: seguridad de red en Android.
 *
 * - En release la app solo habla HTTPS (Android bloquea HTTP en apps
 *   instaladas) y confía en los certificados del sistema más la CA interna del
 *   proyecto, que se incluye en el APK. Así la API puede usar un certificado
 *   propio sin dominio público.
 * - En debug (desarrollo con Metro) se permite HTTP.
 * - `hostsHttp` permite HTTP hacia hosts concretos también en release. Úselo
 *   solo para pruebas (p. ej. "10.0.2.2", el host visto desde el emulador).
 *
 * Opciones: { certificado: "ruta/al/ca.crt", hostsHttp: ["10.0.2.2"] }
 */
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

function escribir(ruta, contenido) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, contenido);
}

module.exports = function conConfianzaDeRed(config, opciones = {}) {
  const { certificado, hostsHttp = [] } = opciones;

  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const app = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src');
      const anclas = ['<certificates src="system" />'];
      if (certificado) {
        const origen = path.resolve(cfg.modRequest.projectRoot, certificado);
        if (!fs.existsSync(origen)) {
          throw new Error(`confianza-red: no existe el certificado ${origen}. Genérelo con apps/api/scripts/crear-certificados.sh`);
        }
        fs.mkdirSync(path.join(app, 'main', 'res', 'raw'), { recursive: true });
        fs.copyFileSync(origen, path.join(app, 'main', 'res', 'raw', 'ca_interna.crt'));
        anclas.push('<certificates src="@raw/ca_interna" />');
      }
      const http = hostsHttp.length
        ? `\n  <domain-config cleartextTrafficPermitted="true">\n${hostsHttp.map((h) => `    <domain includeSubdomains="false">${h}</domain>`).join('\n')}\n  </domain-config>`
        : '';

      escribir(
        path.join(app, 'main', 'res', 'xml', 'network_security_config.xml'),
        `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      ${anclas.join('\n      ')}
    </trust-anchors>
  </base-config>${http}
</network-security-config>
`,
      );
      // Variante debug: Metro sirve el código por HTTP.
      escribir(
        path.join(app, 'debug', 'res', 'xml', 'network_security_config.xml'),
        `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      ${anclas.join('\n      ')}
      <certificates src="user" />
    </trust-anchors>
  </base-config>
</network-security-config>
`,
      );
      return cfg;
    },
  ]);

  return withAndroidManifest(config, (cfg) => {
    const aplicacion = cfg.modResults.manifest.application?.[0];
    if (!aplicacion) throw new Error('confianza-red: AndroidManifest sin <application>');
    aplicacion.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return cfg;
  });
};
