import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { crearClienteSchema, editarClienteSchema, type CrearCliente, type EditarCliente } from '@cp/domain';
import type { FastifyRequest } from 'fastify';
import { alcanceClientes } from '../comun/alcance.js';
import type { Contexto } from '../comun/contexto.js';
import { Ctx, RequierePermisos } from '../comun/decoradores.js';
import { NoEncontrado } from '../comun/errores.js';
import { ZodPipe } from '../comun/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClientesService } from './clientes.service.js';
import { EstadoCuentaService } from './estado-cuenta.service.js';

@Controller('clientes')
@RequierePermisos('cliente.ver')
export class ClientesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estadoCuenta: EstadoCuentaService,
    private readonly clientes: ClientesService,
  ) {}

  @Post()
  @RequierePermisos('cliente.editar')
  crear(@Body(new ZodPipe(crearClienteSchema)) datos: CrearCliente, @Ctx() ctx: Contexto, @Req() req: FastifyRequest) {
    return this.clientes.crear(datos, ctx, req.ip);
  }

  /** Los permisos se verifican por grupo de campos en el servicio. */
  @Patch(':id')
  @RequierePermisos()
  editar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(editarClienteSchema)) datos: EditarCliente,
    @Ctx() ctx: Contexto,
    @Req() req: FastifyRequest,
  ) {
    return this.clientes.editar(id, datos, ctx, req.ip);
  }

  @Get(':id')
  async obtener(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: Contexto) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { AND: [{ id }, alcanceClientes(ctx)] },
      include: {
        ruta: { select: { codigo: true, nombre: true } },
        vendedor: { select: { codigo: true, usuario: { select: { nombre: true } } } },
        listaPrecio: { select: { codigo: true, nombre: true, moneda: true } },
        historialVendedor: {
          orderBy: { fechaDesde: 'desc' },
          include: { vendedor: { select: { codigo: true, usuario: { select: { nombre: true } } } } },
        },
      },
    });
    if (!cliente) throw new NoEncontrado('El cliente');
    return cliente;
  }

  /** Clientes activos de la cartera del usuario. Es lo que descarga la app para trabajar offline. */
  @Get()
  listar(@Ctx() ctx: Contexto, @Query('buscar') buscar?: string, @Query('incluirInactivos') incluirInactivos?: string) {
    const termino = buscar?.trim();
    const soloActivos = incluirInactivos !== 'true' || !ctx.permisos.has('cliente.editar');
    return this.prisma.cliente.findMany({
      where: {
        AND: [
          alcanceClientes(ctx),
          soloActivos ? { activo: true } : {},
          termino
            ? { OR: [{ razonSocial: { contains: termino, mode: 'insensitive' } }, { nroDocumento: { startsWith: termino } }] }
            : {},
        ],
      },
      select: {
        id: true,
        tipoDocumento: true,
        nroDocumento: true,
        razonSocial: true,
        direccion: true,
        telefono: true,
        latitud: true,
        longitud: true,
        rutaId: true,
        vendedorId: true,
        listaPrecioId: true,
        limiteCredito: true,
        monedaCredito: true,
        diasCredito: true,
        activo: true,
      },
      orderBy: { razonSocial: 'asc' },
      take: 500,
    });
  }

  @Get(':id/estado-cuenta')
  async estado(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: Contexto) {
    const visible = await this.prisma.cliente.count({ where: { AND: [{ id }, alcanceClientes(ctx)] } });
    if (!visible) throw new NoEncontrado('El cliente');
    return this.estadoCuenta.calcular(id);
  }
}
