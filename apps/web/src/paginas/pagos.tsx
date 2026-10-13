import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ESTADOS_PAGO } from '@cp/domain';
import { descargar, get, post } from '../api';
import { Boton, Dato, Encabezado, Estado, Insignia, MensajeError, Selector, Tarjeta, useAccion } from '../componentes/ui';
import { etiqueta, fecha, fechaHoraCorta, monto } from '../formatos';
import { useSesion } from '../sesion';
import type { Pago, PagoDetalle } from '../tipos';
import { ModalMotivo } from './pedidos';

export function PaginaPagos() {
  const [estado, setEstado] = useState('REGISTRADO');
  const pagos = useQuery({ queryKey: ['pagos', estado], queryFn: () => get<Pago[]>(`/pagos?limite=200${estado ? `&estado=${estado}` : ''}`) });
  return (
    <>
      <Encabezado titulo="Pagos" subtitulo="Un pago registrado no reduce la deuda hasta que se valida contra el banco o la caja" />
      <Tarjeta>
        <div className="filtros">
          <Selector
            etiqueta="Estado"
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
            vacio="Todos"
            opciones={ESTADOS_PAGO.map((e) => ({ valor: e, texto: etiqueta(e) }))}
          />
        </div>
        <Estado cargando={pagos.isLoading} error={pagos.error} vacio={pagos.data?.length === 0}>
          <div className="tabla-envoltura">
            <table>
              <thead>
                <tr>
                  <th>Registrado</th>
                  <th>Cliente</th>
                  <th>Método</th>
                  <th>Referencia</th>
                  <th className="num">Monto</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {pagos.data?.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/pagos/${p.id}`}>{fechaHoraCorta(p.fechaRegistro)}</Link>
                    </td>
                    <td>{p.cliente.razonSocial}</td>
                    <td>
                      {p.metodoPago.replace('_', ' ').toLowerCase()} · {p.entidadOrigen}
                    </td>
                    <td>{p.referenciaOriginal ?? '—'}</td>
                    <td className="num">{monto(p.montoTotal, p.moneda)}</td>
                    <td>
                      <Insignia estado={p.estado} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Estado>
      </Tarjeta>
    </>
  );
}

/** Descarga la evidencia con la sesión y la muestra como imagen. */
function Evidencia({ archivoId }: { archivoId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let objeto: string | null = null;
    let vigente = true;
    descargar(`/archivos/${archivoId}`)
      .then((blob) => {
        objeto = URL.createObjectURL(blob);
        if (vigente) setUrl(objeto);
      })
      .catch(() => vigente && setError(true));
    return () => {
      vigente = false;
      if (objeto) URL.revokeObjectURL(objeto);
    };
  }, [archivoId]);
  if (error) return <p className="sutil">No se pudo cargar la evidencia.</p>;
  return url ? <img src={url} alt="Evidencia del pago" style={{ maxWidth: '100%', borderRadius: 6, border: '1px solid var(--borde)' }} /> : <p className="sutil">Cargando…</p>;
}

export function PaginaDetallePago() {
  const { id } = useParams();
  const { puede } = useSesion();
  const claves = [['pago', id], ['pagos'], ['factura'], ['estado-cuenta']];
  const pago = useQuery({ queryKey: ['pago', id], queryFn: () => get<PagoDetalle>(`/pagos/${id}`) });
  const validar = useAccion(() => post(`/pagos/${id}/validar`, { version: pago.data!.version }), claves);
  const [modal, setModal] = useState<'rechazar' | 'anular' | null>(null);
  if (!pago.data) return <Estado cargando={pago.isLoading} error={pago.error} />;
  const p = pago.data;
  return (
    <>
      <Encabezado
        titulo={`Pago de ${p.cliente.razonSocial}`}
        subtitulo={
          <>
            <Insignia estado={p.estado} /> {monto(p.montoTotal, p.moneda)} · {p.metodoPago.replace('_', ' ').toLowerCase()}
          </>
        }
        acciones={
          <>
            {p.estado === 'REGISTRADO' && puede('pago.validar') && (
              <>
                <Boton variante="primario" disabled={validar.enCurso} onClick={() => validar.ejecutar(undefined)}>
                  Validar
                </Boton>
                <Boton variante="peligro" onClick={() => setModal('rechazar')}>
                  Rechazar
                </Boton>
              </>
            )}
            {['REGISTRADO', 'VALIDADO'].includes(p.estado) && puede('pago.anular') && (
              <Boton variante="peligro" onClick={() => setModal('anular')}>
                Anular
              </Boton>
            )}
          </>
        }
      />
      <MensajeError texto={validar.error} />
      {p.motivoRechazo && <p className="aviso mal">Rechazado: {p.motivoRechazo}</p>}
      <div className="columnas">
        <div>
          <Tarjeta titulo="Datos del pago">
            <div className="rejilla">
              <Dato etiqueta="Banco / origen">{p.entidadOrigen}</Dato>
              <Dato etiqueta="Referencia">{p.referenciaOriginal ?? '—'}</Dato>
              <Dato etiqueta="Fecha del pago">{fecha(p.fechaEmision)}</Dato>
              <Dato etiqueta="Registrado">{fechaHoraCorta(p.fechaRegistro)}</Dato>
              <Dato etiqueta="Tasa del día">{monto(p.tasaCambio)} Bs/USD</Dato>
              <Dato etiqueta="Sin aplicar">{monto(p.montoDisponible, p.moneda)}</Dato>
            </div>
          </Tarjeta>
          <Tarjeta titulo="Abonos a facturas">
            <Estado vacio={p.aplicaciones.length === 0}>
              <table>
                <thead>
                  <tr>
                    <th>Factura</th>
                    <th className="num">Abono (moneda factura)</th>
                    <th className="num">En moneda del pago</th>
                  </tr>
                </thead>
                <tbody>
                  {p.aplicaciones.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link to={`/facturas/${a.facturaId}`}>{a.factura.numero}</Link>
                      </td>
                      <td className="num">{monto(a.montoAplicado, a.factura.moneda)}</td>
                      <td className="num">{monto(a.montoMonedaPago, p.moneda)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Estado>
          </Tarjeta>
        </div>
        <Tarjeta titulo="Evidencia">{p.evidenciaArchivoId ? <Evidencia archivoId={p.evidenciaArchivoId} /> : <p className="sutil">Sin evidencia adjunta.</p>}</Tarjeta>
      </div>
      <ModalMotivo
        titulo="Rechazar pago"
        abierto={modal === 'rechazar'}
        alCerrar={() => setModal(null)}
        accion={(motivo) => post(`/pagos/${p.id}/rechazar`, { version: p.version, motivo })}
        invalidar={claves}
      />
      <ModalMotivo
        titulo="Anular pago"
        abierto={modal === 'anular'}
        alCerrar={() => setModal(null)}
        accion={(motivo) => post(`/pagos/${p.id}/anular`, { version: p.version, motivo })}
        invalidar={claves}
      />
    </>
  );
}
