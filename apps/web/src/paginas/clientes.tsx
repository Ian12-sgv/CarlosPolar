import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { TIPOS_DOCUMENTO } from '@cp/domain';
import { get, patch, post } from '../api';
import { Boton, Campo, Dato, Encabezado, Estado, Insignia, MensajeError, Modal, Selector, Tarjeta, useAccion } from '../componentes/ui';
import { fecha, fechaHoraCorta, monto } from '../formatos';
import { useSesion } from '../sesion';
import type { ClienteResumen, EstadoCuenta, ListaPrecio, Opcion, PedidoResumen } from '../tipos';
import { ResumenCuenta, TablaPedidos } from './pedidos';

export function PaginaClientes() {
  const { puede } = useSesion();
  const [buscar, setBuscar] = useState('');
  const [editando, setEditando] = useState<ClienteResumen | 'nuevo' | null>(null);
  const clientes = useQuery({
    queryKey: ['clientes', buscar],
    queryFn: () => get<ClienteResumen[]>(`/clientes?incluirInactivos=true&buscar=${encodeURIComponent(buscar)}`),
  });
  return (
    <>
      <Encabezado
        titulo="Clientes"
        acciones={
          puede('cliente.editar') && (
            <Boton variante="primario" onClick={() => setEditando('nuevo')}>
              Nuevo cliente
            </Boton>
          )
        }
      />
      <Tarjeta>
        <div className="filtros">
          <Campo etiqueta="Buscar por nombre o documento" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </div>
        <Estado cargando={clientes.isLoading} error={clientes.error} vacio={clientes.data?.length === 0}>
          <div className="tabla-envoltura">
            <table>
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Razón social</th>
                  <th>Dirección</th>
                  <th className="num">Cupo</th>
                  <th className="num">Días</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {clientes.data?.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.tipoDocumento}-{c.nroDocumento}
                    </td>
                    <td>
                      <Link to={`/clientes/${c.id}`}>{c.razonSocial}</Link> {!c.activo && <Insignia estado="ANULADO" />}
                    </td>
                    <td>{c.direccion}</td>
                    <td className="num">{c.limiteCredito ? monto(c.limiteCredito, c.monedaCredito) : 'Contado'}</td>
                    <td className="num">{c.diasCredito}</td>
                    <td>
                      {puede('cliente.editar', 'cliente.editar_credito', 'cliente.asignar_vendedor') && (
                        <Boton onClick={() => setEditando(c)}>Editar</Boton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Estado>
      </Tarjeta>
      {editando && <FormularioCliente cliente={editando === 'nuevo' ? null : editando} alCerrar={() => setEditando(null)} />}
    </>
  );
}

/** Solo envía los campos que el usuario puede editar: la API exige permiso por grupo de campos. */
function FormularioCliente({ cliente, alCerrar }: { cliente: ClienteResumen | null; alCerrar: () => void }) {
  const { puede } = useSesion();
  const vendedores = useQuery({ queryKey: ['vendedores'], queryFn: () => get<Opcion[]>('/vendedores') });
  const rutas = useQuery({ queryKey: ['rutas'], queryFn: () => get<Opcion[]>('/rutas') });
  const listas = useQuery({ queryKey: ['listas'], queryFn: () => get<ListaPrecio[]>('/listas-precio') });
  const [f, setF] = useState({
    tipoDocumento: cliente?.tipoDocumento ?? 'J',
    nroDocumento: cliente?.nroDocumento ?? '',
    razonSocial: cliente?.razonSocial ?? '',
    direccion: cliente?.direccion ?? '',
    telefono: cliente?.telefono ?? '',
    rutaId: cliente?.rutaId ?? '',
    listaPrecioId: cliente?.listaPrecioId ?? '',
    vendedorId: cliente?.vendedorId ?? '',
    limiteCredito: cliente?.limiteCredito ?? '',
    monedaCredito: cliente?.monedaCredito ?? 'USD',
    diasCredito: String(cliente?.diasCredito ?? 0),
    activo: cliente?.activo ?? true,
  });
  const cambiar = (campo: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [campo]: e.target.value });
  const generales = puede('cliente.editar');
  const credito = puede('cliente.editar_credito');
  const vendedor = puede('cliente.asignar_vendedor');

  const guardar = useAccion(
    () => {
      const datos: Record<string, unknown> = {};
      if (generales) {
        Object.assign(datos, {
          razonSocial: f.razonSocial,
          direccion: f.direccion,
          telefono: f.telefono || undefined,
          rutaId: f.rutaId || null,
          listaPrecioId: f.listaPrecioId || null,
          ...(cliente ? { activo: f.activo } : { tipoDocumento: f.tipoDocumento, nroDocumento: f.nroDocumento }),
        });
      }
      if (credito) {
        Object.assign(datos, {
          limiteCredito: f.limiteCredito === '' ? null : Number(f.limiteCredito),
          monedaCredito: f.monedaCredito,
          diasCredito: Number(f.diasCredito),
        });
      }
      if (vendedor) datos.vendedorId = f.vendedorId || null;
      return cliente ? patch(`/clientes/${cliente.id}`, datos) : post('/clientes', datos);
    },
    [['clientes'], ['cliente']],
    alCerrar,
  );

  function enviar(e: FormEvent) {
    e.preventDefault();
    guardar.ejecutar(undefined);
  }

  return (
    <Modal titulo={cliente ? `Editar ${cliente.razonSocial}` : 'Nuevo cliente'} abierto alCerrar={alCerrar}>
      <form onSubmit={enviar}>
        <div className="formulario">
          {!cliente && (
            <>
              <Selector etiqueta="Tipo" value={f.tipoDocumento} onChange={cambiar('tipoDocumento')} opciones={TIPOS_DOCUMENTO.map((t) => ({ valor: t, texto: t }))} />
              <Campo etiqueta="CI / RIF" value={f.nroDocumento} onChange={cambiar('nroDocumento')} required ayuda="Solo se guardan los dígitos" />
            </>
          )}
          <Campo etiqueta="Razón social" value={f.razonSocial} onChange={cambiar('razonSocial')} disabled={!generales} required />
          <Campo etiqueta="Dirección" value={f.direccion} onChange={cambiar('direccion')} disabled={!generales} required />
          <Campo etiqueta="Teléfono" value={f.telefono} onChange={cambiar('telefono')} disabled={!generales} />
          <Selector
            etiqueta="Ruta"
            value={f.rutaId}
            onChange={cambiar('rutaId')}
            disabled={!generales}
            vacio="Sin ruta"
            opciones={(rutas.data ?? []).map((r) => ({ valor: r.id, texto: `${r.codigo} · ${r.nombre}` }))}
          />
          <Selector
            etiqueta="Lista de precios"
            value={f.listaPrecioId}
            onChange={cambiar('listaPrecioId')}
            disabled={!generales}
            vacio="Sin lista"
            opciones={(listas.data ?? []).map((l) => ({ valor: l.id, texto: `${l.codigo} (${l.moneda})` }))}
          />
          <Selector
            etiqueta="Vendedor"
            value={f.vendedorId}
            onChange={cambiar('vendedorId')}
            disabled={!vendedor}
            vacio="Sin vendedor"
            opciones={(vendedores.data ?? []).map((v) => ({ valor: v.id, texto: `${v.codigo} · ${v.usuario?.nombre ?? ''}` }))}
          />
          <Campo etiqueta="Cupo de crédito" type="number" step="0.01" min="0" value={f.limiteCredito} onChange={cambiar('limiteCredito')} disabled={!credito} ayuda="Vacío = solo contado" />
          <Selector etiqueta="Moneda del cupo" value={f.monedaCredito} onChange={cambiar('monedaCredito')} disabled={!credito} opciones={['USD', 'VES'].map((m) => ({ valor: m, texto: m }))} />
          <Campo etiqueta="Días de crédito" type="number" min="0" max="365" value={f.diasCredito} onChange={cambiar('diasCredito')} disabled={!credito} />
        </div>
        {cliente && generales && (
          <label className="casilla">
            <input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} /> Cliente activo
          </label>
        )}
        <MensajeError texto={guardar.error} />
        <div className="acciones" style={{ marginTop: 14 }}>
          <Boton variante="primario" type="submit" disabled={guardar.enCurso}>
            Guardar
          </Boton>
          <Boton type="button" onClick={alCerrar}>
            Cancelar
          </Boton>
        </div>
      </form>
    </Modal>
  );
}

interface ClienteDetalle extends ClienteResumen {
  ruta: { codigo: string; nombre: string } | null;
  vendedor: { codigo: string; usuario: { nombre: string } } | null;
  listaPrecio: { codigo: string; moneda: string } | null;
  historialVendedor: { id: string; fechaDesde: string; fechaHasta: string | null; vendedor: { codigo: string; usuario: { nombre: string } } }[];
}

export function PaginaDetalleCliente() {
  const { id } = useParams();
  const cliente = useQuery({ queryKey: ['cliente', id], queryFn: () => get<ClienteDetalle>(`/clientes/${id}`) });
  const cuenta = useQuery({ queryKey: ['estado-cuenta', id], queryFn: () => get<EstadoCuenta>(`/clientes/${id}/estado-cuenta`) });
  const pedidos = useQuery({ queryKey: ['pedidos', 'cliente', id], queryFn: () => get<PedidoResumen[]>(`/pedidos?clienteId=${id}&limite=20`) });
  if (!cliente.data) return <Estado cargando={cliente.isLoading} error={cliente.error} />;
  const c = cliente.data;
  return (
    <>
      <Encabezado titulo={c.razonSocial} subtitulo={`${c.tipoDocumento}-${c.nroDocumento} · ${c.direccion}`} />
      <div className="columnas">
        <div>
          <Tarjeta titulo="Facturas pendientes">
            <Estado cargando={cuenta.isLoading} error={cuenta.error} vacio={cuenta.data?.facturas.length === 0}>
              <table>
                <thead>
                  <tr>
                    <th>Factura</th>
                    <th>Vence</th>
                    <th className="num">Total</th>
                    <th className="num">Saldo</th>
                    <th className="num">Días vencida</th>
                  </tr>
                </thead>
                <tbody>
                  {cuenta.data?.facturas.map((f) => (
                    <tr key={f.facturaId}>
                      <td>
                        <Link to={`/facturas/${f.facturaId}`}>{f.numero}</Link>
                      </td>
                      <td>{fecha(f.fechaVencimiento)}</td>
                      <td className="num">{monto(f.total, f.moneda)}</td>
                      <td className="num">{monto(f.saldo, f.moneda)}</td>
                      <td className="num">{f.diasVencido || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Estado>
          </Tarjeta>
          <Tarjeta titulo="Últimos pedidos">
            <Estado cargando={pedidos.isLoading} error={pedidos.error} vacio={pedidos.data?.length === 0}>
              <TablaPedidos pedidos={pedidos.data ?? []} />
            </Estado>
          </Tarjeta>
        </div>
        <div>
          {cuenta.data && <ResumenCuenta cuenta={cuenta.data} clienteId={c.id} />}
          <Tarjeta titulo="Datos comerciales">
            <div className="rejilla">
              <Dato etiqueta="Vendedor">{c.vendedor ? `${c.vendedor.codigo} · ${c.vendedor.usuario.nombre}` : '—'}</Dato>
              <Dato etiqueta="Ruta">{c.ruta ? `${c.ruta.codigo} · ${c.ruta.nombre}` : '—'}</Dato>
              <Dato etiqueta="Lista">{c.listaPrecio ? `${c.listaPrecio.codigo} (${c.listaPrecio.moneda})` : '—'}</Dato>
              <Dato etiqueta="Días de crédito">{c.diasCredito}</Dato>
            </div>
            <h2 style={{ marginTop: 16 }}>Historial de vendedores</h2>
            <ul>
              {c.historialVendedor.map((h) => (
                <li key={h.id}>
                  {h.vendedor.codigo} · {h.vendedor.usuario.nombre}: {fechaHoraCorta(h.fechaDesde)} → {h.fechaHasta ? fechaHoraCorta(h.fechaHasta) : 'vigente'}
                </li>
              ))}
            </ul>
          </Tarjeta>
        </div>
      </div>
    </>
  );
}
