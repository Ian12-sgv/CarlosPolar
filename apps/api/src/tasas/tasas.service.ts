import { Injectable } from '@nestjs/common';
import { config } from '../config.js';
import { aFechaDb, fechaOperativa, sumarDias } from '../comun/fechas.js';
import type { Tx } from '../prisma/prisma.service.js';

@Injectable()
export class TasasService {
  /**
   * Tasa VES por USD aplicable hoy: la más reciente de la fuente configurada
   * con fecha valor entre hoy − `TASA_MAX_DIAS` y hoy. Null si no hay.
   */
  async vigente(tx: Tx) {
    const hoy = fechaOperativa();
    return tx.tasaCambio.findFirst({
      where: {
        monedaOrigen: 'USD',
        monedaDestino: 'VES',
        fuente: config.fuenteTasa,
        fecha: { lte: aFechaDb(hoy), gte: aFechaDb(sumarDias(hoy, -config.tasaMaxDias)) },
      },
      orderBy: { fecha: 'desc' },
    });
  }
}
