import { HttpException, HttpStatus, Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { from, lastValueFrom, type Observable } from 'rxjs';
import type { Contexto } from '../comun/contexto.js';
import { ErrorNegocio } from '../comun/errores.js';
import { traducirError } from '../comun/filtro-errores.js';
import type { Prisma, ResultadoSincronizacion } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const METODOS_MUTACION = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Una solicitud "en proceso" más antigua que esto se considera abandonada (la app murió o se cortó la red). */
const ABANDONADA_MS = 2 * 60_000;

declare module 'fastify' {
  interface FastifyRequest {
    /** El servicio detectó que la operación ya existía (p. ej. pedido con el mismo id). */
    duplicado?: boolean;
  }
}

/**
 * Idempotencia de las mutaciones y bitácora de sincronización móvil.
 *
 * - Con `Idempotency-Key`, la primera respuesta (éxito o rechazo de negocio)
 *   se guarda y los reenvíos con la misma clave la reciben sin repetir la
 *   operación. Los errores 5xx no se guardan, para que el reintento se ejecute.
 * - Las apps móviles (`X-Origen: APP_*`) deben enviar la clave en toda mutación.
 * - Cada mutación de una app móvil queda en `sincronizacion_registros`.
 */
@Injectable()
export class IdempotenciaInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotenciaInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const contexto = req.contexto;
    if (!contexto || !METODOS_MUTACION.has(req.method)) return next.handle();
    return from(this.procesar(ctx, req, contexto, next));
  }

  private async procesar(ctx: ExecutionContext, req: FastifyRequest, contexto: Contexto, next: CallHandler) {
    const inicio = Date.now();
    const esMovil = contexto.origen === 'APP_PREVENTISTA' || contexto.origen === 'APP_CHOFER';
    const clave = cabecera(req, 'idempotency-key');
    const ruta = req.routeOptions.url ?? req.url;
    const estadoExito: number =
      Reflect.getMetadata(HTTP_CODE_METADATA, ctx.getHandler()) ?? (req.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK);

    // Se registra una sola vez, en el finally, con el resultado final.
    let resultado: ResultadoSincronizacion = 'ACEPTADO';
    let estadoHttp = estadoExito;
    let codigoMotivo: string | undefined;

    try {
      if (!clave) {
        if (esMovil) {
          throw new ErrorNegocio('FALTA_IDEMPOTENCY_KEY', 'Las apps móviles deben enviar Idempotency-Key', HttpStatus.BAD_REQUEST);
        }
        return await this.ejecutar(next, req, () => (resultado = 'DUPLICADO'));
      }
      if (clave.length > 100) {
        throw new ErrorNegocio('IDEMPOTENCY_KEY_INVALIDA', 'Idempotency-Key admite hasta 100 caracteres', HttpStatus.BAD_REQUEST);
      }

      const hash = createHash('sha256').update(`${req.method} ${req.url}\n${JSON.stringify(req.body ?? null)}`).digest('hex');
      const previa = await this.reservarClave(contexto.usuarioId, clave, req.method, ruta, hash);
      if (previa) {
        resultado = 'DUPLICADO';
        estadoHttp = previa.estado;
        // Un rechazo guardado se relanza como error para conservar su código HTTP.
        if (previa.estado >= 400) throw new HttpException(previa.cuerpo as object, previa.estado);
        return previa.cuerpo;
      }

      const donde = { usuarioId_clave: { usuarioId: contexto.usuarioId, clave } };
      try {
        const cuerpo = await this.ejecutar(next, req, () => (resultado = 'DUPLICADO'));
        await this.prisma.solicitudIdempotente.update({
          where: donde,
          data: { estadoRespuesta: estadoExito, cuerpoRespuesta: (cuerpo ?? null) as Prisma.InputJsonValue },
        });
        return cuerpo;
      } catch (error) {
        const [estado, cuerpo] = traducirError(error);
        if (estado < 500) {
          await this.prisma.solicitudIdempotente.update({
            where: donde,
            data: { estadoRespuesta: estado, cuerpoRespuesta: cuerpo as unknown as Prisma.InputJsonValue },
          });
        } else {
          await this.prisma.solicitudIdempotente.delete({ where: donde });
        }
        throw error;
      }
    } catch (error) {
      const [estado, cuerpo] = traducirError(error);
      if (resultado !== 'DUPLICADO') resultado = clasificar(estado);
      estadoHttp = estado;
      codigoMotivo = cuerpo.codigo;
      throw error;
    } finally {
      if (esMovil) {
        void this.registrarSincronizacion(req, contexto, ruta, clave, resultado, estadoHttp, codigoMotivo, inicio);
      }
    }
  }

  private async ejecutar(next: CallHandler, req: FastifyRequest, marcarDuplicado: () => void): Promise<unknown> {
    const cuerpo = await lastValueFrom(next.handle(), { defaultValue: undefined });
    if (req.duplicado) marcarDuplicado();
    return cuerpo;
  }

  /**
   * Registra la clave como "en proceso". Si ya existía, devuelve la respuesta
   * guardada, o lanza si sigue en proceso o si se reutilizó con otro contenido.
   */
  private async reservarClave(
    usuarioId: string,
    clave: string,
    metodoHttp: string,
    ruta: string,
    hashSolicitud: string,
  ): Promise<{ estado: number; cuerpo: unknown } | null> {
    const insertadas = await this.prisma.$executeRaw`
      INSERT INTO solicitudes_idempotentes (usuario_id, clave, metodo_http, ruta, hash_solicitud)
      VALUES (${usuarioId}::uuid, ${clave}, ${metodoHttp}, ${ruta}, ${hashSolicitud})
      ON CONFLICT DO NOTHING`;
    if (insertadas === 1) return null;

    const existente = await this.prisma.solicitudIdempotente.findUniqueOrThrow({ where: { usuarioId_clave: { usuarioId, clave } } });
    if (existente.hashSolicitud !== hashSolicitud) {
      throw new ErrorNegocio(
        'IDEMPOTENCY_KEY_REUTILIZADA',
        'La Idempotency-Key ya se usó con otra solicitud; genere una clave nueva',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (existente.estadoRespuesta !== null) {
      return { estado: existente.estadoRespuesta, cuerpo: existente.cuerpoRespuesta };
    }
    // Retoma una solicitud abandonada. Es seguro porque las operaciones también son idempotentes por id.
    const { count } = await this.prisma.solicitudIdempotente.updateMany({
      where: { usuarioId, clave, estadoRespuesta: null, creadaEn: { lt: new Date(Date.now() - ABANDONADA_MS) } },
      data: { creadaEn: new Date() },
    });
    if (count === 1) return null;
    throw new ErrorNegocio('SOLICITUD_EN_PROCESO', 'La misma solicitud aún se está procesando; reintente en unos segundos');
  }

  private async registrarSincronizacion(
    req: FastifyRequest,
    contexto: Contexto,
    ruta: string,
    clave: string | null,
    resultado: ResultadoSincronizacion,
    estadoHttp: number,
    codigoMotivo: string | undefined,
    inicio: number,
  ): Promise<void> {
    const fecha = cabecera(req, 'x-fecha-dispositivo');
    const fechaHoraDispositivo = fecha && !Number.isNaN(Date.parse(fecha)) ? new Date(fecha) : null;
    try {
      await this.prisma.sincronizacionRegistro.create({
        data: {
          usuarioId: contexto.usuarioId,
          dispositivoId: contexto.dispositivoId,
          origen: contexto.origen,
          metodoHttp: req.method,
          ruta,
          claveIdempotencia: clave,
          fechaHoraDispositivo,
          resultado,
          estadoHttp,
          codigoMotivo,
          duracionMs: Date.now() - inicio,
        },
      });
    } catch (error) {
      this.logger.warn(`No se pudo registrar la sincronización: ${String(error)}`);
    }
  }
}

function cabecera(req: FastifyRequest, nombre: string): string | null {
  const valor = req.headers[nombre];
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

function clasificar(estado: number): ResultadoSincronizacion {
  if (estado >= 500) return 'ERROR';
  if (estado === 409) return 'CONFLICTO';
  return 'RECHAZADO';
}
