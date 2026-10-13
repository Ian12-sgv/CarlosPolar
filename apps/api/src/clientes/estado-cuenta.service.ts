import { Injectable } from '@nestjs/common';
import { config } from '../config.js';
import { NoEncontrado } from '../comun/errores.js';
import { Prisma, type Moneda } from '../generated/prisma/client.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;
const CERO = new Decimal(0);

export interface Restriccion {
  codigo: 'DEUDA_VENCIDA' | 'CUPO_EXCEDIDO' | 'SIN_TASA';
  mensaje: string;
}

interface FilaSaldo {
  factura_id: string;
  numero: string;
  moneda: Moneda;
  total: Decimal;
  saldo: Decimal;
  cobrado_por_validar: Decimal;
  fecha_vencimiento: Date;
  dias_vencido: number;
}

export interface ResumenMoneda {
  moneda: Moneda;
  saldo: Decimal;
  vencido: Decimal;
  proximoAVencer: Decimal;
  cobradoPorValidar: Decimal;
  pagosPorValidar: Decimal;
  pedidosAprobados: Decimal;
}

/**
 * Estado de cuenta del cliente: saldo por moneda, vencido, próximo a vencer,
 * pagos pendientes de validación, crédito disponible y restricciones de venta.
 * Es lo que ve el preventista antes de negociar y lo que evalúa Ventas al aprobar.
 */
@Injectable()
export class EstadoCuentaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param adicional monto de un pedido que se está evaluando y que aún no
   *   cuenta como aprobado (se suma al crédito utilizado).
   */
  async calcular(clienteId: string, tx: Tx = this.prisma, adicional?: { monto: Decimal; moneda: Moneda }) {
    const cliente = await tx.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente) throw new NoEncontrado('El cliente');

    const [facturas, pagos, pedidos, tasa] = await Promise.all([
      tx.$queryRaw<FilaSaldo[]>`
        SELECT factura_id, numero, moneda, total, saldo, cobrado_por_validar, fecha_vencimiento, dias_vencido
        FROM bi.v_saldo_facturas
        WHERE cliente_id = ${clienteId}::uuid AND saldo > 0
        ORDER BY fecha_vencimiento, numero`,
      tx.pagoRecibido.groupBy({ by: ['moneda'], where: { clienteId, estado: 'REGISTRADO' }, _sum: { montoTotal: true } }),
      tx.pedido.groupBy({ by: ['moneda'], where: { clienteId, estado: 'APROBADO' }, _sum: { total: true } }),
      tx.tasaCambio.findFirst({
        where: { monedaOrigen: 'USD', monedaDestino: 'VES', fuente: config.fuenteTasa },
        orderBy: { fecha: 'desc' },
      }),
    ]);

    const limiteProximo = new Date(Date.now() + config.diasProximoVencer * 86_400_000);
    const porMoneda = new Map<Moneda, ResumenMoneda>();
    const resumen = (moneda: Moneda): ResumenMoneda => {
      let r = porMoneda.get(moneda);
      if (!r) {
        r = { moneda, saldo: CERO, vencido: CERO, proximoAVencer: CERO, cobradoPorValidar: CERO, pagosPorValidar: CERO, pedidosAprobados: CERO };
        porMoneda.set(moneda, r);
      }
      return r;
    };
    for (const f of facturas) {
      const r = resumen(f.moneda);
      r.saldo = r.saldo.plus(f.saldo);
      r.cobradoPorValidar = r.cobradoPorValidar.plus(f.cobrado_por_validar);
      if (f.dias_vencido > 0) r.vencido = r.vencido.plus(f.saldo);
      else if (f.fecha_vencimiento <= limiteProximo) r.proximoAVencer = r.proximoAVencer.plus(f.saldo);
    }
    for (const p of pagos) resumen(p.moneda).pagosPorValidar = p._sum.montoTotal ?? CERO;
    for (const p of pedidos) resumen(p.moneda).pedidosAprobados = p._sum.total ?? CERO;

    const convertir = (monto: Decimal, de: Moneda, a: Moneda): Decimal | null => {
      if (de === a || monto.isZero()) return monto;
      if (!tasa) return null;
      return de === 'USD' ? monto.times(tasa.tasa) : monto.dividedBy(tasa.tasa);
    };

    const restricciones: Restriccion[] = [];
    if ([...porMoneda.values()].some((r) => r.vencido.greaterThan(0))) {
      restricciones.push({ codigo: 'DEUDA_VENCIDA', mensaje: 'El cliente tiene facturas vencidas' });
    }

    let credito: { limite: Decimal; utilizado: Decimal; disponible: Decimal } | null = null;
    if (cliente.limiteCredito !== null) {
      const componentes: [Decimal, Moneda][] = [...porMoneda.values()].flatMap((r) => [
        [r.saldo, r.moneda] as [Decimal, Moneda],
        [r.pedidosAprobados, r.moneda] as [Decimal, Moneda],
      ]);
      if (adicional) componentes.push([adicional.monto, adicional.moneda]);
      const convertidos = componentes.map(([monto, moneda]) => convertir(monto, moneda, cliente.monedaCredito));
      if (convertidos.some((c) => c === null)) {
        restricciones.push({ codigo: 'SIN_TASA', mensaje: `No hay tasa ${config.fuenteTasa} para evaluar el crédito en ${cliente.monedaCredito}` });
      } else {
        const utilizado = convertidos.reduce<Decimal>((s, c) => s.plus(c!), CERO).toDecimalPlaces(2);
        credito = { limite: cliente.limiteCredito, utilizado, disponible: cliente.limiteCredito.minus(utilizado) };
        if (credito.disponible.lessThan(0)) {
          restricciones.push({ codigo: 'CUPO_EXCEDIDO', mensaje: 'El cliente supera su cupo de crédito' });
        }
      }
    }

    return {
      clienteId,
      monedaCredito: cliente.monedaCredito,
      diasCredito: cliente.diasCredito,
      porMoneda: [...porMoneda.values()],
      facturas: facturas.map((f) => ({
        facturaId: f.factura_id,
        numero: f.numero,
        moneda: f.moneda,
        total: f.total,
        saldo: f.saldo,
        cobradoPorValidar: f.cobrado_por_validar,
        fechaVencimiento: f.fecha_vencimiento,
        diasVencido: f.dias_vencido,
      })),
      credito,
      tasa: tasa ? { valor: tasa.tasa, fecha: tasa.fecha, fuente: tasa.fuente } : null,
      restricciones,
      bloqueado: restricciones.length > 0,
    };
  }
}
