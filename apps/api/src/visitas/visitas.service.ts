import { HttpStatus, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { CerrarVisita, IniciarVisita } from '@cp/domain';
import { alcanceClientes } from '../comun/alcance.js';
import type { Contexto } from '../comun/contexto.js';
import { ErrorNegocio, NoEncontrado } from '../comun/errores.js';
import { aFechaDb, fechaOperativa, sumarDias, ZONA_OPERATIVA } from '../comun/fechas.js';
import { errorPostgres } from '../comun/filtro-errores.js';
import { EventosService } from '../eventos/eventos.service.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';

const RESULTADOS_EFECTIVOS = new Set(['PEDIDO', 'COBRO', 'PEDIDO_Y_COBRO']);
const INTERVALO_AGENDA_MS = 60 * 60_000;

interface FilaPlan {
  ruta_id: string;
  vendedor_id: string;
  cliente_id: string;
  orden: number;
}

/**
 * Agenda diaria y visitas de campo. La agenda (visitas planificadas) se
 * genera desde la plantilla semanal de cada ruta y guarda el vendedor del
 * día, de modo que el cumplimiento histórico no cambia si la ruta cambia de
 * responsable o de plan.
 */
@Injectable()
export class VisitasService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VisitasService.name);
  private temporizador?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventosService,
  ) {}

  onModuleInit(): void {
    const generar = async () => {
      // Hoy y los dos días anteriores, por si el servidor estuvo apagado a medianoche.
      const hoy = fechaOperativa();
      for (const fecha of [sumarDias(hoy, -2), sumarDias(hoy, -1), hoy]) await this.generarAgenda(fecha);
    };
    generar().catch((e: unknown) => this.logger.error(`No se pudo generar la agenda: ${String(e)}`));
    this.temporizador = setInterval(() => void generar().catch(() => undefined), INTERVALO_AGENDA_MS);
    this.temporizador.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.temporizador);
  }

  /** Crea las visitas planificadas de la fecha (idempotente). No genera fechas futuras. */
  async generarAgenda(fecha: string, vendedorId: string | null = null, tx: Tx = this.prisma): Promise<number> {
    if (fecha > fechaOperativa()) return 0;
    return tx.$executeRaw`
      INSERT INTO visitas_planificadas (fecha, ruta_id, vendedor_id, cliente_id, orden, origen)
      SELECT ${fecha}::date, p.ruta_id, r.vendedor_id, p.cliente_id, p.orden, 'PLANTILLA'
      FROM ruta_plan_clientes p
      JOIN rutas r ON r.id = p.ruta_id AND r.activo AND r.vendedor_id IS NOT NULL
      JOIN clientes c ON c.id = p.cliente_id AND c.activo
      WHERE p.dia_semana = extract(isodow FROM ${fecha}::date)
        AND p.vigente_desde <= ${fecha}::date
        AND (p.vigente_hasta IS NULL OR p.vigente_hasta > ${fecha}::date)
        AND (${vendedorId}::uuid IS NULL OR r.vendedor_id = ${vendedorId}::uuid)
      ON CONFLICT (fecha, vendedor_id, cliente_id) DO NOTHING`;
  }

  /**
   * Agenda de un vendedor para una fecha: lo planificado con su visita (si se
   * hizo) y las visitas fuera de plan. Para fechas futuras muestra el plan
   * sin guardarlo.
   */
  async agenda(fechaPedida: string | undefined, vendedorPedido: string | undefined, ctx: Contexto) {
    const fecha = fechaPedida ?? fechaOperativa();
    const vendedorId = ctx.permisos.has('pedido.ver_todos') ? (vendedorPedido ?? ctx.vendedorId) : ctx.vendedorId;
    if (!vendedorId) throw new ErrorNegocio('VENDEDOR_REQUERIDO', 'Indique el vendedor', HttpStatus.BAD_REQUEST);
    const futura = fecha > fechaOperativa();

    let planificadas: { id: string | null; orden: number; rutaId: string | null; clienteId: string; estado: string; motivoCancelacion: string | null }[];
    if (futura) {
      const filas = await this.prisma.$queryRaw<FilaPlan[]>`
        SELECT p.ruta_id, r.vendedor_id, p.cliente_id, p.orden
        FROM ruta_plan_clientes p JOIN rutas r ON r.id = p.ruta_id AND r.activo
        WHERE r.vendedor_id = ${vendedorId}::uuid AND p.dia_semana = extract(isodow FROM ${fecha}::date)
          AND p.vigente_desde <= ${fecha}::date AND (p.vigente_hasta IS NULL OR p.vigente_hasta > ${fecha}::date)
        ORDER BY p.orden`;
      planificadas = filas.map((f) => ({ id: null, orden: f.orden, rutaId: f.ruta_id, clienteId: f.cliente_id, estado: 'PROGRAMADA', motivoCancelacion: null }));
    } else {
      await this.generarAgenda(fecha, vendedorId);
      planificadas = await this.prisma.visitaPlanificada.findMany({
        where: { fecha: aFechaDb(fecha), vendedorId },
        orderBy: { orden: 'asc' },
        select: { id: true, orden: true, rutaId: true, clienteId: true, estado: true, motivoCancelacion: true },
      });
    }

    const visitas = futura
      ? []
      : await this.prisma.$queryRaw<
          { id: string; visita_planificada_id: string | null; cliente_id: string; inicio_en: Date; fin_en: Date | null; resultado: string | null; motivo_sin_venta: string | null }[]
        >`
          SELECT id, visita_planificada_id, cliente_id, inicio_en, fin_en, resultado, motivo_sin_venta
          FROM visitas
          WHERE vendedor_id = ${vendedorId}::uuid AND (inicio_en AT TIME ZONE ${ZONA_OPERATIVA})::date = ${fecha}::date
          ORDER BY inicio_en`;
    const clienteIds = [...new Set([...planificadas.map((p) => p.clienteId), ...visitas.map((v) => v.cliente_id)])];
    const clientes = new Map(
      (await this.prisma.cliente.findMany({ where: { id: { in: clienteIds } }, select: { id: true, razonSocial: true, direccion: true, latitud: true, longitud: true } })).map(
        (c) => [c.id, c],
      ),
    );
    const visitaDe = (v: (typeof visitas)[number]) => ({
      id: v.id,
      inicioEn: v.inicio_en,
      finEn: v.fin_en,
      resultado: v.resultado,
      motivoSinVenta: v.motivo_sin_venta,
    });

    const filasPlan = planificadas.map((p) => ({
      ...p,
      cliente: clientes.get(p.clienteId) ?? null,
      visita: visitas.filter((v) => v.visita_planificada_id === p.id && p.id !== null).map(visitaDe).at(-1) ?? null,
    }));
    const fueraDePlan = visitas.filter((v) => !v.visita_planificada_id).map((v) => ({ ...visitaDe(v), cliente: clientes.get(v.cliente_id) ?? null }));
    const programadas = filasPlan.filter((p) => p.estado === 'PROGRAMADA');
    const visitadas = programadas.filter((p) => p.visita?.finEn);
    const efectivas = [...visitadas.map((p) => p.visita!), ...fueraDePlan].filter((v) => v.finEn && RESULTADOS_EFECTIVOS.has(v.resultado ?? ''));
    return {
      fecha,
      vendedorId,
      previsualizacion: futura,
      planificadas: filasPlan,
      fueraDePlan,
      resumen: {
        planificadas: programadas.length,
        visitadas: visitadas.length,
        fueraDePlan: fueraDePlan.length,
        efectivas: efectivas.length,
        cumplimiento: programadas.length ? visitadas.length / programadas.length : null,
      },
    };
  }

  /**
   * Abre una visita (llegada al cliente, con GPS). Se liga a la visita
   * planificada del día si existe; si no, cuenta como fuera de plan.
   */
  async iniciar(datos: IniciarVisita, ctx: Contexto) {
    if (!ctx.vendedorId) throw new ErrorNegocio('SOLO_VENDEDORES', 'Solo un vendedor registra visitas', HttpStatus.FORBIDDEN);
    const existente = await this.prisma.visita.findUnique({ where: { id: datos.id } });
    if (existente) {
      if (existente.vendedorId !== ctx.vendedorId) throw new ErrorNegocio('DUPLICADO', 'Ya existe una visita con ese id');
      return { visita: existente, duplicado: true };
    }
    const cliente = await this.prisma.cliente.findFirst({ where: { AND: [{ id: datos.clienteId }, alcanceClientes(ctx)] } });
    if (!cliente) throw new NoEncontrado('El cliente');

    const inicioEn = new Date(datos.inicioEn);
    const fecha = fechaOperativa(inicioEn);
    try {
      const visita = await this.prisma.$transaction(async (tx) => {
        await this.generarAgenda(fecha, ctx.vendedorId, tx);
        const plan = await tx.visitaPlanificada.findFirst({
          where: { fecha: aFechaDb(fecha), vendedorId: ctx.vendedorId!, clienteId: cliente.id, estado: 'PROGRAMADA' },
        });
        const creada = await tx.visita.create({
          data: {
            id: datos.id,
            visitaPlanificadaId: plan?.id ?? null,
            vendedorId: ctx.vendedorId!,
            clienteId: cliente.id,
            rutaId: plan?.rutaId ?? cliente.rutaId,
            inicioEn,
            latitud: datos.latitud,
            longitud: datos.longitud,
            precisionMetros: datos.precisionMetros,
          },
        });
        await this.eventos.registrar(tx, ctx, {
          tipoEntidad: 'VISITA',
          idEntidad: creada.id,
          tipoEvento: 'VISITA_INICIADA',
          clienteId: cliente.id,
          vendedorResponsableId: ctx.vendedorId,
          rutaId: creada.rutaId,
          latitud: datos.latitud,
          longitud: datos.longitud,
          fechaHoraDispositivo: inicioEn,
          datos: { planificada: Boolean(plan) },
        });
        return creada;
      });
      return { visita, duplicado: false };
    } catch (error) {
      if (errorPostgres(error)?.restriccion === 'visitas_pkey') {
        return { visita: await this.prisma.visita.findUniqueOrThrow({ where: { id: datos.id } }), duplicado: true };
      }
      throw error;
    }
  }

  /** Cierra la visita con su resultado. Una visita cerrada no se modifica. */
  async cerrar(id: string, datos: CerrarVisita, ctx: Contexto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM visitas WHERE id = ${id}::uuid FOR UPDATE`;
      const visita = await tx.visita.findUnique({ where: { id } });
      if (!visita || visita.vendedorId !== ctx.vendedorId) throw new NoEncontrado('La visita');
      if (visita.finEn) throw new ErrorNegocio('VISITA_CERRADA', 'La visita ya está cerrada');
      const finEn = new Date(datos.finEn);
      if (finEn < visita.inicioEn) throw new ErrorNegocio('FECHA_INVALIDA', 'El cierre no puede ser anterior al inicio', HttpStatus.UNPROCESSABLE_ENTITY);
      const cerrada = await tx.visita.update({
        where: { id },
        data: { finEn, resultado: datos.resultado, motivoSinVenta: datos.motivoSinVenta ?? null, observaciones: datos.observaciones },
      });
      await this.eventos.registrar(tx, ctx, {
        tipoEntidad: 'VISITA',
        idEntidad: id,
        tipoEvento: 'VISITA_CERRADA',
        estadoNuevo: datos.resultado,
        clienteId: visita.clienteId,
        vendedorResponsableId: visita.vendedorId,
        rutaId: visita.rutaId,
        fechaHoraDispositivo: finEn,
        datos: { resultado: datos.resultado, motivoSinVenta: datos.motivoSinVenta ?? null, minutos: Math.round((finEn.getTime() - visita.inicioEn.getTime()) / 60_000) },
      });
      return cerrada;
    });
  }

  /** Quita una visita de la agenda de un día (cliente de vacaciones, cierre temporal…). Deja de contar para el cumplimiento. */
  async cancelarPlanificada(id: string, motivo: string) {
    const { count } = await this.prisma.visitaPlanificada.updateMany({
      where: { id, estado: 'PROGRAMADA', visitas: { none: {} } },
      data: { estado: 'CANCELADA', motivoCancelacion: motivo },
    });
    if (count === 0) {
      if (!(await this.prisma.visitaPlanificada.count({ where: { id } }))) throw new NoEncontrado('La visita planificada');
      throw new ErrorNegocio('NO_CANCELABLE', 'La visita ya fue cancelada o ya se realizó');
    }
    return this.prisma.visitaPlanificada.findUniqueOrThrow({ where: { id } });
  }
}
