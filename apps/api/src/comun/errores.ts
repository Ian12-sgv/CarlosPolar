import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Rechazo de negocio con un código estable que las apps pueden interpretar
 * (p. ej. `PRECIO_CAMBIO`, `STOCK_INSUFICIENTE`, `TRANSICION_INVALIDA`).
 */
export class ErrorNegocio extends HttpException {
  constructor(
    readonly codigo: string,
    mensaje: string,
    estado: HttpStatus = HttpStatus.CONFLICT,
    detalles?: unknown,
  ) {
    super({ codigo, mensaje, ...(detalles === undefined ? {} : { detalles }) }, estado);
  }
}

export class NoEncontrado extends ErrorNegocio {
  constructor(entidad: string) {
    super('NO_ENCONTRADO', `${entidad} no existe`, HttpStatus.NOT_FOUND);
  }
}
