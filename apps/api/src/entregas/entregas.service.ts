import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CICLO_ENTREGA,
  CICLO_FACTURA,
  eventoDeCreacion,
  eventoDeTransicion,
  type AnularEntrega,
  type EstadoEntrega,
  type ListarEntregas,
  type RegistrarEntrega,
} from '@cp/domain';
import { randomUUID } from 'node:crypto';
import { ArchivosService } from '../archivos/archivos.service.js';
import type { Contexto } from '../comun/contexto.js';
import { ErrorNegocio, NoEncontrado } from '../comun/errores.js';
import { errorPostgres } from '../comun/filtro-errores.js';
import { distanciaMetros } from '../comun/geo.js';
import { EventosService } from '../eventos/eventos.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const CERO = new Prisma.Decimal(0);

const incluirDetalle = {
  items: { include: { facturaItem: { select: { productoId: true, cantidad: true, producto: { select: { sku: true, nombre: true } } } } } },
  factura: { select: { numero: true, clienteId: true, clienteRazonSocial: true, estado: true } },
} satisfies Prisma.EntregaInclude;

/** Ve todas las entregas quien supervisa despachos; el chofer, las suyas. */
function alcanceEntregas(ctx: Contexto): Prisma.EntregaWhereInput {
  const supervisa = (['manifiesto.crear', 'manifiesto.cerrar', 'entrega.anular', 'pedido.ver_todos'] as const).some((p) => ctx.permisos.has(p));
  return supervisa ? {} : { choferId: ctx.usuarioId };
}

@Injectable()
export class EntregasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventosService,
    private readonly archivos: ArchivosService,
  ) {}

  /**
   * Registra la entrega (total) o el rechazo (total) de una factura en ruta.
   * La entrega confirmada exige firma, receptor y GPS; descuenta la mercancía
   * del vehículo y pasa la factura a ENTREGADA. El rechazo deja la mercancía
   * en el vehículo: vuelve al almacén en el cierre de la ruta.
   */
  async registrar(datos: RegistrarEntrega, ctx: Contexto) {
    if (datos.id) {
      const existente = await this.duplicado(datos.id, ctx);
      if (existente) return { entrega: existente, duplicado: true };
    }

    let entregaId: string;
    try {
      entregaId = await this.prisma.$transaction(async (tx) => {
        const vinculo = await tx.manifiestoFactura.findFirst({ where: { facturaId: datos.facturaId, activa: true } });
        if (!vinculo) {
          if (!(await tx.factura.count({ where: { id: datos.facturaId } }))) throw new NoEncontrado('La factura');
          throw new ErrorNegocio('FACTURA_SIN_MANIFIESTO', 'La factura no está en un manifiesto activo');
        }
        // Mismo orden de bloqueo que el cierre (manifiesto, luego factura) para evitar interbloqueos.
        await tx.$queryRaw`SELECT id FROM manifiestos WHERE id = ${vinculo.manifiestoId}::uuid FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM facturas WHERE id = ${datos.facturaId}::uuid FOR UPDATE`;
        const manifiesto = await tx.manifiesto.findUniqueOrThrow({ where: { id: vinculo.manifiestoId } });
        const factura = await tx.factura.findUniqueOrThrow({ where: { id: datos.facturaId } });

        if (manifiesto.choferId !== ctx.usuarioId && !ctx.permisos.has('manifiesto.cerrar')) {
          throw new ErrorNegocio('NO_ES_CHOFER_ASIGNADO', 'Solo el chofer del manifiesto registra sus entregas', HttpStatus.FORBIDDEN);
        }
        if (manifiesto.estado !== 'EN_RUTA') {
          throw new ErrorNegocio('MANIFIESTO_NO_EN_RUTA', `El manifiesto ${manifiesto.numero} está ${manifiesto.estado}`);
        }
        if (factura.estado === 'ENTREGADA') throw new ErrorNegocio('FACTURA_YA_ENTREGADA', `La factura ${factura.numero} ya fue entregada`);
        const eventoFactura = datos.resultado === 'CONFIRMADA' ? eventoDeTransicion(CICLO_FACTURA, factura.estado, 'ENTREGADA') : null;

        const cargados = await tx.manifiestoItem.findMany({
          where: { manifiestoId: manifiesto.id, facturaItem: { facturaId: factura.id } },
          include: { facturaItem: true },
        });
        const firmaArchivoId = datos.firma ? await this.archivos.guardarImagen(tx, datos.firma, 'FIRMA', ctx.usuarioId) : null;
        const fechaHoraDispositivo = datos.fechaHoraDispositivo ? new Date(datos.fechaHoraDispositivo) : null;
        const confirmada = datos.resultado === 'CONFIRMADA';

        const entrega = await tx.entrega.create({
          data: {
            ...(datos.id ? { id: datos.id } : {}),
            facturaId: factura.id,
            manifiestoId: manifiesto.id,
            choferId: manifiesto.choferId,
            estado: datos.resultado,
            fechaHora: fechaHoraDispositivo ?? new Date(),
            latitud: datos.latitud,
            longitud: datos.longitud,
            precisionMetros: datos.precisionMetros,
            firmaArchivoId,
            receptorNombre: datos.receptorNombre,
            receptorDocumento: datos.receptorDocumento,
            motivoRechazo: datos.motivoRechazo,
            observaciones: datos.observaciones,
            items: {
              create: cargados.map((c) => ({
                facturaItemId: c.facturaItemId,
                cantidadEntregada: confirmada ? c.cantidadCargada : CERO,
                cantidadRechazada: confirmada ? CERO : c.cantidadCargada,
                motivoRechazo: confirmada ? null : datos.motivoRechazo,
              })),
            },
          },
        });

        const vehiculo = await tx.ubicacion.findUniqueOrThrow({ where: { vehiculoId: manifiesto.vehiculoId } });
        if (confirmada) {
          await tx.movimientoInventario.createMany({
            data: cargados.map((c) => ({
              grupoId: randomUUID(),
              productoId: c.facturaItem.productoId,
              ubicacionId: vehiculo.id,
              tipo: 'ENTREGA' as const,
              cantidadEntrada: CERO,
              cantidadSalida: c.cantidadCargada,
              documentoOrigenTipo: 'ENTREGA',
              documentoOrigenId: entrega.id,
              usuarioId: ctx.usuarioId,
            })),
          });
          await tx.factura.update({ where: { id: factura.id }, data: { estado: 'ENTREGADA', version: { increment: 1 } } });
        }

        const cliente = await tx.cliente.findUniqueOrThrow({ where: { id: factura.clienteId } });
        const distanciaClienteMetros =
          cliente.latitud !== null && cliente.longitud !== null
            ? distanciaMetros(datos.latitud, datos.longitud, cliente.latitud.toNumber(), cliente.longitud.toNumber())
            : null;
        const comunes = {
          clienteId: factura.clienteId,
          vendedorResponsableId: factura.vendedorResponsableId,
          rutaId: factura.rutaId,
          vehiculoId: manifiesto.vehiculoId,
          latitud: datos.latitud,
          longitud: datos.longitud,
          fechaHoraDispositivo,
        };
        await this.eventos.registrarVarios(tx, ctx, [
          {
            ...comunes,
            tipoEntidad: 'ENTREGA',
            idEntidad: entrega.id,
            tipoEvento: eventoDeCreacion(CICLO_ENTREGA, datos.resultado),
            estadoNuevo: datos.resultado,
            datos: {
              facturaId: factura.id,
              numeroFactura: factura.numero,
              manifiestoId: manifiesto.id,
              distanciaClienteMetros,
              precisionMetros: datos.precisionMetros ?? null,
              motivoRechazo: datos.motivoRechazo ?? null,
            },
          },
          ...(eventoFactura
            ? [
                {
                  ...comunes,
                  tipoEntidad: 'FACTURA',
                  idEntidad: factura.id,
                  tipoEvento: eventoFactura,
                  estadoAnterior: factura.estado,
                  estadoNuevo: 'ENTREGADA',
                  datos: { entregaId: entrega.id },
                },
              ]
            : []),
        ]);
        return entrega.id;
      });
    } catch (error) {
      // Dos reenvíos simultáneos con el mismo id: el segundo choca con la clave primaria.
      if (datos.id && errorPostgres(error)?.restriccion === 'entregas_pkey') {
        const existente = await this.duplicado(datos.id, ctx);
        if (existente) return { entrega: existente, duplicado: true };
      }
      throw error;
    }
    return { entrega: await this.obtener(entregaId, ctx), duplicado: false };
  }

  /**
   * Corrige un registro equivocado mientras la ruta sigue abierta. Si la
   * entrega estaba confirmada, la mercancía vuelve al vehículo y la factura a
   * DESPACHADA. Después del cierre, las correcciones van por notas de crédito.
   */
  async anular(id: string, datos: AnularEntrega, ctx: Contexto) {
    await this.prisma.$transaction(async (tx) => {
      const actual = await tx.entrega.findUnique({ where: { id } });
      if (!actual) throw new NoEncontrado('La entrega');
      await tx.$queryRaw`SELECT id FROM manifiestos WHERE id = ${actual.manifiestoId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM facturas WHERE id = ${actual.facturaId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM entregas WHERE id = ${id}::uuid FOR UPDATE`;
      const entrega = await tx.entrega.findUniqueOrThrow({ where: { id }, include: { items: { include: { facturaItem: true } } } });
      const manifiesto = await tx.manifiesto.findUniqueOrThrow({ where: { id: entrega.manifiestoId } });
      const evento = eventoDeTransicion(CICLO_ENTREGA, entrega.estado as EstadoEntrega, 'ANULADA');
      if (manifiesto.estado !== 'EN_RUTA') {
        throw new ErrorNegocio('MANIFIESTO_NO_EN_RUTA', `El manifiesto ${manifiesto.numero} está ${manifiesto.estado}; la entrega ya no se anula`);
      }
      const factura = await tx.factura.findUniqueOrThrow({ where: { id: entrega.facturaId } });
      const comunes = {
        clienteId: factura.clienteId,
        vendedorResponsableId: factura.vendedorResponsableId,
        rutaId: factura.rutaId,
        vehiculoId: manifiesto.vehiculoId,
      };

      let eventoFactura = null;
      if (entrega.estado === 'CONFIRMADA') {
        eventoFactura = eventoDeTransicion(CICLO_FACTURA, factura.estado, 'DESPACHADA');
        const vehiculo = await tx.ubicacion.findUniqueOrThrow({ where: { vehiculoId: manifiesto.vehiculoId } });
        // Reverso: un movimiento ENTREGA de entrada devuelve la mercancía al vehículo.
        await tx.movimientoInventario.createMany({
          data: entrega.items
            .filter((i) => i.cantidadEntregada.greaterThan(0))
            .map((i) => ({
              grupoId: randomUUID(),
              productoId: i.facturaItem.productoId,
              ubicacionId: vehiculo.id,
              tipo: 'ENTREGA' as const,
              cantidadEntrada: i.cantidadEntregada,
              cantidadSalida: CERO,
              documentoOrigenTipo: 'ENTREGA',
              documentoOrigenId: entrega.id,
              usuarioId: ctx.usuarioId,
              motivo: `Anulación de entrega: ${datos.motivo}`,
            })),
        });
        await tx.factura.update({ where: { id: factura.id }, data: { estado: 'DESPACHADA', version: { increment: 1 } } });
      }
      await tx.entrega.update({ where: { id }, data: { estado: 'ANULADA' } });

      await this.eventos.registrarVarios(tx, ctx, [
        {
          ...comunes,
          tipoEntidad: 'ENTREGA',
          idEntidad: id,
          tipoEvento: evento,
          estadoAnterior: entrega.estado,
          estadoNuevo: 'ANULADA',
          datos: { motivo: datos.motivo, facturaId: factura.id },
        },
        ...(eventoFactura
          ? [
              {
                ...comunes,
                tipoEntidad: 'FACTURA',
                idEntidad: factura.id,
                tipoEvento: eventoFactura,
                estadoAnterior: 'ENTREGADA',
                estadoNuevo: 'DESPACHADA',
                datos: { entregaId: id, motivo: datos.motivo },
              },
            ]
          : []),
      ]);
    });
    return this.obtener(id, ctx);
  }

  async obtener(id: string, ctx: Contexto) {
    const entrega = await this.prisma.entrega.findFirst({ where: { AND: [{ id }, alcanceEntregas(ctx)] }, include: incluirDetalle });
    if (!entrega) throw new NoEncontrado('La entrega');
    return entrega;
  }

  listar(filtros: ListarEntregas, ctx: Contexto) {
    return this.prisma.entrega.findMany({
      where: { AND: [alcanceEntregas(ctx), { manifiestoId: filtros.manifiestoId, facturaId: filtros.facturaId }] },
      include: { factura: { select: { numero: true, clienteRazonSocial: true } } },
      orderBy: { fechaHora: 'desc' },
      take: filtros.limite,
    });
  }

  private async duplicado(id: string, ctx: Contexto) {
    const existente = await this.prisma.entrega.findUnique({ where: { id }, include: incluirDetalle });
    if (!existente) return null;
    const registro = await this.prisma.eventoNegocio.findFirst({ where: { idEntidad: id, tipoEntidad: 'ENTREGA' }, orderBy: { fechaHoraUtc: 'asc' } });
    if (registro?.usuarioId !== ctx.usuarioId) throw new ErrorNegocio('DUPLICADO', 'Ya existe una entrega con ese id');
    return existente;
  }
}

