# Distribución: HTTPS y APK

Android bloquea HTTP en las apps instaladas. Para instalar la app sin Expo Go hacen falta dos cosas: **la API sirviendo HTTPS** y **un APK firmado** que confíe en ese certificado.

Se usa una **CA interna** del proyecto: no hace falta dominio público ni pagar certificados. El APK incluye la CA y solo confía en ella y en las autoridades públicas del sistema.

## 1. Certificado HTTPS de la API (una vez, y al cambiar de IP)

En Git Bash, desde la raíz del proyecto, indique las IP o nombres con los que los teléfonos llegan al servidor:

```sh
bash apps/api/scripts/crear-certificados.sh 192.168.1.10 servidor.local
```

Crea `apps/api/certificados/` (ignorado por git):

| Archivo | Uso |
|---|---|
| `ca.crt` | CA interna (10 años). Se incluye en el APK. |
| `ca.key` | Clave de la CA. **Respáldela y no la comparta**: con ella se renuevan los certificados sin reinstalar la app. |
| `servidor.crt` / `servidor.key` | Certificado de la API (825 días). |

Agregue a `apps/api/.env` las dos líneas que imprime el script (`HTTPS_CERT` y `HTTPS_KEY`) y reinicie la API. Con esas variables la API sirve **solo HTTPS** en `PORT`; conviene usar `PORT=3443` y abrir ese puerto en el firewall:

```powershell
New-NetFirewallRule -DisplayName "Carlos Polar API" -Direction Inbound -Protocol TCP -LocalPort 3443 -Action Allow
```

Si la IP del servidor cambia, vuelva a ejecutar el script con la IP nueva: reutiliza la misma CA, así que **no hay que reinstalar la app**. Lo ideal es fijar la IP del servidor en el router (reserva DHCP).

> El backoffice web en desarrollo sigue usando HTTP a través del proxy de Vite. Si la API pasa a HTTPS, inicie la web con `API_URL=https://localhost:3443`.

## 2. Clave de firma del APK (una vez)

```sh
bash apps/mobile/scripts/crear-clave-firma.sh
```

Crea `apps/mobile/credenciales/carlos-polar.keystore` y `firma.env` (ignorados por git). **Respalde ambos fuera del equipo**: Android solo instala actualizaciones firmadas con la misma clave; si se pierde, hay que desinstalar la app en todos los teléfonos.

## 3. Generar el APK

Requisitos: JDK 17 y Android SDK (Android Studio los instala).

```sh
CP_SERVIDOR=https://192.168.1.10:3443 CP_VERSION_CODE=1 bash apps/mobile/scripts/construir-apk.sh
```

- `CP_SERVIDOR`: URL que la app propone al iniciar sesión.
- `CP_VERSION_CODE`: súbalo en cada APK nuevo (2, 3…); Android no instala una versión con número igual o menor.
- El APK queda en `apk/carlos-polar-v<N>.apk` (raíz del proyecto).
- La primera compilación descarga Gradle y dependencias (varios minutos); las siguientes son más rápidas.

Alternativa sin Android SDK: compilar en la nube con EAS (`npx eas-cli build -p android --profile apk`, requiere una cuenta gratuita de Expo). En ese caso la CA debe estar en el proyecto al compilar, o la app solo confiará en certificados públicos.

## 4. Instalar en los teléfonos

1. Copie el APK al teléfono (cable, WhatsApp, Drive…).
2. Ábralo y permita "instalar apps de origen desconocido" para esa aplicación cuando lo pida.
3. Al abrir la app, ingrese con el servidor `https://…:3443` y su usuario.

Para actualizar: genere un APK con `CP_VERSION_CODE` mayor e instálelo encima; los datos y operaciones pendientes del teléfono se conservan.

## Antivirus que inspeccionan HTTPS

Antivirus como **Avast** (Web Shield) interceptan las conexiones HTTPS **que salen** del equipo donde están instalados y las vuelven a firmar con su propio certificado. Efectos:

- En el servidor no afecta a los teléfonos: sus conexiones llegan a la API sin pasar por el antivirus.
- Sí afecta a programas del mismo equipo: el emulador de Android, `curl`, Node o Java verán el certificado del antivirus. El script de compilación ya configura Java para confiar en el almacén de Windows (donde el antivirus instala su raíz).
- Para probar la app con el emulador en ese equipo, agregue una excepción en el antivirus para la dirección del servidor, o compile un APK de prueba que permita HTTP solo hacia el emulador: `CP_HOSTS_HTTP=10.0.2.2`. **No distribuya ese APK.**
