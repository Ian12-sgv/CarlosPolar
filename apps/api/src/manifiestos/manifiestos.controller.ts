import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  agregarFacturasSchema,
  anularManifiestoSchema,
  cerrarManifiestoSchema,
  crearManifiestoSchema,
  iniciarRutaSchema,
  listarManifiestosSchema,
  versionSchema,
  type AgregarFacturas,
  type AnularManifiesto,
  type CerrarManifiesto,
  type ConVersion,
  type CrearManifiesto,
  type IniciarRuta,
  type ListarManifiestos,
} from '@cp/domain';
import type { Contexto } from '../comun/contexto.js';
import { Ctx, RequierePermisos } from '../comun/decoradores.js';
import { ZodPipe } from '../comun/zod.pipe.js';
import { ManifiestosService } from './manifiestos.service.js';

@Controller('manifiestos')
export class ManifiestosController {
  constructor(private readonly manifiestos: ManifiestosService) {}

  @Post()
  @RequierePermisos('manifiesto.crear')
  crear(@Body(new ZodPipe(crearManifiestoSchema)) datos: CrearManifiesto, @Ctx() ctx: Contexto) {
    return this.manifiestos.crear(datos, ctx);
  }

  @Get()
  listar(@Query(new ZodPipe(listarManifiestosSchema)) filtros: ListarManifiestos, @Ctx() ctx: Contexto) {
    return this.manifiestos.listar(filtros, ctx);
  }

  @Get(':id')
  obtener(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: Contexto) {
    return this.manifiestos.obtener(id, ctx);
  }

  /** Vista previa del cuadre: cargado, entregado y lo que debería quedar en el vehículo. */
  @Get(':id/cuadre')
  cuadre(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: Contexto) {
    return this.manifiestos.cuadre(id, ctx);
  }

  @Post(':id/facturas')
  @HttpCode(200)
  @RequierePermisos('manifiesto.crear')
  agregarFacturas(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(agregarFacturasSchema)) datos: AgregarFacturas, @Ctx() ctx: Contexto) {
    return this.manifiestos.agregarFacturas(id, datos, ctx);
  }

  @Post(':id/facturas/:facturaId/quitar')
  @HttpCode(200)
  @RequierePermisos('manifiesto.crear')
  quitarFactura(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('facturaId', ParseUUIDPipe) facturaId: string,
    @Body(new ZodPipe(versionSchema)) datos: ConVersion,
    @Ctx() ctx: Contexto,
  ) {
    return this.manifiestos.quitarFactura(id, facturaId, datos, ctx);
  }

  @Post(':id/confirmar')
  @HttpCode(200)
  @RequierePermisos('manifiesto.confirmar')
  confirmar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(versionSchema)) datos: ConVersion, @Ctx() ctx: Contexto) {
    return this.manifiestos.confirmar(id, datos, ctx);
  }

  /** Lo usa el chofer desde la app (o Logística). El permiso se verifica en el servicio. */
  @Post(':id/iniciar-ruta')
  @HttpCode(200)
  iniciarRuta(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(iniciarRutaSchema)) datos: IniciarRuta, @Ctx() ctx: Contexto) {
    return this.manifiestos.iniciarRuta(id, datos, ctx);
  }

  @Post(':id/anular')
  @HttpCode(200)
  @RequierePermisos('manifiesto.crear')
  anular(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(anularManifiestoSchema)) datos: AnularManifiesto, @Ctx() ctx: Contexto) {
    return this.manifiestos.anular(id, datos, ctx);
  }

  @Post(':id/cerrar')
  @HttpCode(200)
  @RequierePermisos('manifiesto.cerrar')
  cerrar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cerrarManifiestoSchema)) datos: CerrarManifiesto, @Ctx() ctx: Contexto) {
    return this.manifiestos.cerrar(id, datos, ctx);
  }
}
