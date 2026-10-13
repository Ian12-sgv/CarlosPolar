import { Injectable } from '@nestjs/common';
import { config } from '../config.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { Tx } from '../prisma/prisma.service.js';

/** Precio vigente y stock disponible, consultados siempre en línea al confirmar una operación. */
@Injectable()
export class PreciosService {
  async vigentes(tx: Tx, listaPrecioId: string, productoIds: string[]): Promise<Map<string, Prisma.Decimal>> {
    const filas = await tx.$queryRaw<{ producto_id: string; precio: Prisma.Decimal }[]>`
      SELECT DISTINCT ON (producto_id) producto_id, precio
      FROM precios_producto
      WHERE lista_precio_id = ${listaPrecioId}::uuid
        AND producto_id = ANY(${productoIds}::uuid[])
        AND vigente_desde <= now() AND (vigente_hasta IS NULL OR vigente_hasta > now())
      ORDER BY producto_id, vigente_desde DESC`;
    return new Map(filas.map((f) => [f.producto_id, f.precio]));
  }

  /**
   * Stock disponible (físico − reservado) en el almacén principal.
   * Con `bloquear`, toma las filas de existencias hasta el fin de la
   * transacción, en orden de producto para evitar interbloqueos.
   */
  async disponibles(tx: Tx, productoIds: string[], bloquear = false): Promise<Map<string, Prisma.Decimal>> {
    const filas = bloquear
      ? await tx.$queryRaw<{ producto_id: string; disponible: Prisma.Decimal }[]>`
          SELECT e.producto_id, e.cantidad_fisica - e.cantidad_reservada AS disponible
          FROM existencias e JOIN ubicaciones u ON u.id = e.ubicacion_id
          WHERE u.codigo = ${config.almacenPrincipal} AND e.producto_id = ANY(${productoIds}::uuid[])
          ORDER BY e.producto_id
          FOR UPDATE OF e`
      : await tx.$queryRaw<{ producto_id: string; disponible: Prisma.Decimal }[]>`
          SELECT e.producto_id, e.cantidad_fisica - e.cantidad_reservada AS disponible
          FROM existencias e JOIN ubicaciones u ON u.id = e.ubicacion_id
          WHERE u.codigo = ${config.almacenPrincipal} AND e.producto_id = ANY(${productoIds}::uuid[])`;
    return new Map(filas.map((f) => [f.producto_id, f.disponible]));
  }
}
