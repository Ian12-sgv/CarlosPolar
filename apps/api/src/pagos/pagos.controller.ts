import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import {
  aplicarPagoSchema,
  cerrarPagoSchema,
  listarPagosSchema,
  registrarPagoSchema,
  versionSchema,
  type AplicarPago,
  type CerrarPago,
  type ConVersion,
  type ListarPagos,
  type RegistrarPago,
} from '@cp/domain';
import type { FastifyRequest } from 'fastify';
import type { Contexto } from '../comun/contexto.js';
import { Ctx, RequierePermisos } from '../comun/decoradores.js';
import { ZodPipe } from '../comun/zod.pipe.js';
import { PagosService } from './pagos.service.js';

@Controller('pagos')
export class PagosController {
  constructor(private readonly pagos: PagosService) {}

  @Post()
  @RequierePermisos('pago.registrar')
  async registrar(@Body(new ZodPipe(registrarPagoSchema)) datos: RegistrarPago, @Ctx() ctx: Contexto, @Req() req: FastifyRequest) {
    const { pago, duplicado } = await this.pagos.registrar(datos, ctx);
    req.duplicado = duplicado;
    return pago;
  }

  @Get()
  listar(@Query(new ZodPipe(listarPagosSchema)) filtros: ListarPagos, @Ctx() ctx: Contexto) {
    return this.pagos.listar(filtros, ctx);
  }

  @Get(':id')
  obtener(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: Contexto) {
    return this.pagos.obtener(id, ctx);
  }

  @Post(':id/aplicaciones')
  @HttpCode(200)
  @RequierePermisos('pago.registrar')
  aplicar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(aplicarPagoSchema)) datos: AplicarPago, @Ctx() ctx: Contexto) {
    return this.pagos.aplicar(id, datos, ctx);
  }

  @Post(':id/validar')
  @HttpCode(200)
  @RequierePermisos('pago.validar')
  validar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(versionSchema)) datos: ConVersion, @Ctx() ctx: Contexto) {
    return this.pagos.validar(id, datos, ctx);
  }

  @Post(':id/rechazar')
  @HttpCode(200)
  @RequierePermisos('pago.validar')
  rechazar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cerrarPagoSchema)) datos: CerrarPago, @Ctx() ctx: Contexto) {
    return this.pagos.rechazar(id, datos, ctx);
  }

  @Post(':id/anular')
  @HttpCode(200)
  @RequierePermisos('pago.anular')
  anular(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cerrarPagoSchema)) datos: CerrarPago, @Ctx() ctx: Contexto) {
    return this.pagos.anular(id, datos, ctx);
  }
}
