import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { SinPermiso } from '../auth/auth.service.js';
import type { Contexto } from '../comun/contexto.js';
import { Ctx } from '../comun/decoradores.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ArchivosService } from './archivos.service.js';

@Controller('archivos')
export class ArchivosController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly archivos: ArchivosService,
  ) {}

  /**
   * Descarga un archivo. Lo ve quien supervisa (auditoría, cierres, entregas)
   * o quien participa en el documento que lo usa. Como los archivos se
   * reutilizan por contenido, no basta con mirar quién lo subió primero.
   */
  @Get(':id')
  async descargar(@Param('id', ParseUUIDPipe) id: string, @Ctx() ctx: Contexto, @Res() reply: FastifyReply): Promise<void> {
    const archivo = await this.archivos.leer(this.prisma, id);
    if (!(await this.puedeVer(id, archivo.subidoPor, ctx))) throw new SinPermiso(['auditoria.ver']);
    await reply.header('content-type', archivo.mime).header('cache-control', 'private, max-age=86400').send(archivo.contenido);
  }

  private async puedeVer(id: string, subidoPor: string, ctx: Contexto): Promise<boolean> {
    if ((['auditoria.ver', 'manifiesto.cerrar', 'entrega.anular'] as const).some((p) => ctx.permisos.has(p))) return true;
    if (subidoPor === ctx.usuarioId) return true;
    const [entregas, pagos] = await Promise.all([
      this.prisma.entrega.count({ where: { firmaArchivoId: id, choferId: ctx.usuarioId } }),
      this.prisma.pagoRecibido.count({ where: { evidenciaArchivoId: id, creadoPor: ctx.usuarioId } }),
    ]);
    return entregas + pagos > 0;
  }
}
