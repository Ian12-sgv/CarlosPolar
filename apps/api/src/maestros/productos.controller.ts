import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { crearProductoSchema, editarProductoSchema, type CrearProducto, type EditarProducto } from '@cp/domain';
import type { FastifyRequest } from 'fastify';
import type { Contexto } from '../comun/contexto.js';
import { Ctx, RequierePermisos } from '../comun/decoradores.js';
import { NoEncontrado } from '../comun/errores.js';
import { ZodPipe } from '../comun/zod.pipe.js';
import { AuditoriaService } from '../eventos/auditoria.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('productos')
export class ProductosController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get()
  listar(@Query('incluirInactivos') incluirInactivos?: string) {
    return this.prisma.producto.findMany({
      where: incluirInactivos === 'true' ? {} : { activo: true },
      orderBy: { nombre: 'asc' },
    });
  }

  @Post()
  @RequierePermisos('producto.editar')
  crear(@Body(new ZodPipe(crearProductoSchema)) datos: CrearProducto, @Ctx() ctx: Contexto, @Req() req: FastifyRequest) {
    return this.prisma.$transaction(async (tx) => {
      const producto = await tx.producto.create({ data: datos });
      await this.auditoria.registrarAccion(tx, ctx, req.ip, { accion: 'producto.crear', tabla: 'productos', registroId: producto.id, despues: datos });
      return producto;
    });
  }

  @Patch(':id')
  @RequierePermisos('producto.editar')
  editar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(editarProductoSchema)) datos: EditarProducto,
    @Ctx() ctx: Contexto,
    @Req() req: FastifyRequest,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const actual = await tx.producto.findUnique({ where: { id } });
      if (!actual) throw new NoEncontrado('El producto');
      const producto = await tx.producto.update({ where: { id }, data: datos });
      const antes = Object.fromEntries(Object.keys(datos).map((k) => [k, (actual as Record<string, unknown>)[k]]));
      await this.auditoria.registrarAccion(tx, ctx, req.ip, {
        accion: 'producto.editar',
        tabla: 'productos',
        registroId: id,
        antes: JSON.parse(JSON.stringify(antes)) as Prisma.InputJsonValue,
        despues: datos,
      });
      return producto;
    });
  }
}
