import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { TransicionInvalidaError } from '@cp/domain';
import type { FastifyReply } from 'fastify';

export interface CuerpoError {
  codigo: string;
  mensaje: string;
  detalles?: unknown;
}

/**
 * Respuesta de error uniforme: `{ codigo, mensaje, detalles? }`.
 * Traduce las violaciones de reglas de la base de datos (triggers, índices
 * únicos, CHECK) a 409 para que nunca lleguen como error 500.
 */
@Catch()
export class FiltroErrores implements ExceptionFilter {
  private readonly logger = new Logger(FiltroErrores.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const [estado, cuerpo] = traducirError(error);
    if (estado >= 500) this.logger.error(error);
    void host.switchToHttp().getResponse<FastifyReply>().status(estado).send(cuerpo);
  }
}

export function traducirError(error: unknown): [number, CuerpoError] {
  if (error instanceof HttpException) {
    const respuesta = error.getResponse();
    if (typeof respuesta === 'object' && respuesta !== null && 'codigo' in respuesta) {
      return [error.getStatus(), respuesta as CuerpoError];
    }
    return [error.getStatus(), { codigo: codigoHttp(error.getStatus()), mensaje: error.message }];
  }
  if (error instanceof TransicionInvalidaError) {
    return [HttpStatus.CONFLICT, { codigo: 'TRANSICION_INVALIDA', mensaje: error.message }];
  }
  const pg = errorPostgres(error);
  if (pg) {
    switch (pg.codigo) {
      case '23505':
        return [HttpStatus.CONFLICT, { codigo: 'DUPLICADO', mensaje: 'El registro ya existe', detalles: pg.restriccion }];
      case '23503':
        return [HttpStatus.UNPROCESSABLE_ENTITY, { codigo: 'REFERENCIA_INVALIDA', mensaje: 'Referencia a un registro inexistente' }];
      case '23514': // CHECK y triggers de validación
      case '23001': // triggers de inmutabilidad
      case '23P01': // EXCLUDE (vigencias solapadas)
      case 'P0001':
        return [HttpStatus.CONFLICT, { codigo: 'REGLA_VIOLADA', mensaje: pg.mensaje, detalles: pg.restriccion }];
    }
  }
  return [HttpStatus.INTERNAL_SERVER_ERROR, { codigo: 'ERROR_INTERNO', mensaje: 'Error interno del servidor' }];
}

function codigoHttp(estado: number): string {
  switch (estado) {
    case 400:
      return 'SOLICITUD_INVALIDA';
    case 401:
      return 'NO_AUTENTICADO';
    case 403:
      return 'SIN_PERMISO';
    case 404:
      return 'NO_ENCONTRADO';
    default:
      return 'ERROR';
  }
}

interface ErrorPg {
  codigo: string;
  mensaje: string;
  restriccion?: string;
}

/** Extrae el error original de PostgreSQL del envoltorio de Prisma (`meta.driverAdapterError.cause`). */
export function errorPostgres(error: unknown): ErrorPg | null {
  const causa = (error as { meta?: { driverAdapterError?: { cause?: Record<string, unknown> } } } | null)?.meta
    ?.driverAdapterError?.cause;
  if (!causa || typeof causa.originalCode !== 'string') return null;
  const restriccion = causa.constraint as { index?: string } | undefined;
  return {
    codigo: causa.originalCode,
    mensaje: String(causa.originalMessage ?? ''),
    restriccion: restriccion?.index,
  };
}
