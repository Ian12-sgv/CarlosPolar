import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { config } from '../config.js';
import { EventosService } from '../eventos/eventos.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Usuario técnico que firma los eventos generados por procesos automáticos. Lo crea el seed. */
export const USUARIO_SISTEMA = 'sistema';

/**
 * Libera periódicamente las reservas vencidas de pedidos aprobados que no se
 * facturaron a tiempo. Las reservas ya ligadas a una factura no vencen.
 */
@Injectable()
export class ReservasService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReservasService.name);
  private temporizador?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventosService,
  ) {}

  onModuleInit(): void {
    this.temporizador = setInterval(() => {
      this.liberarVencidas().catch((error: unknown) => this.logger.error(`Falló el barrido de reservas: ${String(error)}`));
    }, config.barridoReservasMinutos * 60_000);
    this.temporizador.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.temporizador);
  }

  async liberarVencidas(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const sistema = await tx.usuario.findUnique({ where: { username: USUARIO_SISTEMA } });
      if (!sistema) throw new Error(`Falta el usuario "${USUARIO_SISTEMA}"; ejecute el seed`);

      const vencidas = await tx.$queryRaw<
        { id: string; producto_id: string; cantidad: Prisma.Decimal; pedido_id: string; cliente_id: string; vence_en: Date }[]
      >`
        UPDATE reservas_inventario r
        SET estado = 'VENCIDA', cerrada_en = now()
        FROM pedido_items pi JOIN pedidos p ON p.id = pi.pedido_id
        WHERE pi.id = r.pedido_item_id
          AND r.estado = 'ACTIVA' AND r.factura_item_id IS NULL AND r.vence_en < now()
        RETURNING r.id, r.producto_id, r.cantidad, p.id AS pedido_id, p.cliente_id, r.vence_en`;

      await this.eventos.registrarVarios(
        tx,
        { usuarioId: sistema.id, origen: 'SISTEMA' },
        vencidas.map((r) => ({
          tipoEntidad: 'RESERVA',
          idEntidad: r.id,
          tipoEvento: 'RESERVA_VENCIDA',
          estadoAnterior: 'ACTIVA',
          estadoNuevo: 'VENCIDA',
          clienteId: r.cliente_id,
          datos: { pedidoId: r.pedido_id, productoId: r.producto_id, cantidad: r.cantidad.toString(), venceEn: r.vence_en.toISOString() },
        })),
      );
      if (vencidas.length > 0) this.logger.log(`Reservas vencidas liberadas: ${vencidas.length}`);
      return vencidas.length;
    });
  }
}
