/** Zona horaria en la que opera el negocio: define "hoy" para vencimientos y tasas. */
export const ZONA_OPERATIVA = 'America/Caracas';

const formato = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_OPERATIVA, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Fecha calendario (AAAA-MM-DD) en la zona operativa. */
export function fechaOperativa(instante = new Date()): string {
  return formato.format(instante);
}

/** Convierte AAAA-MM-DD al `Date` que Prisma espera para columnas `@db.Date`. */
export function aFechaDb(fecha: string): Date {
  return new Date(`${fecha}T00:00:00Z`);
}

export function sumarDias(fecha: string, dias: number): string {
  const d = aFechaDb(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
