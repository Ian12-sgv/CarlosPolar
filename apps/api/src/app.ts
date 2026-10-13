import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { readFileSync } from 'node:fs';
import { AppModule } from './app.module.js';
import { FiltroErrores } from './comun/filtro-errores.js';

/** Firma más 512 KB de foto en base64 caben con holgura. */
const LIMITE_CUERPO = 2 * 1024 * 1024;

/**
 * HTTPS si se configuran HTTPS_CERT y HTTPS_KEY (rutas a archivos PEM). Las
 * apps Android instaladas exigen HTTPS; ver docs/distribucion.md.
 */
function opcionesHttps(): { cert: Buffer; key: Buffer } | null {
  const cert = process.env.HTTPS_CERT;
  const key = process.env.HTTPS_KEY;
  if (!cert && !key) return null;
  if (!cert || !key) throw new Error('Configure HTTPS_CERT y HTTPS_KEY juntas');
  return { cert: readFileSync(cert), key: readFileSync(key) };
}

/** Crea la aplicación configurada. La usan `main.ts` y las pruebas de integración. */
export async function crearApp(opciones: { logger?: boolean } = {}): Promise<NestFastifyApplication> {
  const https = opcionesHttps();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, bodyLimit: LIMITE_CUERPO, ...(https ? { https } : {}) }),
    { logger: opciones.logger === false ? false : undefined },
  );
  app.useGlobalFilters(new FiltroErrores());
  app.enableShutdownHooks();
  return app;
}
