import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client.js';
import { crearAdaptador } from './conexion.js';

/** Transacción interactiva de Prisma, para pasar a servicios que escriben dentro de ella. */
export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL no está definida');
    super({ adapter: crearAdaptador(connectionString) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
