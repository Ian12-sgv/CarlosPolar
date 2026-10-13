import { Controller, Get, HttpStatus, ParseUUIDPipe, Query } from '@nestjs/common';
import { config } from '../config.js';
import { alcanceClientes } from '../comun/alcance.js';
import type { Contexto } from '../comun/contexto.js';
import { Ctx } from '../comun/decoradores.js';
import { ErrorNegocio, NoEncontrado } from '../comun/errores.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface FilaCatalogo {
  id: string;
  sku: string;
  nombre: string;
  unidad: string;
  alicuota_iva: Prisma.Decimal;
  precio: Prisma.Decimal;
  disponible: Prisma.Decimal;
}

@Controller('catalogo')
export class CatalogoController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Productos activos con precio vigente en la lista indicada (o la del
   * cliente) y stock disponible en el almacén principal. La app lo guarda
   * como catálogo offline; precio y stock se revalidan al emitir el pedido.
   */
  @Get()
  async obtener(
    @Ctx() ctx: Contexto,
    @Query('clienteId', new ParseUUIDPipe({ optional: true })) clienteId?: string,
    @Query('listaPrecioId', new ParseUUIDPipe({ optional: true })) listaPrecioId?: string,
  ) {
    let listaId = listaPrecioId;
    if (!listaId && clienteId) {
      const cliente = await this.prisma.cliente.findFirst({ where: { AND: [{ id: clienteId }, alcanceClientes(ctx)] } });
      if (!cliente) throw new NoEncontrado('El cliente');
      listaId = cliente.listaPrecioId ?? undefined;
    }
    if (!listaId) {
      throw new ErrorNegocio('SIN_LISTA_PRECIO', 'Indique listaPrecioId o un cliente con lista asignada', HttpStatus.BAD_REQUEST);
    }
    const lista = await this.prisma.listaPrecio.findUnique({ where: { id: listaId } });
    if (!lista) throw new NoEncontrado('La lista de precios');

    const productos = await this.prisma.$queryRaw<FilaCatalogo[]>`
      SELECT p.id, p.sku, p.nombre, p.unidad, p.alicuota_iva, pp.precio,
             coalesce(e.cantidad_fisica - e.cantidad_reservada, 0) AS disponible
      FROM productos p
      JOIN LATERAL (
        SELECT precio FROM precios_producto
        WHERE lista_precio_id = ${lista.id}::uuid AND producto_id = p.id
          AND vigente_desde <= now() AND (vigente_hasta IS NULL OR vigente_hasta > now())
        ORDER BY vigente_desde DESC LIMIT 1
      ) pp ON true
      LEFT JOIN existencias e
        ON e.producto_id = p.id AND e.ubicacion_id = (SELECT id FROM ubicaciones WHERE codigo = ${config.almacenPrincipal})
      WHERE p.activo
      ORDER BY p.nombre`;

    return {
      listaPrecio: { id: lista.id, codigo: lista.codigo, moneda: lista.moneda },
      generadoEn: new Date(),
      productos: productos.map((p) => ({
        id: p.id,
        sku: p.sku,
        nombre: p.nombre,
        unidad: p.unidad,
        alicuotaIva: p.alicuota_iva,
        precio: p.precio,
        disponible: p.disponible,
      })),
    };
  }
}
