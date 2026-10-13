# Modelo de datos del MVP

Fuente de verdad:

- Tablas y relaciones: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma)
- Reglas que Prisma no expresa: [`migrations/20261013000100_reglas_integridad`](../apps/api/prisma/migrations/20261013000100_reglas_integridad/migration.sql)
- Ciclos de vida y eventos: [`packages/domain/src/ciclos.ts`](../packages/domain/src/ciclos.ts)
- Permisos y roles: [`packages/domain/src/permisos.ts`](../packages/domain/src/permisos.ts)

## Ciclos de vida

| Documento | Estados | Notas |
|---|---|---|
| Pedido | EMITIDO → APROBADO → FACTURADO; EMITIDO → RECHAZADO; EMITIDO/APROBADO → CANCELADO | Aprobar reserva inventario; cancelar la libera. |
| Factura | EMITIDA → DESPACHADA → ENTREGADA; DESPACHADA → EMITIDA (retorno); EMITIDA → ANULADA | Estado logístico. El estado de cobro se deriva de los pagos validados. |
| Manifiesto | BORRADOR → CONFIRMADO → EN_RUTA → CERRADO; BORRADOR → ANULADO | Confirmar = carga física. Solo se edita en BORRADOR. |
| Entrega | nace CONFIRMADA o RECHAZADA → ANULADA | Anular es una corrección de supervisor. |
| Pago | REGISTRADO → VALIDADO/RECHAZADO/ANULADO; VALIDADO → ANULADO | Solo VALIDADO reduce la deuda oficial. |
| Reserva | ACTIVA → CONSUMIDA/LIBERADA/VENCIDA | Se consume al cargar en el vehículo. |

Cada transición genera un evento con nombre estable (`PEDIDO_APROBADO`, `PAGO_VALIDADO`…) en `eventos_negocio`.

## Garantías que da la base de datos

La API valida todo antes de escribir, pero estas reglas se cumplen aunque la API tenga un error. Están probadas en [`apps/api/test/reglas-db.test.ts`](../apps/api/test/reglas-db.test.ts).

| Regla | Mecanismo |
|---|---|
| Referencia de pago única por método y banco (salvo anulados) | Índice único parcial |
| Aplicaciones ≤ monto del pago y ≤ saldo de la factura, sin carreras | Trigger con `FOR UPDATE` sobre pago y factura |
| Un pago no se aplica a facturas de otro cliente ni a facturas anuladas | Trigger |
| Una factura en un solo manifiesto activo | Índice único parcial |
| Una factura no se entrega dos veces | Índice único parcial |
| Cargado ≤ facturado; entregado + rechazado ≤ cargado | Triggers |
| Manifiesto no editable fuera de BORRADOR | Trigger |
| Contenido de factura y datos de origen del pago inmutables | Triggers |
| Eventos, auditoría, movimientos, líneas de factura y aplicaciones: sin UPDATE/DELETE/TRUNCATE | Triggers |
| Documentos con estado: sin DELETE/TRUNCATE | Triggers |
| Stock físico ≥ 0 y reservado ≤ físico | CHECK + constraint trigger diferido |
| `existencias` coincide con el libro de movimientos | Triggers; `bi.v_existencias.diferencia_cache` lo audita |
| Vigencias de precio sin solapamiento | `EXCLUDE USING gist` |
| Una sola asignación de vendedor vigente por cliente | Índice único parcial |

| Un cliente no se repite el mismo día en la plantilla de una ruta | Índice único parcial |
| Una visita cerrada no se modifica; sin venta exige motivo | Trigger + CHECK |
| Bitácora de sincronización móvil inmutable | Triggers |
| Un vehículo con un solo manifiesto abierto | Índice único parcial |
| Los datos de una entrega (GPS, firma, receptor, hora) no se modifican | Trigger |
| Una reserva activa por línea de factura | Índice único parcial |

## Rutas, visitas y sincronización

- `ruta_plan_clientes`: plantilla semanal (día ISO 1–7 y orden) de qué clientes visita cada ruta.
- `visitas_planificadas`: visitas que corresponden a cada fecha, con el vendedor de ese día (el histórico no cambia si la ruta cambia de responsable).
- `visitas`: visita real con GPS y resultado (`PEDIDO`, `COBRO`, `SIN_PEDIDO`…). Pedidos y pagos pueden ligarse a la visita.
- `sincronizacion_registros`: cada mutación enviada por una app móvil con su resultado (`ACEPTADO`, `DUPLICADO`, `RECHAZADO`, `CONFLICTO`, `ERROR`). La llena la API automáticamente.

## Decisiones tomadas

- **IDs UUIDv7 generados en la base de datos** (`uuid_v7()`). Las apps móviles pueden generar el id offline y enviarlo; eso permite reintentos idempotentes.
- **Las reservas no son movimientos físicos.** Viven en `reservas_inventario`; el libro de movimientos solo registra mercancía que se movió. Así, el saldo físico siempre se puede reconstruir sumando el libro.
- **Una carga genera dos movimientos** (salida del almacén y entrada al vehículo) con el mismo `grupo_id`.
- **El saldo de la factura no se guarda**: se calcula en `bi.v_saldo_facturas`. Los pagos registrados sin validar "ocupan" saldo para evitar que se aplique dos veces lo mismo, pero no reducen la deuda oficial.
- **Multimoneda (USD/VES):** cada factura, pago y aplicación guarda la tasa que usó. `pago_aplicaciones.monto_aplicado` está en la moneda de la factura y `monto_moneda_pago` en la del pago.
- **Número de control fiscal** opcional y asignable una sola vez, para recibirlo de una imprenta digital o máquina fiscal.
- **Idempotencia:** `solicitudes_idempotentes` guarda la respuesta de cada `Idempotency-Key` por usuario.
- **Sesiones con tokens opacos** (no JWT): solo se guarda el hash. Cada solicitud verifica la sesión en la base de datos, así que revocar es inmediato.
- **Precio de la factura = precio del pedido** (congelado al emitir el pedido). Supuesto pendiente de confirmar.
- **Tasa de la factura:** BCV del día o la más reciente de los últimos 3 días (configurable).
- **Número de control fiscal manual** hasta que se defina la integración fiscal.
- **Un manifiesto abierto por vehículo:** el vehículo queda vacío entre rutas y el cuadre es exacto.
- **Borrador de manifiesto editable:** sus facturas y líneas se pueden quitar; desde que se confirma, nada se borra.
- **Carga completa por factura** en el MVP (cargado = facturado).
- **Una reserva activa por línea de factura**, con historial: la consumida al cargar y una nueva si la factura retorna.
- **Entrega total o rechazo total** en el MVP; `entrega_items` ya guarda cantidades por línea para las entregas parciales de P1.
- **Archivos por contenido:** el nombre es el SHA-256; un reenvío reutiliza el registro y, si el archivo se perdió del disco, se reescribe. Al descargar se verifica el hash.
- **Anular una entrega** solo con la ruta abierta; el reverso es un movimiento ENTREGA de entrada (el cuadre cuenta lo entregado neto).
- **Tasa de los pagos:** la del día del pago, guardada en el pago y en cada abono; los abonos van en la moneda de la factura.
- **Pagos por validar ocupan saldo** (no se puede abonar dos veces lo mismo), pero solo los validados reducen la deuda oficial.
- **Usuario técnico `sistema`** (inactivo, sin contraseña) firma los eventos de procesos automáticos, como el vencimiento de reservas.

## Decisiones del negocio

- **Tasa al aplicar un pago en otra moneda:** la del día del pago (confirmado el 13/10/2026).
- **IGTF y retenciones de IVA:** fuera de alcance por ahora (decidido el 13/10/2026). No se modelan hasta nuevo aviso.

## Pendiente de confirmar con el negocio

1. **Facturación fiscal:** ¿imprenta digital, máquina fiscal o ambas? Define cómo se integra la emisión.
2. **Tasa al facturar:** se usa la BCV del día (supuesto).
3. **Precio de la factura:** se asumió el precio del pedido; confirmar si debe ser el vigente al facturar.
4. **Vencimiento de reservas:** cuántas horas dura una reserva de un pedido aprobado sin facturar.
5. **Formatos de referencia** por método de pago (`packages/domain/src/pagos.ts`): los rangos de longitud son supuestos.
6. **Pagos de terceros:** hoy un pago solo se aplica a facturas del mismo cliente.

## Power BI

Power BI se conecta solo al esquema `bi`. La migración crea el rol `bi_lector` (sin login). Para crear el usuario de conexión:

```sql
CREATE ROLE powerbi LOGIN PASSWORD '...';
GRANT bi_lector TO powerbi;
```

Vistas disponibles: `v_saldo_facturas`, `v_cartera_antiguedad`, `v_existencias`, `v_embudo_lineas`, `v_eventos`, `v_cumplimiento_visitas`, `v_sincronizacion`, `v_cuadre_manifiestos`.
