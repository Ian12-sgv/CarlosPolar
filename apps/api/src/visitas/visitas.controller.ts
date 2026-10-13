import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import {
  cancelarVisitaPlanSchema,
  cerrarVisitaSchema,
  consultarAgendaSchema,
  iniciarVisitaSchema,
  type CancelarVisitaPlan,
  type CerrarVisita,
  type ConsultarAgenda,
  type IniciarVisita,
} from '@cp/domain';
import type { FastifyRequest } from 'fastify';
import type { Contexto } from '../comun/contexto.js';
import { Ctx, RequierePermisos } from '../comun/decoradores.js';
import { exigirAlguno } from '../comun/permisos.js';
import { ZodPipe } from '../comun/zod.pipe.js';
import { VisitasService } from './visitas.service.js';

@Controller()
export class VisitasController {
  constructor(private readonly visitas: VisitasService) {}

  /** Agenda del día: el preventista ve la suya; supervisión, la de cualquier vendedor. */
  @Get('visitas/agenda')
  agenda(@Query(new ZodPipe(consultarAgendaSchema)) filtros: ConsultarAgenda, @Ctx() ctx: Contexto) {
    exigirAlguno(ctx, 'visita.registrar', 'pedido.ver_todos');
    return this.visitas.agenda(filtros.fecha, filtros.vendedorId, ctx);
  }

  @Post('visitas')
  @RequierePermisos('visita.registrar')
  async iniciar(@Body(new ZodPipe(iniciarVisitaSchema)) datos: IniciarVisita, @Ctx() ctx: Contexto, @Req() req: FastifyRequest) {
    const { visita, duplicado } = await this.visitas.iniciar(datos, ctx);
    req.duplicado = duplicado;
    return visita;
  }

  @Post('visitas/:id/cerrar')
  @HttpCode(200)
  @RequierePermisos('visita.registrar')
  cerrar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cerrarVisitaSchema)) datos: CerrarVisita, @Ctx() ctx: Contexto) {
    return this.visitas.cerrar(id, datos, ctx);
  }

  @Post('visitas-planificadas/:id/cancelar')
  @HttpCode(200)
  @RequierePermisos('ruta.planificar')
  cancelar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cancelarVisitaPlanSchema)) datos: CancelarVisitaPlan) {
    return this.visitas.cancelarPlanificada(id, datos.motivo);
  }
}
