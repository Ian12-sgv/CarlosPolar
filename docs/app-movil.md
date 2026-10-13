# App móvil (preventista y chofer)

Una sola app (Expo / React Native). Según el rol del usuario muestra el flujo del **preventista** (clientes, estado de cuenta, pedidos, cobros) o del **chofer** (rutas, entregas con firma, cobros).

## Probarla en un teléfono

1. En la PC, levante la API: `pnpm dev:api` (escucha en todas las interfaces, puerto 3000).
2. Averigüe la IP de la PC en la red local (`ipconfig` → "Dirección IPv4", p. ej. `192.168.1.10`).
3. Permita el puerto 3000 en el firewall de Windows (una vez, en PowerShell como administrador):
   ```powershell
   New-NetFirewallRule -DisplayName "Carlos Polar API" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
   ```
4. Instale **Expo Go** en el teléfono (Play Store / App Store).
5. En la PC: `pnpm dev:mobile` y escanee el código QR con Expo Go (teléfono y PC en la misma red Wi-Fi).
6. En la app: servidor `http://192.168.1.10:3000`, usuario y contraseña creados desde el backoffice (rol Preventista o Chofer).

> La app se verificó con TypeScript, pruebas de la cola de sincronización y generando el bundle de Android, pero **no se ha ejecutado en un teléfono real** desde este entorno. Pruébela con Expo Go antes de distribuirla.

## Cómo funciona sin conexión

- Al entrar y cada minuto (y al volver a la app) descarga lo necesario: el preventista, su cartera, el catálogo con precio y stock de cada lista y el estado de cuenta de cada cliente; el chofer, sus manifiestos cargados o en ruta.
- Cada acción (pedido, entrega, cobro, inicio de ruta) se guarda primero en el teléfono (SQLite) con su propia clave de idempotencia y la hora en que ocurrió.
- Se envía en orden apenas hay señal. Si se corta la red, se reintenta con espera creciente (5 s, 10 s, 20 s… hasta 5 min) **con la misma clave**: la API nunca duplica un pedido, una entrega ni un pago.
- Si el servidor rechaza una operación por una regla de negocio (precio cambió, sin stock, saldo excedido, referencia repetida), queda marcada como **rechazada** en *Sincronización* con el motivo, y el usuario la corrige y la vuelve a registrar.
- No se puede cerrar sesión con operaciones sin enviar. Cerrar sesión borra los datos descargados, nunca lo pendiente.
- El precio y el stock que se ven sin conexión son los últimos descargados; el servidor los confirma al recibir el pedido.

## Flujos

**Preventista**: *Agenda de hoy* (clientes del plan de la ruta, con su estado) o *Mis clientes* → cliente → *Iniciar visita* (llegada con GPS) → pedido y/o cobro → *Terminar visita* (el resultado se sugiere solo; sin venta pide motivo). La ficha del cliente muestra saldo, vencido, por vencer, pagos por validar, crédito disponible y restricciones; desde ahí, *Nuevo pedido* (catálogo con buscador, cantidades, total estimado con IVA) o *Registrar cobro* (método, moneda, banco, referencia, abonos por factura y **foto del comprobante** con la cámara, comprimida a menos de 512 KB).

**Chofer**: Mis rutas → manifiesto (orden de visita y estado de cada factura) → *Iniciar ruta* → factura → *Entregada* (nombre del receptor, cédula opcional, firma con el dedo) o *Rechazada* (motivo). Desde la misma factura puede registrar el cobro.

Todas las acciones adjuntan el GPS del teléfono; la entrega no se registra sin ubicación.

## Distribución

Para instalar la app sin Expo Go (APK firmado y API con HTTPS), ver [distribucion.md](distribucion.md).
