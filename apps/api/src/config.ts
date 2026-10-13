/** Configuración leída del entorno, con valores por defecto para desarrollo. */
function entero(nombre: string, porDefecto: number): number {
  const valor = process.env[nombre];
  if (valor === undefined || valor === '') return porDefecto;
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${nombre} debe ser un entero positivo`);
  return n;
}

export const config = {
  /** Vida del token de acceso. */
  accesoMinutos: entero('ACCESO_MINUTOS', 30),
  /** Vida máxima de una sesión; pasado este plazo hay que volver a iniciar sesión. */
  sesionDias: entero('SESION_DIAS', 30),
  /** Duración de la reserva de un pedido aprobado y no facturado (pendiente de confirmar con el negocio). */
  reservaHoras: entero('RESERVA_HORAS', 48),
  /** Cada cuánto se liberan las reservas vencidas. */
  barridoReservasMinutos: entero('BARRIDO_RESERVAS_MINUTOS', 5),
  /** Almacén desde el que se reserva y despacha. */
  almacenPrincipal: process.env.ALMACEN_PRINCIPAL ?? 'ALM-PRINCIPAL',
  /** Fuente de la tasa de cambio usada para facturar y convertir saldos. */
  fuenteTasa: process.env.FUENTE_TASA ?? 'BCV',
  /**
   * Antigüedad máxima de la tasa para facturar. La de hoy si existe; si no,
   * la más reciente de los últimos N días (cubre fines de semana y feriados).
   */
  tasaMaxDias: entero('TASA_MAX_DIAS', 3),
  /** Días hacia adelante que cuentan como "próximo a vencer". */
  diasProximoVencer: entero('DIAS_PROXIMO_VENCER', 7),
};
