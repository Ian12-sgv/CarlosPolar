import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ESTADOS_PEDIDO } from '@cp/domain';
import { ErrorApi, get, post } from '../api';
import { Boton, Campo, Dato, Encabezado, Estado, Insignia, MensajeError, Modal, Selector, Tarjeta, useAccion } from '../componentes/ui';
import { cant, etiqueta, fechaHoraCorta, monto } from '../formatos';
import { useSesion } from '../sesion';
import type { EstadoCuenta, PedidoDetalle, PedidoResumen } from '../tipos';
import { ModalFacturar } from './facturacion';

export function PaginaPedidos() {
  const [estado, setEstado] = useState('EMITIDO');
  const pedidos = useQuery({
    queryKey: ['pedidos', estado],
    queryFn: () => get<PedidoResumen[]>(`/pedidos?limite=200${estado ? `&estado=${estado}` : ''}`),
  });
  return (
    <>
      <Encabezado titulo="Pedidos" subtitulo="Revisión comercial de los pedidos de la preventa" />
      <Tarjeta>
        <div className="filtros">
          <Selector
            etiqueta="Estado"
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
            vacio="Todos"
            opciones={ESTADOS_PEDIDO.map((e) => ({ valor: e, texto: etiqueta(e) }))}
          />
        </div>
        <Estado cargando={pedidos.isLoading} error={pedidos.error} vacio={pedidos.data?.length === 0}>
          <TablaPedidos pedidos={pedidos.data ?? []} />
        </Estado>
      </Tarjeta>
    </>
  );
}

export function TablaPedidos({ pedidos }: { pedidos: PedidoResumen[] }) {
  return (
    <div className="tabla-envoltura">
      <table>
        <thead>
          <tr>
            <th>Número</th>
            <th>Cliente</th>
            <th>Emitido</th>
            <th className="num">Total</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {pedidos.map((p) => (
            <tr key={p.id}>
              <td>
                <Link to={`/pedidos/${p.id}`}>{p.numero}</Link>
              </td>
              <td>{p.cliente.razonSocial}</td>
              <td>{fechaHoraCorta(p.fechaEmision)}</td>
              <td className="num">{monto(p.total, p.moneda)}</td>
              <td>
                <Insignia estado={p.estado} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PaginaDetallePedido() {
  const { id } = useParams();
  const { puede } = useSesion();
  const pedido = useQuery({ queryKey: ['pedido', id], queryFn: () => get<PedidoDetalle>(`/pedidos/${id}`) });
  const cuenta = useQuery({
    queryKey: ['estado-cuenta', pedido.data?.clienteId],
    queryFn: () => get<EstadoCuenta>(`/clientes/${pedido.data!.clienteId}/estado-cuenta`),
    enabled: Boolean(pedido.data) && puede('cliente.ver'),
  });
  const [modal, setModal] = useState<'aprobar' | 'rechazar' | 'cancelar' | 'facturar' | null>(null);

  if (!pedido.data) return <Estado cargando={pedido.isLoading} error={pedido.error} />;
  const p = pedido.data;
  return (
    <>
      <Encabezado
        titulo={`Pedido ${p.numero}`}
        subtitulo={
          <>
            <Insignia estado={p.estado} /> {p.cliente.razonSocial} · {p.cliente.tipoDocumento}-{p.cliente.nroDocumento}
          </>
        }
        acciones={
          <>
            {p.estado === 'EMITIDO' && puede('pedido.aprobar') && (
              <>
                <Boton variante="primario" onClick={() => setModal('aprobar')}>
                  Aprobar
                </Boton>
                <Boton variante="peligro" onClick={() => setModal('rechazar')}>
                  Rechazar
                </Boton>
              </>
            )}
            {p.estado === 'APROBADO' && puede('factura.emitir') && (
              <Boton variante="primario" onClick={() => setModal('facturar')}>
                Facturar
              </Boton>
            )}
            {['EMITIDO', 'APROBADO'].includes(p.estado) && puede('pedido.cancelar') && (
              <Boton variante="peligro" onClick={() => setModal('cancelar')}>
                Cancelar
              </Boton>
            )}
          </>
        }
      />
      {p.motivoEstado && <p className="aviso curso">Motivo: {p.motivoEstado}</p>}
      <div className="columnas">
        <Tarjeta titulo="Líneas">
          <div className="tabla-envoltura">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Precio</th>
                  <th className="num">IVA %</th>
                  <th className="num">Reservado</th>
                </tr>
              </thead>
              <tbody>
                {p.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.producto.nombre} <span className="sutil">{i.producto.sku}</span>
                    </td>
                    <td className="num">
                      {cant(i.cantidad)} {i.producto.unidad}
                    </td>
                    <td className="num">{monto(i.precioOfertado)}</td>
                    <td className="num">{cant(i.alicuotaIva)}</td>
                    <td className="num">{i.reservas.length ? cant(i.reservas.reduce((s, r) => s + Number(r.cantidad), 0)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rejilla" style={{ marginTop: 14 }}>
            <Dato etiqueta="Subtotal">{monto(p.subtotal, p.moneda)}</Dato>
            <Dato etiqueta="IVA">{monto(p.impuesto, p.moneda)}</Dato>
            <Dato etiqueta="Total">{monto(p.total, p.moneda)}</Dato>
            <Dato etiqueta="Emitido">{fechaHoraCorta(p.fechaEmision)}</Dato>
          </div>
          {p.observaciones && <p className="sutil">Observaciones: {p.observaciones}</p>}
        </Tarjeta>
        {cuenta.data && <ResumenCuenta cuenta={cuenta.data} clienteId={p.clienteId} />}
      </div>

      <ModalAprobar pedido={p} cuenta={cuenta.data} abierto={modal === 'aprobar'} alCerrar={() => setModal(null)} />
      <ModalMotivo
        titulo="Rechazar pedido"
        abierto={modal === 'rechazar'}
        alCerrar={() => setModal(null)}
        accion={(motivo) => post(`/pedidos/${p.id}/rechazar`, { version: p.version, motivo })}
        invalidar={[['pedido', id], ['pedidos']]}
      />
      <ModalMotivo
        titulo="Cancelar pedido"
        abierto={modal === 'cancelar'}
        alCerrar={() => setModal(null)}
        accion={(motivo) => post(`/pedidos/${p.id}/cancelar`, { version: p.version, motivo })}
        invalidar={[['pedido', id], ['pedidos']]}
      />
      {modal === 'facturar' && <ModalFacturar pedidoId={p.id} alCerrar={() => setModal(null)} />}
    </>
  );
}

export function ResumenCuenta({ cuenta, clienteId }: { cuenta: EstadoCuenta; clienteId: string }) {
  return (
    <Tarjeta titulo="Estado de cuenta" acciones={<Link to={`/clientes/${clienteId}`}>Ver cliente</Link>}>
      {cuenta.restricciones.map((r) => (
        <p key={r.codigo} className="aviso mal">
          {r.mensaje}
        </p>
      ))}
      {cuenta.porMoneda.length === 0 && <p className="sutil">Sin deuda pendiente.</p>}
      {cuenta.porMoneda.map((m) => (
        <div key={m.moneda} className="rejilla" style={{ marginBottom: 10 }}>
          <Dato etiqueta={`Saldo ${m.moneda}`}>{monto(m.saldo, m.moneda)}</Dato>
          <Dato etiqueta="Vencido">{monto(m.vencido, m.moneda)}</Dato>
          <Dato etiqueta="Por vencer (7 días)">{monto(m.proximoAVencer, m.moneda)}</Dato>
          <Dato etiqueta="Pagos por validar">{monto(m.pagosPorValidar, m.moneda)}</Dato>
        </div>
      ))}
      {cuenta.credito && (
        <div className="rejilla">
          <Dato etiqueta="Cupo">{monto(cuenta.credito.limite, cuenta.monedaCredito)}</Dato>
          <Dato etiqueta="Disponible">{monto(cuenta.credito.disponible, cuenta.monedaCredito)}</Dato>
        </div>
      )}
    </Tarjeta>
  );
}

function ModalAprobar({ pedido, cuenta, abierto, alCerrar }: { pedido: PedidoDetalle; cuenta?: EstadoCuenta; abierto: boolean; alCerrar: () => void }) {
  const { puede } = useSesion();
  const [aceptarFaltantes, setAceptarFaltantes] = useState(false);
  const [motivoExcepcion, setMotivoExcepcion] = useState('');
  const [faltantes, setFaltantes] = useState<{ productoId: string; solicitado: string; disponible: string }[] | null>(null);
  const aprobar = useAccion(
    () =>
      post(`/pedidos/${pedido.id}/aprobar`, {
        version: pedido.version,
        aceptarFaltantes,
        ...(motivoExcepcion.trim() ? { excepcionCredito: { motivo: motivoExcepcion.trim() } } : {}),
      }).catch((e: unknown) => {
        if (e instanceof ErrorApi && e.codigo === 'STOCK_INSUFICIENTE') setFaltantes(e.detalles as typeof faltantes);
        throw e;
      }),
    [['pedido', pedido.id], ['pedidos']],
    alCerrar,
  );
  const nombre = (productoId: string) => pedido.items.find((i) => i.productoId === productoId)?.producto.nombre ?? productoId;

  return (
    <Modal titulo={`Aprobar pedido ${pedido.numero}`} abierto={abierto} alCerrar={alCerrar}>
      <p className="sutil">Al aprobar se reserva el inventario en el almacén principal.</p>
      {cuenta?.bloqueado && (
        <div className="aviso mal">
          {cuenta.restricciones.map((r) => r.mensaje).join(' · ')}
          {puede('pedido.excepcion_credito') ? (
            <Campo etiqueta="Motivo de la excepción de crédito" value={motivoExcepcion} onChange={(e) => setMotivoExcepcion(e.target.value)} />
          ) : (
            <div>Se necesita una excepción de crédito autorizada por Administración.</div>
          )}
        </div>
      )}
      {faltantes && (
        <div className="aviso curso">
          Stock insuficiente:
          <ul>
            {faltantes.map((f) => (
              <li key={f.productoId}>
                {nombre(f.productoId)}: pedido {cant(f.solicitado)}, disponible {cant(f.disponible)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <label className="casilla">
        <input type="checkbox" checked={aceptarFaltantes} onChange={(e) => setAceptarFaltantes(e.target.checked)} />
        Si falta stock, reservar lo disponible
      </label>
      <MensajeError texto={aprobar.error} />
      <div className="acciones" style={{ marginTop: 14 }}>
        <Boton variante="primario" disabled={aprobar.enCurso} onClick={() => aprobar.ejecutar(undefined)}>
          Aprobar y reservar
        </Boton>
        <Boton onClick={alCerrar}>Volver</Boton>
      </div>
    </Modal>
  );
}

/** Modal genérico para acciones que exigen motivo (rechazar, cancelar, anular). */
export function ModalMotivo({
  titulo,
  abierto,
  alCerrar,
  accion,
  invalidar,
  textoBoton = 'Confirmar',
}: {
  titulo: string;
  abierto: boolean;
  alCerrar: () => void;
  accion: (motivo: string) => Promise<unknown>;
  invalidar: unknown[][];
  textoBoton?: string;
}) {
  const [motivo, setMotivo] = useState('');
  const ejecutar = useAccion((m: string) => accion(m), invalidar, () => {
    setMotivo('');
    alCerrar();
  });
  return (
    <Modal titulo={titulo} abierto={abierto} alCerrar={alCerrar}>
      <Campo etiqueta="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
      <MensajeError texto={ejecutar.error} />
      <div className="acciones" style={{ marginTop: 14 }}>
        <Boton variante="peligro" disabled={ejecutar.enCurso || motivo.trim().length < 3} onClick={() => ejecutar.ejecutar(motivo.trim())}>
          {textoBoton}
        </Boton>
        <Boton onClick={alCerrar}>Volver</Boton>
      </div>
    </Modal>
  );
}
