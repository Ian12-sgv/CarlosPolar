/**
 * Cola de sincronización (outbox) para trabajar sin conexión.
 *
 * Cada acción del usuario (emitir un pedido, registrar una entrega o un pago)
 * se guarda primero en el teléfono como una operación con su propia
 * `Idempotency-Key`, generada al crearla. Después se envía en orden, tantas
 * veces como haga falta: la API reconoce la clave y nunca duplica la operación.
 *
 * Reglas:
 * - Se envía en orden de creación (FIFO). Ante un fallo transitorio (sin red,
 *   5xx, 429, sesión vencida, solicitud aún en proceso) se detiene el envío para
 *   no alterar el orden, y la operación se reintenta más tarde con espera creciente.
 * - Un rechazo de negocio (4xx: precio cambió, sin stock, saldo excedido…) es
 *   definitivo: la operación queda RECHAZADA para que el usuario la revise, y
 *   el envío continúa con las siguientes.
 */

export type TipoOperacion = 'PEDIDO' | 'ENTREGA' | 'PAGO' | 'INICIAR_RUTA' | 'VISITA' | 'CERRAR_VISITA';
export type EstadoOperacion = 'PENDIENTE' | 'ACEPTADA' | 'RECHAZADA';

export interface ErrorOperacion {
  codigo: string;
  mensaje: string;
  detalles?: unknown;
}

export interface Operacion {
  id: string;
  tipo: TipoOperacion;
  /** Texto para mostrar al usuario ("Pedido a Abasto Luz por $ 46,40"). */
  descripcion: string;
  ruta: string;
  cuerpo: unknown;
  claveIdempotencia: string;
  /** Momento en que el usuario hizo la acción (se envía como X-Fecha-Dispositivo). */
  creadaEn: string;
  estado: EstadoOperacion;
  intentos: number;
  ultimoIntentoEn: string | null;
  error: ErrorOperacion | null;
  respuesta: unknown;
}

export interface AlmacenCola {
  agregar(operacion: Operacion): Promise<void>;
  listar(): Promise<Operacion[]>;
  actualizar(operacion: Operacion): Promise<void>;
  eliminar(id: string): Promise<void>;
}

export interface RespuestaTransporte {
  estado: number;
  cuerpo: unknown;
}

/** Envía una operación a la API. Lanza si no hubo respuesta (sin red, tiempo agotado). */
export type Transporte = (operacion: Operacion) => Promise<RespuestaTransporte>;

export interface ResumenEnvio {
  aceptadas: number;
  rechazadas: number;
  pendientes: number;
  /** Motivo por el que se detuvo el envío, si se detuvo. */
  detenidoPor: 'SIN_CONEXION' | 'SESION' | 'SERVIDOR' | null;
}

const ESPERA_BASE_MS = 5_000;
const ESPERA_MAXIMA_MS = 5 * 60_000;

/** Espera antes del siguiente intento: 5 s, 10 s, 20 s… hasta 5 minutos. */
export function esperaReintento(intentos: number): number {
  return Math.min(ESPERA_BASE_MS * 2 ** Math.max(intentos - 1, 0), ESPERA_MAXIMA_MS);
}

/** Respuestas que no son un veredicto sobre la operación: hay que reintentarla. */
function esTransitoria(estado: number, codigo: string | undefined): boolean {
  return estado >= 500 || estado === 401 || estado === 408 || estado === 429 || codigo === 'SOLICITUD_EN_PROCESO';
}

export class ColaSincronizacion {
  private enviando: Promise<ResumenEnvio> | null = null;

  constructor(
    private readonly almacen: AlmacenCola,
    private readonly transporte: Transporte,
    private readonly generarId: () => string,
    private readonly reloj: () => Date = () => new Date(),
  ) {}

  async encolar(tipo: TipoOperacion, ruta: string, cuerpo: unknown, descripcion: string): Promise<Operacion> {
    const operacion: Operacion = {
      id: this.generarId(),
      tipo,
      descripcion,
      ruta,
      cuerpo,
      claveIdempotencia: this.generarId(),
      creadaEn: this.reloj().toISOString(),
      estado: 'PENDIENTE',
      intentos: 0,
      ultimoIntentoEn: null,
      error: null,
      respuesta: null,
    };
    await this.almacen.agregar(operacion);
    return operacion;
  }

  /** Envía lo pendiente. Si ya hay un envío en curso, devuelve ese mismo. */
  enviar(opciones: { ignorarEspera?: boolean } = {}): Promise<ResumenEnvio> {
    this.enviando ??= this.enviarPendientes(opciones.ignorarEspera ?? false).finally(() => {
      this.enviando = null;
    });
    return this.enviando;
  }

  async listar(): Promise<Operacion[]> {
    return (await this.almacen.listar()).sort((a, b) => a.creadaEn.localeCompare(b.creadaEn));
  }

  /** Descarta una operación rechazada (el usuario ya la revisó). Las pendientes no se descartan. */
  async descartar(id: string): Promise<void> {
    const operacion = (await this.almacen.listar()).find((o) => o.id === id);
    if (operacion && operacion.estado !== 'PENDIENTE') await this.almacen.eliminar(id);
  }

  private async enviarPendientes(ignorarEspera: boolean): Promise<ResumenEnvio> {
    const resumen: ResumenEnvio = { aceptadas: 0, rechazadas: 0, pendientes: 0, detenidoPor: null };
    const pendientes = (await this.listar()).filter((o) => o.estado === 'PENDIENTE');

    for (const [i, operacion] of pendientes.entries()) {
      if (!ignorarEspera && !this.tocaReintentar(operacion)) {
        // Respetar el orden: si la primera aún espera, las siguientes también.
        resumen.pendientes = pendientes.length - i;
        break;
      }
      operacion.intentos += 1;
      operacion.ultimoIntentoEn = this.reloj().toISOString();

      let respuesta: RespuestaTransporte;
      try {
        respuesta = await this.transporte(operacion);
      } catch {
        operacion.error = { codigo: 'SIN_CONEXION', mensaje: 'Sin conexión con el servidor' };
        await this.almacen.actualizar(operacion);
        resumen.pendientes = pendientes.length - i;
        resumen.detenidoPor = 'SIN_CONEXION';
        break;
      }

      const cuerpo = respuesta.cuerpo as Partial<ErrorOperacion> | null;
      if (respuesta.estado >= 200 && respuesta.estado < 300) {
        operacion.estado = 'ACEPTADA';
        operacion.respuesta = respuesta.cuerpo;
        operacion.error = null;
        resumen.aceptadas += 1;
      } else if (esTransitoria(respuesta.estado, cuerpo?.codigo)) {
        operacion.error = { codigo: cuerpo?.codigo ?? `HTTP_${respuesta.estado}`, mensaje: cuerpo?.mensaje ?? `Error ${respuesta.estado}` };
        await this.almacen.actualizar(operacion);
        resumen.pendientes = pendientes.length - i;
        resumen.detenidoPor = respuesta.estado === 401 ? 'SESION' : 'SERVIDOR';
        break;
      } else {
        operacion.estado = 'RECHAZADA';
        operacion.error = { codigo: cuerpo?.codigo ?? `HTTP_${respuesta.estado}`, mensaje: cuerpo?.mensaje ?? `Error ${respuesta.estado}`, detalles: cuerpo?.detalles };
        resumen.rechazadas += 1;
      }
      await this.almacen.actualizar(operacion);
    }
    return resumen;
  }

  private tocaReintentar(operacion: Operacion): boolean {
    if (!operacion.ultimoIntentoEn) return true;
    return this.reloj().getTime() - new Date(operacion.ultimoIntentoEn).getTime() >= esperaReintento(operacion.intentos);
  }
}
