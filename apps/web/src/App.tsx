import type { Permiso } from '@cp/domain';
import { useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router';
import { textoError } from './api';
import { Boton, Campo } from './componentes/ui';
import { PaginaClientes, PaginaDetalleCliente } from './paginas/clientes';
import { PaginaDetalleFactura, PaginaFacturacion } from './paginas/facturacion';
import { PaginaInicio } from './paginas/inicio';
import { PaginaInventario } from './paginas/inventario';
import { PaginaDetalleManifiesto, PaginaManifiestos } from './paginas/manifiestos';
import { PaginaDetallePago, PaginaPagos } from './paginas/pagos';
import { PaginaDetallePedido, PaginaPedidos } from './paginas/pedidos';
import { PaginaProductos } from './paginas/productos';
import { PaginaRutas, PaginaVisitas } from './paginas/rutas';
import { PaginaTasas } from './paginas/tasas';
import { PaginaUsuarios } from './paginas/usuarios';
import { useSesion } from './sesion';

interface Seccion {
  ruta: string;
  texto: string;
  grupo: string;
  permisos: Permiso[];
}

/** Menú: cada sección aparece solo si el usuario tiene alguno de sus permisos. */
const SECCIONES: Seccion[] = [
  { ruta: '/pedidos', texto: 'Pedidos', grupo: 'Ventas', permisos: ['pedido.ver_todos', 'pedido.aprobar'] },
  { ruta: '/clientes', texto: 'Clientes', grupo: 'Ventas', permisos: ['cliente.ver'] },
  { ruta: '/rutas', texto: 'Rutas', grupo: 'Ventas', permisos: ['ruta.planificar', 'cliente.editar'] },
  { ruta: '/visitas', texto: 'Visitas', grupo: 'Ventas', permisos: ['pedido.ver_todos'] },
  { ruta: '/facturacion', texto: 'Facturación', grupo: 'Facturación', permisos: ['factura.emitir', 'factura.anular'] },
  { ruta: '/inventario', texto: 'Inventario', grupo: 'Logística', permisos: ['inventario.ingresar', 'inventario.ajustar', 'manifiesto.crear'] },
  { ruta: '/manifiestos', texto: 'Despachos', grupo: 'Logística', permisos: ['manifiesto.crear', 'manifiesto.confirmar', 'manifiesto.cerrar'] },
  { ruta: '/pagos', texto: 'Pagos', grupo: 'Administración', permisos: ['pago.validar', 'pago.anular'] },
  { ruta: '/tasas', texto: 'Tasa de cambio', grupo: 'Administración', permisos: ['tasa.registrar'] },
  { ruta: '/productos', texto: 'Productos y precios', grupo: 'Administración', permisos: ['producto.editar', 'precio.editar'] },
  { ruta: '/usuarios', texto: 'Usuarios', grupo: 'Administración', permisos: ['usuario.administrar'] },
];

export function App() {
  const { usuario, cargando } = useSesion();
  if (cargando) return <p className="acceso">Cargando…</p>;
  if (!usuario) return <PaginaAcceso />;
  return (
    <div className="app">
      <Menu />
      <main>
        <Routes>
          <Route path="/" element={<PaginaInicio />} />
          <Route path="/pedidos" element={<Protegida seccion="/pedidos"><PaginaPedidos /></Protegida>} />
          <Route path="/pedidos/:id" element={<Protegida seccion="/pedidos"><PaginaDetallePedido /></Protegida>} />
          <Route path="/clientes" element={<Protegida seccion="/clientes"><PaginaClientes /></Protegida>} />
          <Route path="/clientes/:id" element={<Protegida seccion="/clientes"><PaginaDetalleCliente /></Protegida>} />
          <Route path="/rutas" element={<Protegida seccion="/rutas"><PaginaRutas /></Protegida>} />
          <Route path="/visitas" element={<Protegida seccion="/visitas"><PaginaVisitas /></Protegida>} />
          <Route path="/facturacion" element={<Protegida seccion="/facturacion"><PaginaFacturacion /></Protegida>} />
          <Route path="/facturas/:id" element={<PaginaDetalleFactura />} />
          <Route path="/inventario" element={<Protegida seccion="/inventario"><PaginaInventario /></Protegida>} />
          <Route path="/manifiestos" element={<Protegida seccion="/manifiestos"><PaginaManifiestos /></Protegida>} />
          <Route path="/manifiestos/:id" element={<Protegida seccion="/manifiestos"><PaginaDetalleManifiesto /></Protegida>} />
          <Route path="/pagos" element={<Protegida seccion="/pagos"><PaginaPagos /></Protegida>} />
          <Route path="/pagos/:id" element={<Protegida seccion="/pagos"><PaginaDetallePago /></Protegida>} />
          <Route path="/tasas" element={<Protegida seccion="/tasas"><PaginaTasas /></Protegida>} />
          <Route path="/productos" element={<Protegida seccion="/productos"><PaginaProductos /></Protegida>} />
          <Route path="/usuarios" element={<Protegida seccion="/usuarios"><PaginaUsuarios /></Protegida>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Protegida({ seccion, children }: { seccion: string; children: ReactNode }) {
  const { puede } = useSesion();
  const permisos = SECCIONES.find((s) => s.ruta === seccion)?.permisos ?? [];
  return puede(...permisos) ? <>{children}</> : <p className="aviso mal">No tiene permiso para ver esta sección.</p>;
}

function Menu() {
  const { usuario, puede, salir } = useSesion();
  const visibles = SECCIONES.filter((s) => puede(...s.permisos));
  const grupos = [...new Set(visibles.map((s) => s.grupo))];
  return (
    <nav className="menu">
      <div className="marca">Carlos Polar</div>
      <NavLink to="/" end>
        Inicio
      </NavLink>
      {grupos.map((g) => (
        <div key={g} style={{ display: 'contents' }}>
          <div className="grupo">{g}</div>
          {visibles
            .filter((s) => s.grupo === g)
            .map((s) => (
              <NavLink key={s.ruta} to={s.ruta}>
                {s.texto}
              </NavLink>
            ))}
        </div>
      ))}
      <div className="usuario">
        <div>{usuario?.nombre}</div>
        <div className="sutil">{usuario?.roles.join(', ')}</div>
        <button onClick={() => void salir()}>Cerrar sesión</button>
      </div>
    </nav>
  );
}

function PaginaAcceso() {
  const { entrar } = useSesion();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enCurso, setEnCurso] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnCurso(true);
    setError(null);
    try {
      await entrar(username, password);
    } catch (err) {
      setError(textoError(err));
    } finally {
      setEnCurso(false);
    }
  }

  return (
    <div className="acceso">
      <form onSubmit={enviar}>
        <div>
          <h1>Carlos Polar</h1>
          <p className="sutil">Backoffice de ventas, despacho y cobranza</p>
        </div>
        {error && <p className="aviso mal">{error}</p>}
        <Campo etiqueta="Usuario" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        <Campo etiqueta="Contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        <Boton variante="primario" type="submit" disabled={enCurso}>
          {enCurso ? 'Entrando…' : 'Entrar'}
        </Boton>
      </form>
    </div>
  );
}
