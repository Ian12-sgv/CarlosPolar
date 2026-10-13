import type { Prisma } from '../generated/prisma/client.js';
import type { Contexto } from './contexto.js';

/**
 * Qué clientes, pedidos y facturas puede ver el usuario. Con `pedido.ver_todos` ve todo;
 * un preventista solo ve su cartera; cualquier otro, solo lo que creó.
 */
export function alcanceClientes(ctx: Contexto): Prisma.ClienteWhereInput {
  if (ctx.permisos.has('pedido.ver_todos')) return {};
  if (ctx.vendedorId) return { vendedorId: ctx.vendedorId };
  return { id: { in: [] } };
}

export function alcancePedidos(ctx: Contexto): Prisma.PedidoWhereInput {
  if (ctx.permisos.has('pedido.ver_todos')) return {};
  if (ctx.vendedorId) return { vendedorResponsableId: ctx.vendedorId };
  return { creadoPor: ctx.usuarioId };
}

export function alcanceFacturas(ctx: Contexto): Prisma.FacturaWhereInput {
  if (ctx.permisos.has('pedido.ver_todos')) return {};
  if (ctx.vendedorId) return { vendedorResponsableId: ctx.vendedorId };
  return { id: { in: [] } };
}
