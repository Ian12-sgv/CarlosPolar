import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ColaSincronizacion, esperaReintento, type AlmacenCola, type Operacion, type RespuestaTransporte } from './cola';

class AlmacenMemoria implements AlmacenCola {
  filas = new Map<string, Operacion>();
  async agregar(o: Operacion) {
    this.filas.set(o.id, structuredClone(o));
  }
  async listar() {
    return [...this.filas.values()].map((o) => structuredClone(o));
  }
  async actualizar(o: Operacion) {
    this.filas.set(o.id, structuredClone(o));
  }
  async eliminar(id: string) {
    this.filas.delete(id);
  }
}

describe('cola de sincronización', () => {
  let almacen: AlmacenMemoria;
  let ahora: Date;
  let respuestas: (RespuestaTransporte | 'SIN_RED')[];
  let enviadas: Operacion[];
  let cola: ColaSincronizacion;

  beforeEach(() => {
    almacen = new AlmacenMemoria();
    ahora = new Date('2026-10-13T12:00:00Z');
    respuestas = [];
    enviadas = [];
    cola = new ColaSincronizacion(
      almacen,
      async (o) => {
        enviadas.push(o);
        const r = respuestas.shift() ?? { estado: 201, cuerpo: { ok: true } };
        if (r === 'SIN_RED') throw new Error('Network request failed');
        return r;
      },
      randomUUID,
      () => ahora,
    );
  });

  const avanzar = (ms: number) => {
    ahora = new Date(ahora.getTime() + ms);
  };

  it('guarda la operación con su clave de idempotencia y la hora del dispositivo', async () => {
    const o = await cola.encolar('PEDIDO', '/pedidos', { a: 1 }, 'Pedido');
    expect(o).toMatchObject({ estado: 'PENDIENTE', intentos: 0, creadaEn: '2026-10-13T12:00:00.000Z' });
    expect(o.claveIdempotencia).not.toBe(o.id);
  });

  it('envía en orden de creación y marca las aceptadas', async () => {
    await cola.encolar('PEDIDO', '/pedidos', 1, 'uno');
    avanzar(1);
    await cola.encolar('PAGO', '/pagos', 2, 'dos');
    const r = await cola.enviar();
    expect(r).toEqual({ aceptadas: 2, rechazadas: 0, pendientes: 0, detenidoPor: null });
    expect(enviadas.map((o) => o.descripcion)).toEqual(['uno', 'dos']);
    expect((await cola.listar()).every((o) => o.estado === 'ACEPTADA')).toBe(true);
  });

  it('sin red se detiene, conserva el orden y reintenta con la misma clave', async () => {
    const primera = await cola.encolar('ENTREGA', '/entregas', 1, 'uno');
    avanzar(1);
    await cola.encolar('ENTREGA', '/entregas', 2, 'dos');
    respuestas = ['SIN_RED'];
    expect(await cola.enviar()).toMatchObject({ aceptadas: 0, pendientes: 2, detenidoPor: 'SIN_CONEXION' });
    expect(enviadas).toHaveLength(1);

    // Antes de la espera no reintenta.
    avanzar(1_000);
    await cola.enviar();
    expect(enviadas).toHaveLength(1);

    avanzar(esperaReintento(1));
    expect(await cola.enviar()).toMatchObject({ aceptadas: 2, pendientes: 0 });
    expect(enviadas.map((o) => o.descripcion)).toEqual(['uno', 'uno', 'dos']);
    expect(enviadas[0]!.claveIdempotencia).toBe(primera.claveIdempotencia);
    expect(enviadas[1]!.claveIdempotencia).toBe(primera.claveIdempotencia);
  });

  it('un rechazo de negocio es definitivo y no bloquea las siguientes', async () => {
    await cola.encolar('PEDIDO', '/pedidos', 1, 'precio viejo');
    avanzar(1);
    await cola.encolar('PAGO', '/pagos', 2, 'pago');
    respuestas = [{ estado: 409, cuerpo: { codigo: 'PRECIO_CAMBIO', mensaje: 'Los precios cambiaron', detalles: [{ precioVigente: '3' }] } }];
    expect(await cola.enviar()).toMatchObject({ aceptadas: 1, rechazadas: 1 });
    const [pedido] = await cola.listar();
    expect(pedido).toMatchObject({ estado: 'RECHAZADA', error: { codigo: 'PRECIO_CAMBIO', detalles: [{ precioVigente: '3' }] } });
  });

  it('errores del servidor, sesión vencida o solicitud en proceso se reintentan', async () => {
    await cola.encolar('PEDIDO', '/pedidos', 1, 'uno');
    for (const r of [
      { estado: 503, cuerpo: null },
      { estado: 401, cuerpo: { codigo: 'NO_AUTENTICADO', mensaje: 'Sesión vencida' } },
      { estado: 409, cuerpo: { codigo: 'SOLICITUD_EN_PROCESO', mensaje: 'En proceso' } },
    ]) {
      respuestas = [r];
      const resumen = await cola.enviar({ ignorarEspera: true });
      expect(resumen.aceptadas).toBe(0);
      expect((await cola.listar())[0]!.estado).toBe('PENDIENTE');
    }
    expect(await cola.enviar({ ignorarEspera: true })).toMatchObject({ aceptadas: 1 });
  });

  it('la espera crece con los intentos hasta un máximo', () => {
    expect([1, 2, 3, 4].map(esperaReintento)).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(esperaReintento(20)).toBe(5 * 60_000);
  });

  it('dos envíos simultáneos no mandan la misma operación dos veces', async () => {
    await cola.encolar('PEDIDO', '/pedidos', 1, 'uno');
    await Promise.all([cola.enviar(), cola.enviar()]);
    expect(enviadas).toHaveLength(1);
  });

  it('solo se descartan operaciones ya resueltas', async () => {
    const o = await cola.encolar('PEDIDO', '/pedidos', 1, 'uno');
    await cola.descartar(o.id);
    expect(await cola.listar()).toHaveLength(1);
    respuestas = [{ estado: 422, cuerpo: { codigo: 'X', mensaje: 'x' } }];
    await cola.enviar();
    await cola.descartar(o.id);
    expect(await cola.listar()).toHaveLength(0);
  });
});
