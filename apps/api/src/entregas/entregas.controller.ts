import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import {
  anularEntregaSchema,
  listarEntregasSchema,
  registrarEntregaSchema,
  type AnularEntrega,
  type ListarEntregas,
  type RegistrarEntrega,
} from '@cp/domain';
import type { FastifyRequest } from 'fastify';
import type { Contexto } from '../comun/contexto.js';
import { Ctx, RequierePermisos } from '../comun/decoradores.js';
import { ZodPipe } from '../comun/zod.pipe.js';
import { EntregasService } from './entregas.service.js';

@Controller('entregas')
export class EntregasController {
  constructor(private readonly entregas: EntregasService) {}

  @Post()
  @RequierePermisos('entrega.registrar')
  async registrar(@Body(new ZodPipe(registrarEntregaSchema)) datos: RegistrarEntrega, @Ctx() ctx: Contexto, @Req() req: FastifyRequest) {
    const { entrega, duplicado } = await this.entregas.registrar(datos, ctx);
    req.duplicado = duplicado;
    return entrega;
  }

  @Get()
  listar(@Query(new ZodPipe(listarEntregasSchema)) filtros: ListarEntregas, @Ctx() ctx: Contexto) {
    return this.entregas.listar(filtros, ctx);
  }

  @Get(':id')
  obtener(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: Contexto) {
    return this.entregas.obtener(id, ctx);
  }

  @Post(':id/anular')
  @HttpCode(200)
  @RequierePermisos('entrega.anular')
  anular(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(anularEntregaSchema)) datos: AnularEntrega, @Ctx() ctx: Contexto) {
    return this.entregas.anular(id, datos, ctx);
  }
}
