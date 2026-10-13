import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Valida y transforma el cuerpo o la consulta con un esquema de `@cp/domain`. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(valor: unknown): z.infer<T> {
    const resultado = this.schema.safeParse(valor);
    if (!resultado.success) {
      throw new BadRequestException({
        codigo: 'SOLICITUD_INVALIDA',
        mensaje: 'La solicitud no es válida',
        detalles: resultado.error.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
      });
    }
    return resultado.data;
  }
}
