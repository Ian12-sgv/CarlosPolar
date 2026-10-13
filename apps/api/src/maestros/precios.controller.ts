import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { crearListaPrecioSchema, publicarPrecioSchema, type CrearListaPrecio, type PublicarPrecio } from '@cp/domain';
import type { FastifyRequest } from 'fastify';
import type { Contexto } from '../comun/contexto.js';
import { Ctx, RequierePermisos } from '../comun/decoradores.js';
import { ErrorNegocio, NoEncontrado } from '../comun/errores.js';
import { ZodPipe } from '../comun/zod.pipe.js';
import { AuditoriaService } from '../eventos/auditoria.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('listas-precio')
export class PreciosController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get()
  listar() {
    return this.prisma.listaPrecio.findMany({ where: { activo: true }, orderBy: { codigo: 'asc' } });
  }

  @Post()
  @RequierePermisos('precio.editar')
  crear(@Body(new ZodPipe(crearListaPrecioSchema)) datos: CrearListaPrecio, @Ctx() ctx: Contexto, @Req() req: FastifyRequest) {
    return this.prisma.$transaction(async (tx) => {
      const lista = await tx.listaPrecio.create({ data: datos });
      await this.auditoria.registrarAccion(tx, ctx, req.ip, { accion: 'lista_precio.crear', tabla: 'listas_precio', registroId: lista.id, despues: datos });
      return lista;
    });
  }

  /** Historial de precios de la lista (todas las versiones), opcionalmente de un producto. */
  @Get(':id/precios')
  async historial(@Param('id', ParseUUIDPipe) id: string, @Query('productoId', new ParseUUIDPipe({ optional: true })) productoId?: string) {
    if (!(await this.prisma.listaPrecio.count({ where: { id } }))) throw new NoEncontrado('La lista de precios');
    return this.prisma.precioProducto.findMany({
      where: { listaPrecioId: id, productoId },
      include: { producto: { select: { sku: true, nombre: true } } },
      orderBy: [{ productoId: 'asc' }, { vigenteDesde: 'desc' }],
    });
  }

  /**
   * Publica un precio nuevo. La versión vigente se cierra en el instante en
   * que empieza la nueva: los pedidos y facturas ya emitidos conservan el suyo.
   */
  @Post(':id/precios')
  @RequierePermisos('precio.editar')
  publicar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(publicarPrecioSchema)) datos: PublicarPrecio,
    @Ctx() ctx: Contexto,
    @Req() req: FastifyRequest,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.listaPrecio.count({ where: { id } }))) throw new NoEncontrado('La lista de precios');
      if (!(await tx.producto.count({ where: { id: datos.productoId } }))) throw new NoEncontrado('El producto');
      const desde = datos.vigenteDesde ? new Date(datos.vigenteDesde) : new Date();

      const [abierta] = await tx.$queryRaw<{ id: string; vigente_desde: Date; precio: string }[]>`
        SELECT id, vigente_desde, precio::text FROM precios_producto
        WHERE lista_precio_id = ${id}::uuid AND producto_id = ${datos.productoId}::uuid AND vigente_hasta IS NULL
        FOR UPDATE`;
      if (abierta) {
        if (desde <= abierta.vigente_desde) {
          throw new ErrorNegocio('VIGENCIA_INVALIDA', 'El precio nuevo debe empezar después de la versión vigente', HttpStatus.CONFLICT, {
            vigenteDesde: abierta.vigente_desde,
          });
        }
        await tx.precioProducto.update({ where: { id: abierta.id }, data: { vigenteHasta: desde } });
      }
      const precio = await tx.precioProducto.create({
        data: { listaPrecioId: id, productoId: datos.productoId, precio: datos.precio, vigenteDesde: desde, creadoPor: ctx.usuarioId },
      });
      await this.auditoria.registrarAccion(tx, ctx, req.ip, {
        accion: 'precio.publicar',
        tabla: 'precios_producto',
        registroId: precio.id,
        antes: abierta ? { precio: abierta.precio, vigenteDesde: abierta.vigente_desde.toISOString() } : undefined,
        despues: { listaPrecioId: id, productoId: datos.productoId, precio: datos.precio, vigenteDesde: desde.toISOString() },
      });
      return precio;
    });
  }
}
