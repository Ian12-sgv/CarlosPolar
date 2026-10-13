import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { registrarTasaSchema, type RegistrarTasa } from '@cp/domain';
import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';
import type { Contexto } from '../comun/contexto.js';
import { Ctx, RequierePermisos } from '../comun/decoradores.js';
import { NoEncontrado } from '../comun/errores.js';
import { aFechaDb } from '../comun/fechas.js';
import { ZodPipe } from '../comun/zod.pipe.js';
import { AuditoriaService } from '../eventos/auditoria.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TasasService } from './tasas.service.js';

@Controller('tasas')
export class TasasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasas: TasasService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Registra la tasa del día. Una tasa por fecha y fuente; no se corrige: cada documento guarda la que usó. */
  @Post()
  @RequierePermisos('tasa.registrar')
  registrar(@Body(new ZodPipe(registrarTasaSchema)) datos: RegistrarTasa, @Ctx() ctx: Contexto, @Req() req: FastifyRequest) {
    return this.prisma.$transaction(async (tx) => {
      const tasa = await tx.tasaCambio.create({
        data: {
          fecha: aFechaDb(datos.fecha),
          monedaOrigen: 'USD',
          monedaDestino: 'VES',
          tasa: datos.tasa,
          fuente: datos.fuente,
          creadoPor: ctx.usuarioId,
        },
      });
      await this.auditoria.registrar(tx, {
        usuarioId: ctx.usuarioId,
        dispositivoId: ctx.dispositivoId,
        origen: ctx.origen,
        ip: req.ip,
        accion: 'tasa.registrar',
        tabla: 'tasas_cambio',
        registroId: tasa.id,
        despues: { fecha: datos.fecha, tasa: datos.tasa, fuente: datos.fuente },
      });
      return tasa;
    });
  }

  @Get('vigente')
  async vigente() {
    const tasa = await this.tasas.vigente(this.prisma);
    if (!tasa) throw new NoEncontrado(`Una tasa ${config.fuenteTasa} reciente`);
    return tasa;
  }
}
