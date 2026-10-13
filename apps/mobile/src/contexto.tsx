import * as Crypto from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { almacenCola, guardarCache, leerCache, limpiarCache } from './almacen';
import { api, cargarConfiguracion, cerrarSesion, definirOrigen, iniciarSesion, origenDe, restaurarSesion, transporte, type UsuarioSesion } from './api';
import { ColaSincronizacion, type Operacion, type ResumenEnvio, type TipoOperacion } from './sincronizacion/cola';
import type { AgendaApp, CatalogoApp, ClienteApp, EstadoCuentaApp, ManifiestoApp } from './tipos';

const cola = new ColaSincronizacion(almacenCola, transporte, () => Crypto.randomUUID());
const INTERVALO_MS = 60_000;

interface ValorApp {
  usuario: UsuarioSesion | null;
  esChofer: boolean;
  /** Hay sesión guardada pero no se pudo contactar al servidor al abrir la app. */
  sinConexion: boolean;
  cargando: boolean;
  servidor: string;
  operaciones: Operacion[];
  ultimoEnvio: ResumenEnvio | null;
  sincronizando: boolean;
  entrar: (servidor: string, usuario: string, clave: string) => Promise<void>;
  salir: () => Promise<void>;
  /** Guarda la acción en el teléfono e intenta enviarla de inmediato. */
  encolar: (tipo: TipoOperacion, ruta: string, cuerpo: unknown, descripcion: string) => Promise<void>;
  sincronizar: (forzar?: boolean) => Promise<void>;
  descartar: (id: string) => Promise<void>;
  /** Incrementa cuando se descargan datos nuevos, para que las pantallas relean la caché. */
  version: number;
}

const Contexto = createContext<ValorApp | null>(null);

export function ProveedorApp({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null);
  const [sinConexion, setSinConexion] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [servidor, setServidor] = useState('');
  const [operaciones, setOperaciones] = useState<Operacion[]>([]);
  const [ultimoEnvio, setUltimoEnvio] = useState<ResumenEnvio | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [version, setVersion] = useState(0);
  const usuarioRef = useRef<UsuarioSesion | null>(null);
  usuarioRef.current = usuario;

  const refrescarOperaciones = useCallback(async () => setOperaciones(await cola.listar()), []);

  const sincronizar = useCallback(
    async (forzar = false) => {
      const actual = usuarioRef.current;
      if (!actual) return;
      setSincronizando(true);
      try {
        const resumen = await cola.enviar({ ignorarEspera: forzar });
        setUltimoEnvio(resumen);
        if (resumen.detenidoPor !== 'SIN_CONEXION') {
          await descargarDatos(actual);
          setSinConexion(false);
          setVersion((v) => v + 1);
        }
      } catch {
        // Sin conexión durante la descarga: se reintenta en el próximo ciclo.
      } finally {
        await refrescarOperaciones();
        setSincronizando(false);
      }
    },
    [refrescarOperaciones],
  );

  useEffect(() => {
    void (async () => {
      const config = await cargarConfiguracion();
      setServidor(config.servidor);
      await refrescarOperaciones();
      if (config.tieneSesion) {
        const enLinea = await restaurarSesion();
        const guardado = (await leerCache<UsuarioSesion>('usuario'))?.valor ?? null;
        const sigueConSesion = (await cargarConfiguracion()).tieneSesion;
        const elegido = enLinea ?? (sigueConSesion ? guardado : null);
        if (elegido) {
          definirOrigen(origenDe(elegido));
          setUsuario(elegido);
          setSinConexion(!enLinea);
        }
      }
      setCargando(false);
    })();
  }, [refrescarOperaciones]);

  // Sincroniza al entrar, al volver a la app y cada minuto mientras está abierta.
  useEffect(() => {
    if (!usuario) return;
    void sincronizar();
    const intervalo = setInterval(() => void sincronizar(), INTERVALO_MS);
    const suscripcion = AppState.addEventListener('change', (estado) => estado === 'active' && void sincronizar());
    return () => {
      clearInterval(intervalo);
      suscripcion.remove();
    };
  }, [usuario, sincronizar]);

  const entrar = useCallback(async (url: string, username: string, clave: string) => {
    const u = await iniciarSesion(url, username, clave);
    definirOrigen(origenDe(u));
    await guardarCache('usuario', u);
    setServidor(url.trim().replace(/\/+$/, ''));
    setSinConexion(false);
    setUsuario(u);
  }, []);

  const salir = useCallback(async () => {
    await cerrarSesion();
    await limpiarCache();
    setUsuario(null);
  }, []);

  const encolar = useCallback(
    async (tipo: TipoOperacion, ruta: string, cuerpo: unknown, descripcion: string) => {
      await cola.encolar(tipo, ruta, cuerpo, descripcion);
      await refrescarOperaciones();
      void sincronizar(true);
    },
    [refrescarOperaciones, sincronizar],
  );

  const descartar = useCallback(
    async (id: string) => {
      await cola.descartar(id);
      await refrescarOperaciones();
    },
    [refrescarOperaciones],
  );

  const valor = useMemo<ValorApp>(
    () => ({
      usuario,
      esChofer: usuario ? origenDe(usuario) === 'APP_CHOFER' : false,
      sinConexion,
      cargando,
      servidor,
      operaciones,
      ultimoEnvio,
      sincronizando,
      entrar,
      salir,
      encolar,
      sincronizar,
      descartar,
      version,
    }),
    [usuario, sinConexion, cargando, servidor, operaciones, ultimoEnvio, sincronizando, entrar, salir, encolar, sincronizar, descartar, version],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useApp(): ValorApp {
  const valor = useContext(Contexto);
  if (!valor) throw new Error('useApp fuera de ProveedorApp');
  return valor;
}

/**
 * Descarga lo necesario para trabajar sin conexión. El preventista: su
 * cartera, la agenda del día, catálogos con precio y stock, y el estado de
 * cuenta de cada cliente. El chofer: sus manifiestos cargados o en ruta.
 */
async function descargarDatos(usuario: UsuarioSesion): Promise<void> {
  if (origenDe(usuario) === 'APP_CHOFER') {
    const lista = [
      ...(await api<{ id: string }[]>('GET', '/manifiestos?estado=EN_RUTA&limite=20')),
      ...(await api<{ id: string }[]>('GET', '/manifiestos?estado=CONFIRMADO&limite=20')),
    ];
    const detalles = await Promise.all(lista.map((m) => api<ManifiestoApp>('GET', `/manifiestos/${m.id}`)));
    await guardarCache('manifiestos', detalles);
    return;
  }

  const clientes = await api<ClienteApp[]>('GET', '/clientes');
  await guardarCache('clientes', clientes);
  if (usuario.permisos.includes('visita.registrar')) await guardarCache('agenda', await api<AgendaApp>('GET', '/visitas/agenda'));
  for (const listaId of new Set(clientes.map((c) => c.listaPrecioId).filter((x): x is string => Boolean(x)))) {
    await guardarCache(`catalogo:${listaId}`, await api<CatalogoApp>('GET', `/catalogo?listaPrecioId=${listaId}`));
  }
  // De a cinco para no saturar la conexión del teléfono.
  for (let i = 0; i < clientes.length; i += 5) {
    await Promise.all(
      clientes.slice(i, i + 5).map(async (c) => guardarCache(`cuenta:${c.id}`, await api<EstadoCuentaApp>('GET', `/clientes/${c.id}/estado-cuenta`))),
    );
  }
}
