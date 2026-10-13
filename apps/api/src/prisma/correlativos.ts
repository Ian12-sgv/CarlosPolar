import type { Tx } from './prisma.service.js';

/** Siguiente número del correlativo (p. ej. 'FAC-00000042'), dentro de la transacción del documento. */
export async function siguienteCorrelativo(tx: Tx, codigo: 'PEDIDO' | 'FACTURA' | 'MANIFIESTO'): Promise<string> {
  const [fila] = await tx.$queryRaw<{ numero: string }[]>`SELECT fn_siguiente_correlativo(${codigo}) AS numero`;
  return fila!.numero;
}
