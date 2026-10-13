import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { editarRutaSchema, guardarPlanDiaSchema, type EditarRuta, type GuardarPlanDia } from '@cp/domain';
import type { FastifyRequest } from 'fastify';
import type { Contexto } from '../comun/contexto.js';
import { Ctx, RequierePermisos } from '../comun/decoradores.js';
import { ErrorNegocio, NoEncontrado } from '../comun/errores.js';
import { aFechaDb, fechaOperativa } from '../comun/fechas.js';
import { ZodPipe } from '../comun/zod.pipe.js';
import { AuditoriaService } from '../eventos/auditoria.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { VisitasService } from './visitas.service.js';

@Controller('rutas')
export class RutasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly visitas: VisitasService,
  ) {}

  /** Ruta con su plan semanal vigente (clientes por día, en orden de visita). */
  @Get(':id')
  @RequierePermisos('cliente.ver')
  async obtener(@Param('id', ParseUUIDPipe) id: string) {
    const ruta = await this.prisma.ruta.findUnique({
      where: { id },
      include: {
        vendedor: { select: { codigo: true, usuario: { select: { nombre: true } } } },
        planClientes: {
          where: { vigenteHasta: null },
          orderBy: [{ diaSemana: 'asc' }, { orden: 'asc' }],
          include: { cliente: { select: { id: true, razonSocial: true, direccion: true, activo: true } } },
        },
      },
    });
    if (!ruta) throw new NoEncontrado('La ruta');
    return ruta;
  }

  @Patch(':id')
  @RequierePermisos('ruta.planificar')
  editar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(editarRutaSchema)) datos: EditarRuta, @Ctx() ctx: Contexto, @Req() req: FastifyRequest) {
    return this.prisma.$transaction(async (tx) => {
      const actual = await tx.ruta.findUnique({ where: { id } });
      if (!actual) throw new NoEncontrado('La ruta');
      if (datos.vendedorId && !(await tx.vendedor.count({ where: { id: datos.vendedorId, activo: true } }))) {
        throw new ErrorNegocio('REFERENCIA_INVALIDA', 'El vendedor no existe o está inactivo', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      const ruta = await tx.ruta.update({ where: { id }, data: datos });
      await this.auditoria.registrarAccion(tx, ctx, req.ip, {
        accion: 'ruta.editar',
        tabla: 'rutas',
        registroId: id,
        antes: { nombre: actual.nombre, vendedorId: actual.vendedorId, activo: actual.activo },
        despues: datos as Prisma.InputJsonValue,
      });
      return ruta;
    });
  }

  /**
   * Reemplaza el plan de un día de la semana. El plan anterior queda en el
   * historial (vigente hasta hoy). Los clientes agregados se suman a la agenda
   * de hoy si el día coincide; los quitados dejan de aparecer desde mañana.
   */
  @Post(':id/plan')
  @RequierePermisos('ruta.planificar')
  guardarPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(guardarPlanDiaSchema)) datos: GuardarPlanDia,
    @Ctx() ctx: Contexto,
    @Req() req: FastifyRequest,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM rutas WHERE id = ${id}::uuid FOR UPDATE`;
      const ruta = await tx.ruta.findUnique({ where: { id } });
      if (!ruta) throw new NoEncontrado('La ruta');
      const clientes = await tx.cliente.findMany({ where: { id: { in: datos.clienteIds }, activo: true }, select: { id: true } });
      const invalidos = datos.clienteIds.filter((c) => !clientes.some((x) => x.id === c));
      if (invalidos.length > 0) {
        throw new ErrorNegocio('CLIENTE_INVALIDO', 'Hay clientes inexistentes o inactivos', HttpStatus.UNPROCESSABLE_ENTITY, { clienteIds: invalidos });
      }

      const hoy = aFechaDb(fechaOperativa());
      const anteriores = await tx.rutaPlanCliente.findMany({ where: { rutaId: id, diaSemana: datos.diaSemana, vigenteHasta: null }, select: { clienteId: true } });
      await tx.rutaPlanCliente.updateMany({ where: { rutaId: id, diaSemana: datos.diaSemana, vigenteHasta: null }, data: { vigenteHasta: hoy } });
      await tx.rutaPlanCliente.createMany({
        data: datos.clienteIds.map((clienteId, i) => ({ rutaId: id, clienteId, diaSemana: datos.diaSemana, orden: i + 1, vigenteDesde: hoy, creadoPor: ctx.usuarioId })),
      });
      await this.auditoria.registrarAccion(tx, ctx, req.ip, {
        accion: 'ruta.plan',
        tabla: 'ruta_plan_clientes',
        registroId: id,
        antes: { diaSemana: datos.diaSemana, clienteIds: anteriores.map((a) => a.clienteId) },
        despues: datos,
      });
      if (ruta.vendedorId) await this.visitas.generarAgenda(fechaOperativa(), ruta.vendedorId, tx);
      return tx.rutaPlanCliente.findMany({
        where: { rutaId: id, diaSemana: datos.diaSemana, vigenteHasta: null },
        orderBy: { orden: 'asc' },
        include: { cliente: { select: { id: true, razonSocial: true, direccion: true, activo: true } } },
      });
    });
  }
}
