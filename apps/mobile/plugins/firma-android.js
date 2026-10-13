/**
 * Plugin de configuración de Expo: firma del APK/AAB de release con la clave
 * propia del proyecto (no con la clave de depuración de la plantilla).
 *
 * Los datos de la clave se leen de propiedades de Gradle, que pueden venir de
 * variables de entorno ORG_GRADLE_PROJECT_<nombre> (ver scripts/construir-apk.sh):
 *   CP_UPLOAD_STORE_FILE, CP_UPLOAD_STORE_PASSWORD, CP_UPLOAD_KEY_ALIAS, CP_UPLOAD_KEY_PASSWORD
 *
 * Sin esas propiedades, release se firma con la clave de depuración (sirve
 * para probar, pero no para distribuir: Android no permite actualizar una app
 * firmada con otra clave).
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARCA = '// carlos-polar: firma de release';

module.exports = function conFirmaAndroid(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARCA)) return cfg;

    const firmas = /signingConfigs\s*\{/;
    if (!firmas.test(gradle)) throw new Error('firma-android: no se encontró signingConfigs en app/build.gradle');
    gradle = gradle.replace(
      firmas,
      `signingConfigs {
        ${MARCA}
        release {
            if (project.hasProperty('CP_UPLOAD_STORE_FILE')) {
                storeFile file(CP_UPLOAD_STORE_FILE)
                storePassword CP_UPLOAD_STORE_PASSWORD
                keyAlias CP_UPLOAD_KEY_ALIAS
                keyPassword CP_UPLOAD_KEY_PASSWORD
            }
        }`,
    );

    const release = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/;
    if (!release.test(gradle)) throw new Error('firma-android: no se encontró la firma del buildType release');
    gradle = gradle.replace(release, `$1signingConfig project.hasProperty('CP_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`);

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
