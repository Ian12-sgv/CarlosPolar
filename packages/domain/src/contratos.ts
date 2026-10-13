/**
 * Contratos de las solicitudes a la API. La API los usa para validar y las
 * apps (web y móvil) para validar antes de enviar o de guardar offline.
 */
import { z } from 'zod';
import { METODOS_PAGO, validarReferencia } from './pagos.js';

const texto = (min = 1, max = 500) => z.string().trim().min(min).max(max);
const latitud = z.number().min(-90).max(90);
const longitud = z.number().min(-180).max(180);
/** Cantidades y montos con hasta 3 decimales. */
const cantidad = z.number().positive().max(1e9).multipleOf(0.001);
const version = z.number().int().positive();

// ───────────────────────── Autenticación ─────────────────────────

export const iniciarSesionSchema = z.object({
  username: texto(3, 60).toLowerCase(),
  password: z.string().min(1).max(200),
  dispositivo: z.object({
    identificador: texto(8, 200),
    plataforma: z.enum(['android', 'ios', 'web']),
    nombre: texto(1, 120).optional(),
  }),
});
export type IniciarSesion = z.infer<typeof iniciarSesionSchema>;

export const refrescarSesionSchema = z.object({
  refreshToken: z.string().min(20).max(200),
});
export type RefrescarSesion = z.infer<typeof refrescarSesionSchema>;

export const crearUsuarioSchema = z.object({
  username: texto(3, 60)
    .toLowerCase()
    .regex(/^[a-z0-9._-]+$/, 'solo letras, números, punto, guion y guion bajo'),
  nombre: texto(2, 120),
  password: z.string().min(10, 'mínimo 10 caracteres').max(200),
  roles: z.array(texto(2, 40)).min(1),
  /** Si se indica, el usuario queda registrado como vendedor (preventista). */
  codigoVendedor: texto(1, 20).optional(),
});
export type CrearUsuario = z.infer<typeof crearUsuarioSchema>;

// ───────────────────────── Pedidos ─────────────────────────

export const emitirPedidoSchema = z.object({
  /** Id generado por el dispositivo; reenviar el mismo id no duplica el pedido. */
  id: z.uuid().optional(),
  clienteId: z.uuid(),
  visitaId: z.uuid().optional(),
  items: z
    .array(
      z.object({
        productoId: z.uuid(),
        cantidad,
        /** Precio que vio el preventista. Si ya no es el vigente, el pedido se rechaza con los precios nuevos. */
        precioOfertado: z.number().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(200)
    .refine((items) => new Set(items.map((i) => i.productoId)).size === items.length, {
      message: 'un producto no puede repetirse en el pedido',
    }),
  observaciones: texto(1, 1000).optional(),
  latitud: latitud.optional(),
  longitud: longitud.optional(),
  /** Momento en que se tomó el pedido en el dispositivo (puede ser anterior si hubo modo offline). */
  fechaHoraDispositivo: z.iso.datetime({ offset: true }).optional(),
});
export type EmitirPedido = z.infer<typeof emitirPedidoSchema>;

export const aprobarPedidoSchema = z.object({
  version,
  /** Reservar lo disponible aunque no alcance para todas las líneas. */
  aceptarFaltantes: z.boolean().default(false),
  /** Aprobar aunque el cliente supere su cupo o tenga deuda vencida (requiere permiso). */
  excepcionCredito: z.object({ motivo: texto(5, 500) }).optional(),
});
export type AprobarPedido = z.infer<typeof aprobarPedidoSchema>;

export const cerrarPedidoSchema = z.object({
  version,
  motivo: texto(3, 500),
});
export type CerrarPedido = z.infer<typeof cerrarPedidoSchema>;

export const ESTADOS_PEDIDO = ['EMITIDO', 'APROBADO', 'RECHAZADO', 'CANCELADO', 'FACTURADO'] as const;

export const listarPedidosSchema = z.object({
  estado: z.enum(ESTADOS_PEDIDO).optional(),
  clienteId: z.uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListarPedidos = z.infer<typeof listarPedidosSchema>;

// ───────────────────────── Facturación ─────────────────────────

export const emitirFacturaSchema = z.object({
  pedidoId: z.uuid(),
  /** Versión del pedido que vio Facturación (control de concurrencia). */
  versionPedido: version,
  /**
   * Cantidades a facturar por línea. Si se omite, se factura lo reservado.
   * Una línea con cantidad 0 o ausente no se factura y su reserva se libera.
   */
  lineas: z
    .array(z.object({ pedidoItemId: z.uuid(), cantidad: z.number().nonnegative().max(1e9).multipleOf(0.001) }))
    .max(200)
    .refine((l) => new Set(l.map((x) => x.pedidoItemId)).size === l.length, { message: 'una línea no puede repetirse' })
    .optional(),
});
export type EmitirFactura = z.infer<typeof emitirFacturaSchema>;

export const anularFacturaSchema = z.object({
  version,
  motivo: texto(5, 500),
});
export type AnularFactura = z.infer<typeof anularFacturaSchema>;

export const asignarNumeroControlSchema = z.object({
  numeroControl: texto(1, 40),
});
export type AsignarNumeroControl = z.infer<typeof asignarNumeroControlSchema>;

export const ESTADOS_FACTURA = ['EMITIDA', 'DESPACHADA', 'ENTREGADA', 'ANULADA'] as const;

export const listarFacturasSchema = z.object({
  estado: z.enum(ESTADOS_FACTURA).optional(),
  clienteId: z.uuid().optional(),
  sinNumeroControl: z.stringbool().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListarFacturas = z.infer<typeof listarFacturasSchema>;

export const registrarTasaSchema = z.object({
  /** Fecha valor de la tasa (AAAA-MM-DD). */
  fecha: z.iso.date(),
  /** Bolívares por dólar. */
  tasa: z.number().positive().max(1e12),
  fuente: texto(2, 20).toUpperCase().default('BCV'),
});
export type RegistrarTasa = z.infer<typeof registrarTasaSchema>;

// ───────────────────────── Despacho ─────────────────────────

export const crearVehiculoSchema = z.object({
  placa: texto(4, 12).toUpperCase().regex(/^[A-Z0-9-]+$/, 'solo letras, números y guion'),
  descripcion: texto(1, 200).optional(),
});
export type CrearVehiculo = z.infer<typeof crearVehiculoSchema>;

const idsFacturas = z
  .array(z.uuid())
  .max(200)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'una factura no puede repetirse' });

export const crearManifiestoSchema = z.object({
  vehiculoId: z.uuid(),
  choferId: z.uuid(),
  facturaIds: idsFacturas.default([]),
});
export type CrearManifiesto = z.infer<typeof crearManifiestoSchema>;

export const agregarFacturasSchema = z.object({
  version,
  facturaIds: idsFacturas.min(1),
});
export type AgregarFacturas = z.infer<typeof agregarFacturasSchema>;

export const versionSchema = z.object({ version });
export type ConVersion = z.infer<typeof versionSchema>;

export const iniciarRutaSchema = z.object({
  version,
  latitud: latitud.optional(),
  longitud: longitud.optional(),
  fechaHoraDispositivo: z.iso.datetime({ offset: true }).optional(),
});
export type IniciarRuta = z.infer<typeof iniciarRutaSchema>;

export const anularManifiestoSchema = z.object({
  version,
  motivo: texto(5, 500),
});
export type AnularManifiesto = z.infer<typeof anularManifiestoSchema>;

export const cerrarManifiestoSchema = z.object({
  version,
  /** Conteo físico de lo que regresa en el vehículo, por producto. Debe incluir todo producto con saldo esperado. */
  conteo: z
    .array(z.object({ productoId: z.uuid(), cantidad: z.number().nonnegative().max(1e9).multipleOf(0.001) }))
    .max(500)
    .refine((c) => new Set(c.map((x) => x.productoId)).size === c.length, { message: 'un producto no puede repetirse' }),
  /** Obligatorio si el conteo no coincide con lo esperado; las diferencias se registran como ajuste. */
  motivoDiferencias: texto(5, 500).optional(),
});
export type CerrarManifiesto = z.infer<typeof cerrarManifiestoSchema>;

export const ESTADOS_MANIFIESTO = ['BORRADOR', 'CONFIRMADO', 'EN_RUTA', 'CERRADO', 'ANULADO'] as const;

export const listarManifiestosSchema = z.object({
  estado: z.enum(ESTADOS_MANIFIESTO).optional(),
  choferId: z.uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListarManifiestos = z.infer<typeof listarManifiestosSchema>;

// ───────────────────────── Entregas ─────────────────────────

/** Tamaño máximo de una imagen (firma o foto) ya decodificada. */
export const MAX_IMAGEN_BYTES = 512 * 1024;

export const imagenSchema = z.object({
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  /** Contenido en base64 (sin prefijo `data:`). */
  contenidoBase64: z.base64().max(Math.ceil((MAX_IMAGEN_BYTES * 4) / 3) + 4, 'la imagen supera 512 KB'),
});
export type Imagen = z.infer<typeof imagenSchema>;

export const registrarEntregaSchema = z
  .object({
    /** Id generado por el dispositivo; reenviar el mismo id no duplica la entrega. */
    id: z.uuid().optional(),
    facturaId: z.uuid(),
    /** En el MVP la entrega es total o el rechazo es total. */
    resultado: z.enum(['CONFIRMADA', 'RECHAZADA']),
    fechaHoraDispositivo: z.iso.datetime({ offset: true }).optional(),
    latitud,
    longitud,
    precisionMetros: z.number().nonnegative().max(100_000).optional(),
    receptorNombre: texto(2, 120).optional(),
    receptorDocumento: texto(3, 20).optional(),
    motivoRechazo: texto(3, 500).optional(),
    observaciones: texto(1, 1000).optional(),
    firma: imagenSchema.optional(),
  })
  .superRefine((e, ctx) => {
    if (e.resultado === 'CONFIRMADA') {
      if (!e.receptorNombre) ctx.addIssue({ code: 'custom', path: ['receptorNombre'], message: 'obligatorio al confirmar la entrega' });
      if (!e.firma) ctx.addIssue({ code: 'custom', path: ['firma'], message: 'obligatoria al confirmar la entrega' });
    } else if (!e.motivoRechazo) {
      ctx.addIssue({ code: 'custom', path: ['motivoRechazo'], message: 'obligatorio al rechazar' });
    }
  });
export type RegistrarEntrega = z.infer<typeof registrarEntregaSchema>;

export const anularEntregaSchema = z.object({
  motivo: texto(5, 500),
});
export type AnularEntrega = z.infer<typeof anularEntregaSchema>;

export const listarEntregasSchema = z.object({
  manifiestoId: z.uuid().optional(),
  facturaId: z.uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListarEntregas = z.infer<typeof listarEntregasSchema>;

// ───────────────────────── Cobranza ─────────────────────────

const monto = z.number().positive().max(1e12).multipleOf(0.01);

const aplicaciones = z
  .array(
    z.object({
      facturaId: z.uuid(),
      /** Monto que se abona a la factura, en la moneda de la factura. */
      montoAplicado: monto,
    }),
  )
  .max(100)
  .refine((a) => new Set(a.map((x) => x.facturaId)).size === a.length, { message: 'una factura no puede repetirse' });

export const registrarPagoSchema = z
  .object({
    /** Id generado por el dispositivo; reenviar el mismo id no duplica el pago. */
    id: z.uuid().optional(),
    clienteId: z.uuid(),
    metodoPago: z.enum(METODOS_PAGO),
    /** Banco o entidad emisora (p. ej. código 0102). Para efectivo se ignora y se usa CAJA. */
    entidadOrigen: texto(2, 40).toUpperCase().optional(),
    referencia: z.string().max(60).optional(),
    moneda: z.enum(['USD', 'VES']),
    montoTotal: monto,
    /** Fecha en que el cliente hizo el pago (AAAA-MM-DD). */
    fechaEmision: z.iso.date(),
    /** Facturas a las que se abona. Lo no aplicado queda disponible para aplicar después. */
    aplicaciones: aplicaciones.default([]),
    evidencia: imagenSchema.optional(),
    visitaId: z.uuid().optional(),
    latitud: latitud.optional(),
    longitud: longitud.optional(),
    fechaHoraDispositivo: z.iso.datetime({ offset: true }).optional(),
  })
  .superRefine((p, ctx) => {
    const ref = validarReferencia(p.metodoPago, p.referencia);
    if (!ref.ok) ctx.addIssue({ code: 'custom', path: ['referencia'], message: ref.motivo });
    if (p.metodoPago !== 'EFECTIVO' && !p.entidadOrigen) {
      ctx.addIssue({ code: 'custom', path: ['entidadOrigen'], message: `obligatorio para ${p.metodoPago}` });
    }
  });
export type RegistrarPago = z.infer<typeof registrarPagoSchema>;

export const aplicarPagoSchema = z.object({
  version,
  aplicaciones: aplicaciones.min(1),
});
export type AplicarPago = z.infer<typeof aplicarPagoSchema>;

export const cerrarPagoSchema = z.object({
  version,
  motivo: texto(5, 500),
});
export type CerrarPago = z.infer<typeof cerrarPagoSchema>;

export const ESTADOS_PAGO = ['REGISTRADO', 'VALIDADO', 'RECHAZADO', 'ANULADO'] as const;

export const listarPagosSchema = z.object({
  estado: z.enum(ESTADOS_PAGO).optional(),
  clienteId: z.uuid().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListarPagos = z.infer<typeof listarPagosSchema>;

// ───────────────────────── Datos maestros ─────────────────────────

export const TIPOS_DOCUMENTO = ['V', 'E', 'J', 'G', 'P'] as const;
const monedaSchema = z.enum(['USD', 'VES']);
const porcentaje = z.number().min(0).max(100).multipleOf(0.01);

const datosCliente = {
  razonSocial: texto(2, 200),
  direccion: texto(3, 500),
  telefono: texto(7, 30).optional(),
  latitud: latitud.optional(),
  longitud: longitud.optional(),
  rutaId: z.uuid().nullable().optional(),
  listaPrecioId: z.uuid().nullable().optional(),
};
const datosCredito = {
  /** Null = sin crédito (solo contado). */
  limiteCredito: z.number().nonnegative().max(1e12).multipleOf(0.01).nullable().optional(),
  monedaCredito: monedaSchema.optional(),
  diasCredito: z.number().int().min(0).max(365).optional(),
};

export const crearClienteSchema = z.object({
  tipoDocumento: z.enum(TIPOS_DOCUMENTO),
  /** Se guardan solo los dígitos (sin guiones ni puntos). */
  nroDocumento: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .pipe(z.string().min(5, 'mínimo 5 dígitos').max(12)),
  ...datosCliente,
  vendedorId: z.uuid().nullable().optional(),
  ...datosCredito,
});
export type CrearCliente = z.infer<typeof crearClienteSchema>;

export const editarClienteSchema = z
  .object({ ...datosCliente, ...datosCredito, vendedorId: z.uuid().nullable().optional(), activo: z.boolean().optional() })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'no hay cambios' });
export type EditarCliente = z.infer<typeof editarClienteSchema>;

export const crearProductoSchema = z.object({
  sku: texto(1, 40).toUpperCase(),
  nombre: texto(2, 200),
  unidad: texto(1, 20),
  alicuotaIva: porcentaje.default(16),
  stockMinimo: z.number().nonnegative().max(1e9).multipleOf(0.001).default(0),
});
export type CrearProducto = z.infer<typeof crearProductoSchema>;

export const editarProductoSchema = z
  .object({
    nombre: texto(2, 200),
    unidad: texto(1, 20),
    alicuotaIva: porcentaje,
    stockMinimo: z.number().nonnegative().max(1e9).multipleOf(0.001),
    activo: z.boolean(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'no hay cambios' });
export type EditarProducto = z.infer<typeof editarProductoSchema>;

export const crearListaPrecioSchema = z.object({
  codigo: texto(1, 20).toUpperCase(),
  nombre: texto(2, 100),
  moneda: monedaSchema,
});
export type CrearListaPrecio = z.infer<typeof crearListaPrecioSchema>;

export const publicarPrecioSchema = z.object({
  productoId: z.uuid(),
  precio: z.number().nonnegative().max(1e12).multipleOf(0.0001),
  /** Desde cuándo rige. Por defecto, ahora. La versión anterior se cierra en ese instante. */
  vigenteDesde: z.iso.datetime({ offset: true }).optional(),
});
export type PublicarPrecio = z.infer<typeof publicarPrecioSchema>;

export const crearRutaSchema = z.object({
  codigo: texto(1, 20).toUpperCase(),
  nombre: texto(2, 100),
  vendedorId: z.uuid().nullable().optional(),
});
export type CrearRuta = z.infer<typeof crearRutaSchema>;

// ───────────────────────── Inventario ─────────────────────────

export const ingresoInventarioSchema = z.object({
  productoId: z.uuid(),
  cantidad,
  /** Documento de respaldo (nota de entrega del proveedor, orden de compra…). */
  documento: texto(1, 60).optional(),
  motivo: texto(3, 300).optional(),
});
export type IngresoInventario = z.infer<typeof ingresoInventarioSchema>;

export const ajusteInventarioSchema = z.object({
  productoId: z.uuid(),
  /** Positivo suma, negativo resta. */
  cantidad: z
    .number()
    .min(-1e9)
    .max(1e9)
    .multipleOf(0.001)
    .refine((c) => c !== 0, { message: 'no puede ser cero' }),
  motivo: texto(5, 300),
});
export type AjusteInventario = z.infer<typeof ajusteInventarioSchema>;

// ───────────────────────── Rutas y visitas ─────────────────────────

export const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const;

export const guardarPlanDiaSchema = z.object({
  /** 1 = lunes … 7 = domingo. */
  diaSemana: z.number().int().min(1).max(7),
  /** Clientes en orden de visita. Reemplaza el plan vigente de ese día. */
  clienteIds: z
    .array(z.uuid())
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'un cliente no puede repetirse en el día' }),
});
export type GuardarPlanDia = z.infer<typeof guardarPlanDiaSchema>;

export const editarRutaSchema = z
  .object({ nombre: texto(2, 100), vendedorId: z.uuid().nullable(), activo: z.boolean() })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'no hay cambios' });
export type EditarRuta = z.infer<typeof editarRutaSchema>;

export const iniciarVisitaSchema = z.object({
  /** Id generado por el dispositivo: los pedidos y cobros de la visita lo referencian aunque no haya conexión. */
  id: z.uuid(),
  clienteId: z.uuid(),
  inicioEn: z.iso.datetime({ offset: true }),
  latitud,
  longitud,
  precisionMetros: z.number().nonnegative().max(100_000).optional(),
});
export type IniciarVisita = z.infer<typeof iniciarVisitaSchema>;

export const RESULTADOS_VISITA = ['PEDIDO', 'COBRO', 'PEDIDO_Y_COBRO', 'SIN_PEDIDO', 'CLIENTE_CERRADO', 'NO_ATENDIDO'] as const;
export type ResultadoVisita = (typeof RESULTADOS_VISITA)[number];

export const cerrarVisitaSchema = z
  .object({
    resultado: z.enum(RESULTADOS_VISITA),
    finEn: z.iso.datetime({ offset: true }),
    motivoSinVenta: texto(3, 300).optional(),
    observaciones: texto(1, 1000).optional(),
  })
  .superRefine((v, ctx) => {
    if (['SIN_PEDIDO', 'CLIENTE_CERRADO', 'NO_ATENDIDO'].includes(v.resultado) && !v.motivoSinVenta) {
      ctx.addIssue({ code: 'custom', path: ['motivoSinVenta'], message: 'obligatorio si no hubo venta ni cobro' });
    }
  });
export type CerrarVisita = z.infer<typeof cerrarVisitaSchema>;

export const consultarAgendaSchema = z.object({
  fecha: z.iso.date().optional(),
  vendedorId: z.uuid().optional(),
});
export type ConsultarAgenda = z.infer<typeof consultarAgendaSchema>;

export const cancelarVisitaPlanSchema = z.object({ motivo: texto(3, 300) });
export type CancelarVisitaPlan = z.infer<typeof cancelarVisitaPlanSchema>;
