import { HttpStatus, Injectable } from '@nestjs/common';
import { MAX_IMAGEN_BYTES, type Imagen } from '@cp/domain';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { ErrorNegocio, NoEncontrado } from '../comun/errores.js';
import type { TipoArchivo } from '../generated/prisma/client.js';
import type { Tx } from '../prisma/prisma.service.js';

const EXTENSION: Record<Imagen['mime'], string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

const existe = (ruta: string) => access(ruta).then(() => true, () => false);

/** Reconoce el formato real por sus primeros bytes, sin confiar en el `mime` declarado. */
function detectarMime(contenido: Buffer): Imagen['mime'] | null {
  if (contenido.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (contenido[0] === 0xff && contenido[1] === 0xd8 && contenido[2] === 0xff) return 'image/jpeg';
  if (contenido.subarray(0, 4).toString('ascii') === 'RIFF' && contenido.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Firmas, fotos y evidencias en el sistema de archivos local (`STORAGE_DIR`).
 * El nombre es el SHA-256 del contenido: un reenvío del mismo archivo reutiliza
 * el registro existente y cualquier alteración posterior es detectable.
 */
@Injectable()
export class ArchivosService {
  private get raiz(): string {
    return resolve(process.cwd(), process.env.STORAGE_DIR ?? '../../storage');
  }

  async guardarImagen(tx: Tx, imagen: Imagen, tipo: TipoArchivo, usuarioId: string): Promise<string> {
    const contenido = Buffer.from(imagen.contenidoBase64, 'base64');
    if (contenido.length === 0 || contenido.length > MAX_IMAGEN_BYTES) {
      throw new ErrorNegocio('ARCHIVO_INVALIDO', 'La imagen está vacía o supera 512 KB', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (detectarMime(contenido) !== imagen.mime) {
      throw new ErrorNegocio('ARCHIVO_INVALIDO', `El contenido no es una imagen ${imagen.mime} válida`, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const sha256 = createHash('sha256').update(contenido).digest('hex');
    const rutaRelativa = join(tipo.toLowerCase(), sha256.slice(0, 2), `${sha256}.${EXTENSION[imagen.mime]}`).replaceAll('\\', '/');
    const destino = join(this.raiz, rutaRelativa);
    const existente = await tx.archivo.findUnique({ where: { rutaRelativa } });
    // Si el registro existe pero el archivo se perdió (p. ej. se restauró la base sin la carpeta), se reescribe:
    // el contenido es idéntico porque el nombre es su hash.
    if (existente && (await existe(destino))) return existente.id;

    // Escritura atómica: si el proceso muere a mitad, no queda un archivo truncado con el nombre definitivo.
    await mkdir(dirname(destino), { recursive: true });
    const temporal = `${destino}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporal, contenido);
    await rename(temporal, destino);
    if (existente) return existente.id;

    const archivo = await tx.archivo.create({
      data: { tipo, rutaRelativa, mime: imagen.mime, tamanoBytes: contenido.length, sha256, subidoPor: usuarioId },
    });
    return archivo.id;
  }

  /** Lee el archivo y verifica que su contenido siga coincidiendo con el hash registrado. */
  async leer(tx: Tx, id: string): Promise<{ mime: string; contenido: Buffer; subidoPor: string }> {
    const archivo = await tx.archivo.findUnique({ where: { id } });
    if (!archivo) throw new NoEncontrado('El archivo');
    const contenido = await readFile(join(this.raiz, archivo.rutaRelativa)).catch(() => null);
    if (!contenido) throw new ErrorNegocio('ARCHIVO_PERDIDO', 'El archivo no está en el almacenamiento', HttpStatus.GONE);
    if (createHash('sha256').update(contenido).digest('hex') !== archivo.sha256) {
      throw new ErrorNegocio('ARCHIVO_ALTERADO', 'El contenido del archivo no coincide con su hash', HttpStatus.CONFLICT);
    }
    return { mime: archivo.mime, contenido, subidoPor: archivo.subidoPor };
  }
}
