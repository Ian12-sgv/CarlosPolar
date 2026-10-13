#!/usr/bin/env bash
# Crea la clave con la que se firman los APK/AAB de la app (una sola vez).
#
#   bash apps/mobile/scripts/crear-clave-firma.sh
#
# Deja en apps/mobile/credenciales/ (ignorado por git):
#   carlos-polar.keystore   la clave
#   firma.env               su contraseña y alias, para construir-apk.sh
#
# RESPALDE AMBOS ARCHIVOS fuera del equipo: sin esta clave no se pueden
# publicar actualizaciones de la app ya instalada en los teléfonos.
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
mkdir -p credenciales
if [ -f credenciales/carlos-polar.keystore ]; then
  echo "Ya existe credenciales/carlos-polar.keystore; no se sobrescribe." >&2
  exit 1
fi
CLAVE="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
keytool -genkeypair -v -storetype PKCS12 -keystore credenciales/carlos-polar.keystore -alias carlos-polar \
  -keyalg RSA -keysize 2048 -validity 10000 -storepass "$CLAVE" -keypass "$CLAVE" \
  -dname "CN=Carlos Polar, O=Carlos Polar, C=VE" >/dev/null
RUTA="$(cd credenciales && (pwd -W 2>/dev/null || pwd))"
cat > credenciales/firma.env <<FIN
ORG_GRADLE_PROJECT_CP_UPLOAD_STORE_FILE="$RUTA/carlos-polar.keystore"
ORG_GRADLE_PROJECT_CP_UPLOAD_STORE_PASSWORD="$CLAVE"
ORG_GRADLE_PROJECT_CP_UPLOAD_KEY_ALIAS=carlos-polar
ORG_GRADLE_PROJECT_CP_UPLOAD_KEY_PASSWORD="$CLAVE"
FIN
echo "Clave creada en $RUTA. Respalde carlos-polar.keystore y firma.env en un lugar seguro."
