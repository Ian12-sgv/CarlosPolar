import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BackHandler } from 'react-native';

/** Rutas de la app. Una pila simple en memoria: suficiente para flujos lineales de campo. */
export type Ruta =
  | { nombre: 'inicio' }
  | { nombre: 'clientes' }
  | { nombre: 'agenda' }
  | { nombre: 'cliente'; clienteId: string }
  | { nombre: 'pedido'; clienteId: string }
  | { nombre: 'pago'; clienteId: string; facturas?: FacturaCobrable[] }
  | { nombre: 'manifiestos' }
  | { nombre: 'manifiesto'; manifiestoId: string }
  | { nombre: 'entrega'; manifiestoId: string; facturaId: string }
  | { nombre: 'pendientes' };

export interface FacturaCobrable {
  facturaId: string;
  numero: string;
  moneda: 'USD' | 'VES';
  saldo: string;
}

interface ValorNavegacion {
  actual: Ruta;
  navegar: (ruta: Ruta) => void;
  volver: () => void;
  /** Vuelve al inicio (p. ej. después de guardar un pedido). */
  reiniciar: (ruta?: Ruta) => void;
  puedeVolver: boolean;
}

const Contexto = createContext<ValorNavegacion | null>(null);

export function ProveedorNavegacion({ children }: { children: ReactNode }) {
  const [pila, setPila] = useState<Ruta[]>([{ nombre: 'inicio' }]);
  const navegar = useCallback((ruta: Ruta) => setPila((p) => [...p, ruta]), []);
  const volver = useCallback(() => setPila((p) => (p.length > 1 ? p.slice(0, -1) : p)), []);
  const reiniciar = useCallback((ruta?: Ruta) => setPila(ruta ? [{ nombre: 'inicio' }, ruta] : [{ nombre: 'inicio' }]), []);

  useEffect(() => {
    const suscripcion = BackHandler.addEventListener('hardwareBackPress', () => {
      if (pila.length <= 1) return false;
      volver();
      return true;
    });
    return () => suscripcion.remove();
  }, [pila.length, volver]);

  const valor = useMemo(
    () => ({ actual: pila[pila.length - 1]!, navegar, volver, reiniciar, puedeVolver: pila.length > 1 }),
    [pila, navegar, volver, reiniciar],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useNavegacion(): ValorNavegacion {
  const valor = useContext(Contexto);
  if (!valor) throw new Error('useNavegacion fuera de ProveedorNavegacion');
  return valor;
}
