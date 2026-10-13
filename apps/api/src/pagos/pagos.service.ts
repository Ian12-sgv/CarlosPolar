import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CICLO_PAGO,
  eventoDeCreacion,
  eventoDeTransicion,
  validarReferencia,
  type AplicarPago,
  type CerrarPago,
  type ConVersion,
  type EstadoPago,
  type ListarPagos,
  type RegistrarPago,
} from '@cp/domain';
import { ArchivosService } from '../archivos/archivos.service.js';
import { config } from '../config.js';
import { alcanceClientes } from '../comun/alcance.js';
import type { Contexto } from '../comun/contexto.js';
import { ErrorNegocio, NoEncontrado } from '../comun/errores.js';
import { aFechaDb } from '../comun/fechas.js';
import { errorPostgres } from '../comun/filtro-errores.js';
import { EventosService } from '../eventos/eventos.service.js';
import { Prisma, type Moneda } from '../generated/prisma/client.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import { TasasService } from '../tasas/tasas.service.js';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

const incluirDetalle = {
  aplicaciones: { include: { factura: { select: { numero: true, moneda: true, total: true } } }, orderBy: { fechaAplicacion: 'asc' } },
  cliente: { select: { razonSocial: true, tipoDocumento: true, nroDocumento: true } },
} satisfies Prisma.PagoRecibidoInclude;

/** Convierte un monto de la moneda de la factura a la del pago con la tasa del pago (Bs por USD). */
function aMonedaPago(monto: Decimal, monedaFactura: Moneda, monedaPago: Moneda, tasa: Decimal): Decimal {
  if (monedaFactura === monedaPago) return monto;
  const convertido = monedaFactura === 'USD' ? monto.times(tasa) : monto.dividedBy(tasa);
  return convertido.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

@Injectable()
export class PagosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventosService,
    private readonly archivos: ArchivosService,
    private readonly tasas: TasasService,
  ) {}

  /**
   * Registra un pago y, opcionalmente, lo aplica a facturas. Registrar no
   * reduce la deuda oficial: solo la validación de Administración lo hace.
   * La conversión entre monedas usa la tasa del día del pago.
   */
  async registrar(datos: RegistrarPago, ctx: Contexto) {
    if (datos.id) {
      const existente = await this.duplicado(datos.id, ctx);
      if (existente) return { pago: existente, duplicado: true };
    }
    await this.verificarAccesoCliente(datos.clienteId, ctx);
    const referencia = validarReferencia(datos.metodoPago, datos.referencia);
    if (!referencia.ok) throw new ErrorNegocio('SOLICITUD_INVALIDA', referencia.motivo, HttpStatus.BAD_REQUEST);

    let pagoId: string;
    try {
      pagoId = await this.prisma.$transaction(async (tx) => {
        const tasa = await this.tasas.vigente(tx);
        if (!tasa) {
          throw new ErrorNegocio('SIN_TASA', `No hay tasa ${config.fuenteTasa} registrada en los últimos ${config.tasaMaxDias} días`);
        }
        const evidenciaArchivoId = datos.evidencia
          ? await this.archivos.guardarImagen(tx, datos.evidencia, 'EVIDENCIA_PAGO', ctx.usuarioId)
          : null;
        const pago = await tx.pagoRecibido.create({
          data: {
            ...(datos.id ? { id: datos.id } : {}),
            clienteId: datos.clienteId,
            vendedorReceptorId: ctx.vendedorId,
            metodoPago: datos.metodoPago,
            entidadOrigen: datos.metodoPago === 'EFECTIVO' ? 'CAJA' : datos.entidadOrigen!,
            referenciaNormalizada: referencia.referencia,
            referenciaOriginal: datos.referencia?.trim() || null,
            moneda: datos.moneda,
            montoTotal: datos.montoTotal,
            tasaCambio: tasa.tasa,
            fechaEmision: aFechaDb(datos.fechaEmision),
            evidenciaArchivoId,
            visitaId: datos.visitaId,
            latitud: datos.latitud,
            longitud: datos.longitud,
            creadoPor: ctx.usuarioId,
          },
        });
        const aplicadas = await this.aplicarEnTx(tx, pago, datos.aplicaciones, ctx);
        await this.eventos.registrar(tx, ctx, {
          tipoEntidad: 'PAGO',
          idEntidad: pago.id,
          tipoEvento: eventoDeCreacion(CICLO_PAGO, 'REGISTRADO'),
          estadoNuevo: 'REGISTRADO',
          clienteId: pago.clienteId,
          vendedorResponsableId: ctx.vendedorId,
          latitud: datos.latitud,
          longitud: datos.longitud,
          fechaHoraDispositivo: datos.fechaHoraDispositivo ? new Date(datos.fechaHoraDispositivo) : null,
          datos: {
            metodoPago: pago.metodoPago,
            moneda: pago.moneda,
            montoTotal: pago.montoTotal.toString(),
            tasa: pago.tasaCambio.toString(),
            aplicaciones: aplicadas,
          },
        });
        return pago.id;
      });
    } catch (error) {
      const restriccion = errorPostgres(error)?.restriccion;
      if (restriccion === 'pagos_recibidos_referencia_unica') {
        throw new ErrorNegocio('REFERENCIA_DUPLICADA', 'Ya hay un pago registrado con esa referencia, método y banco');
      }
      if (datos.id && restriccion === 'pagos_recibidos_pkey') {
        const existente = await this.duplicado(datos.id, ctx);
        if (existente) return { pago: existente, duplicado: true };
      }
      throw error;
    }
    return { pago: await this.obtener(pagoId, ctx), duplicado: false };
  }

  /** Aplica el remanente de un pago (registrado o validado) a más facturas, con la tasa del pago. */
  async aplicar(id: string, datos: AplicarPago, ctx: Contexto) {
    await this.prisma.$transaction(async (tx) => {
      const pago = await this.bloquear(tx, id, ctx, datos.version);
      if (pago.estado !== 'REGISTRADO' && pago.estado !== 'VALIDADO') {
        throw new ErrorNegocio('PAGO_NO_APLICABLE', `El pago está ${pago.estado}`);
      }
      const aplicadas = await this.aplicarEnTx(tx, pago, datos.aplicaciones, ctx);
      await tx.pagoRecibido.update({ where: { id }, data: { version: { increment: 1 } } });
      // No cambia el estado del pago, pero queda como evento propio.
      await this.eventos.registrar(tx, ctx, {
        tipoEntidad: 'PAGO',
        idEntidad: id,
        tipoEvento: 'PAGO_APLICADO',
        clienteId: pago.clienteId,
        datos: { aplicaciones: aplicadas },
      });
    });
    return this.obtener(id, ctx);
  }

  /** Administración confirma el pago contra el banco o la caja. Desde aquí reduce la deuda oficial. */
  async validar(id: string, datos: ConVersion, ctx: Contexto) {
    return this.cambiarEstado(id, datos.version, ctx, 'VALIDADO');
  }

  /** El pago no se confirmó (fondos inexistentes, referencia falsa). Libera el saldo que ocupaba. */
  async rechazar(id: string, datos: CerrarPago, ctx: Contexto) {
    return this.cambiarEstado(id, datos.version, ctx, 'RECHAZADO', datos.motivo);
  }

  /** Reverso de un pago registrado por error o ya validado. La deuda vuelve a quedar pendiente. */
  async anular(id: string, datos: CerrarPago, ctx: Contexto) {
    return this.cambiarEstado(id, datos.version, ctx, 'ANULADO', datos.motivo);
  }

  async obtener(id: string, ctx: Contexto) {
    const pago = await this.prisma.pagoRecibido.findFirst({ where: { AND: [{ id }, this.alcance(ctx)] }, include: incluirDetalle });
    if (!pago) throw new NoEncontrado('El pago');
    const aplicado = pago.aplicaciones.reduce((s, a) => s.plus(a.montoMonedaPago), new Decimal(0));
    return { ...pago, montoAplicado: aplicado, montoDisponible: pago.montoTotal.minus(aplicado) };
  }

  listar(filtros: ListarPagos, ctx: Contexto) {
    return this.prisma.pagoRecibido.findMany({
      where: { AND: [this.alcance(ctx), { estado: filtros.estado, clienteId: filtros.clienteId }] },
      include: { cliente: { select: { razonSocial: true } } },
      orderBy: { fechaRegistro: 'desc' },
      take: filtros.limite,
    });
  }

  private async cambiarEstado(id: string, version: number, ctx: Contexto, destino: 'VALIDADO' | 'RECHAZADO' | 'ANULADO', motivo?: string) {
    await this.prisma.$transaction(async (tx) => {
      const pago = await this.bloquear(tx, id, ctx, version);
      const evento = eventoDeTransicion(CICLO_PAGO, pago.estado as EstadoPago, destino);
      await tx.pagoRecibido.update({
        where: { id },
        data: {
          estado: destino,
          version: { increment: 1 },
          ...(destino === 'VALIDADO' ? { validadoPor: ctx.usuarioId, validadoEn: new Date() } : {}),
          ...(destino === 'RECHAZADO' ? { motivoRechazo: motivo } : {}),
        },
      });
      await this.eventos.registrar(tx, ctx, {
        tipoEntidad: 'PAGO',
        idEntidad: id,
        tipoEvento: evento,
        estadoAnterior: pago.estado,
        estadoNuevo: destino,
        clienteId: pago.clienteId,
        vendedorResponsableId: pago.vendedorReceptorId,
        datos: { motivo: motivo ?? null, montoTotal: pago.montoTotal.toString(), moneda: pago.moneda },
      });
    });
    return this.obtener(id, ctx);
  }

  /**
   * Valida y crea las aplicaciones. El trigger de la base de datos repite las
   * mismas comprobaciones bajo bloqueo; aquí se hacen antes para devolver
   * errores claros.
   */
  private async aplicarEnTx(
    tx: Tx,
    pago: { id: string; clienteId: string; moneda: Moneda; montoTotal: Decimal; tasaCambio: Decimal },
    aplicaciones: RegistrarPago['aplicaciones'],
    ctx: Contexto,
  ) {
    if (aplicaciones.length === 0) return [];
    const ids = aplicaciones.map((a) => a.facturaId);
    await tx.$queryRaw`SELECT id FROM facturas WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
    const facturas = new Map((await tx.factura.findMany({ where: { id: { in: ids } } })).map((f) => [f.id, f]));
    const ocupado = await tx.$queryRaw<{ factura_id: string; ocupado: Decimal }[]>`
      SELECT a.factura_id, sum(a.monto_aplicado) AS ocupado
      FROM pago_aplicaciones a JOIN pagos_recibidos p ON p.id = a.pago_id
      WHERE a.factura_id = ANY(${ids}::uuid[]) AND p.estado IN ('REGISTRADO', 'VALIDADO')
      GROUP BY a.factura_id`;
    const ocupadoPor = new Map(ocupado.map((o) => [o.factura_id, o.ocupado]));

    const filas = aplicaciones.map((a) => {
      const factura = facturas.get(a.facturaId);
      if (!factura || factura.clienteId !== pago.clienteId) {
        throw new ErrorNegocio('FACTURA_INVALIDA', 'La factura no existe o es de otro cliente', HttpStatus.UNPROCESSABLE_ENTITY, { facturaId: a.facturaId });
      }
      if (factura.estado === 'ANULADA') throw new ErrorNegocio('FACTURA_ANULADA', `La factura ${factura.numero} está anulada`);
      const montoAplicado = new Decimal(a.montoAplicado);
      const saldo = factura.total.minus(ocupadoPor.get(factura.id) ?? 0);
      if (montoAplicado.greaterThan(saldo)) {
        throw new ErrorNegocio('SALDO_EXCEDIDO', `El abono supera el saldo de la factura ${factura.numero}`, HttpStatus.CONFLICT, {
          facturaId: factura.id,
          numero: factura.numero,
          saldo,
          montoAplicado,
        });
      }
      return { factura, montoAplicado, montoMonedaPago: aMonedaPago(montoAplicado, factura.moneda, pago.moneda, pago.tasaCambio) };
    });

    const usado = await tx.pagoAplicacion.aggregate({ where: { pagoId: pago.id }, _sum: { montoMonedaPago: true } });
    const total = filas.reduce((s, f) => s.plus(f.montoMonedaPago), usado._sum.montoMonedaPago ?? new Decimal(0));
    if (total.greaterThan(pago.montoTotal)) {
      throw new ErrorNegocio('APLICACIONES_EXCEDEN_PAGO', 'Los abonos superan el monto del pago', HttpStatus.UNPROCESSABLE_ENTITY, {
        montoTotal: pago.montoTotal,
        aplicado: total,
      });
    }

    await tx.pagoAplicacion.createMany({
      data: filas.map((f) => ({
        pagoId: pago.id,
        facturaId: f.factura.id,
        montoAplicado: f.montoAplicado,
        montoMonedaPago: f.montoMonedaPago,
        tasaCambio: pago.tasaCambio,
        creadoPor: ctx.usuarioId,
      })),
    });
    return filas.map((f) => ({
      facturaId: f.factura.id,
      numero: f.factura.numero,
      montoAplicado: f.montoAplicado.toString(),
      monedaFactura: f.factura.moneda,
      montoMonedaPago: f.montoMonedaPago.toString(),
    }));
  }

  /**
   * Quién puede registrar pagos de un cliente: quien ve todos los clientes,
   * el preventista de su cartera o el chofer que tiene una factura del cliente en ruta.
   */
  private async verificarAccesoCliente(clienteId: string, ctx: Contexto): Promise<void> {
    const enCartera = await this.prisma.cliente.count({ where: { AND: [{ id: clienteId }, alcanceClientes(ctx)] } });
    if (enCartera) return;
    const enRuta = await this.prisma.manifiestoFactura.count({
      where: { activa: true, factura: { clienteId }, manifiesto: { choferId: ctx.usuarioId, estado: 'EN_RUTA' } },
    });
    if (!enRuta) throw new NoEncontrado('El cliente');
  }

  /** Administración ve todo; el preventista, los pagos de su cartera; los demás, los que registraron. */
  private alcance(ctx: Contexto): Prisma.PagoRecibidoWhereInput {
    if (ctx.permisos.has('pago.validar') || ctx.permisos.has('pedido.ver_todos')) return {};
    if (ctx.vendedorId) return { OR: [{ cliente: { vendedorId: ctx.vendedorId } }, { creadoPor: ctx.usuarioId }] };
    return { creadoPor: ctx.usuarioId };
  }

  private async bloquear(tx: Tx, id: string, ctx: Contexto, version: number) {
    await tx.$queryRaw`SELECT id FROM pagos_recibidos WHERE id = ${id}::uuid FOR UPDATE`;
    const pago = await tx.pagoRecibido.findFirst({ where: { AND: [{ id }, this.alcance(ctx)] } });
    if (!pago) throw new NoEncontrado('El pago');
    if (pago.version !== version) {
      throw new ErrorNegocio('VERSION_DESACTUALIZADA', 'El pago cambió desde que se consultó; recárguelo', HttpStatus.CONFLICT, {
        versionActual: pago.version,
        estadoActual: pago.estado,
      });
    }
    return pago;
  }

  private async duplicado(id: string, ctx: Contexto) {
    const existente = await this.prisma.pagoRecibido.findUnique({ where: { id }, include: incluirDetalle });
    if (!existente) return null;
    if (existente.creadoPor !== ctx.usuarioId) throw new ErrorNegocio('DUPLICADO', 'Ya existe un pago con ese id');
    return this.obtener(id, ctx);
  }
}
