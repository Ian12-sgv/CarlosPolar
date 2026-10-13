import type { Origen, Permiso } from '@cp/domain';

/** Quién hace la solicitud y desde dónde. Lo arma el guard de autenticación. */
export interface Contexto {
  usuarioId: string;
  sesionId: string;
  dispositivoId: string | null;
  roles: string[];
  permisos: Set<Permiso>;
  /** Id de vendedor si el usuario es preventista. */
  vendedorId: string | null;
  origen: Origen;
}

declare module 'fastify' {
  interface FastifyRequest {
    contexto?: Contexto;
  }
}
