import { SetMetadata, UnauthorizedException, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permiso } from '@cp/domain';
import type { FastifyRequest } from 'fastify';
import type { Contexto } from './contexto.js';

export const CLAVE_PUBLICO = 'publico';
export const CLAVE_PERMISOS = 'permisos';

/** El endpoint no requiere sesión. */
export const Publico = () => SetMetadata(CLAVE_PUBLICO, true);

/** El usuario debe tener todos los permisos indicados. */
export const RequierePermisos = (...permisos: Permiso[]) => SetMetadata(CLAVE_PERMISOS, permisos);

/** Inyecta el contexto de la solicitud autenticada. */
export const Ctx = createParamDecorator((_: unknown, ctx: ExecutionContext): Contexto => {
  const contexto = ctx.switchToHttp().getRequest<FastifyRequest>().contexto;
  if (!contexto) throw new UnauthorizedException();
  return contexto;
});
