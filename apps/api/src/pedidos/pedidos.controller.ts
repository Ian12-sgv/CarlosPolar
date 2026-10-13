import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import {
  aprobarPedidoSchema,
  cerrarPedidoSchema,
  emitirPedidoSchema,
  listarPedidosSchema,
  type AprobarPedido,
  type CerrarPedido,
  type EmitirPedido,
  type ListarPedidos,
} from '@cp/domain';
import type { FastifyRequest } from 'fastify';
import type { Contexto } from '../comun/contexto.js';
import { Ctx, RequierePermisos } from '../comun/decoradores.js';
import { ZodPipe } from '../comun/zod.pipe.js';
import { PedidosService } from './pedidos.service.js';

@Controller('pedidos')
export class PedidosController {
  constructor(private readonly pedidos: PedidosService) {}

  @Post()
  @RequierePermisos('pedido.emitir')
  async emitir(@Body(new ZodPipe(emitirPedidoSchema)) datos: EmitirPedido, @Ctx() ctx: Contexto, @Req() req: FastifyRequest) {
    const { duplicado, ...resultado } = await this.pedidos.emitir(datos, ctx);
    req.duplicado = duplicado;
    return resultado;
  }

  @Get()
  listar(@Query(new ZodPipe(listarPedidosSchema)) filtros: ListarPedidos, @Ctx() ctx: Contexto) {
    return this.pedidos.listar(filtros, ctx);
  }

  @Get(':id')
  obtener(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: Contexto) {
    return this.pedidos.obtener(id, ctx);
  }

  @Post(':id/aprobar')
  @HttpCode(200)
  @RequierePermisos('pedido.aprobar')
  aprobar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(aprobarPedidoSchema)) datos: AprobarPedido, @Ctx() ctx: Contexto) {
    return this.pedidos.aprobar(id, datos, ctx);
  }

  @Post(':id/rechazar')
  @HttpCode(200)
  @RequierePermisos('pedido.aprobar')
  rechazar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cerrarPedidoSchema)) datos: CerrarPedido, @Ctx() ctx: Contexto) {
    return this.pedidos.rechazar(id, datos, ctx);
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @RequierePermisos('pedido.cancelar')
  cancelar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cerrarPedidoSchema)) datos: CerrarPedido, @Ctx() ctx: Contexto) {
    return this.pedidos.cancelar(id, datos, ctx);
  }
}
