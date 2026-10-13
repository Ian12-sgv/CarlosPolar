import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CICLO_PEDIDO,
  eventoDeTransicion,
  type AprobarPedido,
  type CerrarPedido,
  type EmitirPedido,
  type EstadoPedido,
  type ListarPedidos,
} from '@cp/domain';
import { config } from '../config.js';
import { SinPermiso } from '../auth/auth.service.js';
import { EstadoCuentaService, type Restriccion } from '../clientes/estado-cuenta.service.js';
import { PreciosService } from '../catalogo/precios.service.js';
import { alcanceClientes, alcancePedidos } from '../comun/alcance.js';
import type { Contexto } from '../comun/contexto.js';
import { ErrorNegocio, NoEncontrado } from '../comun/errores.js';
import { errorPostgres } from '../comun/filtro-errores.js';
import { EventosService, type NuevoEvento } from '../eventos/eventos.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { siguienteCorrelativo } from '../prisma/correlativos.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/** Diferencia máxima aceptada entre el precio que vio el preventista y el vigente. */
const TOLERANCIA_PRECIO = new Decimal('0.00005');

export interface Advertencia {
  codigo: 'STOCK_INSUFICIENTE' | Restriccion['codigo'];
  mensaje: string;
  productoId?: string;
  solicitado?: Decimal;
  disponible?: Decimal;
}

export interface Faltante {
  productoId: string;
  solicitado: Decimal;
  disponible: Decimal;
}

const incluirDetalle = {
  items: {
    orderBy: { linea: 'asc' },
    include: {
      producto: { select: { sku: true, nombre: true, unidad: true } },
      reservas: { where: { estado: 'ACTIVA' }, select: { id: true, cantidad: true, venceEn: true } },
    },
  },
  cliente: { select: { tipoDocumento: true, nroDocumento: true, razonSocial: true } },
} satisfies Prisma.PedidoInclude;

@Injectable()
export class PedidosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventosService,
    private readonly precios: PreciosService,
    private readonly estadoCuenta: EstadoCuentaService,
  ) {}

  /**
   * Emite un pedido. No reserva inventario (es intención comercial), pero
   * advierte faltantes de stock y restricciones de crédito. Precio y stock se
   * validan en línea; si el precio cambió desde que el preventista lo vio, se
   * rechaza con los precios vigentes para que la app los muestre y reenvíe.
   */
  async emitir(datos: EmitirPedido, ctx: Contexto) {
    if (datos.id) {
      const existente = await this.duplicado(datos.id, ctx);
      if (existente) return { pedido: existente, advertencias: [] as Advertencia[], duplicado: true };
    }

    const cliente = await this.prisma.cliente.findFirst({ where: { AND: [{ id: datos.clienteId }, alcanceClientes(ctx)] } });
    if (!cliente) throw new NoEncontrado('El cliente');
    if (!cliente.activo) throw new ErrorNegocio('CLIENTE_INACTIVO', 'El cliente está inactivo');

    const vendedorResponsableId = ctx.vendedorId ?? cliente.vendedorId;
    if (!vendedorResponsableId) throw new ErrorNegocio('SIN_VENDEDOR', 'El cliente no tiene vendedor asignado');
    if (!cliente.listaPrecioId) throw new ErrorNegocio('SIN_LISTA_PRECIO', 'El cliente no tiene lista de precios asignada');
    const lista = await this.prisma.listaPrecio.findUniqueOrThrow({ where: { id: cliente.listaPrecioId } });

    if (datos.visitaId) {
      const visita = await this.prisma.visita.findUnique({ where: { id: datos.visitaId } });
      if (!visita || visita.clienteId !== cliente.id) {
        throw new ErrorNegocio('VISITA_INVALIDA', 'La visita no corresponde a este cliente', HttpStatus.UNPROCESSABLE_ENTITY);
      }
    }

    const productoIds = datos.items.map((i) => i.productoId);
    const productos = new Map(
      (await this.prisma.producto.findMany({ where: { id: { in: productoIds }, activo: true } })).map((p) => [p.id, p]),
    );
    const invalidos = productoIds.filter((id) => !productos.has(id));
    if (invalidos.length > 0) {
      throw new ErrorNegocio('PRODUCTO_INVALIDO', 'Hay productos inexistentes o inactivos', HttpStatus.UNPROCESSABLE_ENTITY, {
        productoIds: invalidos,
      });
    }

    const vigentes = await this.precios.vigentes(this.prisma, lista.id, productoIds);
    const sinPrecio = productoIds.filter((id) => !vigentes.has(id));
    if (sinPrecio.length > 0) {
      throw new ErrorNegocio('SIN_PRECIO', 'Hay productos sin precio vigente en la lista del cliente', HttpStatus.CONFLICT, {
        productoIds: sinPrecio,
      });
    }
    const cambios = datos.items
      .filter((i) => i.precioOfertado !== undefined && new Decimal(i.precioOfertado).minus(vigentes.get(i.productoId)!).abs().greaterThan(TOLERANCIA_PRECIO))
      .map((i) => ({ productoId: i.productoId, precioOfertado: new Decimal(i.precioOfertado!), precioVigente: vigentes.get(i.productoId)! }));
    if (cambios.length > 0) {
      throw new ErrorNegocio('PRECIO_CAMBIO', 'Los precios cambiaron; revise y reenvíe el pedido', HttpStatus.CONFLICT, cambios);
    }

    const lineas = datos.items.map((item, i) => {
      const producto = productos.get(item.productoId)!;
      const cantidad = new Decimal(item.cantidad);
      const precio = vigentes.get(item.productoId)!;
      const subtotal = cantidad.times(precio).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const impuesto = subtotal.times(producto.alicuotaIva).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      return { linea: i + 1, productoId: item.productoId, cantidad, precioOfertado: precio, alicuotaIva: producto.alicuotaIva, subtotal, impuesto };
    });
    const subtotal = lineas.reduce((s, l) => s.plus(l.subtotal), new Decimal(0));
    const impuesto = lineas.reduce((s, l) => s.plus(l.impuesto), new Decimal(0));
    const fechaHoraDispositivo = datos.fechaHoraDispositivo ? new Date(datos.fechaHoraDispositivo) : null;

    let pedidoId: string;
    try {
      pedidoId = await this.prisma.$transaction(async (tx) => {
        const numero = await siguienteCorrelativo(tx, 'PEDIDO');
        const pedido = await tx.pedido.create({
          data: {
            ...(datos.id ? { id: datos.id } : {}),
            numero,
            clienteId: cliente.id,
            vendedorResponsableId,
            rutaId: cliente.rutaId,
            listaPrecioId: lista.id,
            moneda: lista.moneda,
            subtotal,
            impuesto,
            total: subtotal.plus(impuesto),
            observaciones: datos.observaciones,
            visitaId: datos.visitaId,
            fechaEmision: fechaHoraDispositivo ?? new Date(),
            latitud: datos.latitud,
            longitud: datos.longitud,
            creadoPor: ctx.usuarioId,
            items: {
              create: lineas.map(({ subtotal: _s, impuesto: _i, ...l }) => l),
            },
          },
        });
        await this.eventos.registrar(tx, ctx, {
          ...this.datosEvento(pedido),
          tipoEvento: 'PEDIDO_EMITIDO',
          estadoNuevo: 'EMITIDO',
          latitud: datos.latitud,
          longitud: datos.longitud,
          fechaHoraDispositivo,
          datos: { numero, total: pedido.total.toString(), moneda: pedido.moneda, lineas: lineas.length },
        });
        return pedido.id;
      });
    } catch (error) {
      // Dos reenvíos simultáneos del mismo pedido: el segundo choca con la clave primaria.
      if (datos.id && errorPostgres(error)?.restriccion === 'pedidos_pkey') {
        const existente = await this.duplicado(datos.id, ctx);
        if (existente) return { pedido: existente, advertencias: [] as Advertencia[], duplicado: true };
      }
      throw error;
    }

    const pedido = await this.prisma.pedido.findUniqueOrThrow({ where: { id: pedidoId }, include: incluirDetalle });
    return { pedido, advertencias: await this.advertencias(pedido.clienteId, lineas), duplicado: false };
  }

  /**
   * Aprueba un pedido y reserva inventario en el almacén principal por
   * `RESERVA_HORAS`. Exige que el cliente no tenga restricciones de crédito,
   * salvo excepción autorizada con `pedido.excepcion_credito`.
   */
  async aprobar(id: string, datos: AprobarPedido, ctx: Contexto) {
    const faltantes = await this.prisma.$transaction(async (tx) => {
      const pedido = await this.bloquear(tx, id, ctx, datos.version);
      const evento = eventoDeTransicion(CICLO_PEDIDO, pedido.estado, 'APROBADO');

      const { restricciones } = await this.estadoCuenta.calcular(pedido.clienteId, tx, { monto: pedido.total, moneda: pedido.moneda });
      if (restricciones.length > 0) {
        if (!datos.excepcionCredito) {
          throw new ErrorNegocio('CREDITO_RESTRINGIDO', 'El cliente tiene restricciones de crédito', HttpStatus.CONFLICT, restricciones);
        }
        if (!ctx.permisos.has('pedido.excepcion_credito')) throw new SinPermiso(['pedido.excepcion_credito']);
      }

      const almacen = await tx.ubicacion.findUnique({ where: { codigo: config.almacenPrincipal } });
      if (!almacen) throw new ErrorNegocio('SIN_ALMACEN', `No existe el almacén ${config.almacenPrincipal}`, HttpStatus.INTERNAL_SERVER_ERROR);

      const items = await tx.pedidoItem.findMany({ where: { pedidoId: id }, orderBy: { linea: 'asc' } });
      const disponibles = await this.precios.disponibles(tx, items.map((i) => i.productoId), true);
      const faltantes: Faltante[] = [];
      const reservas = items.flatMap((item) => {
        const disponible = Decimal.max(disponibles.get(item.productoId) ?? 0, 0);
        const cantidad = Decimal.min(item.cantidad, disponible);
        if (cantidad.lessThan(item.cantidad)) faltantes.push({ productoId: item.productoId, solicitado: item.cantidad, disponible });
        return cantidad.greaterThan(0) ? [{ item, cantidad }] : [];
      });
      if (faltantes.length > 0 && !datos.aceptarFaltantes) {
        throw new ErrorNegocio('STOCK_INSUFICIENTE', 'No hay stock suficiente para reservar el pedido completo', HttpStatus.CONFLICT, faltantes);
      }

      const venceEn = new Date(Date.now() + config.reservaHoras * 3_600_000);
      const creadas = await tx.reservaInventario.createManyAndReturn({
        data: reservas.map(({ item, cantidad }) => ({
          productoId: item.productoId,
          ubicacionId: almacen.id,
          pedidoItemId: item.id,
          cantidad,
          venceEn,
        })),
        select: { id: true, productoId: true, cantidad: true },
      });

      await tx.pedido.update({ where: { id }, data: { estado: 'APROBADO', motivoEstado: null, version: { increment: 1 } } });
      await this.eventos.registrarVarios(tx, ctx, [
        {
          ...this.datosEvento(pedido),
          tipoEvento: evento,
          estadoAnterior: pedido.estado,
          estadoNuevo: 'APROBADO',
          datos: {
            excepcionCredito: datos.excepcionCredito ? { motivo: datos.excepcionCredito.motivo, restricciones: restricciones.map((r) => r.codigo) } : null,
            faltantes: faltantes.map((f) => ({ ...f, solicitado: f.solicitado.toString(), disponible: f.disponible.toString() })),
          } as Prisma.InputJsonValue,
        },
        ...creadas.map(
          (r): NuevoEvento => ({
            tipoEntidad: 'RESERVA',
            idEntidad: r.id,
            tipoEvento: 'RESERVA_CREADA',
            estadoNuevo: 'ACTIVA',
            clienteId: pedido.clienteId,
            vendedorResponsableId: pedido.vendedorResponsableId,
            datos: { pedidoId: id, productoId: r.productoId, cantidad: r.cantidad.toString(), venceEn: venceEn.toISOString() },
          }),
        ),
      ]);
      return faltantes;
    });

    return { pedido: await this.obtener(id, ctx), faltantes };
  }

  async rechazar(id: string, datos: CerrarPedido, ctx: Contexto) {
    await this.cerrar(id, datos, ctx, 'RECHAZADO');
    return this.obtener(id, ctx);
  }

  /** Cancela un pedido emitido o aprobado. Si estaba aprobado, libera sus reservas. */
  async cancelar(id: string, datos: CerrarPedido, ctx: Contexto) {
    await this.cerrar(id, datos, ctx, 'CANCELADO');
    return this.obtener(id, ctx);
  }

  async obtener(id: string, ctx: Contexto) {
    const pedido = await this.prisma.pedido.findFirst({ where: { AND: [{ id }, alcancePedidos(ctx)] }, include: incluirDetalle });
    if (!pedido) throw new NoEncontrado('El pedido');
    return pedido;
  }

  listar(filtros: ListarPedidos, ctx: Contexto) {
    return this.prisma.pedido.findMany({
      where: { AND: [alcancePedidos(ctx), { estado: filtros.estado, clienteId: filtros.clienteId }] },
      include: { cliente: { select: { razonSocial: true } } },
      orderBy: { fechaEmision: 'desc' },
      take: filtros.limite,
    });
  }

  private async cerrar(id: string, datos: CerrarPedido, ctx: Contexto, destino: 'RECHAZADO' | 'CANCELADO') {
    await this.prisma.$transaction(async (tx) => {
      const pedido = await this.bloquear(tx, id, ctx, datos.version);
      const evento = eventoDeTransicion(CICLO_PEDIDO, pedido.estado, destino);
      const ahora = new Date();
      const liberadas = await tx.reservaInventario.updateManyAndReturn({
        where: { pedidoItem: { pedidoId: id }, estado: 'ACTIVA' },
        data: { estado: 'LIBERADA', cerradaEn: ahora },
        select: { id: true, productoId: true, cantidad: true },
      });
      await tx.pedido.update({ where: { id }, data: { estado: destino, motivoEstado: datos.motivo, version: { increment: 1 } } });
      await this.eventos.registrarVarios(tx, ctx, [
        {
          ...this.datosEvento(pedido),
          tipoEvento: evento,
          estadoAnterior: pedido.estado,
          estadoNuevo: destino,
          datos: { motivo: datos.motivo },
        },
        ...liberadas.map(
          (r): NuevoEvento => ({
            tipoEntidad: 'RESERVA',
            idEntidad: r.id,
            tipoEvento: 'RESERVA_LIBERADA',
            estadoAnterior: 'ACTIVA',
            estadoNuevo: 'LIBERADA',
            clienteId: pedido.clienteId,
            datos: { pedidoId: id, productoId: r.productoId, cantidad: r.cantidad.toString(), motivo: destino },
          }),
        ),
      ]);
    });
  }

  /** Bloquea el pedido hasta el fin de la transacción y verifica alcance y versión. */
  private async bloquear(tx: Tx, id: string, ctx: Contexto, version: number) {
    await tx.$queryRaw`SELECT id FROM pedidos WHERE id = ${id}::uuid FOR UPDATE`;
    const pedido = await tx.pedido.findFirst({ where: { AND: [{ id }, alcancePedidos(ctx)] } });
    if (!pedido) throw new NoEncontrado('El pedido');
    if (pedido.version !== version) {
      throw new ErrorNegocio('VERSION_DESACTUALIZADA', 'El pedido cambió desde que se consultó; recárguelo', HttpStatus.CONFLICT, {
        versionActual: pedido.version,
        estadoActual: pedido.estado,
      });
    }
    return pedido as typeof pedido & { estado: EstadoPedido };
  }

  private async duplicado(id: string, ctx: Contexto) {
    const existente = await this.prisma.pedido.findUnique({ where: { id }, include: incluirDetalle });
    if (!existente) return null;
    if (existente.creadoPor !== ctx.usuarioId) {
      throw new ErrorNegocio('DUPLICADO', 'Ya existe un pedido con ese id');
    }
    return existente;
  }

  private async advertencias(clienteId: string, lineas: { productoId: string; cantidad: Decimal }[]): Promise<Advertencia[]> {
    const disponibles = await this.precios.disponibles(this.prisma, lineas.map((l) => l.productoId));
    const stock = lineas
      .map((l) => ({ ...l, disponible: Decimal.max(disponibles.get(l.productoId) ?? 0, 0) }))
      .filter((l) => l.disponible.lessThan(l.cantidad))
      .map(
        (l): Advertencia => ({
          codigo: 'STOCK_INSUFICIENTE',
          mensaje: 'Stock disponible menor que lo solicitado',
          productoId: l.productoId,
          solicitado: l.cantidad,
          disponible: l.disponible,
        }),
      );
    const { restricciones } = await this.estadoCuenta.calcular(clienteId);
    return [...stock, ...restricciones];
  }

  private datosEvento(pedido: { id: string; clienteId: string; vendedorResponsableId: string; rutaId: string | null }) {
    return {
      tipoEntidad: 'PEDIDO',
      idEntidad: pedido.id,
      clienteId: pedido.clienteId,
      vendedorResponsableId: pedido.vendedorResponsableId,
      rutaId: pedido.rutaId,
    };
  }
}
