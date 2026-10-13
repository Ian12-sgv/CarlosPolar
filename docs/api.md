# API — guía para las apps

Base: `http://<servidor>:3000`. Todas las respuestas son JSON. Los montos y cantidades llegan como **texto decimal** (`"46.4"`) para no perder precisión; conviértalos con una librería decimal, no con `parseFloat`, si va a operar con ellos.

## Cabeceras

| Cabecera | Cuándo | Valor |
|---|---|---|
| `Authorization` | Siempre, salvo inicio de sesión, refresco y `/salud` | `Bearer <accessToken>` |
| `X-Origen` | Siempre | `WEB`, `APP_PREVENTISTA` o `APP_CHOFER` |
| `Idempotency-Key` | **Obligatoria** en toda mutación (POST) desde las apps móviles; recomendada en la web | UUID nuevo por operación |
| `X-Fecha-Dispositivo` | Opcional, en mutaciones móviles | Fecha ISO del momento en que el usuario hizo la acción |

### Reintentos e idempotencia

- Genere la `Idempotency-Key` **al crear la operación** (al guardar el pedido en SQLite, no al enviarlo) y reutilícela en cada reintento.
- Si la API ya procesó esa clave, devuelve la misma respuesta (éxito o rechazo) sin repetir la operación.
- Si cambia el contenido (por ejemplo, el usuario corrige el pedido después de un `PRECIO_CAMBIO`), use una **clave nueva**. Reutilizar una clave con otro contenido devuelve `422 IDEMPOTENCY_KEY_REUTILIZADA`.
- `409 SOLICITUD_EN_PROCESO`: la primera solicitud con esa clave sigue en curso; reintente en unos segundos.
- Para pedidos, envíe también el `id` generado en el dispositivo (UUID): aunque se pierda la clave, reenviar el mismo `id` no duplica el pedido.

## Errores

Formato único:

```json
{ "codigo": "STOCK_INSUFICIENTE", "mensaje": "…", "detalles": … }
```

Decida por `codigo`, nunca por `mensaje`.

| HTTP | Código | Qué hacer |
|---|---|---|
| 400 | `SOLICITUD_INVALIDA` | Error de validación; `detalles` lista campo y mensaje |
| 401 | `NO_AUTENTICADO`, `CREDENCIALES_INVALIDAS`, `SESION_INVALIDA` | Refrescar sesión o volver a iniciarla |
| 403 | `SIN_PERMISO` (`detalles.faltantes`), `DISPOSITIVO_REVOCADO` | Mostrar mensaje; no reintentar |
| 404 | `NO_ENCONTRADO` | El registro no existe o no está en su alcance |
| 409 | `PRECIO_CAMBIO` | `detalles` trae `precioVigente` por producto; mostrar y reenviar con clave nueva |
| 409 | `STOCK_INSUFICIENTE` | `detalles` trae solicitado y disponible por producto |
| 409 | `CREDITO_RESTRINGIDO` | `detalles` trae las restricciones (`DEUDA_VENCIDA`, `CUPO_EXCEDIDO`, `SIN_TASA`) |
| 409 | `VERSION_DESACTUALIZADA` | Otro usuario cambió el documento; recargar |
| 409 | `TRANSICION_INVALIDA` | El estado actual no admite esa acción |
| 409 | `SIN_TASA` | No hay tasa reciente; Administración debe registrarla |
| 409 | `FACTURA_CON_PAGOS`, `NUMERO_CONTROL_ASIGNADO`, `NADA_QUE_FACTURAR` | Ver mensaje |
| 409 | `VEHICULO_OCUPADO`, `FACTURA_EN_OTRO_MANIFIESTO`, `FACTURA_NO_DESPACHABLE`, `MANIFIESTO_NO_EDITABLE`, `MANIFIESTO_VACIO` | Ver mensaje y `detalles` |
| 409 | `DIFERENCIAS_SIN_JUSTIFICAR` | `detalles` trae esperado, contado y diferencia por producto; reenviar con `motivoDiferencias` |
| 422 | `CONTEO_INCOMPLETO`, `PRODUCTO_NO_CARGADO`, `CHOFER_INVALIDO`, `VEHICULO_INVALIDO` | Corregir la solicitud |
| 409 | `MANIFIESTO_NO_EN_RUTA`, `FACTURA_SIN_MANIFIESTO`, `FACTURA_YA_ENTREGADA` | Ver mensaje |
| 403 | `NO_ES_CHOFER_ASIGNADO` | Solo el chofer del manifiesto registra sus entregas |
| 422 | `ARCHIVO_INVALIDO` | La firma no es una imagen válida del tipo declarado o supera 512 KB |
| 409 | `REFERENCIA_DUPLICADA` | Ya hay un pago con esa referencia, método y banco |
| 409 | `SALDO_EXCEDIDO` | `detalles.saldo` trae lo que queda por cobrar (descontando pagos por validar) |
| 422 | `APLICACIONES_EXCEDEN_PAGO`, `FACTURA_INVALIDA` | Corregir los abonos |
| 409 | `REGLA_VIOLADA`, `DUPLICADO` | La base de datos rechazó la operación por una regla de integridad |

## Sesión

Token de acceso de vida corta (`ACCESO_MINUTOS`, 30 por defecto) y refresh token que rota en cada uso. La sesión dura como máximo `SESION_DIAS` (30). Revocar un dispositivo o cerrar sesión tiene efecto inmediato.

| Método | Ruta | Cuerpo |
|---|---|---|
| POST | `/auth/iniciar-sesion` | `{ username, password, dispositivo: { identificador, plataforma: android\|ios\|web, nombre? } }` |
| POST | `/auth/refrescar` | `{ refreshToken }` |
| POST | `/auth/cerrar-sesion` | — |
| GET | `/auth/yo` | — devuelve usuario, roles, permisos y `vendedorId` |

El `identificador` del dispositivo debe ser estable (generarlo una vez y guardarlo en el almacenamiento seguro del teléfono).

## Endpoints disponibles

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/salud` | público | Estado de la API y la base de datos |
| GET | `/clientes?buscar=` | `cliente.ver` | Cartera del usuario (preventista: solo sus clientes) |
| GET | `/clientes/:id/estado-cuenta` | `cliente.ver` | Saldo por moneda, vencido, próximo a vencer, pagos por validar, crédito disponible y restricciones |
| GET | `/catalogo?clienteId=` o `?listaPrecioId=` | sesión | Productos con precio vigente y disponible en el almacén principal |
| POST | `/pedidos` | `pedido.emitir` | Emitir pedido. Responde `{ pedido, advertencias }` |
| GET | `/pedidos?estado=&clienteId=&limite=` | sesión | Pedidos dentro del alcance del usuario |
| GET | `/pedidos/:id` | sesión | Detalle con líneas y reservas activas |
| POST | `/pedidos/:id/aprobar` | `pedido.aprobar` | `{ version, aceptarFaltantes?, excepcionCredito?: { motivo } }`. Reserva inventario |
| POST | `/pedidos/:id/rechazar` | `pedido.aprobar` | `{ version, motivo }` |
| POST | `/pedidos/:id/cancelar` | `pedido.cancelar` | `{ version, motivo }`. Libera reservas |
| POST | `/facturas` | `factura.emitir` | `{ pedidoId, versionPedido, lineas?: [{ pedidoItemId, cantidad }] }`. Sin `lineas`, factura lo reservado |
| GET | `/facturas?estado=&clienteId=&sinNumeroControl=&limite=` | sesión | Facturas dentro del alcance del usuario |
| GET | `/facturas/:id` | sesión | Detalle con líneas y estado de cobro (saldo, cobrado, por validar) |
| POST | `/facturas/:id/anular` | `factura.anular` | `{ version, motivo }`. Solo facturas EMITIDA sin pagos; libera reservas |
| POST | `/facturas/:id/numero-control` | `factura.emitir` | `{ numeroControl }`. Se asigna una sola vez |
| POST | `/tasas` | `tasa.registrar` | `{ fecha: 'AAAA-MM-DD', tasa, fuente? }` (Bs por USD; fuente BCV por defecto) |
| GET | `/tasas/vigente` | sesión | Tasa aplicable hoy |
| POST | `/vehiculos` | `vehiculo.editar` | `{ placa, descripcion? }`. Crea también su ubicación de inventario |
| GET | `/vehiculos` | `manifiesto.crear` | Vehículos activos |
| POST | `/manifiestos` | `manifiesto.crear` | `{ vehiculoId, choferId, facturaIds? }`. Nace en BORRADOR |
| GET | `/manifiestos?estado=&choferId=&limite=` | sesión | Logística ve todos; el chofer, los suyos |
| GET | `/manifiestos/:id` | sesión | Detalle con facturas (orden de visita) y líneas cargadas |
| GET | `/manifiestos/:id/cuadre` | sesión | Cargado, entregado y esperado en el vehículo por producto |
| POST | `/manifiestos/:id/facturas` | `manifiesto.crear` | `{ version, facturaIds }`. Solo en BORRADOR |
| POST | `/manifiestos/:id/facturas/:facturaId/quitar` | `manifiesto.crear` | `{ version }`. Solo en BORRADOR |
| POST | `/manifiestos/:id/confirmar` | `manifiesto.confirmar` | `{ version }`. Carga física: mueve inventario al vehículo |
| POST | `/manifiestos/:id/iniciar-ruta` | chofer asignado o `manifiesto.confirmar` | `{ version, latitud?, longitud?, fechaHoraDispositivo? }` |
| POST | `/manifiestos/:id/anular` | `manifiesto.crear` | `{ version, motivo }`. Solo BORRADOR |
| POST | `/manifiestos/:id/cerrar` | `manifiesto.cerrar` | `{ version, conteo: [{ productoId, cantidad }], motivoDiferencias? }` |
| POST | `/entregas` | `entrega.registrar` | Entrega total o rechazo total (ver abajo) |
| GET | `/entregas?manifiestoId=&facturaId=&limite=` | sesión | Supervisores ven todas; el chofer, las suyas |
| GET | `/entregas/:id` | sesión | Detalle con líneas entregadas y rechazadas |
| POST | `/entregas/:id/anular` | `entrega.anular` | `{ motivo }`. Solo mientras la ruta está EN_RUTA |
| GET | `/archivos/:id` | sesión | Descarga una firma o evidencia (participantes del documento o supervisores) |
| POST | `/pagos` | `pago.registrar` | Registrar pago y, opcionalmente, abonarlo a facturas (ver abajo) |
| GET | `/pagos?estado=&clienteId=&limite=` | sesión | Administración ve todos; el preventista, los de su cartera |
| GET | `/pagos/:id` | sesión | Detalle con aplicaciones, monto aplicado y disponible |
| POST | `/pagos/:id/aplicaciones` | `pago.registrar` | `{ version, aplicaciones: [{ facturaId, montoAplicado }] }`. Abona el remanente |
| POST | `/pagos/:id/validar` | `pago.validar` | `{ version }`. Desde aquí reduce la deuda oficial |
| POST | `/pagos/:id/rechazar` | `pago.validar` | `{ version, motivo }`. Libera el saldo que ocupaba |
| POST | `/pagos/:id/anular` | `pago.anular` | `{ version, motivo }`. También revierte un pago validado |
| POST | `/usuarios` | `usuario.administrar` | `{ username, nombre, password, roles[], codigoVendedor? }` |
| POST | `/dispositivos/:id/revocar` | `usuario.administrar` | Revoca el dispositivo y sus sesiones |

Los contratos exactos (con validaciones) están en [`packages/domain/src/contratos.ts`](../packages/domain/src/contratos.ts); las apps deben importarlos de `@cp/domain` para validar antes de enviar o de guardar offline.

## Reglas del flujo de pedidos

- **Emitir** no reserva stock. Usa siempre el precio vigente de la lista del cliente; si `precioOfertado` difiere, rechaza con `PRECIO_CAMBIO`. Devuelve advertencias (stock insuficiente, deuda vencida, cupo) sin bloquear.
- **Aprobar** reserva en el almacén principal por `RESERVA_HORAS` (48 por defecto, pendiente de confirmar). Si falta stock, rechaza salvo `aceptarFaltantes: true`, que reserva lo disponible. Si el cliente tiene restricciones de crédito, exige `excepcionCredito` y el permiso `pedido.excepcion_credito`.
- Las reservas vencidas se liberan solas cada `BARRIDO_RESERVAS_MINUTOS` (5).
- Toda acción que cambia de estado exige la `version` actual del pedido (control de concurrencia).

## Reglas de facturación

- Solo se factura un pedido **APROBADO**, con su `version` actual. El pedido pasa a FACTURADO (una factura por pedido).
- **Precio:** el del pedido (congelado al emitirlo). La factura no recalcula con el precio vigente.
- **Cantidades:** por defecto, lo reservado en cada línea. Con `lineas` se puede facturar menos (lo no facturado se libera) o más que lo reservado si hay disponible en ese momento; nunca más que lo pedido.
- **Reservas:** quedan ligadas a la línea de factura y dejan de vencer; se consumirán al cargar el camión.
- **Tasa:** la de la fuente `FUENTE_TASA` (BCV) de hoy o, si no hay, la más reciente de los últimos `TASA_MAX_DIAS` (3). Sin tasa no se factura.
- **Vencimiento:** fecha de emisión (hora de Caracas) + `dias_credito` del cliente.
- **Número de control fiscal:** queda vacío al emitir y se registra después con `/facturas/:id/numero-control` (hasta que se integre la imprenta digital o máquina fiscal). `GET /facturas?sinNumeroControl=true` lista las pendientes.
- **Anulación:** solo facturas EMITIDA (aún no despachadas) y sin pagos aplicados; exige motivo. Lo despachado o entregado se corregirá con notas de crédito (fase P1).

## Reglas del manifiesto de carga

- **Ciclo:** BORRADOR → CONFIRMADO → EN_RUTA → CERRADO; un borrador también puede ANULARSE.
- **Borrador:** se agregan o quitan facturas EMITIDA. Una factura solo puede estar en un manifiesto activo, y un vehículo solo tiene un manifiesto abierto. En el MVP se carga cada factura completa.
- **Confirmar (carga física):** consume las reservas, registra la salida del almacén y la entrada al vehículo, y pasa las facturas a DESPACHADA. Desde aquí nada se modifica.
- **Iniciar ruta:** lo hace el chofer asignado desde la app (con GPS) o Logística.
- **Cerrar (cuadre):** se envía el conteo físico de lo que regresa. Esperado = cargado − entregado. El conteo vuelve al almacén; si no coincide, exige `motivoDiferencias` y la diferencia queda como movimiento de AJUSTE del vehículo. Las facturas no entregadas vuelven a EMITIDA con una reserva nueva, listas para otro manifiesto.

## Registro de entregas (app del chofer)

```json
POST /entregas
{
  "id": "<uuid generado en el teléfono>",
  "facturaId": "…",
  "resultado": "CONFIRMADA",
  "fechaHoraDispositivo": "2026-10-13T15:42:10-04:00",
  "latitud": 10.4806, "longitud": -66.9036, "precisionMetros": 8,
  "receptorNombre": "Encargado de tienda", "receptorDocumento": "V12345678",
  "firma": { "mime": "image/png", "contenidoBase64": "iVBORw0…" }
}
```

- **CONFIRMADA** exige `receptorNombre` y `firma` (PNG, JPEG o WebP, máximo 512 KB). Descuenta la mercancía del vehículo y pasa la factura a ENTREGADA.
- **RECHAZADA** exige `motivoRechazo`. La mercancía sigue en el vehículo y vuelve al almacén en el cierre; la factura se puede reintentar en la misma ruta.
- **GPS obligatorio** en ambos casos. El evento guarda la distancia al cliente (si el cliente tiene coordenadas) para auditoría.
- La firma viaja en la misma solicitud: si la app reintenta, entrega y firma llegan juntas o no llega ninguna. Guarde el `id` y la `Idempotency-Key` junto con la entrega pendiente en SQLite.
- Solo el chofer asignado (o Logística con `manifiesto.cerrar`) registra, y solo con el manifiesto EN_RUTA.
- **Anular** (supervisor) corrige un registro equivocado mientras la ruta sigue abierta: la mercancía vuelve al vehículo y la factura a DESPACHADA. Después del cierre, las correcciones serán con notas de crédito.

## Cobranza

```json
POST /pagos
{
  "id": "<uuid generado en el teléfono>",
  "clienteId": "…",
  "metodoPago": "PAGO_MOVIL",
  "entidadOrigen": "0134",
  "referencia": "0134-5678-90",
  "moneda": "VES",
  "montoTotal": 1174.50,
  "fechaEmision": "2026-10-13",
  "aplicaciones": [{ "facturaId": "…", "montoAplicado": 29 }],
  "evidencia": { "mime": "image/jpeg", "contenidoBase64": "…" }
}
```

- **Registrar ≠ validar.** Un pago registrado no reduce la deuda oficial; Administración lo valida o lo rechaza. El estado de cuenta muestra aparte los pagos por validar.
- **Abonos:** `montoAplicado` va en la **moneda de la factura**. Si el pago es en otra moneda, se convierte con la **tasa del día del pago** (se guarda en el pago y en cada abono). Lo no abonado queda disponible para aplicarlo después.
- **Saldo:** un pago registrado (aún sin validar) también ocupa saldo, para que no se abone dos veces lo mismo. Si se rechaza o anula, el saldo se libera.
- **Referencia:** se normaliza (sin espacios ni guiones, en mayúsculas) y no puede repetirse para el mismo método y banco, salvo que el pago anterior esté anulado. Efectivo no lleva referencia y su origen es `CAJA`.
- **Quién cobra:** el preventista a clientes de su cartera; el chofer, a clientes con una factura en su ruta en curso.
- **IGTF y retenciones de IVA:** fuera de alcance por decisión del negocio.

## Datos maestros e inventario

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| POST | `/clientes` | `cliente.editar` | Alta. Crédito exige `cliente.editar_credito`; vendedor, `cliente.asignar_vendedor` |
| PATCH | `/clientes/:id` | por grupo de campos | Datos generales (`cliente.editar`), crédito (`cliente.editar_credito`), vendedor (`cliente.asignar_vendedor`, guarda historial) |
| GET | `/clientes/:id` | `cliente.ver` | Detalle con ruta, vendedor, lista e historial de vendedores |
| GET / POST / PATCH | `/productos`, `/productos/:id` | lectura con sesión; escritura `producto.editar` | `?incluirInactivos=true` para ver todos |
| GET / POST | `/listas-precio` | escritura `precio.editar` | Listas de precio por moneda |
| GET / POST | `/listas-precio/:id/precios` | escritura `precio.editar` | Historial / publicar precio nuevo (cierra la versión vigente) |
| GET / POST | `/rutas` | `cliente.ver` / `cliente.editar` | |
| GET | `/vendedores` | `cliente.ver` | Para asignar clientes y rutas |
| GET | `/choferes` | `manifiesto.crear` | Usuarios que pueden registrar entregas |
| GET | `/usuarios`, `/roles` | `usuario.administrar` | Usuarios con roles y dispositivos; roles con permisos |
| GET | `/inventario/existencias?tipo=ALMACEN\|VEHICULO` | logística, ajustes o ventas | Físico, reservado, disponible y bajo mínimo |
| POST | `/inventario/ingresos` | `inventario.ingresar` | `{ productoId, cantidad, documento?, motivo? }` |
| POST | `/inventario/ajustes` | `inventario.ajustar` | `{ productoId, cantidad (±), motivo }`; no deja stock negativo |

## Rutas y visitas

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/rutas/:id` | `cliente.ver` | Ruta con su plan semanal vigente |
| PATCH | `/rutas/:id` | `ruta.planificar` | `{ nombre?, vendedorId?, activo? }` |
| POST | `/rutas/:id/plan` | `ruta.planificar` | `{ diaSemana (1=lunes…7), clienteIds[] }` en orden de visita. Reemplaza el plan del día; el anterior queda en el historial |
| GET | `/visitas/agenda?fecha=&vendedorId=` | `visita.registrar` o `pedido.ver_todos` | Agenda del día (plan + visitas hechas + fuera de plan + resumen de cumplimiento). Fecha futura: previsualización |
| POST | `/visitas` | `visita.registrar` | `{ id, clienteId, inicioEn, latitud, longitud, precisionMetros? }`. Llegada al cliente (id generado en el teléfono) |
| POST | `/visitas/:id/cerrar` | `visita.registrar` | `{ resultado, finEn, motivoSinVenta?, observaciones? }`. Sin venta exige motivo |
| POST | `/visitas-planificadas/:id/cancelar` | `ruta.planificar` | `{ motivo }`. Deja de contar para el cumplimiento |

- La agenda de cada día se genera desde el plan vigente (cada hora en el servidor y al consultarla), con el vendedor de ese día.
- Pedidos y pagos aceptan `visitaId`: la cola de la app envía primero la visita y después el pedido.
- El cumplimiento se ve en el backoffice (Ventas → Visitas) y en Power BI (`v_cumplimiento_visitas`).
