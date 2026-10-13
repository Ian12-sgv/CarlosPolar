import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Permiso } from '@cp/domain';
import { alExpirarSesion, cerrarSesion, iniciarSesion, restaurarSesion, type UsuarioSesion } from './api';

interface ValorSesion {
  usuario: UsuarioSesion | null;
  cargando: boolean;
  entrar: (username: string, password: string) => Promise<void>;
  salir: () => Promise<void>;
  puede: (...permisos: Permiso[]) => boolean;
}

const ContextoSesion = createContext<ValorSesion | null>(null);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    alExpirarSesion(() => setUsuario(null));
    restaurarSesion()
      .then(setUsuario)
      .finally(() => setCargando(false));
  }, []);

  const entrar = useCallback(async (username: string, password: string) => {
    setUsuario(await iniciarSesion(username, password));
  }, []);
  const salir = useCallback(async () => {
    await cerrarSesion();
    setUsuario(null);
  }, []);
  /** Verdadero si el usuario tiene al menos uno de los permisos. */
  const puede = useCallback((...permisos: Permiso[]) => permisos.some((p) => usuario?.permisos.includes(p) ?? false), [usuario]);

  const valor = useMemo(() => ({ usuario, cargando, entrar, salir, puede }), [usuario, cargando, entrar, salir, puede]);
  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}

export function useSesion(): ValorSesion {
  const valor = useContext(ContextoSesion);
  if (!valor) throw new Error('useSesion fuera de ProveedorSesion');
  return valor;
}
