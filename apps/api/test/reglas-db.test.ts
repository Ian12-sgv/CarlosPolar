/**
 * Pruebas de las reglas de integridad de la base de datos (migración
 * 20261013000100_reglas_integridad). Cada prueba corre en una transacción que
 * se revierte al final.
 *
 * Requiere TEST_DATABASE_URL apuntando a una base con las migraciones
 * aplicadas. Sin esa variable, las pruebas se omiten.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;
const client = new pg.Client({ connectionString: url });

describe.skipIf(!url)('reglas de integridad en PostgreSQL', () => {
  let f: Awaited<ReturnType<typeof crearFixture>>;

  beforeAll(() => client.connect());
  afterAll(() => client.end());
  beforeEach(async () => {
    await client.query('BEGIN');
    f = await crearFixture();
  });
  afterEach(() => client.query('ROLLBACK'));

  const q = (sql: string, params: unknown[] = []) => client.query(sql, params);

  /** Ejecuta dentro de un savepoint y devuelve el mensaje de error, o null si no falló. */
  async function error(sql: string, params: unknown[] = []): Promise<string | null> {
    await q('SAVEPOINT p');
    try {
      await q(sql, params);
      await q('SET CONSTRAINTS ALL IMMEDIATE');
      await q('RELEASE SAVEPOINT p');
      return null;
    } catch (e) {
      await q('ROLLBACK TO SAVEPOINT p');
      return (e as Error).message;
    }
  }

  async function crearFixture() {
    const usuario = randomUUID();
    const vendedor = randomUUID();
    const cliente = randomUUID();
    const cliente2 = randomUUID();
    const producto = randomUUID();
    const lista = randomUUID();
    const almacen = randomUUID();
    const vehiculo = randomUUID();
    const ubVehiculo = randomUUID();
    const sufijo = usuario.slice(0, 8);

    await q(`INSERT INTO usuarios (id, username, nombre, password_hash) VALUES ($1, $2, 'Prueba', 'x')`, [usuario, `u${sufijo}`]);
    await q(`INSERT INTO vendedores (id, usuario_id, codigo) VALUES ($1, $2, $3)`, [vendedor, usuario, `V${sufijo}`]);
    await q(`INSERT INTO listas_precio (id, codigo, nombre, moneda) VALUES ($1, $2, 'General', 'USD')`, [lista, `L${sufijo}`]);
    for (const [id, doc] of [[cliente, '1'], [cliente2, '2']] as const) {
      await q(
        `INSERT INTO clientes (id, tipo_documento, nro_documento, razon_social, direccion, vendedor_id)
         VALUES ($1, 'J', $2, 'Cliente', 'Dirección', $3)`,
        [id, `${parseInt(sufijo, 16)}${doc}`, vendedor],
      );
    }
    await q(`INSERT INTO productos (id, sku, nombre, unidad) VALUES ($1, $2, 'Producto', 'UND')`, [producto, `P${sufijo}`]);
    await q(`INSERT INTO ubicaciones (id, codigo, nombre, tipo) VALUES ($1, $2, 'Almacén', 'ALMACEN')`, [almacen, `A${sufijo}`]);
    await q(`INSERT INTO vehiculos (id, placa) VALUES ($1, $2)`, [vehiculo, `X${sufijo}`]);
    await q(
      `INSERT INTO ubicaciones (id, codigo, nombre, tipo, vehiculo_id) VALUES ($1, $2, 'Camión', 'VEHICULO', $3)`,
      [ubVehiculo, `C${sufijo}`, vehiculo],
    );

    const fx = { usuario, vendedor, cliente, cliente2, producto, lista, almacen, vehiculo, ubVehiculo };
    return {
      ...fx,
      ingresar: (cantidad: number, ubicacion = almacen) =>
        q(
          `INSERT INTO movimientos_inventario (grupo_id, producto_id, ubicacion_id, tipo, cantidad_entrada,
             documento_origen_tipo, documento_origen_id, usuario_id)
           VALUES (gen_random_uuid(), $1, $2, 'INGRESO', $3, 'AJUSTE', gen_random_uuid(), $4)`,
          [producto, ubicacion, cantidad, usuario],
        ),
      factura: async (total = 100, clienteId = cliente) => {
        const id = randomUUID();
        await q(
          `INSERT INTO facturas (id, numero, cliente_id, cliente_tipo_documento, cliente_nro_documento,
             cliente_razon_social, cliente_direccion, vendedor_responsable_id, moneda, tasa_cambio,
             subtotal, impuesto, total, fecha_emision, fecha_vencimiento, emitida_por)
           VALUES ($1, $2, $3, 'J', '1', 'Cliente', 'Dirección', $4, 'USD', 1, $5, 0, $5, now(), current_date, $6)`,
          [id, `F${id.slice(0, 8)}`, clienteId, vendedor, total, usuario],
        );
        const item = randomUUID();
        await q(
          `INSERT INTO factura_items (id, factura_id, linea, producto_id, cantidad, precio_unitario,
             alicuota_iva, subtotal, impuesto, total)
           VALUES ($1, $2, 1, $3, 10, $4 / 10.0, 0, $4, 0, $4)`,
          [item, id, producto, total],
        );
        return { id, item };
      },
      pago: async (monto: number, referencia = randomUUID().replace(/\D/g, '').slice(0, 10)) => {
        const id = randomUUID();
        await q(
          `INSERT INTO pagos_recibidos (id, cliente_id, metodo_pago, entidad_origen, referencia_normalizada,
             moneda, monto_total, tasa_cambio, fecha_emision, creado_por)
           VALUES ($1, $2, 'TRANSFERENCIA', '0102', $3, 'USD', $4, 1, current_date, $5)`,
          [id, cliente, referencia, monto, usuario],
        );
        return id;
      },
      aplicar: (pago: string, factura: string, monto: number) =>
        error(
          `INSERT INTO pago_aplicaciones (pago_id, factura_id, monto_aplicado, monto_moneda_pago, tasa_cambio, creado_por)
           VALUES ($1, $2, $3, $3, 1, $4)`,
          [pago, factura, monto, usuario],
        ),
      /** Cada manifiesto en su propio vehículo: un vehículo solo admite un manifiesto abierto. */
      manifiesto: async (vehiculoId?: string) => {
        const id = randomUUID();
        const v = vehiculoId ?? randomUUID();
        if (!vehiculoId) await q(`INSERT INTO vehiculos (id, placa) VALUES ($1, $2)`, [v, `M${id.slice(0, 8)}`]);
        await q(
          `INSERT INTO manifiestos (id, numero, vehiculo_id, ubicacion_origen_id, chofer_id, despachador_id)
           VALUES ($1, $2, $3, $4, $5, $5)`,
          [id, `M${id.slice(0, 8)}`, v, almacen, usuario],
        );
        return id;
      },
    };
  }

  describe('pagos', () => {
    it('rechaza una referencia repetida para el mismo método y banco', async () => {
      await f.pago(50, '12345678');
      expect(
        await error(
          `INSERT INTO pagos_recibidos (cliente_id, metodo_pago, entidad_origen, referencia_normalizada,
             moneda, monto_total, tasa_cambio, fecha_emision, creado_por)
           VALUES ($1, 'TRANSFERENCIA', '0102', '12345678', 'USD', 10, 1, current_date, $2)`,
          [f.cliente, f.usuario],
        ),
      ).toMatch(/pagos_recibidos_referencia_unica/);
    });

    it('permite reutilizar la referencia de un pago anulado', async () => {
      const pago = await f.pago(50, '87654321');
      await q(`UPDATE pagos_recibidos SET estado = 'ANULADO' WHERE id = $1`, [pago]);
      await f.pago(50, '87654321');
    });

    it('no aplica más que el monto del pago', async () => {
      const a = await f.factura(100);
      const b = await f.factura(100);
      const pago = await f.pago(150);
      expect(await f.aplicar(pago, a.id, 100)).toBeNull();
      expect(await f.aplicar(pago, b.id, 60)).toMatch(/superan el monto del pago/);
      expect(await f.aplicar(pago, b.id, 50)).toBeNull();
    });

    it('no aplica más que el saldo de la factura, contando pagos por validar', async () => {
      const fac = await f.factura(100);
      expect(await f.aplicar(await f.pago(80), fac.id, 80)).toBeNull();
      expect(await f.aplicar(await f.pago(80), fac.id, 30)).toMatch(/supera el saldo/);
    });

    it('un pago rechazado libera el saldo de la factura', async () => {
      const fac = await f.factura(100);
      const pago = await f.pago(100);
      await f.aplicar(pago, fac.id, 100);
      await q(`UPDATE pagos_recibidos SET estado = 'RECHAZADO', motivo_rechazo = 'Sin fondos' WHERE id = $1`, [pago]);
      expect(await f.aplicar(await f.pago(100), fac.id, 100)).toBeNull();
    });

    it('no aplica un pago a la factura de otro cliente', async () => {
      const fac = await f.factura(100, f.cliente2);
      expect(await f.aplicar(await f.pago(100), fac.id, 10)).toMatch(/clientes distintos/);
    });

    it('el saldo oficial solo baja con pagos validados', async () => {
      const fac = await f.factura(100);
      const pago = await f.pago(40);
      await f.aplicar(pago, fac.id, 40);
      const saldo = async () =>
        (await q(`SELECT saldo, cobrado_por_validar, estado_cobro FROM bi.v_saldo_facturas WHERE factura_id = $1`, [fac.id]))
          .rows[0];
      expect(await saldo()).toEqual({ saldo: '100.00', cobrado_por_validar: '40.00', estado_cobro: 'PENDIENTE' });
      await q(`UPDATE pagos_recibidos SET estado = 'VALIDADO', validado_por = $2, validado_en = now() WHERE id = $1`, [
        pago,
        f.usuario,
      ]);
      expect(await saldo()).toEqual({ saldo: '60.00', cobrado_por_validar: '0', estado_cobro: 'PARCIAL' });
    });

    it('un pago no se valida sin registrar quién lo validó', async () => {
      const pago = await f.pago(10);
      expect(await error(`UPDATE pagos_recibidos SET estado = 'VALIDADO' WHERE id = $1`, [pago])).toMatch(
        /pagos_validacion_coherente/,
      );
    });

    it('los datos de origen de un pago no se modifican', async () => {
      const pago = await f.pago(10);
      expect(await error(`UPDATE pagos_recibidos SET monto_total = 1000 WHERE id = $1`, [pago])).toMatch(/no se modifican/);
    });
  });

  describe('facturas y documentos', () => {
    it('el contenido de una factura emitida es inmutable, pero su estado cambia', async () => {
      const fac = await f.factura(100);
      expect(await error(`UPDATE facturas SET total = 1 WHERE id = $1`, [fac.id])).toMatch(/no se modifica/);
      expect(await error(`UPDATE factura_items SET cantidad = 1 WHERE id = $1`, [fac.item])).toMatch(/inmutable/);
      expect(await error(`UPDATE facturas SET estado = 'DESPACHADA' WHERE id = $1`, [fac.id])).toBeNull();
    });

    it('el número de control se asigna una sola vez', async () => {
      const fac = await f.factura(100);
      expect(await error(`UPDATE facturas SET numero_control = '00-1' WHERE id = $1`, [fac.id])).toBeNull();
      expect(await error(`UPDATE facturas SET numero_control = '00-2' WHERE id = $1`, [fac.id])).toMatch(/ya fue asignado/);
    });

    it('una factura no se anula sin motivo', async () => {
      const fac = await f.factura(100);
      expect(await error(`UPDATE facturas SET estado = 'ANULADA' WHERE id = $1`, [fac.id])).toMatch(
        /facturas_anulacion_motivada/,
      );
    });

    it('no se borran facturas, pagos ni eventos', async () => {
      const fac = await f.factura(100);
      const pago = await f.pago(10);
      expect(await error(`DELETE FROM facturas WHERE id = $1`, [fac.id])).toMatch(/no admite borrado/);
      expect(await error(`DELETE FROM pagos_recibidos WHERE id = $1`, [pago])).toMatch(/no admite borrado/);
      await q(
        `INSERT INTO eventos_negocio (tipo_entidad, id_entidad, tipo_evento, usuario_id, origen)
         VALUES ('FACTURA', $1, 'FACTURA_EMITIDA', $2, 'WEB')`,
        [fac.id, f.usuario],
      );
      expect(await error(`DELETE FROM eventos_negocio WHERE id_entidad = $1`, [fac.id])).toMatch(/inmutable/);
      expect(await error(`UPDATE eventos_negocio SET tipo_evento = 'X' WHERE id_entidad = $1`, [fac.id])).toMatch(
        /inmutable/,
      );
    });

    it('las vigencias de precio no se solapan', async () => {
      const insertar = (desde: string, hasta: string | null) =>
        error(
          `INSERT INTO precios_producto (lista_precio_id, producto_id, precio, vigente_desde, vigente_hasta, creado_por)
           VALUES ($1, $2, 10, $3, $4, $5)`,
          [f.lista, f.producto, desde, hasta, f.usuario],
        );
      expect(await insertar('2026-01-01', '2026-02-01')).toBeNull();
      expect(await insertar('2026-02-01', null)).toBeNull();
      expect(await insertar('2026-01-15', '2026-01-20')).toMatch(/precios_producto_vigencia_sin_solape/);
    });
  });

  describe('inventario', () => {
    const existencia = async () =>
      (
        await q(
          `SELECT cantidad_fisica, cantidad_reservada FROM existencias WHERE producto_id = $1 AND ubicacion_id = $2`,
          [f.producto, f.almacen],
        )
      ).rows[0];

    it('las existencias se derivan del libro de movimientos', async () => {
      await f.ingresar(100);
      await f.ingresar(20);
      expect(await existencia()).toEqual({ cantidad_fisica: '120.000', cantidad_reservada: '0.000' });
      const diferencia = await q(
        `SELECT diferencia_cache FROM bi.v_existencias WHERE producto_id = $1 AND ubicacion_id = $2`,
        [f.producto, f.almacen],
      );
      expect(diferencia.rows[0].diferencia_cache).toBe('0.000');
    });

    it('los movimientos no se editan ni se borran', async () => {
      await f.ingresar(100);
      expect(await error(`UPDATE movimientos_inventario SET cantidad_entrada = 1 WHERE producto_id = $1`, [f.producto])).toMatch(
        /inmutable/,
      );
      expect(await error(`DELETE FROM movimientos_inventario WHERE producto_id = $1`, [f.producto])).toMatch(/inmutable/);
    });

    it('una salida con stock suficiente descuenta la existencia', async () => {
      await f.ingresar(10);
      expect(
        await error(
          `INSERT INTO movimientos_inventario (grupo_id, producto_id, ubicacion_id, tipo, cantidad_salida,
             documento_origen_tipo, documento_origen_id, usuario_id)
           VALUES (gen_random_uuid(), $1, $2, 'AJUSTE', 4, 'AJUSTE', gen_random_uuid(), $3)`,
          [f.producto, f.almacen, f.usuario],
        ),
      ).toBeNull();
      expect(await existencia()).toEqual({ cantidad_fisica: '6.000', cantidad_reservada: '0.000' });
    });

    it('el stock físico no queda negativo', async () => {
      await f.ingresar(10);
      expect(
        await error(
          `INSERT INTO movimientos_inventario (grupo_id, producto_id, ubicacion_id, tipo, cantidad_salida,
             documento_origen_tipo, documento_origen_id, usuario_id)
           VALUES (gen_random_uuid(), $1, $2, 'AJUSTE', 11, 'AJUSTE', gen_random_uuid(), $3)`,
          [f.producto, f.almacen, f.usuario],
        ),
      ).toMatch(/existencias_fisica_no_negativa/);
    });

    it('no se reserva más que el stock físico', async () => {
      await f.ingresar(80);
      const pedido = randomUUID();
      const item = randomUUID();
      await q(
        `INSERT INTO pedidos (id, numero, cliente_id, vendedor_responsable_id, lista_precio_id, moneda,
           subtotal, impuesto, total, fecha_emision, creado_por)
         VALUES ($1, $2, $3, $4, $5, 'USD', 0, 0, 0, now(), $6)`,
        [pedido, `P${pedido.slice(0, 8)}`, f.cliente, f.vendedor, f.lista, f.usuario],
      );
      await q(
        `INSERT INTO pedido_items (id, pedido_id, linea, producto_id, cantidad, precio_ofertado, alicuota_iva)
         VALUES ($1, $2, 1, $3, 100, 1, 0)`,
        [item, pedido, f.producto],
      );
      const reservar = (cantidad: number) =>
        error(
          `INSERT INTO reservas_inventario (producto_id, ubicacion_id, pedido_item_id, cantidad, vence_en)
           VALUES ($1, $2, $3, $4, now() + interval '1 day')`,
          [f.producto, f.almacen, item, cantidad],
        );
      expect(await reservar(100)).toMatch(/stock insuficiente/);
      expect(await reservar(80)).toBeNull();
      expect(await existencia()).toEqual({ cantidad_fisica: '80.000', cantidad_reservada: '80.000' });
    });
  });

  it('todas las vistas del esquema bi responden', async () => {
    const vistas = (await q(`SELECT table_name FROM information_schema.views WHERE table_schema = 'bi' ORDER BY 1`)).rows.map((r) => r.table_name as string);
    expect(vistas.length).toBeGreaterThanOrEqual(17);
    for (const v of vistas) expect(await error(`SELECT * FROM bi.${v} LIMIT 1`)).toBeNull();
  });

  describe('despacho y entrega', () => {
    const agregar = (manifiesto: string, factura: string) =>
      error(`INSERT INTO manifiesto_facturas (manifiesto_id, factura_id) VALUES ($1, $2)`, [manifiesto, factura]);
    const cargar = (manifiesto: string, item: string, cantidad: number) =>
      error(`INSERT INTO manifiesto_items (manifiesto_id, factura_item_id, cantidad_cargada) VALUES ($1, $2, $3)`, [
        manifiesto,
        item,
        cantidad,
      ]);

    it('una factura no está en dos manifiestos activos', async () => {
      const fac = await f.factura();
      expect(await agregar(await f.manifiesto(), fac.id)).toBeNull();
      expect(await agregar(await f.manifiesto(), fac.id)).toMatch(/manifiesto_facturas_factura_activa_unica/);
    });

    it('una factura retornada puede ir en otro manifiesto', async () => {
      const fac = await f.factura();
      const m1 = await f.manifiesto();
      await agregar(m1, fac.id);
      await q(`UPDATE manifiestos SET estado = 'EN_RUTA' WHERE id = $1`, [m1]);
      expect(
        await error(`UPDATE manifiesto_facturas SET activa = false WHERE manifiesto_id = $1`, [m1]),
      ).toBeNull();
      expect(await agregar(await f.manifiesto(), fac.id)).toBeNull();
    });

    it('un vehículo no tiene dos manifiestos abiertos', async () => {
      await f.manifiesto(f.vehiculo);
      expect(await error(`SELECT 1`)).toBeNull();
      await q('SAVEPOINT v');
      await expect(f.manifiesto(f.vehiculo)).rejects.toThrow(/manifiestos_vehiculo_abierto_unico/);
      await q('ROLLBACK TO SAVEPOINT v');
    });

    it('un borrador admite quitar facturas; un manifiesto confirmado no', async () => {
      const fac = await f.factura();
      const m = await f.manifiesto();
      await agregar(m, fac.id);
      await cargar(m, fac.item, 10);
      expect(await error(`DELETE FROM manifiesto_items WHERE manifiesto_id = $1`, [m])).toBeNull();
      await cargar(m, fac.item, 10);
      await q(`UPDATE manifiestos SET estado = 'CONFIRMADO' WHERE id = $1`, [m]);
      expect(await error(`DELETE FROM manifiesto_items WHERE manifiesto_id = $1`, [m])).toMatch(/no admite borrados/);
    });

    it('lo cargado no supera lo facturado ni se carga una factura ajena al manifiesto', async () => {
      const fac = await f.factura();
      const m = await f.manifiesto();
      expect(await cargar(m, fac.item, 5)).toMatch(/no pertenece/);
      await agregar(m, fac.id);
      expect(await cargar(m, fac.item, 11)).toMatch(/supera la facturada/);
      expect(await cargar(m, fac.item, 10)).toBeNull();
    });

    it('un manifiesto confirmado no se modifica', async () => {
      const fac = await f.factura();
      const m = await f.manifiesto();
      await agregar(m, fac.id);
      await q(`UPDATE manifiestos SET estado = 'CONFIRMADO' WHERE id = $1`, [m]);
      expect(await cargar(m, fac.item, 10)).toMatch(/no se modifica/);
    });

    it('una factura no se entrega dos veces', async () => {
      const fac = await f.factura();
      const m = await f.manifiesto();
      await agregar(m, fac.id);
      await cargar(m, fac.item, 10);
      const entregar = () =>
        error(
          `INSERT INTO entregas (factura_id, manifiesto_id, chofer_id, estado, fecha_hora, receptor_nombre)
           VALUES ($1, $2, $3, 'CONFIRMADA', now(), 'Receptor')`,
          [fac.id, m, f.usuario],
        );
      expect(await entregar()).toBeNull();
      expect(await entregar()).toMatch(/entregas_factura_confirmada_unica/);
    });

    it('lo entregado no supera lo cargado', async () => {
      const fac = await f.factura();
      const m = await f.manifiesto();
      await agregar(m, fac.id);
      await cargar(m, fac.item, 8);
      const entrega = randomUUID();
      await q(
        `INSERT INTO entregas (id, factura_id, manifiesto_id, chofer_id, estado, fecha_hora, receptor_nombre)
         VALUES ($1, $2, $3, $4, 'CONFIRMADA', now(), 'Receptor')`,
        [entrega, fac.id, m, f.usuario],
      );
      expect(
        await error(
          `INSERT INTO entrega_items (entrega_id, factura_item_id, cantidad_entregada) VALUES ($1, $2, 9)`,
          [entrega, fac.item],
        ),
      ).toMatch(/supera lo cargado/);
    });
  });
});
