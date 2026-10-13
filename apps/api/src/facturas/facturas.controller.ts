import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import {
  anularFacturaSchema,
  asignarNumeroControlSchema,
  emitirFacturaSchema,
  listarFacturasSchema,
  type AnularFactura,
  type AsignarNumeroControl,
  type EmitirFactura,
  type ListarFacturas,
} from '@cp/domain';
import type { FastifyRequest } from 'fastify';
import type { Contexto } from '../comun/contexto.js';
import { Ctx, RequierePermisos } from '../comun/decoradores.js';
import { ZodPipe } from '../comun/zod.pipe.js';
import { FacturasService } from './facturas.service.js';

@Controller('facturas')
export class FacturasController {
  constructor(private readonly facturas: FacturasService) {}

  @Post()
  @RequierePermisos('factura.emitir')
  emitir(@Body(new ZodPipe(emitirFacturaSchema)) datos: EmitirFactura, @Ctx() ctx: Contexto) {
    return this.facturas.emitir(datos, ctx);
  }

  @Get()
  listar(@Query(new ZodPipe(listarFacturasSchema)) filtros: ListarFacturas, @Ctx() ctx: Contexto) {
    return this.facturas.listar(filtros, ctx);
  }

  @Get(':id')
  obtener(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: Contexto) {
    return this.facturas.obtener(id, ctx);
  }

  @Post(':id/anular')
  @HttpCode(200)
  @RequierePermisos('factura.anular')
  anular(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(anularFacturaSchema)) datos: AnularFactura, @Ctx() ctx: Contexto) {
    return this.facturas.anular(id, datos, ctx);
  }

  @Post(':id/numero-control')
  @HttpCode(200)
  @RequierePermisos('factura.emitir')
  asignarNumeroControl(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(asignarNumeroControlSchema)) datos: AsignarNumeroControl,
    @Ctx() ctx: Contexto,
    @Req() req: FastifyRequest,
  ) {
    return this.facturas.asignarNumeroControl(id, datos.numeroControl, ctx, req.ip);
  }
}
