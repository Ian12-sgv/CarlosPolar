/** Formas de los datos que la app descarga. Los decimales llegan como texto. */

export interface ClienteApp {
  id: string;
  tipoDocumento: string;
  nroDocumento: string;
  razonSocial: string;
  direccion: string;
  telefono: string | null;
  latitud: string | null;
  longitud: string | null;
  listaPrecioId: string | null;
}

export interface ProductoCatalogo {
  id: string;
  sku: string;
  nombre: string;
  unidad: string;
  alicuotaIva: string;
  precio: string;
  disponible: string;
}

export interface CatalogoApp {
  listaPrecio: { id: string; codigo: string; moneda: 'USD' | 'VES' };
  generadoEn: string;
  productos: ProductoCatalogo[];
}

export interface EstadoCuentaApp {
  porMoneda: { moneda: string; saldo: string; vencido: string; proximoAVencer: string; pagosPorValidar: string }[];
  facturas: { facturaId: string; numero: string; moneda: 'USD' | 'VES'; total: string; saldo: string; cobradoPorValidar: string; fechaVencimiento: string; diasVencido: number }[];
  credito: { limite: string; disponible: string } | null;
  monedaCredito: string;
  restricciones: { codigo: string; mensaje: string }[];
  bloqueado: boolean;
}

export interface AgendaApp {
  fecha: string;
  planificadas: {
    id: string | null;
    orden: number;
    clienteId: string;
    estado: string;
    cliente: { razonSocial: string; direccion: string } | null;
    visita: { id: string; finEn: string | null; resultado: string | null } | null;
  }[];
  resumen: { planificadas: number; visitadas: number; cumplimiento: number | null };
}

export interface ManifiestoApp {
  id: string;
  numero: string;
  estado: string;
  version: number;
  vehiculo: { placa: string };
  facturas: {
    facturaId: string;
    ordenVisita: number | null;
    factura: { id: string; numero: string; estado: string; clienteId: string; clienteRazonSocial: string; clienteDireccion: string; total: string; moneda: string };
  }[];
  items: { cantidadCargada: string; facturaItem: { facturaId: string; producto: { sku: string; nombre: string } } }[];
}
