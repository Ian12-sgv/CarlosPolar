import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CICLO_FACTURA,
  CICLO_PEDIDO,
  eventoDeCreacion,
  eventoDeTransicion,
  type AnularFactura,
  type EmitirFactura,
  type EstadoFactura,
  type EstadoPedido,
  type ListarFacturas,
} from '@cp/domain';
import { config } from '../config.js';
import { PreciosService } from '../catalogo/precios.service.js';
import { alcanceFacturas } from '../comun/alcance.js';
import type { Contexto } from '../comun/contexto.js';
import { ErrorNegocio, NoEncontrado } from '../comun/errores.js';
import { aFechaDb, fechaOperativa, sumarDias } from '../comun/fechas.js';
import { EventosService, type NuevoEvento } from '../eventos/eventos.service.js';
import { AuditoriaService } from '../eventos/auditoria.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { siguienteCorrelativo } from '../prisma/correlativos.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import { TasasService } from '../tasas/tasas.service.js';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

const incluirDetalle = {
  items: { orderBy: { linea: 'asc' }, include: { producto: { select: { sku: true, nombre: true, unidad: true } } } },
} satisfies Prisma.FacturaInclude;

interface FilaSaldo {
  cobrado_validado: Decimal;
  cobrado_por_validar: Decimal;
  saldo: Decimal;
  estado_cobro: string;
  dias_vencido: number;
}

@Injectable()
export class FacturasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventosService,
    private readonly auditoria: AuditoriaService,
    private readonly precios: PreciosService,
    private readonly tasas: TasasService,
  ) {}

  /**
   * Factura un pedido aprobado. Cada línea conserva su relación con la línea
   * del pedido y el precio con que se emitió el pedido. La reserva de cada
   * línea se ajusta a lo facturado y queda ligada a la factura (deja de
   * vencer); lo no facturado se libera. Si se factura más de lo reservado,
   * la diferencia se toma del disponible en ese momento.
   */
  async emitir(datos: EmitirFactura, ctx: Contexto) {
    const facturaId = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM pedidos WHERE id = ${datos.pedidoId}::uuid FOR UPDATE`;
      const pedido = await tx.pedido.findUnique({
        where: { id: datos.pedidoId },
        include: {
          cliente: true,
          items: { orderBy: { linea: 'asc' }, include: { reservas: { where: { estado: 'ACTIVA' } } } },
        },
      });
      if (!pedido) throw new NoEncontrado('El pedido');
      if (pedido.version !== datos.versionPedido) {
        throw new ErrorNegocio('VERSION_DESACTUALIZADA', 'El pedido cambió desde que se consultó; recárguelo', HttpStatus.CONFLICT, {
          versionActual: pedido.version,
          estadoActual: pedido.estado,
        });
      }
      const eventoPedido = eventoDeTransicion(CICLO_PEDIDO, pedido.estado as EstadoPedido, 'FACTURADO');
      if (!pedido.cliente.activo) throw new ErrorNegocio('CLIENTE_INACTIVO', 'El cliente está inactivo');

      const tasa = await this.tasas.vigente(tx);
      if (!tasa) {
        throw new ErrorNegocio(
          'SIN_TASA',
          `No hay tasa ${config.fuenteTasa} registrada en los últimos ${config.tasaMaxDias} días; regístrela antes de facturar`,
        );
      }

      // Cantidad a facturar por línea: la indicada, o lo reservado.
      const porLinea = new Map(pedido.items.map((item) => [item.id, item]));
      const pedidas = new Map<string, Decimal>();
      if (datos.lineas) {
        for (const l of datos.lineas) {
          const item = porLinea.get(l.pedidoItemId);
          if (!item) {
            throw new ErrorNegocio('LINEA_INVALIDA', 'La línea no pertenece al pedido', HttpStatus.UNPROCESSABLE_ENTITY, { pedidoItemId: l.pedidoItemId });
          }
          const cantidad = new Decimal(l.cantidad);
          if (cantidad.greaterThan(item.cantidad)) {
            throw new ErrorNegocio('CANTIDAD_EXCEDE_PEDIDO', 'No se puede facturar más de lo pedido', HttpStatus.UNPROCESSABLE_ENTITY, {
              pedidoItemId: item.id,
              pedido: item.cantidad,
              solicitado: cantidad,
            });
          }
          pedidas.set(item.id, cantidad);
        }
      }
      const lineas = pedido.items.map((item) => {
        const reserva = item.reservas[0] ?? null;
        const reservado = reserva?.cantidad ?? new Decimal(0);
        return { item, reserva, reservado, cantidad: datos.lineas ? (pedidas.get(item.id) ?? new Decimal(0)) : reservado };
      });
      const aFacturar = lineas.filter((l) => l.cantidad.greaterThan(0));
      if (aFacturar.length === 0) {
        throw new ErrorNegocio('NADA_QUE_FACTURAR', 'No hay cantidades reservadas ni indicadas para facturar');
      }

      // Lo que exceda la reserva debe estar disponible ahora.
      const excedentes = aFacturar.filter((l) => l.cantidad.greaterThan(l.reservado));
      if (excedentes.length > 0) {
        const disponibles = await this.precios.disponibles(tx, excedentes.map((l) => l.item.productoId), true);
        const faltantes = excedentes
          .map((l) => ({ l, disponible: Decimal.max(disponibles.get(l.item.productoId) ?? 0, 0) }))
          .filter(({ l, disponible }) => l.cantidad.minus(l.reservado).greaterThan(disponible))
          .map(({ l, disponible }) => ({ pedidoItemId: l.item.id, productoId: l.item.productoId, solicitado: l.cantidad, reservado: l.reservado, disponible }));
        if (faltantes.length > 0) {
          throw new ErrorNegocio('STOCK_INSUFICIENTE', 'No hay stock para facturar más de lo reservado', HttpStatus.CONFLICT, faltantes);
        }
      }

      const calculadas = aFacturar.map((l, i) => {
        const subtotal = l.cantidad.times(l.item.precioOfertado).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        const impuesto = subtotal.times(l.item.alicuotaIva).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        return { ...l, linea: i + 1, subtotal, impuesto };
      });
      const subtotal = calculadas.reduce((s, l) => s.plus(l.subtotal), new Decimal(0));
      const impuesto = calculadas.reduce((s, l) => s.plus(l.impuesto), new Decimal(0));
      const hoy = fechaOperativa();
      const numero = await siguienteCorrelativo(tx, 'FACTURA');
      const c = pedido.cliente;

      const factura = await tx.factura.create({
        data: {
          numero,
          pedidoId: pedido.id,
          clienteId: c.id,
          clienteTipoDocumento: c.tipoDocumento,
          clienteNroDocumento: c.nroDocumento,
          clienteRazonSocial: c.razonSocial,
          clienteDireccion: c.direccion,
          vendedorResponsableId: pedido.vendedorResponsableId,
          rutaId: pedido.rutaId,
          moneda: pedido.moneda,
          tasaCambio: tasa.tasa,
          subtotal,
          impuesto,
          total: subtotal.plus(impuesto),
          fechaEmision: new Date(),
          fechaVencimiento: aFechaDb(sumarDias(hoy, c.diasCredito)),
          emitidaPor: ctx.usuarioId,
        },
      });
      const items = await tx.facturaItem.createManyAndReturn({
        data: calculadas.map((l) => ({
          facturaId: factura.id,
          linea: l.linea,
          pedidoItemId: l.item.id,
          productoId: l.item.productoId,
          cantidad: l.cantidad,
          precioUnitario: l.item.precioOfertado,
          descuentoPct: l.item.descuentoPct,
          alicuotaIva: l.item.alicuotaIva,
          subtotal: l.subtotal,
          impuesto: l.impuesto,
          total: l.subtotal.plus(l.impuesto),
        })),
        select: { id: true, pedidoItemId: true },
      });
      const itemFactura = new Map(items.map((i) => [i.pedidoItemId!, i.id]));

      // Reservas: ajustar y ligar las facturadas, crear las que falten, liberar las no facturadas.
      const almacen = await tx.ubicacion.findUniqueOrThrow({ where: { codigo: config.almacenPrincipal } });
      const ahora = new Date();
      const eventosReserva: NuevoEvento[] = [];
      for (const l of lineas) {
        const facturaItemId = itemFactura.get(l.item.id);
        if (facturaItemId && l.reserva) {
          await tx.reservaInventario.update({
            where: { id: l.reserva.id },
            data: { cantidad: l.cantidad, facturaItemId, venceEn: null },
          });
        } else if (facturaItemId) {
          const nueva = await tx.reservaInventario.create({
            data: { productoId: l.item.productoId, ubicacionId: almacen.id, pedidoItemId: l.item.id, facturaItemId, cantidad: l.cantidad },
          });
          eventosReserva.push({
            tipoEntidad: 'RESERVA',
            idEntidad: nueva.id,
            tipoEvento: 'RESERVA_CREADA',
            estadoNuevo: 'ACTIVA',
            clienteId: c.id,
            datos: { pedidoId: pedido.id, facturaId: factura.id, productoId: l.item.productoId, cantidad: l.cantidad.toString() },
          });
        } else if (l.reserva) {
          await tx.reservaInventario.update({ where: { id: l.reserva.id }, data: { estado: 'LIBERADA', cerradaEn: ahora } });
          eventosReserva.push({
            tipoEntidad: 'RESERVA',
            idEntidad: l.reserva.id,
            tipoEvento: 'RESERVA_LIBERADA',
            estadoAnterior: 'ACTIVA',
            estadoNuevo: 'LIBERADA',
            clienteId: c.id,
            datos: { pedidoId: pedido.id, productoId: l.item.productoId, cantidad: l.reserva.cantidad.toString(), motivo: 'NO_FACTURADA' },
          });
        }
      }

      await tx.pedido.update({ where: { id: pedido.id }, data: { estado: 'FACTURADO', version: { increment: 1 } } });

      const comunes = { clienteId: c.id, vendedorResponsableId: pedido.vendedorResponsableId, rutaId: pedido.rutaId };
      await this.eventos.registrarVarios(tx, ctx, [
        {
          ...comunes,
          tipoEntidad: 'FACTURA',
          idEntidad: factura.id,
          tipoEvento: eventoDeCreacion(CICLO_FACTURA, 'EMITIDA'),
          estadoNuevo: 'EMITIDA',
          datos: {
            numero,
            pedidoId: pedido.id,
            total: factura.total.toString(),
            moneda: factura.moneda,
            tasa: tasa.tasa.toString(),
            // Diferencias pedido → factura por línea, para medir conversión y faltantes.
            lineas: lineas.map((l) => ({
              pedidoItemId: l.item.id,
              pedido: l.item.cantidad.toString(),
              reservado: l.reservado.toString(),
              facturado: l.cantidad.toString(),
            })),
          },
        },
        {
          ...comunes,
          tipoEntidad: 'PEDIDO',
          idEntidad: pedido.id,
          tipoEvento: eventoPedido,
          estadoAnterior: pedido.estado,
          estadoNuevo: 'FACTURADO',
          datos: { facturaId: factura.id, numeroFactura: numero },
        },
        ...eventosReserva,
      ]);
      return factura.id;
    });

    return this.obtener(facturaId, ctx);
  }

  /**
   * Anula una factura que aún no salió del almacén. Libera sus reservas.
   * No se puede anular si tiene pagos aplicados (registrados o validados).
   */
  async anular(id: string, datos: AnularFactura, ctx: Contexto) {
    await this.prisma.$transaction(async (tx) => {
      const factura = await this.bloquear(tx, id, datos.version);
      const evento = eventoDeTransicion(CICLO_FACTURA, factura.estado as EstadoFactura, 'ANULADA');

      const pagos = await tx.pagoAplicacion.count({ where: { facturaId: id, pago: { estado: { in: ['REGISTRADO', 'VALIDADO'] } } } });
      if (pagos > 0) {
        throw new ErrorNegocio('FACTURA_CON_PAGOS', 'La factura tiene pagos aplicados; anule o reasigne los pagos primero');
      }

      const liberadas = await tx.reservaInventario.updateManyAndReturn({
        where: { facturaItem: { facturaId: id }, estado: 'ACTIVA' },
        data: { estado: 'LIBERADA', cerradaEn: new Date() },
        select: { id: true, productoId: true, cantidad: true },
      });
      await tx.factura.update({ where: { id }, data: { estado: 'ANULADA', motivoAnulacion: datos.motivo, version: { increment: 1 } } });

      await this.eventos.registrarVarios(tx, ctx, [
        {
          tipoEntidad: 'FACTURA',
          idEntidad: id,
          tipoEvento: evento,
          estadoAnterior: factura.estado,
          estadoNuevo: 'ANULADA',
          clienteId: factura.clienteId,
          vendedorResponsableId: factura.vendedorResponsableId,
          rutaId: factura.rutaId,
          datos: { motivo: datos.motivo, numero: factura.numero },
        },
        ...liberadas.map(
          (r): NuevoEvento => ({
            tipoEntidad: 'RESERVA',
            idEntidad: r.id,
            tipoEvento: 'RESERVA_LIBERADA',
            estadoAnterior: 'ACTIVA',
            estadoNuevo: 'LIBERADA',
            clienteId: factura.clienteId,
            datos: { facturaId: id, productoId: r.productoId, cantidad: r.cantidad.toString(), motivo: 'FACTURA_ANULADA' },
          }),
        ),
      ]);
    });
    return this.obtener(id, ctx);
  }

  /**
   * Registra el número de control fiscal (imprenta digital o máquina fiscal).
   * Se asigna una sola vez; la base de datos impide cambiarlo después.
   */
  async asignarNumeroControl(id: string, numeroControl: string, ctx: Contexto, ip: string | null) {
    await this.prisma.$transaction(async (tx) => {
      const factura = await this.bloquear(tx, id);
      if (factura.numeroControl !== null) {
        throw new ErrorNegocio('NUMERO_CONTROL_ASIGNADO', `La factura ya tiene el número de control ${factura.numeroControl}`);
      }
      if (factura.estado === 'ANULADA') throw new ErrorNegocio('FACTURA_ANULADA', 'La factura está anulada');
      await tx.factura.update({ where: { id }, data: { numeroControl, version: { increment: 1 } } });
      await this.auditoria.registrar(tx, {
        usuarioId: ctx.usuarioId,
        dispositivoId: ctx.dispositivoId,
        origen: ctx.origen,
        ip,
        accion: 'factura.asignar_numero_control',
        tabla: 'facturas',
        registroId: id,
        despues: { numero: factura.numero, numeroControl },
      });
    });
    return this.obtener(id, ctx);
  }

  async obtener(id: string, ctx: Contexto) {
    const factura = await this.prisma.factura.findFirst({ where: { AND: [{ id }, alcanceFacturas(ctx)] }, include: incluirDetalle });
    if (!factura) throw new NoEncontrado('La factura');
    const [saldo] = await this.prisma.$queryRaw<FilaSaldo[]>`
      SELECT cobrado_validado, cobrado_por_validar, saldo, estado_cobro, dias_vencido
      FROM bi.v_saldo_facturas WHERE factura_id = ${id}::uuid`;
    return {
      ...factura,
      cobro: saldo
        ? {
            cobradoValidado: saldo.cobrado_validado,
            cobradoPorValidar: saldo.cobrado_por_validar,
            saldo: saldo.saldo,
            estado: saldo.estado_cobro,
            diasVencido: saldo.dias_vencido,
          }
        : null,
    };
  }

  listar(filtros: ListarFacturas, ctx: Contexto) {
    return this.prisma.factura.findMany({
      where: {
        AND: [
          alcanceFacturas(ctx),
          {
            estado: filtros.estado,
            clienteId: filtros.clienteId,
            ...(filtros.sinNumeroControl === undefined
              ? {}
              : { numeroControl: filtros.sinNumeroControl ? null : { not: null } }),
          },
        ],
      },
      orderBy: { fechaEmision: 'desc' },
      take: filtros.limite,
    });
  }

  private async bloquear(tx: Tx, id: string, version?: number) {
    await tx.$queryRaw`SELECT id FROM facturas WHERE id = ${id}::uuid FOR UPDATE`;
    const factura = await tx.factura.findUnique({ where: { id } });
    if (!factura) throw new NoEncontrado('La factura');
    if (version !== undefined && factura.version !== version) {
      throw new ErrorNegocio('VERSION_DESACTUALIZADA', 'La factura cambió desde que se consultó; recárguela', HttpStatus.CONFLICT, {
        versionActual: factura.version,
        estadoActual: factura.estado,
      });
    }
    return factura;
  }
}
