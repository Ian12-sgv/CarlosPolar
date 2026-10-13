/**
 * Cliente de la API para la app. Guarda la URL del servidor y los tokens en
 * el almacenamiento seguro del teléfono y refresca la sesión automáticamente.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { Operacion, RespuestaTransporte } from './sincronizacion/cola';

export interface UsuarioSesion {
  id: string;
  username: string;
  nombre: string;
  roles: string[];
  permisos: string[];
  vendedorId: string | null;
}

export type OrigenApp = 'APP_PREVENTISTA' | 'APP_CHOFER';

export class ErrorApi extends Error {
  constructor(
    readonly estado: number,
    readonly codigo: string,
    mensaje: string,
    readonly detalles?: unknown,
  ) {
    super(mensaje);
  }
}

const CLAVES = { servidor: 'cp.servidor', refresh: 'cp.refresh', dispositivo: 'cp.dispositivo' };
const TIEMPO_MAXIMO_MS = 20_000;

let servidor = '';
let accessToken: string | null = null;
let origen: OrigenApp = 'APP_PREVENTISTA';

export async function cargarConfiguracion(): Promise<{ servidor: string; tieneSesion: boolean }> {
  servidor = (await SecureStore.getItemAsync(CLAVES.servidor)) ?? '';
  return { servidor, tieneSesion: Boolean(await SecureStore.getItemAsync(CLAVES.refresh)) };
}

export function definirOrigen(o: OrigenApp): void {
  origen = o;
}

/** El chofer usa la app como APP_CHOFER; el resto, como preventista. */
export function origenDe(usuario: UsuarioSesion): OrigenApp {
  return usuario.permisos.includes('entrega.registrar') && !usuario.permisos.includes('pedido.emitir') ? 'APP_CHOFER' : 'APP_PREVENTISTA';
}

async function identificadorDispositivo(): Promise<string> {
  let id = await SecureStore.getItemAsync(CLAVES.dispositivo);
  if (!id) {
    id = `${Platform.OS}-${Crypto.randomUUID()}`;
    await SecureStore.setItemAsync(CLAVES.dispositivo, id);
  }
  return id;
}

async function pedir(metodo: string, ruta: string, cuerpo?: unknown, cabeceras: Record<string, string> = {}): Promise<Response> {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), TIEMPO_MAXIMO_MS);
  try {
    return await fetch(`${servidor}${ruta}`, {
      method: metodo,
      signal: control.signal,
      headers: {
        'x-origen': origen,
        ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...cabeceras,
      },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  } finally {
    clearTimeout(temporizador);
  }
}

let refrescando: Promise<boolean> | null = null;

export function refrescarSesion(): Promise<boolean> {
  refrescando ??= (async () => {
    try {
      const refreshToken = await SecureStore.getItemAsync(CLAVES.refresh);
      if (!refreshToken) return false;
      const r = await pedir('POST', '/auth/refrescar', { refreshToken });
      if (r.status === 401) {
        await SecureStore.deleteItemAsync(CLAVES.refresh);
        return false;
      }
      if (!r.ok) return false;
      const tokens = (await r.json()) as { accessToken: string; refreshToken: string };
      accessToken = tokens.accessToken;
      await SecureStore.setItemAsync(CLAVES.refresh, tokens.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refrescando = null;
    }
  })();
  return refrescando;
}

/** Solicitud en línea (consultas). Lanza ErrorApi con el código de la API, o Error si no hay conexión. */
export async function api<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  let r = await pedir(metodo, ruta, cuerpo, metodo === 'GET' ? {} : { 'idempotency-key': Crypto.randomUUID() });
  if (r.status === 401 && (await refrescarSesion())) r = await pedir(metodo, ruta, cuerpo, metodo === 'GET' ? {} : { 'idempotency-key': Crypto.randomUUID() });
  if (r.status === 204) return undefined as T;
  const datos = (await r.json().catch(() => null)) as { codigo?: string; mensaje?: string; detalles?: unknown } | null;
  if (!r.ok) throw new ErrorApi(r.status, datos?.codigo ?? 'ERROR', datos?.mensaje ?? `Error ${r.status}`, datos?.detalles);
  return datos as T;
}

/** Transporte de la cola: misma clave de idempotencia en cada reintento y la hora original de la acción. */
export async function transporte(operacion: Operacion): Promise<RespuestaTransporte> {
  const cabeceras = { 'idempotency-key': operacion.claveIdempotencia, 'x-fecha-dispositivo': operacion.creadaEn };
  let r = await pedir('POST', operacion.ruta, operacion.cuerpo, cabeceras);
  if (r.status === 401 && (await refrescarSesion())) r = await pedir('POST', operacion.ruta, operacion.cuerpo, cabeceras);
  return { estado: r.status, cuerpo: await r.json().catch(() => null) };
}

export async function iniciarSesion(url: string, username: string, password: string): Promise<UsuarioSesion> {
  servidor = url.trim().replace(/\/+$/, '');
  await SecureStore.setItemAsync(CLAVES.servidor, servidor);
  const r = await api<{ accessToken: string; refreshToken: string; usuario: UsuarioSesion }>('POST', '/auth/iniciar-sesion', {
    username,
    password,
    dispositivo: { identificador: await identificadorDispositivo(), plataforma: Platform.OS === 'ios' ? 'ios' : 'android', nombre: `${Platform.OS} ${Platform.Version}` },
  });
  accessToken = r.accessToken;
  await SecureStore.setItemAsync(CLAVES.refresh, r.refreshToken);
  return r.usuario;
}

/** Recupera la sesión guardada. Sin conexión devuelve null, pero el refresh token se conserva. */
export async function restaurarSesion(): Promise<UsuarioSesion | null> {
  if (!(await refrescarSesion())) return null;
  return api<UsuarioSesion>('GET', '/auth/yo').catch(() => null);
}

export async function cerrarSesion(): Promise<void> {
  await api('POST', '/auth/cerrar-sesion').catch(() => undefined);
  accessToken = null;
  await SecureStore.deleteItemAsync(CLAVES.refresh);
}

export function textoError(error: unknown): string {
  if (error instanceof ErrorApi) {
    if (error.codigo === 'SOLICITUD_INVALIDA' && Array.isArray(error.detalles)) {
      return `${error.message}: ${(error.detalles as { campo: string; mensaje: string }[]).map((d) => `${d.campo} ${d.mensaje}`).join('; ')}`;
    }
    return error.message;
  }
  return 'Sin conexión con el servidor';
}
