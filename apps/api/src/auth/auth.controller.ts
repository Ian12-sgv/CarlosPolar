import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { iniciarSesionSchema, refrescarSesionSchema, type IniciarSesion, type RefrescarSesion } from '@cp/domain';
import type { FastifyRequest } from 'fastify';
import type { Contexto } from '../comun/contexto.js';
import { Ctx, Publico } from '../comun/decoradores.js';
import { ZodPipe } from '../comun/zod.pipe.js';
import { origenDe } from './auth.guard.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Publico()
  @Post('iniciar-sesion')
  @HttpCode(200)
  iniciarSesion(@Body(new ZodPipe(iniciarSesionSchema)) datos: IniciarSesion, @Req() req: FastifyRequest) {
    return this.auth.iniciarSesion(datos, origenDe(req), req.ip);
  }

  @Publico()
  @Post('refrescar')
  @HttpCode(200)
  refrescar(@Body(new ZodPipe(refrescarSesionSchema)) datos: RefrescarSesion) {
    return this.auth.refrescar(datos.refreshToken);
  }

  @Post('cerrar-sesion')
  @HttpCode(204)
  async cerrarSesion(@Ctx() ctx: Contexto, @Req() req: FastifyRequest): Promise<void> {
    await this.auth.cerrarSesion(ctx, req.ip);
  }

  @Get('yo')
  yo(@Ctx() ctx: Contexto) {
    return this.auth.usuarioActual(ctx);
  }
}
