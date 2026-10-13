#!/usr/bin/env bash
# Genera el APK de release firmado, listo para instalar en los teléfonos.
#
#   CP_SERVIDOR=https://192.168.1.10:3443 CP_VERSION_CODE=2 bash apps/mobile/scripts/construir-apk.sh
#
# Requisitos: JDK 17, Android SDK, la CA interna (apps/api/scripts/crear-certificados.sh)
# y la clave de firma (scripts/crear-clave-firma.sh). El APK queda en apk/ (raíz del proyecto).
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."

if [ -z "${ANDROID_HOME:-}" ]; then
  ANDROID_HOME="$(cygpath -m "${LOCALAPPDATA:-}/Android/Sdk" 2>/dev/null || echo "$HOME/Android/Sdk")"
fi
export ANDROID_HOME
if [ -f credenciales/firma.env ]; then
  set -a; . credenciales/firma.env; set +a
else
  echo "AVISO: no hay credenciales/firma.env; el APK se firmará con la clave de depuración (solo para pruebas)." >&2
fi
if [ ! -f ../api/certificados/ca.crt ] && [ -z "${CP_CA:-}" ]; then
  echo "AVISO: no hay CA interna; la app solo confiará en certificados públicos." >&2
fi

# En Windows, Java usa el almacén de certificados del sistema: así funcionan las
# descargas de Gradle detrás de antivirus o proxies que inspeccionan HTTPS.
case "${OSTYPE:-}" in
  msys*|cygwin*|win*) export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} -Djavax.net.ssl.trustStoreType=Windows-ROOT" ;;
esac

npx expo prebuild --platform android --clean --no-install
cd android
# La descarga de Gradle (~140 MB) supera a veces los 10 s por defecto del descargador.
sed -i 's/^networkTimeout=.*/networkTimeout=600000/' gradle/wrapper/gradle-wrapper.properties
./gradlew assembleRelease --no-daemon
# El APK queda en la carpeta apk/ de la raíz del proyecto.
RAIZ="$(cd ../../.. && pwd)"
mkdir -p "$RAIZ/apk"
DESTINO="$RAIZ/apk/carlos-polar-v${CP_VERSION_CODE:-1}.apk"
cp app/build/outputs/apk/release/app-release.apk "$DESTINO"
echo "APK: $(cd "$RAIZ/apk" && (pwd -W 2>/dev/null || pwd))/$(basename "$DESTINO")"
