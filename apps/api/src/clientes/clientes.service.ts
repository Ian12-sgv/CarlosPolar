import { HttpStatus, Injectable } from '@nestjs/common';
import type { CrearCliente, EditarCliente, Permiso } from '@cp/domain';
import { SinPermiso } from '../auth/auth.service.js';
import type { Contexto } from '../comun/contexto.js';
import { ErrorNegocio, NoEncontrado } from '../comun/errores.js';
import { AuditoriaService } from '../eventos/auditoria.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';

const CAMPOS_CREDITO = ['limiteCredito', 'monedaCredito', 'diasCredito'] as const;

/** Alta y edición de clientes, con historial de vendedor y permisos por grupo de campos. */
@Injectable()
export class ClientesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async crear(datos: CrearCliente, ctx: Contexto, ip: string | null) {
    this.exigirPermisosDeCampos(datos, ctx);
    return this.prisma.$transaction(async (tx) => {
      await this.validarReferencias(tx, datos);
      const cliente = await tx.cliente.create({ data: datos });
      if (datos.vendedorId) {
        await tx.clienteVendedorHistorial.create({
          data: { clienteId: cliente.id, vendedorId: datos.vendedorId, fechaDesde: new Date(), asignadoPor: ctx.usuarioId },
        });
      }
      await this.auditoria.registrarAccion(tx, ctx, ip, {
        accion: 'cliente.crear',
        tabla: 'clientes',
        registroId: cliente.id,
        despues: datos as Prisma.InputJsonValue,
      });
      return cliente;
    });
  }

  /**
   * Edita un cliente. Cambiar el vendedor cierra la asignación vigente y abre
   * una nueva; los documentos ya emitidos conservan su vendedor responsable.
   */
  async editar(id: string, datos: EditarCliente, ctx: Contexto, ip: string | null) {
    this.exigirPermisosDeCampos(datos, ctx);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM clientes WHERE id = ${id}::uuid FOR UPDATE`;
      const actual = await tx.cliente.findUnique({ where: { id } });
      if (!actual) throw new NoEncontrado('El cliente');
      await this.validarReferencias(tx, datos);

      const cliente = await tx.cliente.update({ where: { id }, data: datos });
      if (datos.vendedorId !== undefined && datos.vendedorId !== actual.vendedorId) {
        const ahora = new Date();
        await tx.clienteVendedorHistorial.updateMany({ where: { clienteId: id, fechaHasta: null }, data: { fechaHasta: ahora } });
        if (datos.vendedorId) {
          await tx.clienteVendedorHistorial.create({
            data: { clienteId: id, vendedorId: datos.vendedorId, fechaDesde: ahora, asignadoPor: ctx.usuarioId },
          });
        }
      }
      const antes = Object.fromEntries(Object.keys(datos).map((k) => [k, (actual as Record<string, unknown>)[k] ?? null]));
      await this.auditoria.registrarAccion(tx, ctx, ip, {
        accion: 'cliente.editar',
        tabla: 'clientes',
        registroId: id,
        antes: JSON.parse(JSON.stringify(antes)) as Prisma.InputJsonValue,
        despues: datos as Prisma.InputJsonValue,
      });
      return cliente;
    });
  }

  /**
   * Cada grupo de campos exige su permiso: crédito (`cliente.editar_credito`),
   * vendedor (`cliente.asignar_vendedor`) y el resto (`cliente.editar`). Así
   * Administración puede cambiar un cupo sin poder editar los demás datos.
   */
  private exigirPermisosDeCampos(datos: Partial<CrearCliente & EditarCliente>, ctx: Contexto): void {
    const faltantes: Permiso[] = [];
    const generales = Object.keys(datos).filter((k) => !(CAMPOS_CREDITO as readonly string[]).includes(k) && k !== 'vendedorId');
    if (generales.length > 0 && !ctx.permisos.has('cliente.editar')) faltantes.push('cliente.editar');
    if (CAMPOS_CREDITO.some((c) => datos[c] !== undefined) && !ctx.permisos.has('cliente.editar_credito')) {
      faltantes.push('cliente.editar_credito');
    }
    if (datos.vendedorId !== undefined && !ctx.permisos.has('cliente.asignar_vendedor')) faltantes.push('cliente.asignar_vendedor');
    if (faltantes.length > 0) throw new SinPermiso(faltantes);
  }

  private async validarReferencias(tx: Tx, datos: { vendedorId?: string | null; rutaId?: string | null; listaPrecioId?: string | null }) {
    const invalidas: string[] = [];
    if (datos.vendedorId && !(await tx.vendedor.count({ where: { id: datos.vendedorId, activo: true } }))) invalidas.push('vendedorId');
    if (datos.rutaId && !(await tx.ruta.count({ where: { id: datos.rutaId, activo: true } }))) invalidas.push('rutaId');
    if (datos.listaPrecioId && !(await tx.listaPrecio.count({ where: { id: datos.listaPrecioId, activo: true } }))) invalidas.push('listaPrecioId');
    if (invalidas.length > 0) {
      throw new ErrorNegocio('REFERENCIA_INVALIDA', 'Hay referencias inexistentes o inactivas', HttpStatus.UNPROCESSABLE_ENTITY, { campos: invalidas });
    }
  }
}
