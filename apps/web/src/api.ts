/**
 * Cliente HTTP de la API. Maneja la sesión (tokens), el refresco automático
 * cuando el token de acceso vence y el formato de error `{ codigo, mensaje }`.
 */

export interface UsuarioSesion {
  id: string;
  username: string;
  nombre: string;
  roles: string[];
  permisos: string[];
  vendedorId: string | null;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export class ErrorApi extends Error {
  constructor(
    readonly estado: number,
    readonly codigo: string,
    mensaje: string,
    readonly detalles?: unknown,
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

const CLAVE_REFRESH = 'cp.refresh';
const CLAVE_DISPOSITIVO = 'cp.dispositivo';

let accessToken: string | null = null;
let refrescando: Promise<boolean> | null = null;
let alExpirar: () => void = () => {};

/** El refresh token se guarda en el navegador; el de acceso vive solo en memoria. */
function guardar(tokens: Tokens | null): void {
  accessToken = tokens?.accessToken ?? null;
  try {
    if (tokens) localStorage.setItem(CLAVE_REFRESH, tokens.refreshToken);
    else localStorage.removeItem(CLAVE_REFRESH);
  } catch {
    // Sin almacenamiento (modo privado): la sesión dura lo que la pestaña.
  }
}

function leerRefresh(): string | null {
  try {
    return localStorage.getItem(CLAVE_REFRESH);
  } catch {
    return null;
  }
}

/** Identificador estable de este navegador, para el registro de dispositivos. */
export function identificadorDispositivo(): string {
  try {
    let id = localStorage.getItem(CLAVE_DISPOSITIVO);
    if (!id) {
      id = `web-${crypto.randomUUID()}`;
      localStorage.setItem(CLAVE_DISPOSITIVO, id);
    }
    return id;
  } catch {
    return `web-${crypto.randomUUID()}`;
  }
}

export function alExpirarSesion(fn: () => void): void {
  alExpirar = fn;
}

async function refrescar(): Promise<boolean> {
  const refreshToken = leerRefresh();
  if (!refreshToken) return false;
  refrescando ??= (async () => {
    try {
      const r = await fetch('/api/auth/refrescar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!r.ok) {
        guardar(null);
        return false;
      }
      guardar((await r.json()) as Tokens);
      return true;
    } finally {
      refrescando = null;
    }
  })();
  return refrescando;
}

export async function api<T>(metodo: string, ruta: string, cuerpo?: unknown, reintento = true): Promise<T> {
  const r = await fetch(`/api${ruta}`, {
    method: metodo,
    headers: {
      'x-origen': 'WEB',
      ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      // Cada mutación lleva su clave: un doble clic o un reintento no duplica la operación.
      ...(metodo !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  if (r.status === 401 && reintento && ruta !== '/auth/iniciar-sesion') {
    if (await refrescar()) return api<T>(metodo, ruta, cuerpo, false);
    alExpirar();
  }
  if (r.status === 204) return undefined as T;
  const datos = (await r.json().catch(() => null)) as { codigo?: string; mensaje?: string; detalles?: unknown } | null;
  if (!r.ok) {
    throw new ErrorApi(r.status, datos?.codigo ?? 'ERROR', datos?.mensaje ?? `Error ${r.status}`, datos?.detalles);
  }
  return datos as T;
}

/** Descarga binaria (firmas, evidencias) con la misma sesión y refresco que `api`. */
export async function descargar(ruta: string, reintento = true): Promise<Blob> {
  const r = await fetch(`/api${ruta}`, { headers: { 'x-origen': 'WEB', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) } });
  if (r.status === 401 && reintento && (await refrescar())) return descargar(ruta, false);
  if (!r.ok) throw new ErrorApi(r.status, 'ERROR', `Error ${r.status}`);
  return r.blob();
}

export const get = <T>(ruta: string) => api<T>('GET', ruta);
export const post = <T>(ruta: string, cuerpo: unknown = {}) => api<T>('POST', ruta, cuerpo);
export const patch = <T>(ruta: string, cuerpo: unknown) => api<T>('PATCH', ruta, cuerpo);

export async function iniciarSesion(username: string, password: string): Promise<UsuarioSesion> {
  const r = await api<Tokens & { usuario: UsuarioSesion }>('POST', '/auth/iniciar-sesion', {
    username,
    password,
    dispositivo: { identificador: identificadorDispositivo(), plataforma: 'web', nombre: navigator.userAgent.slice(0, 120) },
  });
  guardar(r);
  return r.usuario;
}

/** Recupera la sesión al recargar la página usando el refresh token guardado. */
export async function restaurarSesion(): Promise<UsuarioSesion | null> {
  if (!(await refrescar())) return null;
  return get<UsuarioSesion>('/auth/yo').catch(() => null);
}

export async function cerrarSesion(): Promise<void> {
  await api('POST', '/auth/cerrar-sesion').catch(() => undefined);
  guardar(null);
}

/** Texto legible para un error de la API, con los detalles de validación si los hay. */
export function textoError(error: unknown): string {
  if (!(error instanceof ErrorApi)) return 'No se pudo conectar con el servidor';
  if (error.codigo === 'SOLICITUD_INVALIDA' && Array.isArray(error.detalles)) {
    return `${error.message}: ${(error.detalles as { campo: string; mensaje: string }[]).map((d) => `${d.campo} ${d.mensaje}`).join('; ')}`;
  }
  return error.message;
}
