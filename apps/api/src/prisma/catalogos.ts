import { PERMISOS, ROLES_PREDETERMINADOS } from '@cp/domain';
import { USUARIO_SISTEMA } from '../pedidos/reservas.service.js';
import type { PrismaClient } from '../generated/prisma/client.js';

const CORRELATIVOS = [
  { codigo: 'PEDIDO', prefijo: 'PED-' },
  { codigo: 'FACTURA', prefijo: 'FAC-' },
  { codigo: 'MANIFIESTO', prefijo: 'MAN-' },
];

/**
 * Catálogos base: permisos, roles, correlativos, almacén principal y usuario
 * técnico del sistema. Es idempotente: puede ejecutarse varias veces.
 */
export async function sembrarCatalogos(prisma: PrismaClient): Promise<void> {
  for (const [codigo, descripcion] of Object.entries(PERMISOS)) {
    await prisma.permiso.upsert({ where: { codigo }, create: { codigo, descripcion }, update: { descripcion } });
  }
  const permisos = new Map((await prisma.permiso.findMany()).map((p) => [p.codigo, p.id]));

  for (const [codigo, rol] of Object.entries(ROLES_PREDETERMINADOS)) {
    const { id } = await prisma.rol.upsert({
      where: { codigo },
      create: { codigo, nombre: rol.nombre },
      update: { nombre: rol.nombre },
    });
    await prisma.rolPermiso.createMany({
      data: rol.permisos.map((p) => ({ rolId: id, permisoId: permisos.get(p)! })),
      skipDuplicates: true,
    });
  }

  for (const c of CORRELATIVOS) {
    await prisma.correlativo.upsert({ where: { codigo: c.codigo }, create: c, update: {} });
  }

  await prisma.ubicacion.upsert({
    where: { codigo: 'ALM-PRINCIPAL' },
    create: { codigo: 'ALM-PRINCIPAL', nombre: 'Almacén principal', tipo: 'ALMACEN' },
    update: {},
  });

  // Sin contraseña válida ('!') e inactivo: no puede iniciar sesión.
  await prisma.usuario.upsert({
    where: { username: USUARIO_SISTEMA },
    create: { username: USUARIO_SISTEMA, nombre: 'Procesos automáticos', passwordHash: '!', activo: false },
    update: {},
  });
}
