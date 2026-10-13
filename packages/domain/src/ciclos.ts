/**
 * Ciclos de vida formales de los documentos del MVP.
 *
 * Cada ciclo declara los estados iniciales posibles y las transiciones
 * permitidas. Cada transición está ligada al evento de negocio que debe
 * registrarse en `eventos_negocio` cuando ocurre. Cualquier cambio de estado
 * que no figure aquí es inválido y debe rechazarse en la API.
 */
import type { TipoEvento } from './eventos.js';

export interface CicloDeVida<E extends string> {
  entidad: string;
  /** Estados con los que puede nacer el documento y el evento que lo registra. */
  iniciales: Partial<Record<E, TipoEvento>>;
  /** estado actual → estado destino → evento que registra la transición. */
  transiciones: Record<E, Partial<Record<E, TipoEvento>>>;
}

export type EstadoPedido = 'EMITIDO' | 'APROBADO' | 'RECHAZADO' | 'CANCELADO' | 'FACTURADO';

export const CICLO_PEDIDO: CicloDeVida<EstadoPedido> = {
  entidad: 'PEDIDO',
  iniciales: { EMITIDO: 'PEDIDO_EMITIDO' },
  transiciones: {
    EMITIDO: {
      APROBADO: 'PEDIDO_APROBADO',
      RECHAZADO: 'PEDIDO_RECHAZADO',
      CANCELADO: 'PEDIDO_CANCELADO',
    },
    // Al aprobar se reserva inventario; cancelar libera la reserva.
    APROBADO: {
      FACTURADO: 'PEDIDO_FACTURADO',
      CANCELADO: 'PEDIDO_CANCELADO',
    },
    RECHAZADO: {},
    CANCELADO: {},
    FACTURADO: {},
  },
};

/**
 * Estado logístico de la factura. El estado de cobro (pendiente, parcial,
 * pagada) no se guarda aquí: se deriva de las aplicaciones de pago validadas.
 */
export type EstadoFactura = 'EMITIDA' | 'DESPACHADA' | 'ENTREGADA' | 'ANULADA';

export const CICLO_FACTURA: CicloDeVida<EstadoFactura> = {
  entidad: 'FACTURA',
  iniciales: { EMITIDA: 'FACTURA_EMITIDA' },
  transiciones: {
    EMITIDA: {
      DESPACHADA: 'FACTURA_DESPACHADA',
      ANULADA: 'FACTURA_ANULADA',
    },
    DESPACHADA: {
      ENTREGADA: 'FACTURA_ENTREGADA',
      // Rechazo total en destino: la mercancía regresa y la factura puede
      // incluirse en otro manifiesto o anularse.
      EMITIDA: 'FACTURA_RETORNADA',
    },
    // Solo vuelve atrás si un supervisor anula la entrega mientras la ruta
    // sigue abierta (error de registro). Después, se corrige con notas de crédito (P1).
    ENTREGADA: { DESPACHADA: 'FACTURA_ENTREGA_REVERTIDA' },
    ANULADA: {},
  },
};

export type EstadoManifiesto = 'BORRADOR' | 'CONFIRMADO' | 'EN_RUTA' | 'CERRADO' | 'ANULADO';

export const CICLO_MANIFIESTO: CicloDeVida<EstadoManifiesto> = {
  entidad: 'MANIFIESTO',
  iniciales: { BORRADOR: 'MANIFIESTO_CREADO' },
  transiciones: {
    BORRADOR: {
      // Confirmar = carga física: mueve inventario del almacén al vehículo.
      CONFIRMADO: 'MANIFIESTO_CONFIRMADO',
      ANULADO: 'MANIFIESTO_ANULADO',
    },
    CONFIRMADO: { EN_RUTA: 'RUTA_INICIADA' },
    // Cerrar exige cuadrar carga = entregas + devoluciones + saldo en vehículo.
    EN_RUTA: { CERRADO: 'MANIFIESTO_CERRADO' },
    CERRADO: {},
    ANULADO: {},
  },
};

export type EstadoEntrega = 'CONFIRMADA' | 'RECHAZADA' | 'ANULADA';

export const CICLO_ENTREGA: CicloDeVida<EstadoEntrega> = {
  entidad: 'ENTREGA',
  iniciales: {
    CONFIRMADA: 'ENTREGA_CONFIRMADA',
    RECHAZADA: 'ENTREGA_RECHAZADA',
  },
  transiciones: {
    // Anular es una corrección de supervisor con evento compensatorio.
    CONFIRMADA: { ANULADA: 'ENTREGA_ANULADA' },
    RECHAZADA: { ANULADA: 'ENTREGA_ANULADA' },
    ANULADA: {},
  },
};

export type EstadoPago = 'REGISTRADO' | 'VALIDADO' | 'RECHAZADO' | 'ANULADO';

export const CICLO_PAGO: CicloDeVida<EstadoPago> = {
  entidad: 'PAGO',
  iniciales: { REGISTRADO: 'PAGO_REGISTRADO' },
  transiciones: {
    REGISTRADO: {
      VALIDADO: 'PAGO_VALIDADO',
      RECHAZADO: 'PAGO_RECHAZADO',
      ANULADO: 'PAGO_ANULADO',
    },
    // Reverso de un pago ya validado: la deuda vuelve a quedar pendiente.
    VALIDADO: { ANULADO: 'PAGO_ANULADO' },
    RECHAZADO: {},
    ANULADO: {},
  },
};

export type EstadoReserva = 'ACTIVA' | 'CONSUMIDA' | 'LIBERADA' | 'VENCIDA';

export const CICLO_RESERVA: CicloDeVida<EstadoReserva> = {
  entidad: 'RESERVA',
  iniciales: { ACTIVA: 'RESERVA_CREADA' },
  transiciones: {
    ACTIVA: {
      // Se consume al cargar la mercancía en el vehículo.
      CONSUMIDA: 'RESERVA_CONSUMIDA',
      LIBERADA: 'RESERVA_LIBERADA',
      // Solo vencen las reservas de pedidos aún no facturados.
      VENCIDA: 'RESERVA_VENCIDA',
    },
    CONSUMIDA: {},
    LIBERADA: {},
    VENCIDA: {},
  },
};

export class TransicionInvalidaError extends Error {
  constructor(
    readonly entidad: string,
    readonly desde: string | null,
    readonly hacia: string,
  ) {
    super(
      desde === null
        ? `${entidad}: no puede crearse en estado ${hacia}`
        : `${entidad}: transición no permitida ${desde} → ${hacia}`,
    );
    this.name = 'TransicionInvalidaError';
  }
}

export function puedeTransicionar<E extends string>(ciclo: CicloDeVida<E>, desde: E, hacia: E): boolean {
  return ciclo.transiciones[desde][hacia] !== undefined;
}

/** Devuelve el evento a registrar para la creación del documento, o lanza si el estado no es inicial. */
export function eventoDeCreacion<E extends string>(ciclo: CicloDeVida<E>, estado: E): TipoEvento {
  const evento = ciclo.iniciales[estado];
  if (evento === undefined) throw new TransicionInvalidaError(ciclo.entidad, null, estado);
  return evento;
}

/** Devuelve el evento a registrar para la transición, o lanza si no está permitida. */
export function eventoDeTransicion<E extends string>(ciclo: CicloDeVida<E>, desde: E, hacia: E): TipoEvento {
  const evento = ciclo.transiciones[desde][hacia];
  if (evento === undefined) throw new TransicionInvalidaError(ciclo.entidad, desde, hacia);
  return evento;
}

export function esEstadoFinal<E extends string>(ciclo: CicloDeVida<E>, estado: E): boolean {
  return Object.keys(ciclo.transiciones[estado]).length === 0;
}

export const CICLOS = {
  PEDIDO: CICLO_PEDIDO,
  FACTURA: CICLO_FACTURA,
  MANIFIESTO: CICLO_MANIFIESTO,
  ENTREGA: CICLO_ENTREGA,
  PAGO: CICLO_PAGO,
  RESERVA: CICLO_RESERVA,
} as const;
