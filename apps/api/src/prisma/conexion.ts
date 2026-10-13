import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Crea el cliente Prisma. Toda conexión debe pasar por aquí.
 *
 * La sesión se fija en UTC porque el adaptador `pg` envía las fechas sin zona
 * horaria: con la zona local del servidor (p. ej. America/Caracas) PostgreSQL
 * las interpretaría como hora local y quedarían desfasadas 4 horas respecto a
 * `now()`, rompiendo vencimientos, reportes y triggers.
 */
export function crearPrisma(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error('DATABASE_URL no está definida');
  return new PrismaClient({ adapter: crearAdaptador(connectionString) });
}

export function crearAdaptador(connectionString: string): PrismaPg {
  return new PrismaPg({ connectionString, options: '-c timezone=UTC' });
}
