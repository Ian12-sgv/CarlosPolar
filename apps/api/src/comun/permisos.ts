import type { Permiso } from '@cp/domain';
import { SinPermiso } from '../auth/auth.service.js';
import type { Contexto } from './contexto.js';

/** Exige al menos uno de los permisos (`@RequierePermisos` exige todos). */
export function exigirAlguno(ctx: Contexto, ...permisos: Permiso[]): void {
  if (!permisos.some((p) => ctx.permisos.has(p))) throw new SinPermiso(permisos);
}
