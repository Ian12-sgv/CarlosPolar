import { HttpStatus } from '@nestjs/common';
import type { CrearUsuario } from '@cp/domain';
import { hashContrasena } from '../auth/secretos.js';
import { ErrorNegocio } from '../comun/errores.js';
import type { Tx } from '../prisma/prisma.service.js';

/** Crea un usuario con sus roles y, si corresponde, su registro de vendedor. Lo usan la API y el script de administrador. */
export async function crearUsuario(tx: Tx, datos: CrearUsuario) {
  const roles = await tx.rol.findMany({ where: { codigo: { in: datos.roles } } });
  const inexistentes = datos.roles.filter((c) => !roles.some((r) => r.codigo === c));
  if (inexistentes.length > 0) {
    throw new ErrorNegocio('ROL_INEXISTENTE', 'Hay roles que no existen', HttpStatus.UNPROCESSABLE_ENTITY, { inexistentes });
  }
  return tx.usuario.create({
    data: {
      username: datos.username,
      nombre: datos.nombre,
      passwordHash: await hashContrasena(datos.password),
      roles: { create: roles.map((r) => ({ rolId: r.id })) },
      ...(datos.codigoVendedor ? { vendedor: { create: { codigo: datos.codigoVendedor } } } : {}),
    },
    select: { id: true, username: true, nombre: true, activo: true, vendedor: { select: { id: true, codigo: true } } },
  });
}
