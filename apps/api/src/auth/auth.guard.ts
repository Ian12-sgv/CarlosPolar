import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ORIGENES, type Origen, type Permiso } from '@cp/domain';
import type { FastifyRequest } from 'fastify';
import { CLAVE_PERMISOS, CLAVE_PUBLICO } from '../comun/decoradores.js';
import { AuthService, SinPermiso } from './auth.service.js';

/**
 * Guard global: exige sesión válida salvo en endpoints `@Publico()` y
 * verifica los permisos declarados con `@RequierePermisos()`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const destinos = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(CLAVE_PUBLICO, destinos)) return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const [esquema, token] = (req.headers.authorization ?? '').split(' ');
    const contexto = esquema === 'Bearer' && token ? await this.auth.autenticar(token, origenDe(req)) : null;
    if (!contexto) {
      throw new UnauthorizedException({ codigo: 'NO_AUTENTICADO', mensaje: 'Sesión inválida o expirada' });
    }
    req.contexto = contexto;

    const requeridos = this.reflector.getAllAndOverride<Permiso[] | undefined>(CLAVE_PERMISOS, destinos) ?? [];
    const faltantes = requeridos.filter((p) => !contexto.permisos.has(p));
    if (faltantes.length > 0) throw new SinPermiso(faltantes);
    return true;
  }
}

/** Origen declarado por el cliente en `X-Origen` (WEB, APP_PREVENTISTA, APP_CHOFER). Por defecto, API. */
export function origenDe(req: FastifyRequest): Origen {
  const valor = String(req.headers['x-origen'] ?? '').toUpperCase();
  return (ORIGENES as readonly string[]).includes(valor) && valor !== 'SISTEMA' ? (valor as Origen) : 'API';
}
