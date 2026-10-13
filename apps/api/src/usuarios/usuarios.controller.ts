import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { crearUsuarioSchema, type CrearUsuario } from '@cp/domain';
import type { FastifyRequest } from 'fastify';
import type { Contexto } from '../comun/contexto.js';
import { Ctx, RequierePermisos } from '../comun/decoradores.js';
import { NoEncontrado } from '../comun/errores.js';
import { ZodPipe } from '../comun/zod.pipe.js';
import { AuditoriaService } from '../eventos/auditoria.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { crearUsuario } from './crear-usuario.js';

@Controller()
@RequierePermisos('usuario.administrar')
export class UsuariosController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Post('usuarios')
  crear(@Body(new ZodPipe(crearUsuarioSchema)) datos: CrearUsuario, @Ctx() ctx: Contexto, @Req() req: FastifyRequest) {
    return this.prisma.$transaction(async (tx) => {
      const usuario = await crearUsuario(tx, datos);
      await this.auditoria.registrar(tx, {
        usuarioId: ctx.usuarioId,
        dispositivoId: ctx.dispositivoId,
        origen: ctx.origen,
        ip: req.ip,
        accion: 'usuario.crear',
        tabla: 'usuarios',
        registroId: usuario.id,
        despues: { username: usuario.username, roles: datos.roles, codigoVendedor: datos.codigoVendedor ?? null },
      });
      return usuario;
    });
  }

  /** Revoca un dispositivo y todas sus sesiones. El efecto es inmediato. */
  @Post('dispositivos/:id/revocar')
  @HttpCode(204)
  async revocarDispositivo(
    @Param('id', ParseUUIDPipe) id: string,
    @Ctx() ctx: Contexto,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const ahora = new Date();
      const { count } = await tx.dispositivo.updateMany({ where: { id, revocadoEn: null }, data: { revocadoEn: ahora } });
      if (count === 0 && !(await tx.dispositivo.findUnique({ where: { id } }))) throw new NoEncontrado('El dispositivo');
      const sesiones = await tx.sesion.updateMany({ where: { dispositivoId: id, revocadaEn: null }, data: { revocadaEn: ahora } });
      await this.auditoria.registrar(tx, {
        usuarioId: ctx.usuarioId,
        dispositivoId: ctx.dispositivoId,
        origen: ctx.origen,
        ip: req.ip,
        accion: 'dispositivo.revocar',
        tabla: 'dispositivos',
        registroId: id,
        despues: { sesionesRevocadas: sesiones.count },
      });
    });
  }
}
