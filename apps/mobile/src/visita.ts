import { useCallback, useEffect, useState } from 'react';
import { guardarCache, leerCache } from './almacen';
import { useApp } from './contexto';

/**
 * Visita en curso del preventista, guardada en el teléfono. Su id se genera
 * en el dispositivo, así que los pedidos y cobros hechos durante la visita lo
 * referencian aunque la visita aún no haya llegado al servidor (la cola envía
 * en orden: primero la visita, luego el pedido).
 */
export interface VisitaActiva {
  id: string;
  clienteId: string;
  razonSocial: string;
  inicioEn: string;
  huboPedido: boolean;
  huboCobro: boolean;
}

const CLAVE = 'visita-activa';

export function useVisitaActiva() {
  const { version } = useApp();
  const [visita, setVisita] = useState<VisitaActiva | null>(null);
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    void leerCache<VisitaActiva | null>(CLAVE).then((e) => {
      setVisita(e?.valor ?? null);
      setCargando(false);
    });
  }, [version]);
  const guardar = useCallback(async (v: VisitaActiva | null) => {
    await guardarCache(CLAVE, v);
    setVisita(v);
  }, []);
  return { visita, cargando, guardar };
}

/** Marca que durante la visita del cliente hubo pedido o cobro (para sugerir el resultado al cerrarla). */
export async function registrarAccionEnVisita(clienteId: string, accion: 'pedido' | 'cobro'): Promise<string | undefined> {
  const actual = (await leerCache<VisitaActiva | null>(CLAVE))?.valor;
  if (!actual || actual.clienteId !== clienteId) return undefined;
  await guardarCache(CLAVE, { ...actual, huboPedido: actual.huboPedido || accion === 'pedido', huboCobro: actual.huboCobro || accion === 'cobro' });
  return actual.id;
}

/** Id de la visita en curso con ese cliente, para adjuntarlo a un pedido o cobro. */
export async function visitaEnCurso(clienteId: string): Promise<string | undefined> {
  const actual = (await leerCache<VisitaActiva | null>(CLAVE))?.valor;
  return actual?.clienteId === clienteId ? actual.id : undefined;
}
