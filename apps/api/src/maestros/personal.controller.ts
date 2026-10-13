import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { crearRutaSchema, type CrearRuta } from '@cp/domain';
import type { FastifyRequest } from 'fastify';
import type { Contexto } from '../comun/contexto.js';
import { Ctx, RequierePermisos } from '../comun/decoradores.js';
import { ZodPipe } from '../comun/zod.pipe.js';
import { AuditoriaService } from '../eventos/auditoria.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Catálogos de personas y zonas: vendedores, choferes, rutas, usuarios y roles. */
@Controller()
export class PersonalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get('vendedores')
  @RequierePermisos('cliente.ver')
  vendedores() {
    return this.prisma.vendedor.findMany({
      where: { activo: true },
      select: { id: true, codigo: true, usuario: { select: { id: true, nombre: true } } },
      orderBy: { codigo: 'asc' },
    });
  }

  /** Usuarios activos que pueden registrar entregas, para asignarlos a un manifiesto. */
  @Get('choferes')
  @RequierePermisos('manifiesto.crear')
  choferes() {
    return this.prisma.usuario.findMany({
      where: { activo: true, roles: { some: { rol: { permisos: { some: { permiso: { codigo: 'entrega.registrar' } } } } } } },
      select: { id: true, username: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });
  }

  @Get('rutas')
  @RequierePermisos('cliente.ver')
  rutas() {
    return this.prisma.ruta.findMany({
      where: { activo: true },
      include: { vendedor: { select: { codigo: true, usuario: { select: { nombre: true } } } } },
      orderBy: { codigo: 'asc' },
    });
  }

  @Post('rutas')
  @RequierePermisos('cliente.editar')
  crearRuta(@Body(new ZodPipe(crearRutaSchema)) datos: CrearRuta, @Ctx() ctx: Contexto, @Req() req: FastifyRequest) {
    return this.prisma.$transaction(async (tx) => {
      const ruta = await tx.ruta.create({ data: datos });
      await this.auditoria.registrarAccion(tx, ctx, req.ip, { accion: 'ruta.crear', tabla: 'rutas', registroId: ruta.id, despues: datos });
      return ruta;
    });
  }

  @Get('usuarios')
  @RequierePermisos('usuario.administrar')
  usuarios() {
    return this.prisma.usuario.findMany({
      where: { username: { not: 'sistema' } },
      select: {
        id: true,
        username: true,
        nombre: true,
        activo: true,
        creadoEn: true,
        roles: { select: { rol: { select: { codigo: true, nombre: true } } } },
        vendedor: { select: { id: true, codigo: true } },
        dispositivos: {
          select: { id: true, identificador: true, plataforma: true, nombre: true, registradoEn: true, revocadoEn: true },
          orderBy: { registradoEn: 'desc' },
        },
      },
      orderBy: { nombre: 'asc' },
    });
  }

  @Get('roles')
  @RequierePermisos('usuario.administrar')
  roles() {
    return this.prisma.rol.findMany({
      select: { codigo: true, nombre: true, permisos: { select: { permiso: { select: { codigo: true, descripcion: true } } } } },
      orderBy: { codigo: 'asc' },
    });
  }
}
