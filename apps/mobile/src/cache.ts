import { useEffect, useState } from 'react';
import { leerCache, type EntradaCache } from './almacen';
import { useApp } from './contexto';

/** Lee un dato de la caché local y lo relee cada vez que la sincronización trae datos nuevos. */
export function useCache<T>(clave: string | null): { entrada: EntradaCache<T> | null; cargando: boolean } {
  const { version } = useApp();
  const [entrada, setEntrada] = useState<EntradaCache<T> | null>(null);
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    let vigente = true;
    if (!clave) {
      setCargando(false);
      return;
    }
    void leerCache<T>(clave).then((e) => {
      if (vigente) {
        setEntrada(e);
        setCargando(false);
      }
    });
    return () => {
      vigente = false;
    };
  }, [clave, version]);
  return { entrada, cargando };
}
