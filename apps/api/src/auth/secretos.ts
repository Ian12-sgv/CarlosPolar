import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } satisfies ScryptOptions;
const LARGO = 64;

function derivar(password: string, sal: Buffer, opciones: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), sal, LARGO, opciones, (err, clave) => (err ? reject(err) : resolve(clave))),
  );
}

/** Formato: `scrypt$N$r$p$sal$hash` (base64url), para poder subir el costo sin invalidar contraseñas existentes. */
export async function hashContrasena(password: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await derivar(password, sal, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, sal.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function verificarContrasena(password: string, almacenado: string): Promise<boolean> {
  const [algoritmo, N, r, p, sal, hash] = almacenado.split('$');
  if (algoritmo !== 'scrypt' || !sal || !hash) return false;
  const esperado = Buffer.from(hash, 'base64url');
  const calculado = await derivar(password, Buffer.from(sal, 'base64url'), {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  });
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

/** Hash de referencia para comparar cuando el usuario no existe y no revelar por el tiempo de respuesta si existe. */
export const HASH_FICTICIO = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86);

/** Token opaco aleatorio (256 bits). Solo se guarda su hash. */
export function generarToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
