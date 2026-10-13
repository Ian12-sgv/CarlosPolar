/**
 * Nombres estables de los eventos de negocio. Power BI y los reportes se
 * construyen sobre estos nombres, nunca sobre códigos de estado; renombrar
 * uno rompe el histórico analítico.
 */
export const TIPOS_EVENTO = [
  'PEDIDO_EMITIDO',
  'PEDIDO_APROBADO',
  'PEDIDO_RECHAZADO',
  'PEDIDO_CANCELADO',
  'PEDIDO_FACTURADO',
  'RESERVA_CREADA',
  'RESERVA_CONSUMIDA',
  'RESERVA_LIBERADA',
  'RESERVA_VENCIDA',
  'FACTURA_EMITIDA',
  'FACTURA_DESPACHADA',
  'FACTURA_ENTREGADA',
  'FACTURA_ENTREGA_REVERTIDA',
  'FACTURA_RETORNADA',
  'FACTURA_ANULADA',
  'MANIFIESTO_CREADO',
  'MANIFIESTO_CONFIRMADO',
  'MANIFIESTO_ANULADO',
  'MANIFIESTO_CERRADO',
  'RUTA_INICIADA',
  'ENTREGA_CONFIRMADA',
  'ENTREGA_RECHAZADA',
  'ENTREGA_ANULADA',
  'DEVOLUCION_CONFIRMADA',
  'VISITA_INICIADA',
  'VISITA_CERRADA',
  'PAGO_REGISTRADO',
  'PAGO_APLICADO',
  'PAGO_VALIDADO',
  'PAGO_RECHAZADO',
  'PAGO_ANULADO',
] as const;

export type TipoEvento = (typeof TIPOS_EVENTO)[number];

export const ORIGENES = ['WEB', 'APP_PREVENTISTA', 'APP_CHOFER', 'API', 'SISTEMA'] as const;

export type Origen = (typeof ORIGENES)[number];
