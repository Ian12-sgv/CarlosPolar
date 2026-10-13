import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { crearVehiculoSchema, type CrearVehiculo } from '@cp/domain';
import type { FastifyRequest } from 'fastify';
import type { Contexto } from '../comun/contexto.js';
import { Ctx, RequierePermisos } from '../comun/decoradores.js';
import { ZodPipe } from '../comun/zod.pipe.js';
import { AuditoriaService } from '../eventos/auditoria.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('vehiculos')
export class VehiculosController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Registra un vehículo y su ubicación de inventario (el camión es un lugar de custodia). */
  @Post()
  @RequierePermisos('vehiculo.editar')
  crear(@Body(new ZodPipe(crearVehiculoSchema)) datos: CrearVehiculo, @Ctx() ctx: Contexto, @Req() req: FastifyRequest) {
    return this.prisma.$transaction(async (tx) => {
      const vehiculo = await tx.vehiculo.create({
        data: {
          placa: datos.placa,
          descripcion: datos.descripcion,
          ubicacion: { create: { codigo: `VEH-${datos.placa}`, nombre: `Vehículo ${datos.placa}`, tipo: 'VEHICULO' } },
        },
        include: { ubicacion: true },
      });
      await this.auditoria.registrar(tx, {
        usuarioId: ctx.usuarioId,
        dispositivoId: ctx.dispositivoId,
        origen: ctx.origen,
        ip: req.ip,
        accion: 'vehiculo.crear',
        tabla: 'vehiculos',
        registroId: vehiculo.id,
        despues: { placa: vehiculo.placa },
      });
      return vehiculo;
    });
  }

  @Get()
  @RequierePermisos('manifiesto.crear')
  listar() {
    return this.prisma.vehiculo.findMany({ where: { activo: true }, include: { ubicacion: true }, orderBy: { placa: 'asc' } });
  }
}
