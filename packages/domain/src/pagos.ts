/**
 * Normalización y validación de referencias de pago.
 *
 * La referencia normalizada es la que se guarda en
 * `pagos_recibidos.referencia_normalizada` y participa en el índice único
 * (metodo_pago, entidad_origen, referencia_normalizada) que impide registrar
 * dos veces la misma transferencia.
 */
export const METODOS_PAGO = ['EFECTIVO', 'TRANSFERENCIA', 'PAGO_MOVIL', 'PUNTO_VENTA', 'ZELLE'] as const;

export type MetodoPago = (typeof METODOS_PAGO)[number];

/**
 * Formato esperado de la referencia ya normalizada. `null` significa que el
 * método no usa referencia (efectivo). Los rangos de longitud son supuestos
 * iniciales y deben confirmarse con los bancos que usa la operación.
 */
const FORMATO_REFERENCIA: Record<MetodoPago, RegExp | null> = {
  EFECTIVO: null,
  TRANSFERENCIA: /^\d{4,20}$/,
  PAGO_MOVIL: /^\d{4,12}$/,
  PUNTO_VENTA: /^\d{4,12}$/,
  ZELLE: /^[A-Z0-9]{6,30}$/,
};

/** Elimina espacios, guiones y otros separadores, y convierte a mayúsculas. */
export function normalizarReferencia(referencia: string): string {
  return referencia.normalize('NFKC').replace(/[\s\-_.\/#]/g, '').toUpperCase();
}

export type ResultadoReferencia =
  | { ok: true; referencia: string | null }
  | { ok: false; motivo: string };

export function validarReferencia(metodo: MetodoPago, referencia: string | null | undefined): ResultadoReferencia {
  const formato = FORMATO_REFERENCIA[metodo];
  const normalizada = referencia ? normalizarReferencia(referencia) : '';

  if (formato === null) {
    return normalizada === ''
      ? { ok: true, referencia: null }
      : { ok: false, motivo: `${metodo} no lleva referencia` };
  }
  if (normalizada === '') return { ok: false, motivo: `${metodo} requiere referencia` };
  if (!formato.test(normalizada)) return { ok: false, motivo: `Referencia con formato inválido para ${metodo}` };
  return { ok: true, referencia: normalizada };
}
