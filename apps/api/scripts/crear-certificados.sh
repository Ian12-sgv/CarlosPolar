#!/usr/bin/env bash
# Crea una autoridad certificadora (CA) propia y un certificado HTTPS para la
# API, firmado por esa CA. La app Android instalada confía en esta CA (se
# incluye en el APK), así que no hace falta un dominio público ni pagar un
# certificado.
#
# Uso (Git Bash):
#   bash apps/api/scripts/crear-certificados.sh 192.168.1.10 servidor.local
#
# Argumentos: las IP y nombres con los que los teléfonos llegarán al servidor.
# Genera en apps/api/certificados/:
#   ca.crt / ca.key        CA (10 años). Guarde ca.key en un lugar seguro.
#   servidor.crt / .key    Certificado de la API (825 días). Renovable con la misma CA.
set -euo pipefail
# Git Bash en Windows convierte "/O=..." en una ruta; esto lo evita (sin efecto en Linux/macOS).
export MSYS_NO_PATHCONV=1

if [ "$#" -eq 0 ]; then
  echo "Indique al menos una IP o nombre del servidor. Ej.: $0 192.168.1.10" >&2
  exit 1
fi

DIR="$(cd "$(dirname "$0")/.." && pwd)/certificados"
mkdir -p "$DIR"
cd "$DIR"

if [ ! -f ca.key ]; then
  openssl req -x509 -newkey rsa:3072 -sha256 -days 3650 -nodes \
    -keyout ca.key -out ca.crt -subj "/O=Carlos Polar/CN=Carlos Polar CA interna" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"
  echo "CA creada: $DIR/ca.crt"
else
  echo "Se reutiliza la CA existente: $DIR/ca.crt"
fi

SAN="DNS:localhost,IP:127.0.0.1"
for nombre in "$@"; do
  [ "$nombre" = "localhost" ] || [ "$nombre" = "127.0.0.1" ] && continue
  if [[ "$nombre" =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then SAN="$SAN,IP:$nombre"; else SAN="$SAN,DNS:$nombre"; fi
done

openssl req -newkey rsa:2048 -sha256 -nodes -keyout servidor.key -out servidor.csr -subj "/O=Carlos Polar/CN=$1"
# Archivo temporal (no sustitución de procesos): el openssl de Windows no lee /dev/fd.
printf "subjectAltName=%s\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n" "$SAN" > servidor.ext
openssl x509 -req -in servidor.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 825 -sha256 -out servidor.crt -extfile servidor.ext
rm -f servidor.csr servidor.ext

# Ruta en formato Windows si se ejecuta en Git Bash (Node no entiende /c/...).
RUTA="$(pwd -W 2>/dev/null || pwd)"
echo
echo "Certificado del servidor: $RUTA/servidor.crt ($SAN)"
echo "Agregue a apps/api/.env:"
echo "  HTTPS_CERT=\"$RUTA/servidor.crt\""
echo "  HTTPS_KEY=\"$RUTA/servidor.key\""
