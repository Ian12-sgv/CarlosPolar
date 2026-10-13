/**
 * Almacenamiento local en SQLite: la cola de operaciones pendientes y una
 * caché de datos descargados (clientes, catálogo, manifiestos) para trabajar
 * sin conexión.
 */
import * as SQLite from 'expo-sqlite';
import type { AlmacenCola, Operacion } from './sincronizacion/cola';

let conexion: Promise<SQLite.SQLiteDatabase> | null = null;

function db(): Promise<SQLite.SQLiteDatabase> {
  conexion ??= (async () => {
    const base = await SQLite.openDatabaseAsync('carlos-polar.db');
    await base.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS operaciones (id TEXT PRIMARY KEY NOT NULL, creada_en TEXT NOT NULL, datos TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cache (clave TEXT PRIMARY KEY NOT NULL, valor TEXT NOT NULL, actualizado_en TEXT NOT NULL);
    `);
    return base;
  })();
  return conexion;
}

export const almacenCola: AlmacenCola = {
  async agregar(o: Operacion) {
    await (await db()).runAsync('INSERT INTO operaciones (id, creada_en, datos) VALUES (?, ?, ?)', o.id, o.creadaEn, JSON.stringify(o));
  },
  async listar() {
    const filas = await (await db()).getAllAsync<{ datos: string }>('SELECT datos FROM operaciones ORDER BY creada_en');
    return filas.map((f) => JSON.parse(f.datos) as Operacion);
  },
  async actualizar(o: Operacion) {
    await (await db()).runAsync('UPDATE operaciones SET datos = ? WHERE id = ?', JSON.stringify(o), o.id);
  },
  async eliminar(id: string) {
    await (await db()).runAsync('DELETE FROM operaciones WHERE id = ?', id);
  },
};

export interface EntradaCache<T> {
  valor: T;
  actualizadoEn: string;
}

export async function leerCache<T>(clave: string): Promise<EntradaCache<T> | null> {
  const fila = await (await db()).getFirstAsync<{ valor: string; actualizado_en: string }>('SELECT valor, actualizado_en FROM cache WHERE clave = ?', clave);
  return fila ? { valor: JSON.parse(fila.valor) as T, actualizadoEn: fila.actualizado_en } : null;
}

export async function guardarCache(clave: string, valor: unknown): Promise<void> {
  await (await db()).runAsync(
    'INSERT INTO cache (clave, valor, actualizado_en) VALUES (?, ?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en',
    clave,
    JSON.stringify(valor),
    new Date().toISOString(),
  );
}

/** Al cerrar sesión se borra la caché (datos de clientes) pero nunca las operaciones sin enviar. */
export async function limpiarCache(): Promise<void> {
  await (await db()).runAsync('DELETE FROM cache');
}
