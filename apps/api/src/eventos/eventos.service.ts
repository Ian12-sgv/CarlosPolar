import { Injectable } from '@nestjs/common';
import type { Origen, TipoEvento } from '@cp/domain';
import type { Prisma } from '../generated/prisma/client.js';
import type { Contexto } from '../comun/contexto.js';
import type { Tx } from '../prisma/prisma.service.js';

export interface NuevoEvento {
  tipoEntidad: string;
  idEntidad: string;
  tipoEvento: TipoEvento;
  estadoAnterior?: string | null;
  estadoNuevo?: string | null;
  vendedorResponsableId?: string | null;
  clienteId?: string | null;
  rutaId?: string | null;
  vehiculoId?: string | null;
  latitud?: number | null;
  longitud?: number | null;
  fechaHoraDispositivo?: Date | null;
  datos?: Prisma.InputJsonValue;
}

/** Quién origina el evento: un usuario autenticado o un proceso del sistema. */
export type Actor = Contexto | { usuarioId: string; origen: Origen; roles?: string[]; dispositivoId?: null };

/**
 * Registra eventos de negocio. Siempre se llama dentro de la misma
 * transacción que el cambio de estado: si el cambio se revierte, el evento
 * también, y no hay cambio de estado sin evento.
 */
@Injectable()
export class EventosService {
  async registrar(tx: Tx, actor: Actor, evento: NuevoEvento): Promise<void> {
    await tx.eventoNegocio.create({
      data: {
        ...evento,
        usuarioId: actor.usuarioId,
        rolCodigo: actor.roles?.join(',') || null,
        dispositivoId: actor.dispositivoId ?? null,
        origen: actor.origen,
      },
    });
  }

  async registrarVarios(tx: Tx, actor: Actor, eventos: NuevoEvento[]): Promise<void> {
    if (eventos.length === 0) return;
    await tx.eventoNegocio.createMany({
      data: eventos.map((evento) => ({
        ...evento,
        usuarioId: actor.usuarioId,
        rolCodigo: actor.roles?.join(',') || null,
        dispositivoId: actor.dispositivoId ?? null,
        origen: actor.origen,
      })),
    });
  }
}
