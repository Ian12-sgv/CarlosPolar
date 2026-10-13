import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ESTADOS_FACTURA } from '@cp/domain';
import { get, post } from '../api';
import { Boton, Campo, Dato, Encabezado, Estado, Insignia, MensajeError, Modal, Selector, Tarjeta, useAccion } from '../componentes/ui';
import { cant, etiqueta, fecha, fechaHoraCorta, monto } from '../formatos';
import { useSesion } from '../sesion';
import type { FacturaDetalle, FacturaResumen, PedidoDetalle, PedidoResumen } from '../tipos';
import { ModalMotivo } from './pedidos';

export function PaginaFacturacion() {
  const { puede } = useSesion();
  const [porFacturar, setPorFacturar] = useState<string | null>(null);
  const [estado, setEstado] = useState('');
  const [sinControl, setSinControl] = useState(false);
  const aprobados = useQuery({
    queryKey: ['pedidos', 'APROBADO'],
    queryFn: () => get<PedidoResumen[]>('/pedidos?estado=APROBADO&limite=200'),
    enabled: puede('factura.emitir'),
  });
  const facturas = useQuery({
    queryKey: ['facturas', estado, sinControl],
    queryFn: () => get<FacturaResumen[]>(`/facturas?limite=200${estado ? `&estado=${estado}` : ''}${sinControl ? '&sinNumeroControl=true' : ''}`),
  });

  return (
    <>
      <Encabezado titulo="Facturación" />
      {puede('factura.emitir') && (
        <Tarjeta titulo="Pedidos aprobados por facturar">
          <Estado cargando={aprobados.isLoading} error={aprobados.error} vacio={aprobados.data?.length === 0}>
            <table>
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Emitido</th>
                  <th className="num">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {aprobados.data?.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/pedidos/${p.id}`}>{p.numero}</Link>
                    </td>
                    <td>{p.cliente.razonSocial}</td>
                    <td>{fechaHoraCorta(p.fechaEmision)}</td>
                    <td className="num">{monto(p.total, p.moneda)}</td>
                    <td>
                      <Boton variante="primario" onClick={() => setPorFacturar(p.id)}>
                        Facturar
                      </Boton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Estado>
        </Tarjeta>
      )}
      <Tarjeta titulo="Facturas">
        <div className="filtros">
          <Selector
            etiqueta="Estado"
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
            vacio="Todos"
            opciones={ESTADOS_FACTURA.map((e) => ({ valor: e, texto: etiqueta(e) }))}
          />
          <label className="casilla">
            <input type="checkbox" checked={sinControl} onChange={(e) => setSinControl(e.target.checked)} /> Sin número de control
          </label>
        </div>
        <Estado cargando={facturas.isLoading} error={facturas.error} vacio={facturas.data?.length === 0}>
          <TablaFacturas facturas={facturas.data ?? []} />
        </Estado>
      </Tarjeta>
      {porFacturar && <ModalFacturar pedidoId={porFacturar} alCerrar={() => setPorFacturar(null)} />}
    </>
  );
}

export function TablaFacturas({ facturas }: { facturas: FacturaResumen[] }) {
  return (
    <div className="tabla-envoltura">
      <table>
        <thead>
          <tr>
            <th>Número</th>
            <th>Control</th>
            <th>Cliente</th>
            <th>Emitida</th>
            <th>Vence</th>
            <th className="num">Total</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {facturas.map((f) => (
            <tr key={f.id}>
              <td>
                <Link to={`/facturas/${f.id}`}>{f.numero}</Link>
              </td>
              <td>{f.numeroControl ?? <span className="sutil">pendiente</span>}</td>
              <td>{f.clienteRazonSocial}</td>
              <td>{fechaHoraCorta(f.fechaEmision)}</td>
              <td>{fecha(f.fechaVencimiento)}</td>
              <td className="num">{monto(f.total, f.moneda)}</td>
              <td>
                <Insignia estado={f.estado} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Facturar un pedido aprobado. Por defecto se factura lo reservado; se puede ajustar por línea. */
export function ModalFacturar({ pedidoId, alCerrar }: { pedidoId: string; alCerrar: () => void }) {
  const navegar = useNavigate();
  const pedido = useQuery({ queryKey: ['pedido', pedidoId], queryFn: () => get<PedidoDetalle>(`/pedidos/${pedidoId}`) });
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const reservado = (item: PedidoDetalle['items'][number]) => item.reservas.reduce((s, r) => s + Number(r.cantidad), 0);
  const valor = (item: PedidoDetalle['items'][number]) => cantidades[item.id] ?? String(reservado(item));

  const facturar = useAccion(
    () =>
      post<FacturaDetalle>('/facturas', {
        pedidoId,
        versionPedido: pedido.data!.version,
        lineas: pedido.data!.items.map((i) => ({ pedidoItemId: i.id, cantidad: Number(valor(i)) || 0 })),
      }),
    [['pedidos'], ['pedido', pedidoId], ['facturas']],
    (factura) => navegar(`/facturas/${factura.id}`),
  );

  return (
    <Modal titulo={`Facturar pedido ${pedido.data?.numero ?? ''}`} abierto alCerrar={alCerrar}>
      <Estado cargando={pedido.isLoading} error={pedido.error}>
        {pedido.data && (
          <>
            <p className="sutil">
              {pedido.data.cliente.razonSocial}. El precio es el del pedido. Lo no facturado libera su reserva.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num">Pedido</th>
                  <th className="num">Reservado</th>
                  <th className="num">A facturar</th>
                </tr>
              </thead>
              <tbody>
                {pedido.data.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.producto.nombre}</td>
                    <td className="num">{cant(i.cantidad)}</td>
                    <td className="num">{cant(reservado(i))}</td>
                    <td className="num">
                      <input
                        className="corto"
                        type="number"
                        min="0"
                        max={i.cantidad}
                        step="0.001"
                        value={valor(i)}
                        onChange={(e) => setCantidades({ ...cantidades, [i.id]: e.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <MensajeError texto={facturar.error} />
            <div className="acciones" style={{ marginTop: 14 }}>
              <Boton variante="primario" disabled={facturar.enCurso} onClick={() => facturar.ejecutar(undefined)}>
                Emitir factura
              </Boton>
              <Boton onClick={alCerrar}>Volver</Boton>
            </div>
          </>
        )}
      </Estado>
    </Modal>
  );
}

export function PaginaDetalleFactura() {
  const { id } = useParams();
  const { puede } = useSesion();
  const factura = useQuery({ queryKey: ['factura', id], queryFn: () => get<FacturaDetalle>(`/facturas/${id}`) });
  const [modal, setModal] = useState<'control' | 'anular' | null>(null);
  if (!factura.data) return <Estado cargando={factura.isLoading} error={factura.error} />;
  const f = factura.data;
  return (
    <>
      <Encabezado
        titulo={`Factura ${f.numero}`}
        subtitulo={
          <>
            <Insignia estado={f.estado} /> {f.cobro && <Insignia estado={f.cobro.estado} />} {f.clienteRazonSocial}
          </>
        }
        acciones={
          <>
            {!f.numeroControl && f.estado !== 'ANULADA' && puede('factura.emitir') && (
              <Boton variante="primario" onClick={() => setModal('control')}>
                Registrar número de control
              </Boton>
            )}
            {f.estado === 'EMITIDA' && puede('factura.anular') && (
              <Boton variante="peligro" onClick={() => setModal('anular')}>
                Anular
              </Boton>
            )}
          </>
        }
      />
      {f.motivoAnulacion && <p className="aviso mal">Anulada: {f.motivoAnulacion}</p>}
      <div className="columnas">
        <Tarjeta titulo="Detalle">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">Cantidad</th>
                <th className="num">Precio</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {f.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.producto.nombre} <span className="sutil">{i.producto.sku}</span>
                  </td>
                  <td className="num">{cant(i.cantidad)}</td>
                  <td className="num">{monto(i.precioUnitario)}</td>
                  <td className="num">{monto(i.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="rejilla" style={{ marginTop: 14 }}>
            <Dato etiqueta="Subtotal">{monto(f.subtotal, f.moneda)}</Dato>
            <Dato etiqueta="IVA">{monto(f.impuesto, f.moneda)}</Dato>
            <Dato etiqueta="Total">{monto(f.total, f.moneda)}</Dato>
            <Dato etiqueta="Tasa">{monto(f.tasaCambio)} Bs/USD</Dato>
          </div>
        </Tarjeta>
        <Tarjeta titulo="Datos">
          <div className="rejilla">
            <Dato etiqueta="Cliente">
              {f.clienteTipoDocumento}-{f.clienteNroDocumento}
            </Dato>
            <Dato etiqueta="Número de control">{f.numeroControl ?? 'pendiente'}</Dato>
            <Dato etiqueta="Emitida">{fechaHoraCorta(f.fechaEmision)}</Dato>
            <Dato etiqueta="Vence">{fecha(f.fechaVencimiento)}</Dato>
            {f.pedidoId && (
              <Dato etiqueta="Pedido">
                <Link to={`/pedidos/${f.pedidoId}`}>ver pedido</Link>
              </Dato>
            )}
          </div>
          {f.cobro && (
            <div className="rejilla" style={{ marginTop: 14 }}>
              <Dato etiqueta="Cobrado (validado)">{monto(f.cobro.cobradoValidado, f.moneda)}</Dato>
              <Dato etiqueta="Por validar">{monto(f.cobro.cobradoPorValidar, f.moneda)}</Dato>
              <Dato etiqueta="Saldo">{monto(f.cobro.saldo, f.moneda)}</Dato>
              <Dato etiqueta="Días vencida">{f.cobro.diasVencido || '—'}</Dato>
            </div>
          )}
        </Tarjeta>
      </div>
      {modal === 'control' && <ModalNumeroControl factura={f} alCerrar={() => setModal(null)} />}
      <ModalMotivo
        titulo={`Anular factura ${f.numero}`}
        textoBoton="Anular factura"
        abierto={modal === 'anular'}
        alCerrar={() => setModal(null)}
        accion={(motivo) => post(`/facturas/${f.id}/anular`, { version: f.version, motivo })}
        invalidar={[['factura', id], ['facturas']]}
      />
    </>
  );
}

function ModalNumeroControl({ factura, alCerrar }: { factura: FacturaDetalle; alCerrar: () => void }) {
  const [numero, setNumero] = useState('');
  const asignar = useAccion(() => post(`/facturas/${factura.id}/numero-control`, { numeroControl: numero.trim() }), [['factura', factura.id], ['facturas']], alCerrar);
  return (
    <Modal titulo={`Número de control · ${factura.numero}`} abierto alCerrar={alCerrar}>
      <p className="sutil">Se registra una sola vez y no puede repetirse entre facturas.</p>
      <Campo etiqueta="Número de control" value={numero} onChange={(e) => setNumero(e.target.value)} autoFocus />
      <MensajeError texto={asignar.error} />
      <div className="acciones" style={{ marginTop: 14 }}>
        <Boton variante="primario" disabled={!numero.trim() || asignar.enCurso} onClick={() => asignar.ejecutar(undefined)}>
          Guardar
        </Boton>
        <Boton onClick={alCerrar}>Volver</Boton>
      </div>
    </Modal>
  );
}

