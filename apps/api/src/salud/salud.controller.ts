import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Publico } from '../comun/decoradores.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Publico()
@Controller('salud')
export class SaludController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async verificar(): Promise<{ estado: 'ok'; baseDatos: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ estado: 'error', baseDatos: 'sin conexión' });
    }
    return { estado: 'ok', baseDatos: 'ok' };
  }
}
