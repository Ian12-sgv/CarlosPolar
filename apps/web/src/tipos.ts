/** Formas de las respuestas de la API que usa el backoffice. Los decimales llegan como texto. */

export interface ClienteResumen {
  id: string;
  tipoDocumento: string;
  nroDocumento: string;
  razonSocial: string;
  direccion: string;
  telefono: string | null;
  rutaId: string | null;
  vendedorId: string | null;
  listaPrecioId: string | null;
  limiteCredito: string | null;
  monedaCredito: string;
  diasCredito: number;
  activo: boolean;
}

export interface Restriccion {
  codigo: string;
  mensaje: string;
}

export interface EstadoCuenta {
  porMoneda: {
    moneda: string;
    saldo: string;
    vencido: string;
    proximoAVencer: string;
    cobradoPorValidar: string;
    pagosPorValidar: string;
    pedidosAprobados: string;
  }[];
  facturas: { facturaId: string; numero: string; moneda: string; total: string; saldo: string; fechaVencimiento: string; diasVencido: number }[];
  credito: { limite: string; utilizado: string; disponible: string } | null;
  monedaCredito: string;
  restricciones: Restriccion[];
  bloqueado: boolean;
}

export interface PedidoResumen {
  id: string;
  numero: string;
  estado: string;
  clienteId: string;
  vendedorResponsableId: string;
  moneda: string;
  total: string;
  fechaEmision: string;
  version: number;
  cliente: { razonSocial: string };
}

export interface PedidoDetalle extends PedidoResumen {
  subtotal: string;
  impuesto: string;
  observaciones: string | null;
  motivoEstado: string | null;
  cliente: { razonSocial: string; tipoDocumento: string; nroDocumento: string };
  items: {
    id: string;
    linea: number;
    productoId: string;
    cantidad: string;
    precioOfertado: string;
    alicuotaIva: string;
    producto: { sku: string; nombre: string; unidad: string };
    reservas: { id: string; cantidad: string; venceEn: string | null }[];
  }[];
}

export interface FacturaResumen {
  id: string;
  numero: string;
  numeroControl: string | null;
  estado: string;
  pedidoId: string | null;
  clienteId: string;
  clienteRazonSocial: string;
  moneda: string;
  total: string;
  fechaEmision: string;
  fechaVencimiento: string;
  version: number;
}

export interface FacturaDetalle extends FacturaResumen {
  clienteTipoDocumento: string;
  clienteNroDocumento: string;
  clienteDireccion: string;
  subtotal: string;
  impuesto: string;
  tasaCambio: string;
  motivoAnulacion: string | null;
  items: { id: string; linea: number; cantidad: string; precioUnitario: string; total: string; producto: { sku: string; nombre: string } }[];
  cobro: { cobradoValidado: string; cobradoPorValidar: string; saldo: string; estado: string; diasVencido: number } | null;
}

export interface Vehiculo {
  id: string;
  placa: string;
  descripcion: string | null;
}

export interface ManifiestoResumen {
  id: string;
  numero: string;
  estado: string;
  choferId: string;
  creadoEn: string;
  version: number;
  vehiculo: { placa: string };
  _count?: { facturas: number };
}

export interface ManifiestoDetalle extends ManifiestoResumen {
  confirmadoEn: string | null;
  salidaEn: string | null;
  cerradoEn: string | null;
  facturas: {
    facturaId: string;
    ordenVisita: number | null;
    factura: { id: string; numero: string; estado: string; clienteRazonSocial: string; clienteDireccion: string; total: string; moneda: string };
  }[];
  items: { id: string; cantidadCargada: string; facturaItem: { facturaId: string; productoId: string; producto: { sku: string; nombre: string } } }[];
}

export interface LineaCuadre {
  productoId: string;
  sku: string;
  nombre: string;
  cargado: string;
  entregado: string;
  esperado: string;
}

export interface Pago {
  id: string;
  clienteId: string;
  metodoPago: string;
  entidadOrigen: string;
  referenciaOriginal: string | null;
  moneda: string;
  montoTotal: string;
  tasaCambio: string;
  fechaEmision: string;
  fechaRegistro: string;
  estado: string;
  motivoRechazo: string | null;
  evidenciaArchivoId: string | null;
  version: number;
  cliente: { razonSocial: string };
}

export interface PagoDetalle extends Pago {
  montoAplicado: string;
  montoDisponible: string;
  aplicaciones: { id: string; facturaId: string; montoAplicado: string; montoMonedaPago: string; factura: { numero: string; moneda: string } }[];
}

export interface Producto {
  id: string;
  sku: string;
  nombre: string;
  unidad: string;
  alicuotaIva: string;
  stockMinimo: string;
  activo: boolean;
}

export interface ListaPrecio {
  id: string;
  codigo: string;
  nombre: string;
  moneda: string;
}

export interface Existencia {
  productoId: string;
  sku: string;
  producto: string;
  ubicacion: string;
  tipoUbicacion: string;
  fisico: string;
  reservado: string;
  disponible: string;
  minimo: string;
  bajoMinimo: boolean;
}

export interface Opcion {
  id: string;
  codigo?: string;
  nombre?: string;
  username?: string;
  usuario?: { nombre: string };
}
