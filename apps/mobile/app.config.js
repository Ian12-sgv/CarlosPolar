/**
 * Configuración de la app. Valores por compilación (variables de entorno):
 *   CP_SERVIDOR       URL de la API que aparece por defecto al iniciar sesión (https://…)
 *   CP_CA             Ruta al certificado de la CA interna (por defecto ../api/certificados/ca.crt si existe)
 *   CP_HOSTS_HTTP     Hosts a los que se permite HTTP en release, separados por coma (solo pruebas)
 *   CP_VERSION_CODE   Número de versión de Android; súbalo en cada APK que distribuya
 */
const fs = require('node:fs');
const path = require('node:path');

const caPorDefecto = path.join(__dirname, '..', 'api', 'certificados', 'ca.crt');
const certificado = process.env.CP_CA ?? (fs.existsSync(caPorDefecto) ? caPorDefecto : undefined);
const hostsHttp = (process.env.CP_HOSTS_HTTP ?? '').split(',').map((h) => h.trim()).filter(Boolean);
const permisoUbicacion = 'La ubicación se registra como evidencia de visitas, entregas y cobros.';

module.exports = {
  expo: {
    name: 'Carlos Polar',
    slug: 'carlos-polar',
    version: '0.1.0',
    orientation: 'portrait',
    android: {
      package: 'com.carlospolar.app',
      versionCode: Number(process.env.CP_VERSION_CODE ?? 1),
      permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'CAMERA'],
    },
    ios: {
      bundleIdentifier: 'com.carlospolar.app',
      infoPlist: { NSLocationWhenInUseUsageDescription: permisoUbicacion },
    },
    extra: {
      servidorPredeterminado: process.env.CP_SERVIDOR ?? '',
    },
    plugins: [
      'expo-sqlite',
      'expo-secure-store',
      ['expo-location', { locationWhenInUsePermission: permisoUbicacion }],
      ['expo-image-picker', { cameraPermission: 'La cámara se usa para fotografiar el comprobante de pago.', photosPermission: false }],
      ['./plugins/confianza-red', { certificado, hostsHttp }],
      './plugins/firma-android',
    ],
  },
};
