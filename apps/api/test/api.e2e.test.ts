/**
 * Pruebas de punta a punta de la API contra PostgreSQL real.
 * Requiere TEST_DATABASE_URL con las migraciones aplicadas; si no, se omiten.
 * Cada ejecución crea sus propios datos con un sufijo aleatorio.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Prisma } from '../src/generated/prisma/client.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
// Fuente de tasa propia de esta ejecución, para probar "sin tasa" aunque la base se reutilice.
const FUENTE_TASA = `T${randomUUID().slice(0, 8).toUpperCase()}`;
process.env.FUENTE_TASA = FUENTE_TASA;
process.env.STORAGE_DIR = join(tmpdir(), `cp-storage-${randomUUID().slice(0, 8)}`);

type Respuesta = { statusCode: number; json: () => any };

describe.skipIf(!url)('API', () => {
  let app: NestFastifyApplication;
  let prisma: Awaited<ReturnType<typeof import('../src/prisma/conexion.js')['crearPrisma']>>;
  const sufijo = randomUUID().slice(0, 8);
  const PASSWORD = 'clave-de-prueba-123';
  const f = {} as {
    preventista: string;
    ventas: string;
    admin: string;
    facturacion: string;
    administracion: string;
    vendedorId: string;
    otroVendedorId: string;
    cliente: string;
    clienteAjeno: string;
    clienteMoroso: string;
    lista: string;
    productoA: string;
    productoB: string;
    productoC: string;
    productoD: string;
    almacen: string;
  };

  async function pedir(
    metodo: 'GET' | 'POST' | 'PATCH',
    ruta: string,
    opciones: { token?: string; body?: unknown; cabeceras?: Record<string, string> } = {},
  ): Promise<Respuesta> {
    return app.getHttpAdapter().getInstance().inject({
      method: metodo,
      url: ruta,
      payload: opciones.body as object,
      headers: {
        ...(opciones.token ? { authorization: `Bearer ${opciones.token}` } : {}),
        ...opciones.cabeceras,
      },
    }) as unknown as Promise<Respuesta>;
  }

  async function login(username: string, dispositivo = `disp-${username}`, origen = 'WEB') {
    const r = await pedir('POST', '/auth/iniciar-sesion', {
      body: { username, password: PASSWORD, dispositivo: { identificador: dispositivo, plataforma: 'android' } },
      cabeceras: { 'x-origen': origen },
    });
    expect(r.statusCode, JSON.stringify(r.json())).toBe(200);
    return r.json() as { accessToken: string; refreshToken: string; usuario: { permisos: string[] } };
  }

  const movil = (token: string, clave: string = randomUUID()) => ({
    token,
    cabeceras: { 'x-origen': 'APP_PREVENTISTA', 'idempotency-key': clave },
  });

  async function emitir(
    token: string,
    items: { productoId: string; cantidad: number; precioOfertado?: number }[] = [{ productoId: f.productoA, cantidad: 10 }],
    extra: object = {},
  ) {
    return pedir('POST', '/pedidos', { ...movil(token), body: { clienteId: f.cliente, items, ...extra } });
  }

  async function ingresar(productoId: string, cantidad: number) {
    await prisma.movimientoInventario.create({
      data: {
        grupoId: randomUUID(),
        productoId,
        ubicacionId: f.almacen,
        tipo: 'INGRESO',
        cantidadEntrada: cantidad,
        documentoOrigenTipo: 'AJUSTE',
        documentoOrigenId: randomUUID(),
        usuarioId: randomUUID(),
      },
    });
  }

  const reservado = async (productoId: string) =>
    (await prisma.existencia.findFirst({ where: { productoId, ubicacionId: f.almacen } }))?.cantidadReservada.toString();

  /** Emite (preventista) y aprueba (ventas) un pedido; devuelve el pedido en versión 2. */
  async function pedidoAprobado(items: { productoId: string; cantidad: number }[], aceptarFaltantes = false) {
    const s = await login(f.preventista);
    const v = await login(f.ventas);
    const { pedido } = (await emitir(s.accessToken, items)).json();
    const r = await pedir('POST', `/pedidos/${pedido.id}/aprobar`, { token: v.accessToken, body: { version: 1, aceptarFaltantes } });
    expect(r.statusCode, JSON.stringify(r.json())).toBe(200);
    return r.json().pedido as { id: string; version: number; items: { id: string; productoId: string }[] };
  }

  beforeAll(async () => {
    const { crearPrisma } = await import('../src/prisma/conexion.js');
    const { sembrarCatalogos } = await import('../src/prisma/catalogos.js');
    const { crearUsuario } = await import('../src/usuarios/crear-usuario.js');
    const { crearApp } = await import('../src/app.js');

    prisma = crearPrisma(url);
    await sembrarCatalogos(prisma);

    const crear = (nombre: string, roles: string[], codigoVendedor?: string) =>
      crearUsuario(prisma, { username: `${nombre}-${sufijo}`, nombre, password: PASSWORD, roles, codigoVendedor });
    const preventista = await crear('preventista', ['PREVENTISTA'], `V-${sufijo}`);
    const otro = await crear('otro', ['PREVENTISTA'], `W-${sufijo}`);
    await crear('ventas', ['VENTAS']);
    await crear('admin', ['ADMIN']);
    await crear('facturacion', ['FACTURACION']);
    await crear('administracion', ['ADMINISTRACION']);
    f.facturacion = `facturacion-${sufijo}`;
    f.administracion = `administracion-${sufijo}`;
    f.preventista = `preventista-${sufijo}`;
    f.ventas = `ventas-${sufijo}`;
    f.admin = `admin-${sufijo}`;
    f.vendedorId = preventista.vendedor!.id;
    f.otroVendedorId = otro.vendedor!.id;

    const lista = await prisma.listaPrecio.create({ data: { codigo: `L-${sufijo}`, nombre: 'General', moneda: 'USD' } });
    f.lista = lista.id;
    const nuevoCliente = async (doc: string, vendedorId: string) =>
      (
        await prisma.cliente.create({
          data: {
            tipoDocumento: 'J',
            nroDocumento: `${parseInt(sufijo, 16)}${doc}`,
            razonSocial: `Cliente ${doc}`,
            direccion: 'Calle 1',
            vendedorId,
            listaPrecioId: lista.id,
            limiteCredito: 10_000,
          },
        })
      ).id;
    f.cliente = await nuevoCliente('1', f.vendedorId);
    f.clienteAjeno = await nuevoCliente('2', f.otroVendedorId);
    f.clienteMoroso = await nuevoCliente('3', f.vendedorId);

    const nuevoProducto = async (sku: string, precio: number) => {
      const p = await prisma.producto.create({ data: { sku: `${sku}-${sufijo}`, nombre: sku, unidad: 'UND', alicuotaIva: 16 } });
      await prisma.precioProducto.create({
        data: { listaPrecioId: lista.id, productoId: p.id, precio, vigenteDesde: new Date(Date.now() - 86_400_000), creadoPor: p.id },
      });
      return p.id;
    };
    f.productoA = await nuevoProducto('A', 2.5);
    f.productoB = await nuevoProducto('B', 10);
    f.productoC = await nuevoProducto('C', 4);
    f.productoD = await nuevoProducto('D', 10);
    f.almacen = (await prisma.ubicacion.findUniqueOrThrow({ where: { codigo: 'ALM-PRINCIPAL' } })).id;
    await ingresar(f.productoA, 1000);
    await ingresar(f.productoB, 5);
    await ingresar(f.productoC, 3);
    await ingresar(f.productoD, 100);

    // Factura vencida para el cliente moroso.
    await prisma.factura.create({
      data: {
        numero: `F-${sufijo}`,
        clienteId: f.clienteMoroso,
        clienteTipoDocumento: 'J',
        clienteNroDocumento: '1',
        clienteRazonSocial: 'Cliente 3',
        clienteDireccion: 'Calle 1',
        vendedorResponsableId: f.vendedorId,
        moneda: 'USD',
        tasaCambio: 1,
        subtotal: 50,
        impuesto: 0,
        total: 50,
        fechaEmision: new Date(Date.now() - 40 * 86_400_000),
        fechaVencimiento: new Date(Date.now() - 10 * 86_400_000),
        emitidaPor: preventista.id,
      },
    });

    app = await crearApp({ logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('autenticación', () => {
    it('inicia sesión y devuelve permisos del rol', async () => {
      const s = await login(f.preventista);
      expect(s.usuario.permisos).toEqual(['cliente.ver', 'pago.registrar', 'pedido.emitir', 'visita.registrar']);
      const yo = await pedir('GET', '/auth/yo', { token: s.accessToken });
      expect(yo.json()).toMatchObject({ username: f.preventista, vendedorId: f.vendedorId });
    });

    it('rechaza contraseña incorrecta y deja rastro en auditoría', async () => {
      const r = await pedir('POST', '/auth/iniciar-sesion', {
        body: { username: f.preventista, password: 'mala', dispositivo: { identificador: 'xxxxxxxx', plataforma: 'web' } },
      });
      expect(r.statusCode).toBe(401);
      expect(r.json().codigo).toBe('CREDENCIALES_INVALIDAS');
      expect(await prisma.auditoria.count({ where: { accion: 'sesion.fallida', datosDespues: { path: ['username'], equals: f.preventista } } })).toBeGreaterThan(0);
    });

    it('el chequeo de salud es público', async () => {
      expect((await pedir('GET', '/salud')).json()).toEqual({ estado: 'ok', baseDatos: 'ok' });
    });

    it('sin token responde 401', async () => {
      expect((await pedir('GET', '/pedidos')).statusCode).toBe(401);
    });

    it('refrescar rota los tokens: el refresh anterior deja de servir', async () => {
      const s = await login(f.preventista);
      const r1 = await pedir('POST', '/auth/refrescar', { body: { refreshToken: s.refreshToken } });
      expect(r1.statusCode).toBe(200);
      expect((await pedir('GET', '/auth/yo', { token: s.accessToken })).statusCode).toBe(401);
      expect((await pedir('GET', '/auth/yo', { token: r1.json().accessToken })).statusCode).toBe(200);
      expect((await pedir('POST', '/auth/refrescar', { body: { refreshToken: s.refreshToken } })).statusCode).toBe(401);
    });

    it('cerrar sesión invalida el token de inmediato', async () => {
      const s = await login(f.preventista);
      expect((await pedir('POST', '/auth/cerrar-sesion', { token: s.accessToken })).statusCode).toBe(204);
      expect((await pedir('GET', '/auth/yo', { token: s.accessToken })).statusCode).toBe(401);
    });

    it('revocar un dispositivo corta sus sesiones y bloquea nuevos inicios desde él', async () => {
      const dispositivo = `tel-${randomUUID()}`;
      const s = await login(f.preventista, dispositivo);
      const admin = await login(f.admin);
      const d = await prisma.dispositivo.findFirstOrThrow({ where: { identificador: dispositivo } });
      expect((await pedir('POST', `/dispositivos/${d.id}/revocar`, { token: admin.accessToken })).statusCode).toBe(204);
      expect((await pedir('GET', '/auth/yo', { token: s.accessToken })).statusCode).toBe(401);
      const r = await pedir('POST', '/auth/iniciar-sesion', {
        body: { username: f.preventista, password: PASSWORD, dispositivo: { identificador: dispositivo, plataforma: 'android' } },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().codigo).toBe('DISPOSITIVO_REVOCADO');
    });

    it('exige permisos por acción', async () => {
      const s = await login(f.preventista);
      const r = await pedir('POST', `/pedidos/${randomUUID()}/aprobar`, { token: s.accessToken, body: { version: 1 } });
      expect(r.statusCode).toBe(403);
      expect(r.json()).toMatchObject({ codigo: 'SIN_PERMISO', detalles: { faltantes: ['pedido.aprobar'] } });
    });
  });

  describe('idempotencia y sincronización', () => {
    it('la app móvil debe enviar Idempotency-Key', async () => {
      const s = await login(f.preventista);
      const r = await pedir('POST', '/pedidos', {
        token: s.accessToken,
        cabeceras: { 'x-origen': 'APP_PREVENTISTA' },
        body: { clienteId: f.cliente, items: [{ productoId: f.productoA, cantidad: 1 }] },
      });
      expect(r.statusCode).toBe(400);
      expect(r.json().codigo).toBe('FALTA_IDEMPOTENCY_KEY');
    });

    it('reenviar con la misma clave devuelve la misma respuesta sin duplicar el pedido', async () => {
      const s = await login(f.preventista);
      const clave = randomUUID();
      const body = { clienteId: f.cliente, items: [{ productoId: f.productoA, cantidad: 3 }] };
      const r1 = await pedir('POST', '/pedidos', { ...movil(s.accessToken, clave), body });
      const r2 = await pedir('POST', '/pedidos', { ...movil(s.accessToken, clave), body });
      expect(r1.statusCode).toBe(201);
      expect(r2.statusCode).toBe(201);
      expect(r2.json().pedido.id).toBe(r1.json().pedido.id);
      expect(await prisma.pedido.count({ where: { id: r1.json().pedido.id } })).toBe(1);
      await new Promise((r) => setTimeout(r, 100));
      const registros = await prisma.sincronizacionRegistro.findMany({ where: { claveIdempotencia: clave }, orderBy: { recibidoEn: 'asc' } });
      expect(registros.map((x) => x.resultado)).toEqual(['ACEPTADO', 'DUPLICADO']);
    });

    it('reutilizar la clave con otro contenido se rechaza', async () => {
      const s = await login(f.preventista);
      const clave = randomUUID();
      await pedir('POST', '/pedidos', { ...movil(s.accessToken, clave), body: { clienteId: f.cliente, items: [{ productoId: f.productoA, cantidad: 1 }] } });
      const r = await pedir('POST', '/pedidos', { ...movil(s.accessToken, clave), body: { clienteId: f.cliente, items: [{ productoId: f.productoA, cantidad: 2 }] } });
      expect(r.statusCode).toBe(422);
      expect(r.json().codigo).toBe('IDEMPOTENCY_KEY_REUTILIZADA');
    });

    it('un rechazo de negocio se guarda y el reenvío recibe el mismo rechazo', async () => {
      const s = await login(f.preventista);
      const clave = randomUUID();
      const body = { clienteId: f.cliente, items: [{ productoId: f.productoA, cantidad: 1, precioOfertado: 1 }] };
      const r1 = await pedir('POST', '/pedidos', { ...movil(s.accessToken, clave), body });
      const r2 = await pedir('POST', '/pedidos', { ...movil(s.accessToken, clave), body });
      expect([r1.statusCode, r2.statusCode]).toEqual([409, 409]);
      expect(r2.json()).toEqual(r1.json());
    });

    it('reenviar el mismo pedido (mismo id) con otra clave no lo duplica', async () => {
      const s = await login(f.preventista);
      const id = randomUUID();
      const r1 = await emitir(s.accessToken, undefined, { id });
      const r2 = await emitir(s.accessToken, undefined, { id });
      expect(r1.statusCode).toBe(201);
      expect(r2.json().pedido.numero).toBe(r1.json().pedido.numero);
    });
  });

  describe('pedidos', () => {
    it('emite con precio vigente, totales, número y evento', async () => {
      const s = await login(f.preventista);
      const r = await emitir(s.accessToken, [
        { productoId: f.productoA, cantidad: 10 },
        { productoId: f.productoB, cantidad: 1.5 },
      ]);
      expect(r.statusCode, JSON.stringify(r.json())).toBe(201);
      const { pedido, advertencias } = r.json();
      expect(pedido).toMatchObject({ estado: 'EMITIDO', subtotal: '40', impuesto: '6.4', total: '46.4', moneda: 'USD', version: 1 });
      expect(pedido.numero).toMatch(/^PED-\d{8}$/);
      expect(pedido.vendedorResponsableId).toBe(f.vendedorId);
      expect(advertencias).toEqual([]);
      const eventos = await prisma.eventoNegocio.findMany({ where: { idEntidad: pedido.id } });
      expect(eventos).toMatchObject([{ tipoEvento: 'PEDIDO_EMITIDO', origen: 'APP_PREVENTISTA', estadoNuevo: 'EMITIDO' }]);
    });

    it('las fechas que escribe la API coinciden con el reloj de la base de datos', async () => {
      const s = await login(f.preventista);
      const { pedido } = (await emitir(s.accessToken)).json();
      const [fila] = await prisma.$queryRaw<{ desfase: number }[]>`
        SELECT abs(extract(epoch FROM now() - creado_en))::int AS desfase FROM pedidos WHERE id = ${pedido.id}::uuid`;
      expect(fila!.desfase).toBeLessThan(60);
    });

    it('advierte stock insuficiente sin bloquear la emisión', async () => {
      const s = await login(f.preventista);
      const r = await emitir(s.accessToken, [{ productoId: f.productoB, cantidad: 50 }]);
      expect(r.statusCode).toBe(201);
      expect(r.json().advertencias).toMatchObject([{ codigo: 'STOCK_INSUFICIENTE', productoId: f.productoB }]);
    });

    it('rechaza si el precio cambió y devuelve el vigente', async () => {
      const s = await login(f.preventista);
      const r = await emitir(s.accessToken, [{ productoId: f.productoA, cantidad: 1, precioOfertado: 2 }]);
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ codigo: 'PRECIO_CAMBIO', detalles: [{ productoId: f.productoA, precioVigente: '2.5' }] });
    });

    it('un preventista no puede vender a un cliente de otra cartera', async () => {
      const s = await login(f.preventista);
      const r = await pedir('POST', '/pedidos', { ...movil(s.accessToken), body: { clienteId: f.clienteAjeno, items: [{ productoId: f.productoA, cantidad: 1 }] } });
      expect(r.statusCode).toBe(404);
    });

    it('valida la solicitud con el contrato compartido', async () => {
      const s = await login(f.preventista);
      const r = await emitir(s.accessToken, [
        { productoId: f.productoA, cantidad: 1 },
        { productoId: f.productoA, cantidad: 2 },
      ]);
      expect(r.statusCode).toBe(400);
      expect(r.json().codigo).toBe('SOLICITUD_INVALIDA');
    });

    it('aprobar reserva inventario y el catálogo refleja el disponible', async () => {
      const s = await login(f.preventista);
      const v = await login(f.ventas);
      const antes = Number(await reservado(f.productoA));
      const { pedido } = (await emitir(s.accessToken, [{ productoId: f.productoA, cantidad: 25 }])).json();
      const r = await pedir('POST', `/pedidos/${pedido.id}/aprobar`, { token: v.accessToken, body: { version: 1 } });
      expect(r.statusCode, JSON.stringify(r.json())).toBe(200);
      expect(r.json().pedido).toMatchObject({ estado: 'APROBADO', version: 2 });
      expect(r.json().pedido.items[0].reservas).toHaveLength(1);
      expect(Number(await reservado(f.productoA))).toBe(antes + 25);

      const catalogo = await pedir('GET', `/catalogo?clienteId=${f.cliente}`, { token: s.accessToken });
      const a = catalogo.json().productos.find((p: { id: string }) => p.id === f.productoA);
      expect(Number(a.disponible)).toBe(1000 - antes - 25);

      const eventos = await prisma.eventoNegocio.findMany({ where: { OR: [{ idEntidad: pedido.id }, { datos: { path: ['pedidoId'], equals: pedido.id } }] } });
      expect(eventos.map((e) => e.tipoEvento).sort()).toEqual(['PEDIDO_APROBADO', 'PEDIDO_EMITIDO', 'RESERVA_CREADA']);
    });

    it('no aprueba si falta stock, salvo que se acepten faltantes', async () => {
      const s = await login(f.preventista);
      const v = await login(f.ventas);
      const { pedido } = (await emitir(s.accessToken, [{ productoId: f.productoB, cantidad: 8 }])).json();
      const r1 = await pedir('POST', `/pedidos/${pedido.id}/aprobar`, { token: v.accessToken, body: { version: 1 } });
      expect(r1.statusCode).toBe(409);
      expect(r1.json()).toMatchObject({ codigo: 'STOCK_INSUFICIENTE', detalles: [{ productoId: f.productoB, solicitado: '8' }] });
      const r2 = await pedir('POST', `/pedidos/${pedido.id}/aprobar`, { token: v.accessToken, body: { version: 1, aceptarFaltantes: true } });
      expect(r2.statusCode).toBe(200);
      expect(r2.json().pedido.items[0].reservas[0].cantidad).toBe(r2.json().faltantes[0].disponible);
    });

    it('rechaza una versión desactualizada', async () => {
      const s = await login(f.preventista);
      const v = await login(f.ventas);
      const { pedido } = (await emitir(s.accessToken)).json();
      await pedir('POST', `/pedidos/${pedido.id}/aprobar`, { token: v.accessToken, body: { version: 1 } });
      const r = await pedir('POST', `/pedidos/${pedido.id}/cancelar`, { token: v.accessToken, body: { version: 1, motivo: 'Cliente desiste' } });
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ codigo: 'VERSION_DESACTUALIZADA', detalles: { versionActual: 2 } });
    });

    it('cancelar un pedido aprobado libera su reserva', async () => {
      const s = await login(f.preventista);
      const v = await login(f.ventas);
      const antes = await reservado(f.productoA);
      const { pedido } = (await emitir(s.accessToken, [{ productoId: f.productoA, cantidad: 7 }])).json();
      await pedir('POST', `/pedidos/${pedido.id}/aprobar`, { token: v.accessToken, body: { version: 1 } });
      const r = await pedir('POST', `/pedidos/${pedido.id}/cancelar`, { token: v.accessToken, body: { version: 2, motivo: 'Cliente desiste' } });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ estado: 'CANCELADO', motivoEstado: 'Cliente desiste' });
      expect(await reservado(f.productoA)).toBe(antes);
    });

    it('no permite transiciones fuera del ciclo de vida', async () => {
      const s = await login(f.preventista);
      const v = await login(f.ventas);
      const { pedido } = (await emitir(s.accessToken)).json();
      await pedir('POST', `/pedidos/${pedido.id}/aprobar`, { token: v.accessToken, body: { version: 1 } });
      const r = await pedir('POST', `/pedidos/${pedido.id}/rechazar`, { token: v.accessToken, body: { version: 2, motivo: 'Tarde' } });
      expect(r.statusCode).toBe(409);
      expect(r.json().codigo).toBe('TRANSICION_INVALIDA');
    });

    it('bloquea la aprobación por deuda vencida salvo excepción autorizada', async () => {
      const s = await login(f.preventista);
      const v = await login(f.ventas);
      const a = await login(f.admin);
      const r0 = await pedir('POST', '/pedidos', { ...movil(s.accessToken), body: { clienteId: f.clienteMoroso, items: [{ productoId: f.productoA, cantidad: 1 }] } });
      expect(r0.json().advertencias).toMatchObject([{ codigo: 'DEUDA_VENCIDA' }]);
      const { id } = r0.json().pedido;

      const r1 = await pedir('POST', `/pedidos/${id}/aprobar`, { token: v.accessToken, body: { version: 1 } });
      expect(r1.statusCode).toBe(409);
      expect(r1.json()).toMatchObject({ codigo: 'CREDITO_RESTRINGIDO', detalles: [{ codigo: 'DEUDA_VENCIDA' }] });

      const excepcion = { version: 1, excepcionCredito: { motivo: 'Acordó pagar mañana' } };
      const r2 = await pedir('POST', `/pedidos/${id}/aprobar`, { token: v.accessToken, body: excepcion });
      expect(r2.statusCode).toBe(403);

      const r3 = await pedir('POST', `/pedidos/${id}/aprobar`, { token: a.accessToken, body: excepcion });
      expect(r3.statusCode).toBe(200);
      const evento = await prisma.eventoNegocio.findFirstOrThrow({ where: { idEntidad: id, tipoEvento: 'PEDIDO_APROBADO' } });
      expect(evento.datos).toMatchObject({ excepcionCredito: { motivo: 'Acordó pagar mañana', restricciones: ['DEUDA_VENCIDA'] } });
    });

    it('las reservas vencidas se liberan automáticamente', async () => {
      const s = await login(f.preventista);
      const v = await login(f.ventas);
      const antes = await reservado(f.productoA);
      const { pedido } = (await emitir(s.accessToken, [{ productoId: f.productoA, cantidad: 4 }])).json();
      await pedir('POST', `/pedidos/${pedido.id}/aprobar`, { token: v.accessToken, body: { version: 1 } });
      await prisma.$executeRaw`
        UPDATE reservas_inventario SET vence_en = now() - interval '1 minute'
        WHERE pedido_item_id IN (SELECT id FROM pedido_items WHERE pedido_id = ${pedido.id}::uuid)`;

      const { ReservasService } = await import('../src/pedidos/reservas.service.js');
      expect(await app.get(ReservasService).liberarVencidas()).toBeGreaterThanOrEqual(1);
      expect(await reservado(f.productoA)).toBe(antes);
      const reserva = await prisma.reservaInventario.findFirstOrThrow({ where: { pedidoItem: { pedidoId: pedido.id } } });
      expect(reserva.estado).toBe('VENCIDA');
      expect(await prisma.eventoNegocio.count({ where: { idEntidad: reserva.id, tipoEvento: 'RESERVA_VENCIDA', origen: 'SISTEMA' } })).toBe(1);
    });

    it('un preventista solo lista sus pedidos', async () => {
      const s = await login(f.preventista);
      const r = await pedir('GET', '/pedidos?limite=200', { token: s.accessToken });
      expect(r.statusCode).toBe(200);
      expect(r.json().every((p: { vendedorResponsableId: string }) => p.vendedorResponsableId === f.vendedorId)).toBe(true);
    });
  });

  describe('estado de cuenta', () => {
    it('muestra saldo vencido y la restricción de venta', async () => {
      const s = await login(f.preventista);
      const r = await pedir('GET', `/clientes/${f.clienteMoroso}/estado-cuenta`, { token: s.accessToken });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({
        porMoneda: [{ moneda: 'USD', saldo: '50', vencido: '50' }],
        facturas: [{ numero: `F-${sufijo}`, diasVencido: 10 }],
        restricciones: [{ codigo: 'DEUDA_VENCIDA' }],
        bloqueado: true,
      });
      expect(Number(r.json().credito.utilizado)).toBeGreaterThanOrEqual(50);
    });

    it('no muestra clientes de otra cartera', async () => {
      const s = await login(f.preventista);
      expect((await pedir('GET', `/clientes/${f.clienteAjeno}/estado-cuenta`, { token: s.accessToken })).statusCode).toBe(404);
      const lista = (await pedir('GET', '/clientes', { token: s.accessToken })).json();
      expect(lista.map((c: { id: string }) => c.id).sort()).toEqual([f.cliente, f.clienteMoroso].sort());
    });
  });
  describe('facturación', () => {
    const facturar = async (body: object) => pedir('POST', '/facturas', { token: (await login(f.facturacion)).accessToken, body });
    const hoyCaracas = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date());

    it('sin tasa del día no se factura', async () => {
      const pedido = await pedidoAprobado([{ productoId: f.productoA, cantidad: 1 }]);
      const r = await facturar({ pedidoId: pedido.id, versionPedido: 2 });
      expect(r.statusCode).toBe(409);
      expect(r.json().codigo).toBe('SIN_TASA');
    });

    it('registra la tasa del día una sola vez', async () => {
      const a = await login(f.administracion);
      const body = { fecha: hoyCaracas(), tasa: 40.5, fuente: FUENTE_TASA };
      expect((await pedir('POST', '/tasas', { token: a.accessToken, body })).statusCode).toBe(201);
      expect((await pedir('POST', '/tasas', { token: a.accessToken, body })).json().codigo).toBe('DUPLICADO');
      const vigente = await pedir('GET', '/tasas/vigente', { token: a.accessToken });
      expect(vigente.json()).toMatchObject({ tasa: '40.5', fuente: FUENTE_TASA });
      const s = await login(f.preventista);
      expect((await pedir('POST', '/tasas', { token: s.accessToken, body })).statusCode).toBe(403);
    });

    it('factura lo reservado con fotografía del cliente, tasa y vencimiento por días de crédito', async () => {
      await prisma.cliente.update({ where: { id: f.cliente }, data: { diasCredito: 15 } });
      const pedido = await pedidoAprobado([
        { productoId: f.productoA, cantidad: 10 },
        { productoId: f.productoD, cantidad: 1 },
      ]);
      const r = await facturar({ pedidoId: pedido.id, versionPedido: 2 });
      expect(r.statusCode, JSON.stringify(r.json())).toBe(201);
      const factura = r.json();
      const vence = new Date(`${hoyCaracas()}T00:00:00Z`);
      vence.setUTCDate(vence.getUTCDate() + 15);
      expect(factura).toMatchObject({
        estado: 'EMITIDA',
        pedidoId: pedido.id,
        clienteRazonSocial: 'Cliente 1',
        subtotal: '35',
        impuesto: '5.6',
        total: '40.6',
        tasaCambio: '40.5',
        numeroControl: null,
        fechaVencimiento: vence.toISOString(),
        cobro: { saldo: '40.6', estado: 'PENDIENTE' },
      });
      expect(factura.numero).toMatch(/^FAC-\d{8}$/);
      expect(factura.items.map((i: { pedidoItemId: string }) => i.pedidoItemId)).toEqual(pedido.items.map((i) => i.id));

      const reservas = await prisma.reservaInventario.findMany({ where: { pedidoItem: { pedidoId: pedido.id } } });
      expect(reservas.every((x) => x.estado === 'ACTIVA' && x.facturaItemId !== null && x.venceEn === null)).toBe(true);
      expect((await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } })).estado).toBe('FACTURADO');
      const eventos = await prisma.eventoNegocio.findMany({ where: { idEntidad: { in: [pedido.id, factura.id] } } });
      expect(eventos.map((e) => e.tipoEvento)).toEqual(expect.arrayContaining(['FACTURA_EMITIDA', 'PEDIDO_FACTURADO']));
    });

    it('factura parcial: ajusta la reserva y libera lo no facturado', async () => {
      const pedido = await pedidoAprobado([
        { productoId: f.productoA, cantidad: 10 },
        { productoId: f.productoD, cantidad: 1 },
      ]);
      const antesA = Number(await reservado(f.productoA));
      const antesD = Number(await reservado(f.productoD));
      const r = await facturar({ pedidoId: pedido.id, versionPedido: 2, lineas: [{ pedidoItemId: pedido.items[0]!.id, cantidad: 6 }] });
      expect(r.statusCode, JSON.stringify(r.json())).toBe(201);
      expect(r.json().items).toMatchObject([{ cantidad: '6', subtotal: '15' }]);
      expect(Number(await reservado(f.productoA))).toBe(antesA - 4);
      expect(Number(await reservado(f.productoD))).toBe(antesD - 1);
      const evento = await prisma.eventoNegocio.findFirstOrThrow({ where: { idEntidad: r.json().id, tipoEvento: 'FACTURA_EMITIDA' } });
      expect((evento.datos as { lineas: unknown[] }).lineas).toEqual([
        { pedidoItemId: pedido.items[0]!.id, pedido: '10', reservado: '10', facturado: '6' },
        { pedidoItemId: pedido.items[1]!.id, pedido: '1', reservado: '1', facturado: '0' },
      ]);
    });

    it('no factura más de lo reservado si no hay disponible', async () => {
      const pedido = await pedidoAprobado([{ productoId: f.productoC, cantidad: 5 }], true);
      const item = pedido.items[0]!.id;
      const r1 = await facturar({ pedidoId: pedido.id, versionPedido: 2, lineas: [{ pedidoItemId: item, cantidad: 5 }] });
      expect(r1.statusCode).toBe(409);
      expect(r1.json()).toMatchObject({ codigo: 'STOCK_INSUFICIENTE', detalles: [{ solicitado: '5', reservado: '3', disponible: '0' }] });
      const r2 = await facturar({ pedidoId: pedido.id, versionPedido: 2, lineas: [{ pedidoItemId: item, cantidad: 3 }] });
      expect(r2.statusCode).toBe(201);
    });

    it('valida versión, cantidades y que el pedido no se facture dos veces', async () => {
      const pedido = await pedidoAprobado([{ productoId: f.productoA, cantidad: 2 }]);
      const item = pedido.items[0]!.id;
      expect((await facturar({ pedidoId: pedido.id, versionPedido: 1 })).json().codigo).toBe('VERSION_DESACTUALIZADA');
      expect((await facturar({ pedidoId: pedido.id, versionPedido: 2, lineas: [{ pedidoItemId: item, cantidad: 3 }] })).json().codigo).toBe(
        'CANTIDAD_EXCEDE_PEDIDO',
      );
      expect((await facturar({ pedidoId: pedido.id, versionPedido: 2, lineas: [{ pedidoItemId: item, cantidad: 0 }] })).json().codigo).toBe(
        'NADA_QUE_FACTURAR',
      );
      expect((await facturar({ pedidoId: pedido.id, versionPedido: 2 })).statusCode).toBe(201);
      expect((await facturar({ pedidoId: pedido.id, versionPedido: 3 })).json().codigo).toBe('TRANSICION_INVALIDA');
    });

    it('un pedido emitido sin aprobar no se factura', async () => {
      const s = await login(f.preventista);
      const { pedido } = (await emitir(s.accessToken)).json();
      expect((await facturar({ pedidoId: pedido.id, versionPedido: 1 })).json().codigo).toBe('TRANSICION_INVALIDA');
    });

    it('anular libera las reservas y exige permiso y motivo', async () => {
      const pedido = await pedidoAprobado([{ productoId: f.productoA, cantidad: 9 }]);
      const factura = (await facturar({ pedidoId: pedido.id, versionPedido: 2 })).json();
      const antes = Number(await reservado(f.productoA));
      const fa = await login(f.facturacion);
      const ad = await login(f.administracion);
      const anular = (token: string, version: number, motivo: string) =>
        pedir('POST', `/facturas/${factura.id}/anular`, { token, body: { version, motivo } });
      expect((await anular(fa.accessToken, 1, 'Error de carga')).statusCode).toBe(403);
      const r = await anular(ad.accessToken, 1, 'Error de carga');
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ estado: 'ANULADA', motivoAnulacion: 'Error de carga', cobro: null });
      expect(Number(await reservado(f.productoA))).toBe(antes - 9);
      expect((await anular(ad.accessToken, 2, 'Otra vez')).json().codigo).toBe('TRANSICION_INVALIDA');
    });

    it('no anula una factura con pagos aplicados', async () => {
      const pedido = await pedidoAprobado([{ productoId: f.productoA, cantidad: 1 }]);
      const factura = (await facturar({ pedidoId: pedido.id, versionPedido: 2 })).json();
      const pago = await prisma.pagoRecibido.create({
        data: {
          clienteId: f.cliente,
          metodoPago: 'EFECTIVO',
          entidadOrigen: 'CAJA',
          moneda: 'USD',
          montoTotal: 1,
          tasaCambio: 40.5,
          fechaEmision: new Date(),
          creadoPor: pedido.id,
        },
      });
      await prisma.pagoAplicacion.create({
        data: { pagoId: pago.id, facturaId: factura.id, montoAplicado: 1, montoMonedaPago: 1, tasaCambio: 1, creadoPor: pedido.id },
      });
      const ad = await login(f.administracion);
      const r = await pedir('POST', `/facturas/${factura.id}/anular`, { token: ad.accessToken, body: { version: 1, motivo: 'Error de carga' } });
      expect(r.statusCode).toBe(409);
      expect(r.json().codigo).toBe('FACTURA_CON_PAGOS');
    });

    it('el número de control se asigna una vez y no se repite entre facturas', async () => {
      const fa = await login(f.facturacion);
      const facturaNueva = async () =>
        (await facturar({ pedidoId: (await pedidoAprobado([{ productoId: f.productoA, cantidad: 1 }])).id, versionPedido: 2 })).json();
      const a = await facturaNueva();
      const b = await facturaNueva();
      const numero = `00-${sufijo}`;
      const asignar = (id: string, numeroControl: string) =>
        pedir('POST', `/facturas/${id}/numero-control`, { token: fa.accessToken, body: { numeroControl } });
      expect((await asignar(a.id, numero)).json()).toMatchObject({ numeroControl: numero });
      expect((await asignar(a.id, `${numero}-X`)).json().codigo).toBe('NUMERO_CONTROL_ASIGNADO');
      expect((await asignar(b.id, numero)).json().codigo).toBe('DUPLICADO');

      const pendientes = (await pedir('GET', '/facturas?sinNumeroControl=true&limite=200', { token: fa.accessToken })).json();
      expect(pendientes.some((x: { id: string }) => x.id === b.id)).toBe(true);
      expect(pendientes.some((x: { id: string }) => x.id === a.id)).toBe(false);
    });

    it('el preventista ve sus facturas, no las de otra cartera', async () => {
      const pedido = await pedidoAprobado([{ productoId: f.productoA, cantidad: 1 }]);
      const factura = (await facturar({ pedidoId: pedido.id, versionPedido: 2 })).json();
      const s = await login(f.preventista);
      expect((await pedir('GET', `/facturas/${factura.id}`, { token: s.accessToken })).statusCode).toBe(200);
      const lista = (await pedir('GET', '/facturas?limite=200', { token: s.accessToken })).json();
      expect(lista.every((x: { vendedorResponsableId: string }) => x.vendedorResponsableId === f.vendedorId)).toBe(true);
    });
  });
  describe('manifiestos', () => {
    let tokens: { logistica: string; chofer: string; otroChofer: string; preventista: string };
    let choferId: string;
    let otroChoferId: string;

    const fisico = async (productoId: string, ubicacionId: string) =>
      (await prisma.existencia.findFirst({ where: { productoId, ubicacionId } }))?.cantidadFisica.toString() ?? '0';

    /** Factura nueva de `cantidad` unidades del producto A (pasa por pedido aprobado y facturado). */
    async function facturaNueva(cantidad = 2) {
      const pedido = await pedidoAprobado([{ productoId: f.productoA, cantidad }]);
      const fa = await login(f.facturacion);
      const r = await pedir('POST', '/facturas', { token: fa.accessToken, body: { pedidoId: pedido.id, versionPedido: 2 } });
      expect(r.statusCode, JSON.stringify(r.json())).toBe(201);
      return r.json() as { id: string; numero: string; items: { id: string }[] };
    }

    async function vehiculoNuevo() {
      const r = await pedir('POST', '/vehiculos', { token: tokens.logistica, body: { placa: `P${randomUUID().slice(0, 7)}` } });
      expect(r.statusCode, JSON.stringify(r.json())).toBe(201);
      return r.json() as { id: string; placa: string; ubicacion: { id: string; tipo: string } };
    }

    async function manifiestoCon(facturaIds: string[], chofer = choferId) {
      const vehiculo = await vehiculoNuevo();
      const r = await pedir('POST', '/manifiestos', { token: tokens.logistica, body: { vehiculoId: vehiculo.id, choferId: chofer, facturaIds } });
      expect(r.statusCode, JSON.stringify(r.json())).toBe(201);
      return { manifiesto: r.json() as { id: string; numero: string; version: number; estado: string }, vehiculo };
    }

    const accion = (id: string, nombre: string, body: object, token = tokens.logistica) =>
      pedir('POST', `/manifiestos/${id}/${nombre}`, { token, body });

    /** Lleva un manifiesto con esas facturas hasta EN_RUTA. */
    async function enRuta(facturaIds: string[]) {
      const { manifiesto, vehiculo } = await manifiestoCon(facturaIds);
      expect((await accion(manifiesto.id, 'confirmar', { version: 1 })).statusCode).toBe(200);
      expect((await accion(manifiesto.id, 'iniciar-ruta', { version: 2 }, tokens.chofer)).statusCode).toBe(200);
      return { manifiesto, vehiculo };
    }

    beforeAll(async () => {
      const { crearUsuario } = await import('../src/usuarios/crear-usuario.js');
      const crear = (nombre: string, roles: string[]) =>
        crearUsuario(prisma, { username: `${nombre}-${sufijo}`, nombre, password: PASSWORD, roles });
      choferId = (await crear('chofer', ['CHOFER'])).id;
      otroChoferId = (await crear('chofer2', ['CHOFER'])).id;
      await crear('logistica', ['LOGISTICA']);
      tokens = {
        logistica: (await login(`logistica-${sufijo}`)).accessToken,
        chofer: (await login(`chofer-${sufijo}`)).accessToken,
        otroChofer: (await login(`chofer2-${sufijo}`)).accessToken,
        preventista: (await login(f.preventista)).accessToken,
      };
    });

    it('registra vehículos como ubicación de inventario', async () => {
      const v = await vehiculoNuevo();
      expect(v.ubicacion.tipo).toBe('VEHICULO');
      expect((await pedir('POST', '/vehiculos', { token: tokens.logistica, body: { placa: v.placa } })).json().codigo).toBe('DUPLICADO');
      expect((await pedir('POST', '/vehiculos', { token: tokens.preventista, body: { placa: 'ZZZ999' } })).statusCode).toBe(403);
    });

    it('crea el manifiesto en borrador con la carga completa de cada factura', async () => {
      const a = await facturaNueva(2);
      const b = await facturaNueva(3);
      const { manifiesto } = await manifiestoCon([a.id, b.id]);
      expect(manifiesto).toMatchObject({ estado: 'BORRADOR', version: 1 });
      expect(manifiesto.numero).toMatch(/^MAN-\d{8}$/);
      const detalle = (await pedir('GET', `/manifiestos/${manifiesto.id}`, { token: tokens.logistica })).json();
      expect(detalle.facturas.map((x: { facturaId: string; ordenVisita: number }) => [x.facturaId, x.ordenVisita])).toEqual([
        [a.id, 1],
        [b.id, 2],
      ]);
      expect(detalle.items.map((i: { cantidadCargada: string }) => i.cantidadCargada).sort()).toEqual(['2', '3']);
    });

    it('valida chofer, vehículo ocupado y facturas', async () => {
      const a = await facturaNueva();
      const v = await vehiculoNuevo();
      const crear = (body: object) => pedir('POST', '/manifiestos', { token: tokens.logistica, body });
      expect((await crear({ vehiculoId: v.id, choferId: f.vendedorId })).json().codigo).toBe('CHOFER_INVALIDO');
      expect((await crear({ vehiculoId: v.id, choferId, facturaIds: [a.id] })).statusCode).toBe(201);
      expect((await crear({ vehiculoId: v.id, choferId })).json().codigo).toBe('VEHICULO_OCUPADO');
      const otro = await vehiculoNuevo();
      expect((await crear({ vehiculoId: otro.id, choferId, facturaIds: [a.id] })).json().codigo).toBe('FACTURA_EN_OTRO_MANIFIESTO');

      const anulada = await facturaNueva();
      const ad = await login(f.administracion);
      await pedir('POST', `/facturas/${anulada.id}/anular`, { token: ad.accessToken, body: { version: 1, motivo: 'Prueba de anulación' } });
      expect((await crear({ vehiculoId: otro.id, choferId, facturaIds: [anulada.id] })).json().codigo).toBe('FACTURA_NO_DESPACHABLE');
    });

    it('en borrador se agregan y quitan facturas; quitada queda libre', async () => {
      const a = await facturaNueva();
      const b = await facturaNueva();
      const { manifiesto } = await manifiestoCon([a.id]);
      const r1 = await accion(manifiesto.id, 'facturas', { version: 1, facturaIds: [b.id] });
      expect(r1.json().facturas).toHaveLength(2);
      const r2 = await accion(manifiesto.id, `facturas/${a.id}/quitar`, { version: 2 });
      expect(r2.json().facturas.map((x: { facturaId: string }) => x.facturaId)).toEqual([b.id]);
      expect(r2.json().items).toHaveLength(1);
      await manifiestoCon([a.id]);
    });

    it('confirmar mueve el inventario al vehículo, consume la reserva y despacha las facturas', async () => {
      const a = await facturaNueva(4);
      const almacenAntes = Number(await fisico(f.productoA, f.almacen));
      const reservadoAntes = Number(await reservado(f.productoA));
      const { manifiesto, vehiculo } = await manifiestoCon([a.id]);

      expect((await accion(manifiesto.id, 'confirmar', { version: 1 }, tokens.preventista)).statusCode).toBe(403);
      const r = await accion(manifiesto.id, 'confirmar', { version: 1 });
      expect(r.statusCode, JSON.stringify(r.json())).toBe(200);
      expect(r.json()).toMatchObject({ estado: 'CONFIRMADO', version: 2 });

      expect(Number(await fisico(f.productoA, f.almacen))).toBe(almacenAntes - 4);
      expect(await fisico(f.productoA, vehiculo.ubicacion.id)).toBe('4');
      expect(Number(await reservado(f.productoA))).toBe(reservadoAntes - 4);
      expect((await prisma.factura.findUniqueOrThrow({ where: { id: a.id } })).estado).toBe('DESPACHADA');
      const reserva = await prisma.reservaInventario.findFirstOrThrow({ where: { facturaItemId: a.items[0]!.id } });
      expect(reserva.estado).toBe('CONSUMIDA');
      const tipos = (await prisma.eventoNegocio.findMany({ where: { idEntidad: { in: [manifiesto.id, a.id, reserva.id] } } })).map((e) => e.tipoEvento);
      expect(tipos).toEqual(expect.arrayContaining(['MANIFIESTO_CONFIRMADO', 'FACTURA_DESPACHADA', 'RESERVA_CONSUMIDA']));

      // Ya no se edita.
      const b = await facturaNueva();
      expect((await accion(manifiesto.id, 'facturas', { version: 2, facturaIds: [b.id] })).json().codigo).toBe('MANIFIESTO_NO_EDITABLE');
      const anular = await accion(manifiesto.id, 'anular', { version: 2, motivo: 'Ya no se puede' });
      expect(anular.json().codigo).toBe('TRANSICION_INVALIDA');
    });

    it('no confirma un manifiesto vacío', async () => {
      const v = await vehiculoNuevo();
      const { id } = (await pedir('POST', '/manifiestos', { token: tokens.logistica, body: { vehiculoId: v.id, choferId } })).json();
      expect((await accion(id, 'confirmar', { version: 1 })).json().codigo).toBe('MANIFIESTO_VACIO');
    });

    it('solo el chofer asignado (o Logística) inicia la ruta, con GPS', async () => {
      const a = await facturaNueva();
      const { manifiesto } = await manifiestoCon([a.id]);
      await accion(manifiesto.id, 'confirmar', { version: 1 });
      expect((await accion(manifiesto.id, 'iniciar-ruta', { version: 2 }, tokens.otroChofer)).statusCode).toBe(403);
      const r = await accion(manifiesto.id, 'iniciar-ruta', { version: 2, latitud: 10.4806, longitud: -66.9036 }, tokens.chofer);
      expect(r.statusCode).toBe(200);
      expect(r.json().estado).toBe('EN_RUTA');
      const evento = await prisma.eventoNegocio.findFirstOrThrow({ where: { idEntidad: manifiesto.id, tipoEvento: 'RUTA_INICIADA' } });
      expect(evento.latitud?.toString()).toBe('10.4806');
    });

    it('el chofer solo ve sus manifiestos', async () => {
      const a = await facturaNueva();
      const { manifiesto } = await manifiestoCon([a.id]);
      expect((await pedir('GET', `/manifiestos/${manifiesto.id}`, { token: tokens.chofer })).statusCode).toBe(200);
      expect((await pedir('GET', `/manifiestos/${manifiesto.id}`, { token: tokens.otroChofer })).statusCode).toBe(404);
      const lista = (await pedir('GET', '/manifiestos?limite=200', { token: tokens.otroChofer })).json();
      expect(lista.every((m: { choferId: string }) => m.choferId === otroChoferId)).toBe(true);
    });

    it('cerrar sin entregas devuelve todo al almacén y las facturas quedan listas para otro manifiesto', async () => {
      const a = await facturaNueva(5);
      const almacenAntes = Number(await fisico(f.productoA, f.almacen));
      const reservadoAntes = Number(await reservado(f.productoA));
      const { manifiesto, vehiculo } = await enRuta([a.id]);

      const previa = (await pedir('GET', `/manifiestos/${manifiesto.id}/cuadre`, { token: tokens.logistica })).json();
      expect(previa).toMatchObject([{ productoId: f.productoA, cargado: '5', entregado: '0', esperado: '5' }]);

      const r = await accion(manifiesto.id, 'cerrar', { version: 3, conteo: [{ productoId: f.productoA, cantidad: 5 }] });
      expect(r.statusCode, JSON.stringify(r.json())).toBe(200);
      expect(r.json().manifiesto.estado).toBe('CERRADO');
      expect(r.json().cuadre).toMatchObject([{ esperado: '5', contado: '5', diferencia: '0' }]);

      expect(await fisico(f.productoA, vehiculo.ubicacion.id)).toBe('0');
      expect(Number(await fisico(f.productoA, f.almacen))).toBe(almacenAntes);
      expect(Number(await reservado(f.productoA))).toBe(reservadoAntes);
      expect((await prisma.factura.findUniqueOrThrow({ where: { id: a.id } })).estado).toBe('EMITIDA');
      const reservas = await prisma.reservaInventario.findMany({ where: { facturaItemId: a.items[0]!.id }, orderBy: { creadaEn: 'asc' } });
      expect(reservas.map((x) => x.estado)).toEqual(['CONSUMIDA', 'ACTIVA']);
      expect(await prisma.eventoNegocio.count({ where: { idEntidad: a.id, tipoEvento: 'FACTURA_RETORNADA' } })).toBe(1);

      // La factura retornada puede despacharse de nuevo.
      const otro = await manifiestoCon([a.id]);
      expect((await accion(otro.manifiesto.id, 'confirmar', { version: 1 })).statusCode).toBe(200);
    });

    it('el cuadre exige contar todo y justificar diferencias, que quedan como ajuste', async () => {
      const a = await facturaNueva(6);
      const almacenAntes = Number(await fisico(f.productoA, f.almacen));
      const { manifiesto, vehiculo } = await enRuta([a.id]);
      const cerrar = (body: object) => accion(manifiesto.id, 'cerrar', { version: 3, ...body });

      expect((await cerrar({ conteo: [] })).json()).toMatchObject({ codigo: 'CONTEO_INCOMPLETO', detalles: { productoIds: [f.productoA] } });
      expect((await cerrar({ conteo: [{ productoId: f.productoA, cantidad: 6 }, { productoId: f.productoB, cantidad: 1 }] })).json().codigo).toBe(
        'PRODUCTO_NO_CARGADO',
      );
      const sinMotivo = await cerrar({ conteo: [{ productoId: f.productoA, cantidad: 5 }] });
      expect(sinMotivo.statusCode).toBe(409);
      expect(sinMotivo.json()).toMatchObject({ codigo: 'DIFERENCIAS_SIN_JUSTIFICAR', detalles: [{ esperado: '6', contado: '5', diferencia: '-1' }] });

      const r = await cerrar({ conteo: [{ productoId: f.productoA, cantidad: 5 }], motivoDiferencias: 'Bulto dañado en ruta' });
      expect(r.statusCode, JSON.stringify(r.json())).toBe(200);
      expect(await fisico(f.productoA, vehiculo.ubicacion.id)).toBe('0');
      expect(Number(await fisico(f.productoA, f.almacen))).toBe(almacenAntes - 1);
      const ajuste = await prisma.movimientoInventario.findFirstOrThrow({ where: { documentoOrigenId: manifiesto.id, tipo: 'AJUSTE' } });
      expect(ajuste).toMatchObject({ motivo: 'Bulto dañado en ruta' });
      expect(ajuste.cantidadSalida.toString()).toBe('1');
    });

    it('el cuadre descuenta lo entregado; la factura entregada no retorna', async () => {
      const entregada = await facturaNueva(3);
      const pendiente = await facturaNueva(2);
      const { manifiesto, vehiculo } = await enRuta([entregada.id, pendiente.id]);

      // Simula lo que hará el módulo de entregas: entrega confirmada, salida del vehículo y factura ENTREGADA.
      const entrega = await prisma.entrega.create({
        data: {
          facturaId: entregada.id,
          manifiestoId: manifiesto.id,
          choferId,
          estado: 'CONFIRMADA',
          fechaHora: new Date(),
          receptorNombre: 'Encargado',
          items: { create: [{ facturaItemId: entregada.items[0]!.id, cantidadEntregada: 3 }] },
        },
      });
      await prisma.movimientoInventario.create({
        data: {
          grupoId: randomUUID(),
          productoId: f.productoA,
          ubicacionId: vehiculo.ubicacion.id,
          tipo: 'ENTREGA',
          cantidadSalida: 3,
          documentoOrigenTipo: 'ENTREGA',
          documentoOrigenId: entrega.id,
          usuarioId: choferId,
        },
      });
      await prisma.factura.update({ where: { id: entregada.id }, data: { estado: 'ENTREGADA' } });

      const previa = (await pedir('GET', `/manifiestos/${manifiesto.id}/cuadre`, { token: tokens.logistica })).json();
      expect(previa).toMatchObject([{ cargado: '5', entregado: '3', esperado: '2' }]);
      const r = await accion(manifiesto.id, 'cerrar', { version: 3, conteo: [{ productoId: f.productoA, cantidad: 2 }] });
      expect(r.statusCode, JSON.stringify(r.json())).toBe(200);
      expect((await prisma.factura.findUniqueOrThrow({ where: { id: entregada.id } })).estado).toBe('ENTREGADA');
      expect((await prisma.factura.findUniqueOrThrow({ where: { id: pendiente.id } })).estado).toBe('EMITIDA');
      expect(await fisico(f.productoA, vehiculo.ubicacion.id)).toBe('0');
    });

    it('anular un borrador libera sus facturas', async () => {
      const a = await facturaNueva();
      const { manifiesto } = await manifiestoCon([a.id]);
      const r = await accion(manifiesto.id, 'anular', { version: 1, motivo: 'Camión averiado' });
      expect(r.json().estado).toBe('ANULADO');
      await manifiestoCon([a.id]);
    });
    describe('entregas', () => {
      /** PNG válido de 1×1 píxel. */
      const FIRMA = {
        mime: 'image/png',
        contenidoBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      };
      const GPS = { latitud: 10.4806, longitud: -66.9036, precisionMetros: 8 };

      const entregar = (body: object, token = tokens.chofer, clave: string = randomUUID()) =>
        pedir('POST', '/entregas', { token, body, cabeceras: { 'x-origen': 'APP_CHOFER', 'idempotency-key': clave } });
      const confirmar = (facturaId: string, extra: object = {}, token?: string) =>
        entregar({ facturaId, resultado: 'CONFIRMADA', receptorNombre: 'Encargado de tienda', firma: FIRMA, ...GPS, ...extra }, token);
      const rechazar = (facturaId: string, extra: object = {}) =>
        entregar({ facturaId, resultado: 'RECHAZADA', motivoRechazo: 'Local cerrado', ...GPS, ...extra });

      it('confirma la entrega con firma y GPS: descuenta del vehículo y la factura queda ENTREGADA', async () => {
        const a = await facturaNueva(3);
        const { manifiesto, vehiculo } = await enRuta([a.id]);
        const r = await confirmar(a.id, { fechaHoraDispositivo: new Date(Date.now() - 60_000).toISOString() });
        expect(r.statusCode, JSON.stringify(r.json())).toBe(201);
        const entrega = r.json();
        expect(entrega).toMatchObject({ estado: 'CONFIRMADA', receptorNombre: 'Encargado de tienda', choferId, manifiestoId: manifiesto.id });
        expect(entrega.items).toMatchObject([{ cantidadEntregada: '3', cantidadRechazada: '0' }]);
        expect(entrega.firmaArchivoId).toBeTruthy();

        expect(await fisico(f.productoA, vehiculo.ubicacion.id)).toBe('0');
        expect((await prisma.factura.findUniqueOrThrow({ where: { id: a.id } })).estado).toBe('ENTREGADA');
        const eventos = await prisma.eventoNegocio.findMany({ where: { idEntidad: { in: [entrega.id, a.id] } } });
        expect(eventos.map((e) => e.tipoEvento)).toEqual(expect.arrayContaining(['ENTREGA_CONFIRMADA', 'FACTURA_ENTREGADA']));
        const evento = eventos.find((e) => e.tipoEvento === 'ENTREGA_CONFIRMADA')!;
        expect(evento).toMatchObject({ origen: 'APP_CHOFER' });
        expect(evento.latitud?.toString()).toBe('10.4806');
        expect(evento.fechaHoraDispositivo).not.toBeNull();

        const firma = await pedir('GET', `/archivos/${entrega.firmaArchivoId}`, { token: tokens.chofer });
        expect(firma.statusCode).toBe(200);
        expect((firma as unknown as { headers: Record<string, string> }).headers['content-type']).toBe('image/png');
        expect((await pedir('GET', `/archivos/${entrega.firmaArchivoId}`, { token: tokens.preventista })).statusCode).toBe(403);
      });

      it('valida firma, receptor y motivo', async () => {
        const a = await facturaNueva();
        await enRuta([a.id]);
        expect((await entregar({ facturaId: a.id, resultado: 'CONFIRMADA', receptorNombre: 'X Y', ...GPS })).statusCode).toBe(400);
        expect((await entregar({ facturaId: a.id, resultado: 'RECHAZADA', ...GPS })).statusCode).toBe(400);
        const falsa = await confirmar(a.id, { firma: { mime: 'image/png', contenidoBase64: Buffer.from('no es una imagen').toString('base64') } });
        expect(falsa.statusCode).toBe(422);
        expect(falsa.json().codigo).toBe('ARCHIVO_INVALIDO');
        expect((await prisma.factura.findUniqueOrThrow({ where: { id: a.id } })).estado).toBe('DESPACHADA');
      });

      it('reenviar la misma entrega (mismo id) no la duplica', async () => {
        const a = await facturaNueva();
        await enRuta([a.id]);
        const id = randomUUID();
        const r1 = await confirmar(a.id, { id });
        const r2 = await confirmar(a.id, { id });
        expect([r1.statusCode, r2.statusCode]).toEqual([201, 201]);
        expect(r2.json().id).toBe(id);
        expect(await prisma.entrega.count({ where: { facturaId: a.id } })).toBe(1);
        expect(await prisma.movimientoInventario.count({ where: { documentoOrigenId: id } })).toBe(1);
      });

      it('solo el chofer asignado, en ruta, sobre facturas de su manifiesto y una sola vez', async () => {
        const a = await facturaNueva();
        const { manifiesto } = await manifiestoCon([a.id]);
        await accion(manifiesto.id, 'confirmar', { version: 1 });
        expect((await confirmar(a.id)).json().codigo).toBe('MANIFIESTO_NO_EN_RUTA');
        await accion(manifiesto.id, 'iniciar-ruta', { version: 2 }, tokens.chofer);
        expect((await confirmar(a.id, {}, tokens.otroChofer)).json().codigo).toBe('NO_ES_CHOFER_ASIGNADO');
        const sinManifiesto = await facturaNueva();
        expect((await confirmar(sinManifiesto.id)).json().codigo).toBe('FACTURA_SIN_MANIFIESTO');
        expect((await confirmar(a.id)).statusCode).toBe(201);
        expect((await confirmar(a.id)).json().codigo).toBe('FACTURA_YA_ENTREGADA');
      });

      it('un rechazo deja la mercancía en el vehículo y permite reintentar en la misma ruta', async () => {
        const a = await facturaNueva(2);
        const { vehiculo } = await enRuta([a.id]);
        const r = await rechazar(a.id);
        expect(r.statusCode, JSON.stringify(r.json())).toBe(201);
        expect(r.json().items).toMatchObject([{ cantidadEntregada: '0', cantidadRechazada: '2', motivoRechazo: 'Local cerrado' }]);
        expect(await fisico(f.productoA, vehiculo.ubicacion.id)).toBe('2');
        expect((await prisma.factura.findUniqueOrThrow({ where: { id: a.id } })).estado).toBe('DESPACHADA');
        expect((await confirmar(a.id)).statusCode).toBe(201);
      });

      it('anular una entrega confirmada devuelve la mercancía al vehículo y la factura a DESPACHADA', async () => {
        const a = await facturaNueva(4);
        const { manifiesto, vehiculo } = await enRuta([a.id]);
        const entrega = (await confirmar(a.id)).json();
        const ad = await login(f.administracion);
        const anular = (token: string) => pedir('POST', `/entregas/${entrega.id}/anular`, { token, body: { motivo: 'Factura equivocada' } });

        expect((await anular(tokens.chofer)).statusCode).toBe(403);
        const r = await anular(ad.accessToken);
        expect(r.statusCode, JSON.stringify(r.json())).toBe(200);
        expect(r.json().estado).toBe('ANULADA');
        expect(await fisico(f.productoA, vehiculo.ubicacion.id)).toBe('4');
        expect((await prisma.factura.findUniqueOrThrow({ where: { id: a.id } })).estado).toBe('DESPACHADA');
        const cuadre = (await pedir('GET', `/manifiestos/${manifiesto.id}/cuadre`, { token: tokens.logistica })).json();
        expect(cuadre).toMatchObject([{ cargado: '4', entregado: '0', esperado: '4' }]);
        expect((await anular(ad.accessToken)).json().codigo).toBe('TRANSICION_INVALIDA');

        // Se puede volver a entregar correctamente.
        expect((await confirmar(a.id)).statusCode).toBe(201);
      });

      it('ruta completa: entrega una, rechaza otra y cierra cuadrando', async () => {
        const entregada = await facturaNueva(3);
        const rechazada = await facturaNueva(2);
        const almacenAntes = Number(await fisico(f.productoA, f.almacen));
        const { manifiesto, vehiculo } = await enRuta([entregada.id, rechazada.id]);
        await confirmar(entregada.id);
        await rechazar(rechazada.id);

        const cuadre = (await pedir('GET', `/manifiestos/${manifiesto.id}/cuadre`, { token: tokens.logistica })).json();
        expect(cuadre).toMatchObject([{ cargado: '5', entregado: '3', esperado: '2' }]);
        const r = await accion(manifiesto.id, 'cerrar', { version: 3, conteo: [{ productoId: f.productoA, cantidad: 2 }] });
        expect(r.statusCode, JSON.stringify(r.json())).toBe(200);
        expect(await fisico(f.productoA, vehiculo.ubicacion.id)).toBe('0');
        expect(Number(await fisico(f.productoA, f.almacen))).toBe(almacenAntes - 3);
        expect((await prisma.factura.findUniqueOrThrow({ where: { id: entregada.id } })).estado).toBe('ENTREGADA');
        expect((await prisma.factura.findUniqueOrThrow({ where: { id: rechazada.id } })).estado).toBe('EMITIDA');

        const embudo = await prisma.$queryRaw<{ cargado: Prisma.Decimal; entregado: Prisma.Decimal }[]>`
          SELECT e.cargado, e.entregado FROM bi.v_embudo_lineas e
          JOIN factura_items fi ON fi.pedido_item_id = e.pedido_item_id
          WHERE fi.factura_id = ${entregada.id}::uuid`;
        expect(embudo.map((x) => [x.cargado.toString(), x.entregado.toString()])).toEqual([['3', '3']]);

        // Después del cierre, la entrega ya no se anula.
        const entrega = await prisma.entrega.findFirstOrThrow({ where: { facturaId: entregada.id } });
        const ad = await login(f.administracion);
        const anular = await pedir('POST', `/entregas/${entrega.id}/anular`, { token: ad.accessToken, body: { motivo: 'Muy tarde' } });
        expect(anular.json().codigo).toBe('MANIFIESTO_NO_EN_RUTA');
      });

      it('el chofer solo ve sus entregas', async () => {
        const lista = (await pedir('GET', '/entregas?limite=200', { token: tokens.otroChofer })).json();
        expect(lista.every((e: { choferId: string }) => e.choferId === otroChoferId)).toBe(true);
        const propias = (await pedir('GET', '/entregas?limite=200', { token: tokens.chofer })).json();
        expect(propias.length).toBeGreaterThan(0);
      });
    });
  });
  describe('cobranza', () => {
    const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date());

    /** Factura de 10 unidades de A: subtotal 25 + IVA 4 = 29 USD, del cliente de la cartera. */
    async function factura29() {
      const pedido = await pedidoAprobado([{ productoId: f.productoA, cantidad: 10 }]);
      const fa = await login(f.facturacion);
      const r = await pedir('POST', '/facturas', { token: fa.accessToken, body: { pedidoId: pedido.id, versionPedido: 2 } });
      expect(r.statusCode, JSON.stringify(r.json())).toBe(201);
      expect(r.json().total).toBe('29');
      return r.json() as { id: string; numero: string };
    }

    const registrar = async (body: object, token?: string, origen = 'APP_PREVENTISTA') =>
      pedir('POST', '/pagos', {
        token: token ?? (await login(f.preventista)).accessToken,
        body: { clienteId: f.cliente, fechaEmision: hoy(), ...body },
        cabeceras: { 'x-origen': origen, 'idempotency-key': randomUUID() },
      });
    const transferencia = (monto: number, aplicaciones: object[] = [], extra: object = {}) =>
      registrar({
        metodoPago: 'TRANSFERENCIA',
        entidadOrigen: '0102',
        referencia: String(Date.now()) + Math.floor(Math.random() * 1000),
        moneda: 'USD',
        montoTotal: monto,
        aplicaciones,
        ...extra,
      });
    const administrar = async (id: string, accion: string, body: object) =>
      pedir('POST', `/pagos/${id}/${accion}`, { token: (await login(f.administracion)).accessToken, body });
    const cobro = async (facturaId: string) =>
      (await pedir('GET', `/facturas/${facturaId}`, { token: (await login(f.facturacion)).accessToken })).json().cobro;

    it('registrar no reduce la deuda; validar sí', async () => {
      const fac = await factura29();
      const r = await transferencia(20, [{ facturaId: fac.id, montoAplicado: 20 }]);
      expect(r.statusCode, JSON.stringify(r.json())).toBe(201);
      const pago = r.json();
      expect(pago).toMatchObject({ estado: 'REGISTRADO', montoTotal: '20', montoAplicado: '20', montoDisponible: '0', tasaCambio: '40.5' });
      expect(await cobro(fac.id)).toMatchObject({ saldo: '29', cobradoPorValidar: '20', estado: 'PENDIENTE' });

      const s = await login(f.preventista);
      expect((await pedir('POST', `/pagos/${pago.id}/validar`, { token: s.accessToken, body: { version: 1 } })).statusCode).toBe(403);
      const v = await administrar(pago.id, 'validar', { version: 1 });
      expect(v.statusCode).toBe(200);
      expect(v.json()).toMatchObject({ estado: 'VALIDADO', version: 2 });
      expect(v.json().validadoPor).toBeTruthy();
      expect(await cobro(fac.id)).toMatchObject({ saldo: '9', cobradoValidado: '20', cobradoPorValidar: '0', estado: 'PARCIAL' });
      expect(await prisma.eventoNegocio.count({ where: { idEntidad: pago.id, tipoEvento: { in: ['PAGO_REGISTRADO', 'PAGO_VALIDADO'] } } })).toBe(2);
    });

    it('un pago en bolívares abona a una factura en dólares con la tasa del día', async () => {
      const fac = await factura29();
      const r = await registrar({
        metodoPago: 'PAGO_MOVIL',
        entidadOrigen: '0134',
        referencia: String(Date.now()).slice(-10),
        moneda: 'VES',
        montoTotal: 1174.5,
        aplicaciones: [{ facturaId: fac.id, montoAplicado: 29 }],
      });
      expect(r.statusCode, JSON.stringify(r.json())).toBe(201);
      expect(r.json().aplicaciones).toMatchObject([{ montoAplicado: '29', montoMonedaPago: '1174.5', tasaCambio: '40.5' }]);
      expect(r.json().montoDisponible).toBe('0');
      await administrar(r.json().id, 'validar', { version: 1 });
      expect(await cobro(fac.id)).toMatchObject({ saldo: '0', estado: 'PAGADA' });
    });

    it('normaliza la referencia e impide registrarla dos veces, salvo que el pago se anule', async () => {
      const referencia = `0102-${String(Date.now()).slice(-6)}`;
      const body = { metodoPago: 'TRANSFERENCIA', entidadOrigen: '0102', moneda: 'USD', montoTotal: 5 };
      const r1 = await registrar({ ...body, referencia });
      expect(r1.json()).toMatchObject({ referenciaNormalizada: referencia.replace('-', ''), referenciaOriginal: referencia });
      const r2 = await registrar({ ...body, referencia: ` ${referencia.replace('-', ' ')} ` });
      expect(r2.statusCode).toBe(409);
      expect(r2.json().codigo).toBe('REFERENCIA_DUPLICADA');
      expect((await registrar({ ...body, referencia: 'ABC' })).statusCode).toBe(400);

      expect((await administrar(r1.json().id, 'anular', { version: 1, motivo: 'Registrado por error' })).json().estado).toBe('ANULADO');
      expect((await registrar({ ...body, referencia })).statusCode).toBe(201);
    });

    it('no abona más que el saldo (contando pagos por validar) ni más que el monto del pago', async () => {
      const fac = await factura29();
      expect((await transferencia(30, [{ facturaId: fac.id, montoAplicado: 30 }])).json()).toMatchObject({
        codigo: 'SALDO_EXCEDIDO',
        detalles: { saldo: '29' },
      });
      expect((await transferencia(10, [{ facturaId: fac.id, montoAplicado: 20 }])).json().codigo).toBe('APLICACIONES_EXCEDEN_PAGO');

      const primero = (await transferencia(29, [{ facturaId: fac.id, montoAplicado: 29 }])).json();
      expect((await transferencia(1, [{ facturaId: fac.id, montoAplicado: 1 }])).json()).toMatchObject({
        codigo: 'SALDO_EXCEDIDO',
        detalles: { saldo: '0' },
      });
      // Si Administración rechaza el primero, el saldo vuelve a estar disponible.
      const rechazo = await administrar(primero.id, 'rechazar', { version: 1, motivo: 'Transferencia no recibida' });
      expect(rechazo.json()).toMatchObject({ estado: 'RECHAZADO', motivoRechazo: 'Transferencia no recibida' });
      expect((await transferencia(1, [{ facturaId: fac.id, montoAplicado: 1 }])).statusCode).toBe(201);
      expect((await administrar(primero.id, 'validar', { version: 2 })).json().codigo).toBe('TRANSICION_INVALIDA');
    });

    it('el remanente de un pago se aplica después a otra factura', async () => {
      const a = await factura29();
      const b = await factura29();
      const pago = (await transferencia(50, [{ facturaId: a.id, montoAplicado: 29 }])).json();
      expect(pago.montoDisponible).toBe('21');
      const s = await login(f.preventista);
      const r = await pedir('POST', `/pagos/${pago.id}/aplicaciones`, {
        token: s.accessToken,
        body: { version: 1, aplicaciones: [{ facturaId: b.id, montoAplicado: 21 }] },
      });
      expect(r.statusCode, JSON.stringify(r.json())).toBe(200);
      expect(r.json()).toMatchObject({ montoAplicado: '50', montoDisponible: '0', version: 2 });
      expect(await prisma.eventoNegocio.count({ where: { idEntidad: pago.id, tipoEvento: 'PAGO_APLICADO' } })).toBe(1);
    });

    it('anular un pago validado devuelve la deuda', async () => {
      const fac = await factura29();
      const pago = (await transferencia(29, [{ facturaId: fac.id, montoAplicado: 29 }])).json();
      await administrar(pago.id, 'validar', { version: 1 });
      expect((await cobro(fac.id)).estado).toBe('PAGADA');
      expect((await administrar(pago.id, 'anular', { version: 2, motivo: 'Cheque devuelto' })).json().estado).toBe('ANULADO');
      expect(await cobro(fac.id)).toMatchObject({ saldo: '29', estado: 'PENDIENTE' });
    });

    it('efectivo no lleva referencia y usa CAJA; se puede adjuntar evidencia', async () => {
      const r = await registrar({
        metodoPago: 'EFECTIVO',
        moneda: 'USD',
        montoTotal: 3,
        entidadOrigen: 'BANCO X',
        evidencia: {
          mime: 'image/png',
          contenidoBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        },
      });
      expect(r.statusCode, JSON.stringify(r.json())).toBe(201);
      expect(r.json()).toMatchObject({ entidadOrigen: 'CAJA', referenciaNormalizada: null });
      expect(r.json().evidenciaArchivoId).toBeTruthy();
      expect((await registrar({ metodoPago: 'EFECTIVO', moneda: 'USD', montoTotal: 3, referencia: '123' })).statusCode).toBe(400);
    });

    it('reenviar el mismo pago (mismo id) no lo duplica', async () => {
      const id = randomUUID();
      const r1 = await transferencia(4, [], { id, referencia: '99' + String(Date.now()).slice(-8) });
      const r2 = await transferencia(4, [], { id, referencia: r1.json().referenciaOriginal });
      expect([r1.statusCode, r2.statusCode]).toEqual([201, 201]);
      expect(await prisma.pagoRecibido.count({ where: { id } })).toBe(1);
    });

    it('no abona a facturas anuladas ni de otro cliente; el preventista no cobra fuera de su cartera', async () => {
      const fac = await factura29();
      await pedir('POST', `/facturas/${fac.id}/anular`, { token: (await login(f.administracion)).accessToken, body: { version: 1, motivo: 'Prueba de anulación' } });
      expect((await transferencia(5, [{ facturaId: fac.id, montoAplicado: 5 }])).json().codigo).toBe('FACTURA_ANULADA');
      const ajena = await registrar({ metodoPago: 'EFECTIVO', moneda: 'USD', montoTotal: 3, clienteId: f.clienteAjeno });
      expect(ajena.statusCode).toBe(404);
      const morosa = await prisma.factura.findFirstOrThrow({ where: { clienteId: f.clienteMoroso } });
      expect((await transferencia(5, [{ facturaId: morosa.id, montoAplicado: 5 }])).json().codigo).toBe('FACTURA_INVALIDA');
    });

    it('el chofer cobra al cliente de una factura que lleva en ruta', async () => {
      // Cliente nuevo: el chofer no debe tener otras rutas abiertas con él.
      const cliente = await prisma.cliente.create({
        data: {
          tipoDocumento: 'J',
          nroDocumento: `${parseInt(sufijo, 16)}9`,
          razonSocial: 'Cliente de ruta',
          direccion: 'Calle 9',
          vendedorId: f.vendedorId,
          listaPrecioId: f.lista,
        },
      });
      const s = await login(f.preventista);
      const { pedido } = (await emitir(s.accessToken, [{ productoId: f.productoA, cantidad: 10 }], { clienteId: cliente.id })).json();
      await pedir('POST', `/pedidos/${pedido.id}/aprobar`, { token: (await login(f.ventas)).accessToken, body: { version: 1 } });
      const fac = (
        await pedir('POST', '/facturas', { token: (await login(f.facturacion)).accessToken, body: { pedidoId: pedido.id, versionPedido: 2 } })
      ).json();
      const logistica = (await login(`logistica-${sufijo}`)).accessToken;
      const chofer = await login(`chofer-${sufijo}`);
      const choferId = (await pedir('GET', '/auth/yo', { token: chofer.accessToken })).json().id;
      const vehiculo = (await pedir('POST', '/vehiculos', { token: logistica, body: { placa: `C${randomUUID().slice(0, 7)}` } })).json();
      const m = (await pedir('POST', '/manifiestos', { token: logistica, body: { vehiculoId: vehiculo.id, choferId, facturaIds: [fac.id] } })).json();
      const cobrar = () =>
        registrar(
          { clienteId: cliente.id, metodoPago: 'EFECTIVO', moneda: 'USD', montoTotal: 29, aplicaciones: [{ facturaId: fac.id, montoAplicado: 29 }] },
          chofer.accessToken,
          'APP_CHOFER',
        );

      expect((await cobrar()).statusCode).toBe(404);
      await pedir('POST', `/manifiestos/${m.id}/confirmar`, { token: logistica, body: { version: 1 } });
      await pedir('POST', `/manifiestos/${m.id}/iniciar-ruta`, { token: chofer.accessToken, body: { version: 2 } });
      const r = await cobrar();
      expect(r.statusCode, JSON.stringify(r.json())).toBe(201);
      expect(r.json().vendedorReceptorId).toBeNull();
      expect((await pedir('GET', `/pagos/${r.json().id}`, { token: chofer.accessToken })).statusCode).toBe(200);
    });

    it('el estado de cuenta muestra los pagos pendientes de validar', async () => {
      await transferencia(7);
      const s = await login(f.preventista);
      const estado = (await pedir('GET', `/clientes/${f.cliente}/estado-cuenta`, { token: s.accessToken })).json();
      const usd = estado.porMoneda.find((m: { moneda: string }) => m.moneda === 'USD');
      expect(Number(usd.pagosPorValidar)).toBeGreaterThanOrEqual(7);
    });
  });
  describe('datos maestros e inventario', () => {
    const token = async (u: string) => (await login(u)).accessToken;

    it('crea clientes con documento normalizado; crédito y vendedor exigen su propio permiso', async () => {
      const ventas = await token(f.ventas);
      const doc = `${Date.now()}`.slice(-8);
      const base = { tipoDocumento: 'J', nroDocumento: `J-${doc.slice(0, 4)}.${doc.slice(4)}-1`, razonSocial: 'Abasto Nuevo', direccion: 'Av. Principal' };
      const r = await pedir('POST', '/clientes', { token: ventas, body: { ...base, vendedorId: f.vendedorId, listaPrecioId: f.lista } });
      expect(r.statusCode, JSON.stringify(r.json())).toBe(201);
      expect(r.json().nroDocumento).toBe(`${doc}1`);
      expect((await pedir('POST', '/clientes', { token: ventas, body: base })).json().codigo).toBe('DUPLICADO');
      expect((await pedir('POST', '/clientes', { token: ventas, body: { ...base, nroDocumento: '99887766', limiteCredito: 100 } })).json()).toMatchObject({
        codigo: 'SIN_PERMISO',
        detalles: { faltantes: ['cliente.editar_credito'] },
      });

      // Administración cambia el cupo, pero no los datos generales.
      const admin = await token(f.administracion);
      const id = r.json().id;
      expect((await pedir('PATCH', `/clientes/${id}`, { token: admin, body: { limiteCredito: 500, diasCredito: 30 } })).json()).toMatchObject({
        limiteCredito: '500',
        diasCredito: 30,
      });
      expect((await pedir('PATCH', `/clientes/${id}`, { token: admin, body: { razonSocial: 'Otro' } })).statusCode).toBe(403);
      expect(await prisma.auditoria.count({ where: { tabla: 'clientes', registroId: id } })).toBe(2);
    });

    it('cambiar el vendedor cierra la asignación anterior y abre una nueva', async () => {
      const ventas = await token(f.ventas);
      const { id } = (
        await pedir('POST', '/clientes', {
          token: ventas,
          body: { tipoDocumento: 'V', nroDocumento: `${Date.now()}`.slice(-9), razonSocial: 'Bodega', direccion: 'Calle 5', vendedorId: f.vendedorId },
        })
      ).json();
      await pedir('PATCH', `/clientes/${id}`, { token: ventas, body: { vendedorId: f.otroVendedorId } });
      const detalle = (await pedir('GET', `/clientes/${id}`, { token: ventas })).json();
      expect(detalle.vendedorId).toBe(f.otroVendedorId);
      expect(detalle.historialVendedor.map((h: { vendedorId: string; fechaHasta: string | null }) => [h.vendedorId, h.fechaHasta === null])).toEqual([
        [f.otroVendedorId, true],
        [f.vendedorId, false],
      ]);
    });

    it('productos y precios versionados: publicar cierra la versión vigente', async () => {
      const admin = await token(f.administracion);
      const sku = `N-${randomUUID().slice(0, 6)}`;
      const p = await pedir('POST', '/productos', { token: admin, body: { sku, nombre: 'Harina 1kg', unidad: 'UND' } });
      expect(p.statusCode, JSON.stringify(p.json())).toBe(201);
      expect(p.json()).toMatchObject({ sku: sku.toUpperCase(), alicuotaIva: '16' });
      expect((await pedir('POST', '/productos', { token: admin, body: { sku, nombre: 'Otro', unidad: 'UND' } })).json().codigo).toBe('DUPLICADO');
      expect((await pedir('PATCH', `/productos/${p.json().id}`, { token: admin, body: { stockMinimo: 10 } })).json().stockMinimo).toBe('10');

      const publicar = (precio: number, vigenteDesde?: string) =>
        pedir('POST', `/listas-precio/${f.lista}/precios`, { token: admin, body: { productoId: p.json().id, precio, vigenteDesde } });
      const ayer = new Date(Date.now() - 86_400_000).toISOString();
      expect((await publicar(1.5, ayer)).statusCode).toBe(201);
      expect((await publicar(1.75)).statusCode).toBe(201);
      expect((await publicar(2, ayer)).json().codigo).toBe('VIGENCIA_INVALIDA');

      const historial = (await pedir('GET', `/listas-precio/${f.lista}/precios?productoId=${p.json().id}`, { token: admin })).json();
      expect(historial.map((h: { precio: string; vigenteHasta: string | null }) => [h.precio, h.vigenteHasta === null])).toEqual([
        ['1.75', true],
        ['1.5', false],
      ]);
      const catalogo = (await pedir('GET', `/catalogo?listaPrecioId=${f.lista}`, { token: admin })).json();
      expect(catalogo.productos.find((x: { id: string }) => x.id === p.json().id).precio).toBe('1.75');
    });

    it('ingresos y ajustes de inventario quedan en el libro y no dejan stock negativo', async () => {
      const admin = await token(f.administracion);
      const logistica = await token(`logistica-${sufijo}`);
      const sku = `I-${randomUUID().slice(0, 6)}`;
      const producto = (await pedir('POST', '/productos', { token: admin, body: { sku, nombre: 'Aceite', unidad: 'UND', stockMinimo: 50 } })).json();

      const ingreso = await pedir('POST', '/inventario/ingresos', { token: logistica, body: { productoId: producto.id, cantidad: 40, documento: 'NE-001' } });
      expect(ingreso.statusCode, JSON.stringify(ingreso.json())).toBe(201);
      expect(ingreso.json()).toMatchObject({ tipo: 'INGRESO', cantidadEntrada: '40', motivo: 'NE-001' });
      expect((await pedir('POST', '/inventario/ajustes', { token: logistica, body: { productoId: producto.id, cantidad: -1, motivo: 'Merma' } })).statusCode).toBe(403);
      expect((await pedir('POST', '/inventario/ajustes', { token: admin, body: { productoId: producto.id, cantidad: -41, motivo: 'Conteo físico' } })).json().codigo).toBe('REGLA_VIOLADA');
      expect((await pedir('POST', '/inventario/ajustes', { token: admin, body: { productoId: producto.id, cantidad: -5, motivo: 'Merma' } })).statusCode).toBe(201);

      const existencias = (await pedir('GET', '/inventario/existencias?tipo=ALMACEN', { token: logistica })).json();
      expect(existencias.find((e: { productoId: string }) => e.productoId === producto.id)).toMatchObject({
        fisico: '35',
        disponible: '35',
        bajoMinimo: true,
        diferenciaCache: '0',
      });
      expect((await pedir('GET', '/inventario/existencias', { token: await token(f.preventista) })).statusCode).toBe(403);
    });

    it('catálogos de rutas, vendedores, choferes, usuarios y roles', async () => {
      const ventas = await token(f.ventas);
      const ruta = await pedir('POST', '/rutas', { token: ventas, body: { codigo: `R-${sufijo}`, nombre: 'Ruta Centro', vendedorId: f.vendedorId } });
      expect(ruta.statusCode).toBe(201);
      expect((await pedir('GET', '/rutas', { token: ventas })).json().some((r: { id: string }) => r.id === ruta.json().id)).toBe(true);
      expect((await pedir('GET', '/vendedores', { token: ventas })).json().some((v: { id: string }) => v.id === f.vendedorId)).toBe(true);
      const choferes = (await pedir('GET', '/choferes', { token: await token(`logistica-${sufijo}`) })).json();
      expect(choferes.some((c: { username: string }) => c.username === `chofer-${sufijo}`)).toBe(true);

      const admin = await token(f.admin);
      const usuarios = (await pedir('GET', '/usuarios', { token: admin })).json();
      expect(usuarios.some((u: { username: string }) => u.username === 'sistema')).toBe(false);
      expect((await pedir('GET', '/roles', { token: admin })).json().map((r: { codigo: string }) => r.codigo)).toContain('CHOFER');
      expect((await pedir('GET', '/usuarios', { token: ventas })).statusCode).toBe(403);
    });
  });
  describe('rutas y visitas', () => {
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date());
    const diaHoy = ((d) => (d === 0 ? 7 : d))(new Date(`${hoy}T12:00:00Z`).getUTCDay());
    const GPS = { latitud: 10.5, longitud: -66.9 };
    let rutaId: string;
    let clienteFuera: string;
    let visitaId: string;

    const movilPrev = async () => ({ token: (await login(f.preventista)).accessToken, cabeceras: { 'x-origen': 'APP_PREVENTISTA', 'idempotency-key': randomUUID() } });
    const agenda = async (q = '') => (await pedir('GET', `/visitas/agenda${q}`, { token: (await login(f.preventista)).accessToken })).json();

    beforeAll(async () => {
      const ventas = (await login(f.ventas)).accessToken;
      rutaId = (await pedir('POST', '/rutas', { token: ventas, body: { codigo: `V-${sufijo}`, nombre: 'Ruta de visitas', vendedorId: f.vendedorId } })).json().id;
      clienteFuera = (
        await prisma.cliente.create({
          data: { tipoDocumento: 'J', nroDocumento: `${parseInt(sufijo, 16)}7`, razonSocial: 'Fuera de plan', direccion: 'Calle 7', vendedorId: f.vendedorId, listaPrecioId: f.lista },
        })
      ).id;
    });

    it('planifica el día de la semana y solo quien tiene permiso puede hacerlo', async () => {
      const ventas = (await login(f.ventas)).accessToken;
      const r = await pedir('POST', `/rutas/${rutaId}/plan`, { token: ventas, body: { diaSemana: diaHoy, clienteIds: [f.cliente, f.clienteMoroso] } });
      expect(r.statusCode, JSON.stringify(r.json())).toBe(201);
      expect(r.json().map((p: { clienteId: string; orden: number }) => [p.clienteId, p.orden])).toEqual([
        [f.cliente, 1],
        [f.clienteMoroso, 2],
      ]);
      const s = (await login(f.preventista)).accessToken;
      expect((await pedir('POST', `/rutas/${rutaId}/plan`, { token: s, body: { diaSemana: diaHoy, clienteIds: [] } })).statusCode).toBe(403);
    });

    it('la agenda de hoy se genera desde el plan', async () => {
      const a = await agenda();
      expect(a).toMatchObject({ fecha: hoy, vendedorId: f.vendedorId, previsualizacion: false, resumen: { planificadas: 2, visitadas: 0, cumplimiento: 0 } });
      expect(a.planificadas.map((p: { clienteId: string }) => p.clienteId)).toEqual([f.cliente, f.clienteMoroso]);
    });

    it('una visita planificada se inicia con GPS, ampara el pedido y se cierra con resultado', async () => {
      visitaId = randomUUID();
      const inicio = { id: visitaId, clienteId: f.cliente, inicioEn: new Date().toISOString(), ...GPS };
      const r = await pedir('POST', '/visitas', { ...(await movilPrev()), body: inicio });
      expect(r.statusCode, JSON.stringify(r.json())).toBe(201);
      expect(r.json().visitaPlanificadaId).toBeTruthy();
      expect((await pedir('POST', '/visitas', { ...(await movilPrev()), body: inicio })).json().id).toBe(visitaId);

      const pedido = await pedir('POST', '/pedidos', { ...(await movilPrev()), body: { clienteId: f.cliente, visitaId, items: [{ productoId: f.productoA, cantidad: 1 }] } });
      expect(pedido.statusCode).toBe(201);
      expect(pedido.json().pedido.visitaId).toBe(visitaId);

      const sinMotivo = await pedir('POST', `/visitas/${visitaId}/cerrar`, { ...(await movilPrev()), body: { resultado: 'SIN_PEDIDO', finEn: new Date().toISOString() } });
      expect(sinMotivo.statusCode).toBe(400);
      const cierre = await pedir('POST', `/visitas/${visitaId}/cerrar`, { ...(await movilPrev()), body: { resultado: 'PEDIDO', finEn: new Date().toISOString() } });
      expect(cierre.statusCode, JSON.stringify(cierre.json())).toBe(200);
      expect(cierre.json().resultado).toBe('PEDIDO');
      expect((await pedir('POST', `/visitas/${visitaId}/cerrar`, { ...(await movilPrev()), body: { resultado: 'COBRO', finEn: new Date().toISOString() } })).json().codigo).toBe('VISITA_CERRADA');
      const eventos = await prisma.eventoNegocio.findMany({ where: { idEntidad: visitaId }, orderBy: { fechaHoraUtc: 'asc' } });
      expect(eventos.map((e) => e.tipoEvento)).toEqual(['VISITA_INICIADA', 'VISITA_CERRADA']);
    });

    it('una visita a un cliente fuera del plan cuenta aparte', async () => {
      const id = randomUUID();
      await pedir('POST', '/visitas', { ...(await movilPrev()), body: { id, clienteId: clienteFuera, inicioEn: new Date().toISOString(), ...GPS } });
      await pedir('POST', `/visitas/${id}/cerrar`, { ...(await movilPrev()), body: { resultado: 'CLIENTE_CERRADO', motivoSinVenta: 'Local cerrado', finEn: new Date().toISOString() } });
      const a = await agenda();
      expect(a.resumen).toEqual({ planificadas: 2, visitadas: 1, fueraDePlan: 1, efectivas: 1, cumplimiento: 0.5 });
      expect(a.fueraDePlan).toMatchObject([{ resultado: 'CLIENTE_CERRADO', cliente: { razonSocial: 'Fuera de plan' } }]);
    });

    it('el indicador de cumplimiento en Power BI refleja la agenda', async () => {
      const [fila] = await prisma.$queryRaw<{ planificadas: bigint; planificadas_visitadas: bigint; fuera_de_plan: bigint; efectivas: bigint }[]>`
        SELECT planificadas, planificadas_visitadas, fuera_de_plan, efectivas FROM bi.v_cumplimiento_visitas
        WHERE fecha = ${hoy}::date AND vendedor_id = ${f.vendedorId}::uuid`;
      expect(fila).toEqual({ planificadas: 2n, planificadas_visitadas: 1n, fuera_de_plan: 1n, efectivas: 1n });
    });

    it('cancelar una visita planificada la saca del cumplimiento', async () => {
      const a = await agenda();
      const pendiente = a.planificadas.find((p: { clienteId: string }) => p.clienteId === f.clienteMoroso);
      const ventas = (await login(f.ventas)).accessToken;
      const r = await pedir('POST', `/visitas-planificadas/${pendiente.id}/cancelar`, { token: ventas, body: { motivo: 'Cliente de vacaciones' } });
      expect(r.json()).toMatchObject({ estado: 'CANCELADA' });
      expect((await agenda()).resumen).toMatchObject({ planificadas: 1, visitadas: 1, cumplimiento: 1 });
      const realizada = a.planificadas.find((p: { clienteId: string }) => p.clienteId === f.cliente);
      expect((await pedir('POST', `/visitas-planificadas/${realizada.id}/cancelar`, { token: ventas, body: { motivo: 'X y Z' } })).json().codigo).toBe('NO_CANCELABLE');
    });

    it('reemplazar el plan deja historial y muestra la agenda futura sin guardarla', async () => {
      const ventas = (await login(f.ventas)).accessToken;
      await pedir('POST', `/rutas/${rutaId}/plan`, { token: ventas, body: { diaSemana: diaHoy, clienteIds: [f.cliente] } });
      const ruta = (await pedir('GET', `/rutas/${rutaId}`, { token: ventas })).json();
      expect(ruta.planClientes.map((p: { clienteId: string }) => p.clienteId)).toEqual([f.cliente]);
      expect(await prisma.rutaPlanCliente.count({ where: { rutaId, vigenteHasta: { not: null } } })).toBe(2);

      const enUnaSemana = new Date(`${hoy}T12:00:00Z`);
      enUnaSemana.setUTCDate(enUnaSemana.getUTCDate() + 7);
      const futura = await agenda(`?fecha=${enUnaSemana.toISOString().slice(0, 10)}`);
      expect(futura).toMatchObject({ previsualizacion: true, resumen: { planificadas: 1 } });
      expect(futura.planificadas[0].id).toBeNull();
    });

    it('el chofer no registra visitas y supervisión ve la agenda de cualquier vendedor', async () => {
      const chofer = (await login(`chofer-${sufijo}`)).accessToken;
      const r = await pedir('POST', '/visitas', { token: chofer, body: { id: randomUUID(), clienteId: f.cliente, inicioEn: new Date().toISOString(), ...GPS } });
      expect(r.statusCode).toBe(403);
      const ventas = (await login(f.ventas)).accessToken;
      expect((await pedir('GET', '/visitas/agenda', { token: ventas })).json().codigo).toBe('VENDEDOR_REQUERIDO');
      expect((await pedir('GET', `/visitas/agenda?vendedorId=${f.vendedorId}`, { token: ventas })).json().resumen.visitadas).toBe(1);
    });
  });
});
