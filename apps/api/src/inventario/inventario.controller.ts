import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ajusteInventarioSchema, ingresoInventarioSchema, type AjusteInventario, type IngresoInventario } from '@cp/domain';
import type { FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type { Contexto } from '../comun/contexto.js';
import { Ctx, RequierePermisos } from '../comun/decoradores.js';
import { NoEncontrado } from '../comun/errores.js';
import { exigirAlguno } from '../comun/permisos.js';
import { ZodPipe } from '../comun/zod.pipe.js';
import { AuditoriaService } from '../eventos/auditoria.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';

const CERO = new Prisma.Decimal(0);

interface FilaExistencia {
  producto_id: string;
  sku: string;
  producto: string;
  ubicacion_id: string;
  ubicacion: string;
  tipo_ubicacion: string;
  stock_fisico: Prisma.Decimal;
  stock_reservado: Prisma.Decimal;
  stock_disponible: Prisma.Decimal;
  stock_minimo: Prisma.Decimal;
  diferencia_cache: Prisma.Decimal;
}

@Controller('inventario')
export class InventarioController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Existencias reconstruidas desde el libro de movimientos, por producto y ubicación. */
  @Get('existencias')
  async existencias(@Ctx() ctx: Contexto, @Query('tipo') tipo?: string) {
    exigirAlguno(ctx, 'inventario.ingresar', 'inventario.ajustar', 'manifiesto.crear', 'pedido.ver_todos');
    const filas = await this.prisma.$queryRaw<FilaExistencia[]>`
      SELECT * FROM bi.v_existencias
      WHERE (${tipo ?? null}::text IS NULL OR tipo_ubicacion::text = ${tipo ?? null}::text)
      ORDER BY ubicacion, producto`;
    return filas.map((f) => ({
      productoId: f.producto_id,
      sku: f.sku,
      producto: f.producto,
      ubicacionId: f.ubicacion_id,
      ubicacion: f.ubicacion,
      tipoUbicacion: f.tipo_ubicacion,
      fisico: f.stock_fisico,
      reservado: f.stock_reservado,
      disponible: f.stock_disponible,
      minimo: f.stock_minimo,
      bajoMinimo: f.tipo_ubicacion === 'ALMACEN' && f.stock_disponible.lessThan(f.stock_minimo),
      diferenciaCache: f.diferencia_cache,
    }));
  }

  /** Entrada de mercancía al almacén principal (compra, producción, devolución de proveedor…). */
  @Post('ingresos')
  @RequierePermisos('inventario.ingresar')
  ingresar(@Body(new ZodPipe(ingresoInventarioSchema)) datos: IngresoInventario, @Ctx() ctx: Contexto, @Req() req: FastifyRequest) {
    return this.prisma.$transaction(async (tx) => {
      const movimiento = await this.mover(tx, ctx, datos.productoId, 'INGRESO', new Prisma.Decimal(datos.cantidad), [datos.documento, datos.motivo].filter(Boolean).join(' — ') || null);
      await this.auditoria.registrarAccion(tx, ctx, req.ip, { accion: 'inventario.ingreso', tabla: 'movimientos_inventario', registroId: movimiento.id, despues: datos });
      return movimiento;
    });
  }

  /** Ajuste por conteo físico, merma o daño. Exige motivo y no puede dejar el stock negativo. */
  @Post('ajustes')
  @RequierePermisos('inventario.ajustar')
  ajustar(@Body(new ZodPipe(ajusteInventarioSchema)) datos: AjusteInventario, @Ctx() ctx: Contexto, @Req() req: FastifyRequest) {
    return this.prisma.$transaction(async (tx) => {
      const movimiento = await this.mover(tx, ctx, datos.productoId, 'AJUSTE', new Prisma.Decimal(datos.cantidad), datos.motivo);
      await this.auditoria.registrarAccion(tx, ctx, req.ip, { accion: 'inventario.ajuste', tabla: 'movimientos_inventario', registroId: movimiento.id, despues: datos });
      return movimiento;
    });
  }

  private async mover(tx: Tx, ctx: Contexto, productoId: string, tipo: 'INGRESO' | 'AJUSTE', cantidad: Prisma.Decimal, motivo: string | null) {
    if (!(await tx.producto.count({ where: { id: productoId } }))) throw new NoEncontrado('El producto');
    const almacen = await tx.ubicacion.findUniqueOrThrow({ where: { codigo: config.almacenPrincipal } });
    const grupoId = randomUUID();
    return tx.movimientoInventario.create({
      data: {
        grupoId,
        productoId,
        ubicacionId: almacen.id,
        tipo,
        cantidadEntrada: cantidad.greaterThan(0) ? cantidad : CERO,
        cantidadSalida: cantidad.lessThan(0) ? cantidad.negated() : CERO,
        documentoOrigenTipo: tipo,
        documentoOrigenId: grupoId,
        usuarioId: ctx.usuarioId,
        motivo,
      },
    });
  }
}
