import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CICLO_FACTURA,
  CICLO_MANIFIESTO,
  eventoDeCreacion,
  eventoDeTransicion,
  type AgregarFacturas,
  type AnularManifiesto,
  type CerrarManifiesto,
  type ConVersion,
  type CrearManifiesto,
  type EstadoManifiesto,
  type IniciarRuta,
  type ListarManifiestos,
} from '@cp/domain';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { SinPermiso } from '../auth/auth.service.js';
import { PreciosService } from '../catalogo/precios.service.js';
import type { Contexto } from '../comun/contexto.js';
import { ErrorNegocio, NoEncontrado } from '../comun/errores.js';
import { errorPostgres } from '../comun/filtro-errores.js';
import { EventosService, type NuevoEvento } from '../eventos/eventos.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { siguienteCorrelativo } from '../prisma/correlativos.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;
const CERO = new Decimal(0);

// Un movimiento tiene un solo sentido: una de las dos cantidades es cero
// (CHECK movimientos_un_solo_sentido).
const entrada = (cantidad: Decimal) => ({ cantidadEntrada: cantidad, cantidadSalida: CERO });
const salida = (cantidad: Decimal) => ({ cantidadEntrada: CERO, cantidadSalida: cantidad });

export interface LineaCuadre {
  productoId: string;
  sku: string;
  nombre: string;
  cargado: Decimal;
  entregado: Decimal;
  /** Lo que debería quedar en el vehículo: cargado − entregado. */
  esperado: Decimal;
}

const incluirDetalle = {
  vehiculo: { select: { placa: true, descripcion: true } },
  facturas: {
    where: { activa: true },
    orderBy: { ordenVisita: 'asc' },
    include: {
      factura: {
        select: { id: true, numero: true, estado: true, clienteId: true, clienteRazonSocial: true, clienteDireccion: true, total: true, moneda: true },
      },
    },
  },
  items: { include: { facturaItem: { select: { facturaId: true, productoId: true, producto: { select: { sku: true, nombre: true } } } } } },
} satisfies Prisma.ManifiestoInclude;

/** Puede ver todos los manifiestos quien los gestiona; el chofer, solo los suyos. */
function alcanceManifiestos(ctx: Contexto): Prisma.ManifiestoWhereInput {
  const gestiona = (['manifiesto.crear', 'manifiesto.confirmar', 'manifiesto.cerrar'] as const).some((p) => ctx.permisos.has(p));
  return gestiona ? {} : { choferId: ctx.usuarioId };
}

@Injectable()
export class ManifiestosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventosService,
    private readonly precios: PreciosService,
  ) {}

  async crear(datos: CrearManifiesto, ctx: Contexto) {
    const vehiculo = await this.prisma.vehiculo.findUnique({ where: { id: datos.vehiculoId }, include: { ubicacion: true } });
    if (!vehiculo || !vehiculo.activo || !vehiculo.ubicacion) {
      throw new ErrorNegocio('VEHICULO_INVALIDO', 'El vehículo no existe, está inactivo o no tiene ubicación', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    await this.validarChofer(datos.choferId);

    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const almacen = await tx.ubicacion.findUniqueOrThrow({ where: { codigo: config.almacenPrincipal } });
        const manifiesto = await tx.manifiesto.create({
          data: {
            numero: await siguienteCorrelativo(tx, 'MANIFIESTO'),
            vehiculoId: vehiculo.id,
            ubicacionOrigenId: almacen.id,
            choferId: datos.choferId,
            despachadorId: ctx.usuarioId,
          },
        });
        await this.agregarEnTx(tx, manifiesto.id, datos.facturaIds);
        await this.eventos.registrar(tx, ctx, {
          tipoEntidad: 'MANIFIESTO',
          idEntidad: manifiesto.id,
          tipoEvento: eventoDeCreacion(CICLO_MANIFIESTO, 'BORRADOR'),
          estadoNuevo: 'BORRADOR',
          vehiculoId: vehiculo.id,
          datos: { numero: manifiesto.numero, choferId: datos.choferId, facturas: datos.facturaIds.length },
        });
        return manifiesto.id;
      });
    } catch (error) {
      if (errorPostgres(error)?.restriccion === 'manifiestos_vehiculo_abierto_unico') {
        throw new ErrorNegocio('VEHICULO_OCUPADO', `El vehículo ${vehiculo.placa} ya tiene un manifiesto abierto`);
      }
      throw error;
    }
    return this.obtener(id, ctx);
  }

  async agregarFacturas(id: string, datos: AgregarFacturas, ctx: Contexto) {
    await this.prisma.$transaction(async (tx) => {
      await this.bloquearBorrador(tx, id, datos.version);
      await this.agregarEnTx(tx, id, datos.facturaIds);
      await tx.manifiesto.update({ where: { id }, data: { version: { increment: 1 } } });
    });
    return this.obtener(id, ctx);
  }

  async quitarFactura(id: string, facturaId: string, datos: ConVersion, ctx: Contexto) {
    await this.prisma.$transaction(async (tx) => {
      await this.bloquearBorrador(tx, id, datos.version);
      const { count } = await tx.manifiestoFactura.deleteMany({ where: { manifiestoId: id, facturaId } });
      if (count === 0) throw new NoEncontrado('La factura en este manifiesto');
      await tx.manifiestoItem.deleteMany({ where: { manifiestoId: id, facturaItem: { facturaId } } });
      await tx.manifiesto.update({ where: { id }, data: { version: { increment: 1 } } });
    });
    return this.obtener(id, ctx);
  }

  /**
   * Confirma la carga física: consume las reservas, mueve el inventario del
   * almacén al vehículo y pasa las facturas a DESPACHADA. Desde aquí el
   * manifiesto no se modifica.
   */
  async confirmar(id: string, datos: ConVersion, ctx: Contexto) {
    await this.prisma.$transaction(async (tx) => {
      const manifiesto = await this.bloquear(tx, id, datos.version);
      const evento = eventoDeTransicion(CICLO_MANIFIESTO, manifiesto.estado as EstadoManifiesto, 'CONFIRMADO');

      const facturaIds = (await tx.manifiestoFactura.findMany({ where: { manifiestoId: id, activa: true } })).map((f) => f.facturaId);
      if (facturaIds.length === 0) throw new ErrorNegocio('MANIFIESTO_VACIO', 'El manifiesto no tiene facturas');
      const facturas = await this.bloquearFacturas(tx, facturaIds);
      const noDespachables = facturas.filter((f) => f.estado !== 'EMITIDA');
      if (noDespachables.length > 0) {
        throw new ErrorNegocio('FACTURA_NO_DESPACHABLE', 'Hay facturas que ya no están pendientes de despacho', HttpStatus.CONFLICT,
          noDespachables.map((f) => ({ facturaId: f.id, numero: f.numero, estado: f.estado })));
      }

      const items = await tx.manifiestoItem.findMany({ where: { manifiestoId: id }, include: { facturaItem: true } });
      const vehiculo = await this.ubicacionVehiculo(tx, manifiesto.vehiculoId);
      const reservas = await tx.reservaInventario.findMany({
        where: { facturaItemId: { in: items.map((i) => i.facturaItemId) }, estado: 'ACTIVA' },
      });
      const reservada = new Set(reservas.map((r) => r.facturaItemId));

      // Lo que se cargue sin reserva (no debería ocurrir en el flujo normal) sale del disponible.
      const sinReserva = new Map<string, Decimal>();
      for (const i of items.filter((x) => !reservada.has(x.facturaItemId))) {
        sinReserva.set(i.facturaItem.productoId, (sinReserva.get(i.facturaItem.productoId) ?? CERO).plus(i.cantidadCargada));
      }
      if (sinReserva.size > 0) {
        const disponibles = await this.precios.disponibles(tx, [...sinReserva.keys()], true);
        const faltantes = [...sinReserva]
          .filter(([p, cantidad]) => cantidad.greaterThan(disponibles.get(p) ?? 0))
          .map(([productoId, cantidad]) => ({ productoId, solicitado: cantidad, disponible: disponibles.get(productoId) ?? CERO }));
        if (faltantes.length > 0) {
          throw new ErrorNegocio('STOCK_INSUFICIENTE', 'No hay stock en el almacén para completar la carga', HttpStatus.CONFLICT, faltantes);
        }
      }

      const ahora = new Date();
      await tx.reservaInventario.updateMany({ where: { id: { in: reservas.map((r) => r.id) } }, data: { estado: 'CONSUMIDA', cerradaEn: ahora } });
      await tx.movimientoInventario.createMany({
        data: items.flatMap((i) => {
          const comun = {
            grupoId: randomUUID(),
            productoId: i.facturaItem.productoId,
            documentoOrigenTipo: 'MANIFIESTO',
            documentoOrigenId: id,
            usuarioId: ctx.usuarioId,
          };
          return [
            { ...comun, ubicacionId: manifiesto.ubicacionOrigenId, tipo: 'CARGA_SALIDA' as const, ...salida(i.cantidadCargada) },
            { ...comun, ubicacionId: vehiculo, tipo: 'CARGA_ENTRADA' as const, ...entrada(i.cantidadCargada) },
          ];
        }),
      });
      await tx.factura.updateMany({ where: { id: { in: facturaIds } }, data: { estado: 'DESPACHADA', version: { increment: 1 } } });
      await tx.manifiesto.update({ where: { id }, data: { estado: 'CONFIRMADO', confirmadoEn: ahora, version: { increment: 1 } } });

      const eventoFactura = eventoDeTransicion(CICLO_FACTURA, 'EMITIDA', 'DESPACHADA');
      await this.eventos.registrarVarios(tx, ctx, [
        {
          tipoEntidad: 'MANIFIESTO',
          idEntidad: id,
          tipoEvento: evento,
          estadoAnterior: manifiesto.estado,
          estadoNuevo: 'CONFIRMADO',
          vehiculoId: manifiesto.vehiculoId,
          datos: { numero: manifiesto.numero, facturas: facturaIds.length, lineas: items.length },
        },
        ...facturas.map(
          (f): NuevoEvento => ({
            tipoEntidad: 'FACTURA',
            idEntidad: f.id,
            tipoEvento: eventoFactura,
            estadoAnterior: 'EMITIDA',
            estadoNuevo: 'DESPACHADA',
            clienteId: f.clienteId,
            vendedorResponsableId: f.vendedorResponsableId,
            rutaId: f.rutaId,
            vehiculoId: manifiesto.vehiculoId,
            datos: { manifiestoId: id, numeroManifiesto: manifiesto.numero },
          }),
        ),
        ...reservas.map(
          (r): NuevoEvento => ({
            tipoEntidad: 'RESERVA',
            idEntidad: r.id,
            tipoEvento: 'RESERVA_CONSUMIDA',
            estadoAnterior: 'ACTIVA',
            estadoNuevo: 'CONSUMIDA',
            vehiculoId: manifiesto.vehiculoId,
            datos: { manifiestoId: id, productoId: r.productoId, cantidad: r.cantidad.toString() },
          }),
        ),
      ]);
    });
    return this.obtener(id, ctx);
  }

  /** El chofer (o quien gestiona despachos) marca la salida del vehículo, con GPS. */
  async iniciarRuta(id: string, datos: IniciarRuta, ctx: Contexto) {
    await this.prisma.$transaction(async (tx) => {
      const manifiesto = await this.bloquear(tx, id, datos.version);
      if (manifiesto.choferId !== ctx.usuarioId && !ctx.permisos.has('manifiesto.confirmar')) {
        throw new SinPermiso(['manifiesto.confirmar']);
      }
      const evento = eventoDeTransicion(CICLO_MANIFIESTO, manifiesto.estado as EstadoManifiesto, 'EN_RUTA');
      const fechaHoraDispositivo = datos.fechaHoraDispositivo ? new Date(datos.fechaHoraDispositivo) : null;
      await tx.manifiesto.update({
        where: { id },
        data: { estado: 'EN_RUTA', salidaEn: fechaHoraDispositivo ?? new Date(), version: { increment: 1 } },
      });
      await this.eventos.registrar(tx, ctx, {
        tipoEntidad: 'MANIFIESTO',
        idEntidad: id,
        tipoEvento: evento,
        estadoAnterior: manifiesto.estado,
        estadoNuevo: 'EN_RUTA',
        vehiculoId: manifiesto.vehiculoId,
        latitud: datos.latitud,
        longitud: datos.longitud,
        fechaHoraDispositivo,
        datos: { numero: manifiesto.numero },
      });
    });
    return this.obtener(id, ctx);
  }

  /** Anula un borrador. Sus facturas quedan libres para otro manifiesto. */
  async anular(id: string, datos: AnularManifiesto, ctx: Contexto) {
    await this.prisma.$transaction(async (tx) => {
      const manifiesto = await this.bloquear(tx, id, datos.version);
      const evento = eventoDeTransicion(CICLO_MANIFIESTO, manifiesto.estado as EstadoManifiesto, 'ANULADO');
      await tx.manifiestoFactura.updateMany({ where: { manifiestoId: id, activa: true }, data: { activa: false } });
      await tx.manifiesto.update({ where: { id }, data: { estado: 'ANULADO', version: { increment: 1 } } });
      await this.eventos.registrar(tx, ctx, {
        tipoEntidad: 'MANIFIESTO',
        idEntidad: id,
        tipoEvento: evento,
        estadoAnterior: manifiesto.estado,
        estadoNuevo: 'ANULADO',
        vehiculoId: manifiesto.vehiculoId,
        datos: { numero: manifiesto.numero, motivo: datos.motivo },
      });
    });
    return this.obtener(id, ctx);
  }

  /**
   * Cierra la ruta y cuadra el vehículo: cargado = entregado + retornado ± ajuste.
   * Lo contado vuelve al almacén; las diferencias con lo esperado se
   * registran como ajuste (exigen motivo). Las facturas no entregadas vuelven
   * a EMITIDA con una reserva nueva, listas para otro manifiesto.
   */
  async cerrar(id: string, datos: CerrarManifiesto, ctx: Contexto) {
    const cuadreFinal = await this.prisma.$transaction(async (tx) => {
      const manifiesto = await this.bloquear(tx, id, datos.version);
      const evento = eventoDeTransicion(CICLO_MANIFIESTO, manifiesto.estado as EstadoManifiesto, 'CERRADO');
      const cuadre = await this.calcularCuadre(tx, id);
      const conteo = new Map(datos.conteo.map((c) => [c.productoId, new Decimal(c.cantidad)]));

      const noCargados = [...conteo.keys()].filter((p) => !cuadre.some((l) => l.productoId === p));
      if (noCargados.length > 0) {
        throw new ErrorNegocio('PRODUCTO_NO_CARGADO', 'El conteo incluye productos que no se cargaron en este manifiesto', HttpStatus.UNPROCESSABLE_ENTITY, {
          productoIds: noCargados,
        });
      }
      const sinContar = cuadre.filter((l) => l.esperado.greaterThan(0) && !conteo.has(l.productoId)).map((l) => l.productoId);
      if (sinContar.length > 0) {
        throw new ErrorNegocio('CONTEO_INCOMPLETO', 'Falta contar productos que deberían estar en el vehículo', HttpStatus.UNPROCESSABLE_ENTITY, {
          productoIds: sinContar,
        });
      }

      const resultado = cuadre.map((l) => {
        const contado = conteo.get(l.productoId) ?? CERO;
        return { ...l, contado, diferencia: contado.minus(l.esperado) };
      });
      const conDiferencia = resultado.filter((l) => !l.diferencia.isZero());
      if (conDiferencia.length > 0 && !datos.motivoDiferencias) {
        throw new ErrorNegocio('DIFERENCIAS_SIN_JUSTIFICAR', 'El conteo no coincide con lo esperado; indique el motivo', HttpStatus.CONFLICT, conDiferencia);
      }

      const vehiculo = await this.ubicacionVehiculo(tx, manifiesto.vehiculoId);
      const comun = { documentoOrigenTipo: 'MANIFIESTO', documentoOrigenId: id, usuarioId: ctx.usuarioId };
      await tx.movimientoInventario.createMany({
        data: resultado.flatMap((l) => {
          const grupoId = randomUUID();
          const movimientos: Prisma.MovimientoInventarioCreateManyInput[] = [];
          if (l.diferencia.lessThan(0)) {
            movimientos.push({ ...comun, grupoId, productoId: l.productoId, ubicacionId: vehiculo, tipo: 'AJUSTE', ...salida(l.diferencia.negated()), motivo: datos.motivoDiferencias });
          } else if (l.diferencia.greaterThan(0)) {
            movimientos.push({ ...comun, grupoId, productoId: l.productoId, ubicacionId: vehiculo, tipo: 'AJUSTE', ...entrada(l.diferencia), motivo: datos.motivoDiferencias });
          }
          if (l.contado.greaterThan(0)) {
            movimientos.push(
              { ...comun, grupoId, productoId: l.productoId, ubicacionId: vehiculo, tipo: 'RETORNO_SALIDA', ...salida(l.contado) },
              { ...comun, grupoId, productoId: l.productoId, ubicacionId: manifiesto.ubicacionOrigenId, tipo: 'RETORNO_ENTRADA', ...entrada(l.contado) },
            );
          }
          return movimientos;
        }),
      });

      // Facturas que no se entregaron: vuelven a pendientes de despacho con su reserva.
      const pendientes = await tx.manifiestoFactura.findMany({
        where: { manifiestoId: id, activa: true, factura: { estado: 'DESPACHADA' } },
        include: { factura: { include: { items: true } } },
      });
      const eventosRetorno: NuevoEvento[] = [];
      for (const { factura } of pendientes) {
        await tx.manifiestoFactura.update({ where: { manifiestoId_facturaId: { manifiestoId: id, facturaId: factura.id } }, data: { activa: false } });
        await tx.factura.update({ where: { id: factura.id }, data: { estado: 'EMITIDA', version: { increment: 1 } } });
        const nuevas = await tx.reservaInventario.createManyAndReturn({
          data: factura.items
            .filter((i) => i.pedidoItemId !== null)
            .map((i) => ({
              productoId: i.productoId,
              ubicacionId: manifiesto.ubicacionOrigenId,
              pedidoItemId: i.pedidoItemId!,
              facturaItemId: i.id,
              cantidad: i.cantidad,
            })),
          select: { id: true, productoId: true, cantidad: true },
        });
        const deFactura = { clienteId: factura.clienteId, vendedorResponsableId: factura.vendedorResponsableId, rutaId: factura.rutaId };
        eventosRetorno.push(
          {
            ...deFactura,
            tipoEntidad: 'FACTURA',
            idEntidad: factura.id,
            tipoEvento: eventoDeTransicion(CICLO_FACTURA, 'DESPACHADA', 'EMITIDA'),
            estadoAnterior: 'DESPACHADA',
            estadoNuevo: 'EMITIDA',
            vehiculoId: manifiesto.vehiculoId,
            datos: { manifiestoId: id, numeroManifiesto: manifiesto.numero },
          },
          ...nuevas.map(
            (r): NuevoEvento => ({
              ...deFactura,
              tipoEntidad: 'RESERVA',
              idEntidad: r.id,
              tipoEvento: 'RESERVA_CREADA',
              estadoNuevo: 'ACTIVA',
              datos: { facturaId: factura.id, productoId: r.productoId, cantidad: r.cantidad.toString(), motivo: 'FACTURA_RETORNADA' },
            }),
          ),
        );
      }

      await tx.manifiesto.update({ where: { id }, data: { estado: 'CERRADO', cerradoEn: new Date(), version: { increment: 1 } } });
      const cuadreJson = resultado.map((l) => ({
        productoId: l.productoId,
        cargado: l.cargado.toString(),
        entregado: l.entregado.toString(),
        esperado: l.esperado.toString(),
        contado: l.contado.toString(),
        diferencia: l.diferencia.toString(),
      }));
      await this.eventos.registrarVarios(tx, ctx, [
        {
          tipoEntidad: 'MANIFIESTO',
          idEntidad: id,
          tipoEvento: evento,
          estadoAnterior: manifiesto.estado,
          estadoNuevo: 'CERRADO',
          vehiculoId: manifiesto.vehiculoId,
          datos: {
            numero: manifiesto.numero,
            cuadre: cuadreJson,
            motivoDiferencias: datos.motivoDiferencias ?? null,
            facturasRetornadas: pendientes.map((p) => p.factura.numero),
          },
        },
        ...eventosRetorno,
      ]);
      return resultado;
    });
    return { manifiesto: await this.obtener(id, ctx), cuadre: cuadreFinal };
  }

  async cuadre(id: string, ctx: Contexto) {
    await this.obtener(id, ctx);
    return this.calcularCuadre(this.prisma, id);
  }

  async obtener(id: string, ctx: Contexto) {
    const manifiesto = await this.prisma.manifiesto.findFirst({ where: { AND: [{ id }, alcanceManifiestos(ctx)] }, include: incluirDetalle });
    if (!manifiesto) throw new NoEncontrado('El manifiesto');
    return manifiesto;
  }

  listar(filtros: ListarManifiestos, ctx: Contexto) {
    return this.prisma.manifiesto.findMany({
      where: { AND: [alcanceManifiestos(ctx), { estado: filtros.estado, choferId: filtros.choferId }] },
      include: { vehiculo: { select: { placa: true } }, _count: { select: { facturas: { where: { activa: true } } } } },
      orderBy: { creadoEn: 'desc' },
      take: filtros.limite,
    });
  }

  /** Cargado y entregado por producto según el libro de movimientos del vehículo. */
  private async calcularCuadre(tx: Tx, id: string): Promise<LineaCuadre[]> {
    const filas = await tx.$queryRaw<
      { producto_id: string; sku: string; nombre: string; cargado: Decimal; entregado: Decimal; retornado: Decimal; faltante: Decimal }[]
    >`
      SELECT c.producto_id, p.sku, p.nombre, c.cargado, c.entregado, c.retornado, c.faltante
      FROM bi.v_cuadre_manifiestos c JOIN productos p ON p.id = c.producto_id
      WHERE c.manifiesto_id = ${id}::uuid
      ORDER BY p.nombre`;
    return filas.map((f) => ({
      productoId: f.producto_id,
      sku: f.sku,
      nombre: f.nombre,
      cargado: f.cargado,
      entregado: f.entregado,
      esperado: f.cargado.minus(f.entregado).minus(f.retornado).minus(f.faltante),
    }));
  }

  private async agregarEnTx(tx: Tx, manifiestoId: string, facturaIds: string[]): Promise<void> {
    if (facturaIds.length === 0) return;
    const facturas = await this.bloquearFacturas(tx, facturaIds);
    const inexistentes = facturaIds.filter((id) => !facturas.some((f) => f.id === id));
    if (inexistentes.length > 0) {
      throw new ErrorNegocio('NO_ENCONTRADO', 'Hay facturas que no existen', HttpStatus.NOT_FOUND, { facturaIds: inexistentes });
    }
    const noDespachables = facturas.filter((f) => f.estado !== 'EMITIDA');
    if (noDespachables.length > 0) {
      throw new ErrorNegocio('FACTURA_NO_DESPACHABLE', 'Solo se cargan facturas emitidas y pendientes de despacho', HttpStatus.CONFLICT,
        noDespachables.map((f) => ({ facturaId: f.id, numero: f.numero, estado: f.estado })));
    }
    const ocupadas = await tx.manifiestoFactura.findMany({
      where: { facturaId: { in: facturaIds }, activa: true },
      include: { manifiesto: { select: { numero: true } }, factura: { select: { numero: true } } },
    });
    if (ocupadas.length > 0) {
      throw new ErrorNegocio('FACTURA_EN_OTRO_MANIFIESTO', 'Hay facturas que ya están en un manifiesto activo', HttpStatus.CONFLICT,
        ocupadas.map((o) => ({ facturaId: o.facturaId, numero: o.factura.numero, manifiesto: o.manifiesto.numero })));
    }

    const ultima = await tx.manifiestoFactura.aggregate({ where: { manifiestoId }, _max: { ordenVisita: true } });
    let orden = ultima._max.ordenVisita ?? 0;
    for (const facturaId of facturaIds) {
      await tx.manifiestoFactura.create({ data: { manifiestoId, facturaId, ordenVisita: ++orden } });
    }
    const items = await tx.facturaItem.findMany({ where: { facturaId: { in: facturaIds } } });
    // En el MVP se carga la factura completa.
    await tx.manifiestoItem.createMany({ data: items.map((i) => ({ manifiestoId, facturaItemId: i.id, cantidadCargada: i.cantidad })) });
  }

  private async validarChofer(choferId: string): Promise<void> {
    const chofer = await this.prisma.usuario.findFirst({
      where: { id: choferId, activo: true, roles: { some: { rol: { permisos: { some: { permiso: { codigo: 'entrega.registrar' } } } } } } },
    });
    if (!chofer) {
      throw new ErrorNegocio('CHOFER_INVALIDO', 'El chofer no existe, está inactivo o no puede registrar entregas', HttpStatus.UNPROCESSABLE_ENTITY);
    }
  }

  private async ubicacionVehiculo(tx: Tx, vehiculoId: string): Promise<string> {
    return (await tx.ubicacion.findUniqueOrThrow({ where: { vehiculoId } })).id;
  }

  private async bloquearFacturas(tx: Tx, ids: string[]) {
    await tx.$queryRaw`SELECT id FROM facturas WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
    return tx.factura.findMany({ where: { id: { in: ids } } });
  }

  private async bloquear(tx: Tx, id: string, version: number) {
    await tx.$queryRaw`SELECT id FROM manifiestos WHERE id = ${id}::uuid FOR UPDATE`;
    const manifiesto = await tx.manifiesto.findUnique({ where: { id } });
    if (!manifiesto) throw new NoEncontrado('El manifiesto');
    if (manifiesto.version !== version) {
      throw new ErrorNegocio('VERSION_DESACTUALIZADA', 'El manifiesto cambió desde que se consultó; recárguelo', HttpStatus.CONFLICT, {
        versionActual: manifiesto.version,
        estadoActual: manifiesto.estado,
      });
    }
    return manifiesto;
  }

  private async bloquearBorrador(tx: Tx, id: string, version: number) {
    const manifiesto = await this.bloquear(tx, id, version);
    if (manifiesto.estado !== 'BORRADOR') {
      throw new ErrorNegocio('MANIFIESTO_NO_EDITABLE', `El manifiesto está ${manifiesto.estado}; solo se edita en BORRADOR`);
    }
    return manifiesto;
  }
}
