import { Injectable } from '@nestjs/common';
import type { Origen } from '@cp/domain';
import type { Prisma } from '../generated/prisma/client.js';
import type { Contexto } from '../comun/contexto.js';
import type { Tx } from '../prisma/prisma.service.js';

export interface EntradaAuditoria {
  usuarioId?: string | null;
  dispositivoId?: string | null;
  origen: Origen;
  ip?: string | null;
  accion: string;
  tabla: string;
  registroId?: string | null;
  antes?: Prisma.InputJsonValue;
  despues?: Prisma.InputJsonValue;
}

/** Bitácora de acciones sensibles (sesiones, usuarios, permisos, datos maestros). */
@Injectable()
export class AuditoriaService {
  async registrar(tx: Tx, entrada: EntradaAuditoria): Promise<void> {
    const { antes, despues, ...resto } = entrada;
    await tx.auditoria.create({ data: { ...resto, datosAntes: antes, datosDespues: despues } });
  }

  /** Atajo para acciones de un usuario autenticado. */
  async registrarAccion(
    tx: Tx,
    ctx: Contexto,
    ip: string | null,
    accion: Pick<EntradaAuditoria, 'accion' | 'tabla' | 'registroId' | 'antes' | 'despues'>,
  ): Promise<void> {
    await this.registrar(tx, { usuarioId: ctx.usuarioId, dispositivoId: ctx.dispositivoId, origen: ctx.origen, ip, ...accion });
  }
}
