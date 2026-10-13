const numero = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cantidad = new Intl.NumberFormat('es-VE', { maximumFractionDigits: 3 });
const fechaHora = new Intl.DateTimeFormat('es-VE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Caracas' });

/** Los montos llegan de la API como texto decimal ("46.4"). */
export function monto(valor: string | number | null | undefined, moneda?: string): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  const texto = numero.format(Number(valor));
  return moneda ? `${moneda === 'USD' ? '$' : 'Bs'} ${texto}` : texto;
}

export function cant(valor: string | number | null | undefined): string {
  return valor === null || valor === undefined ? '—' : cantidad.format(Number(valor));
}

export function fechaHoraCorta(valor: string | null | undefined): string {
  return valor ? fechaHora.format(new Date(valor)) : '—';
}

/** Columnas `@db.Date`: llegan como medianoche UTC y se muestran sin convertir zona. */
export function fecha(valor: string | null | undefined): string {
  if (!valor) return '—';
  const [a, m, d] = valor.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function hoyCaracas(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date());
}

const ETIQUETAS: Record<string, string> = {
  EMITIDO: 'Emitido',
  APROBADO: 'Aprobado',
  RECHAZADO: 'Rechazado',
  CANCELADO: 'Cancelado',
  FACTURADO: 'Facturado',
  EMITIDA: 'Emitida',
  DESPACHADA: 'Despachada',
  ENTREGADA: 'Entregada',
  ANULADA: 'Anulada',
  BORRADOR: 'Borrador',
  CONFIRMADO: 'Cargado',
  EN_RUTA: 'En ruta',
  CERRADO: 'Cerrado',
  ANULADO: 'Anulado',
  REGISTRADO: 'Por validar',
  VALIDADO: 'Validado',
  CONFIRMADA: 'Confirmada',
  RECHAZADA: 'Rechazada',
  PENDIENTE: 'Pendiente',
  PARCIAL: 'Parcial',
  PAGADA: 'Pagada',
};

export function etiqueta(estado: string): string {
  return ETIQUETAS[estado] ?? estado;
}

/** Tono visual por estado: neutral, en curso, éxito o problema. */
export function tono(estado: string): 'neutro' | 'curso' | 'ok' | 'mal' {
  if (['RECHAZADO', 'CANCELADO', 'ANULADA', 'ANULADO', 'RECHAZADA'].includes(estado)) return 'mal';
  if (['FACTURADO', 'ENTREGADA', 'CERRADO', 'VALIDADO', 'CONFIRMADA', 'PAGADA'].includes(estado)) return 'ok';
  if (['APROBADO', 'DESPACHADA', 'CONFIRMADO', 'EN_RUTA', 'PARCIAL'].includes(estado)) return 'curso';
  return 'neutro';
}
