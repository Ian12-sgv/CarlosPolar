import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ESTADOS_MANIFIESTO } from '@cp/domain';
import { ErrorApi, get, post } from '../api';
import { Boton, Campo, Dato, Encabezado, Estado, Insignia, MensajeError, Modal, Selector, Tarjeta, useAccion } from '../componentes/ui';
import { cant, etiqueta, fechaHoraCorta, monto } from '../formatos';
import { useSesion } from '../sesion';
import type { FacturaResumen, LineaCuadre, ManifiestoDetalle, ManifiestoResumen, Opcion, Vehiculo } from '../tipos';
import { ModalMotivo } from './pedidos';

export function PaginaManifiestos() {
  const { puede } = useSesion();
  const [estado, setEstado] = useState('');
  const [modal, setModal] = useState<'nuevo' | 'vehiculo' | null>(null);
  const manifiestos = useQuery({
    queryKey: ['manifiestos', estado],
    queryFn: () => get<ManifiestoResumen[]>(`/manifiestos?limite=200${estado ? `&estado=${estado}` : ''}`),
  });
  const choferes = useQuery({ queryKey: ['choferes'], queryFn: () => get<Opcion[]>('/choferes'), enabled: puede('manifiesto.crear') });
  const nombreChofer = (id: string) => choferes.data?.find((c) => c.id === id)?.nombre ?? '—';

  return (
    <>
      <Encabezado
        titulo="Despachos"
        subtitulo="Manifiestos de carga: qué factura va en qué camión y con qué chofer"
        acciones={
          <>
            {puede('vehiculo.editar') && <Boton onClick={() => setModal('vehiculo')}>Nuevo vehículo</Boton>}
            {puede('manifiesto.crear') && (
              <Boton variante="primario" onClick={() => setModal('nuevo')}>
                Nuevo manifiesto
              </Boton>
            )}
          </>
        }
      />
      <Tarjeta>
        <div className="filtros">
          <Selector
            etiqueta="Estado"
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
            vacio="Todos"
            opciones={ESTADOS_MANIFIESTO.map((e) => ({ valor: e, texto: etiqueta(e) }))}
          />
        </div>
        <Estado cargando={manifiestos.isLoading} error={manifiestos.error} vacio={manifiestos.data?.length === 0}>
          <table>
            <thead>
              <tr>
                <th>Número</th>
                <th>Vehículo</th>
                <th>Chofer</th>
                <th className="num">Facturas</th>
                <th>Creado</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {manifiestos.data?.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link to={`/manifiestos/${m.id}`}>{m.numero}</Link>
                  </td>
                  <td>{m.vehiculo.placa}</td>
                  <td>{nombreChofer(m.choferId)}</td>
                  <td className="num">{m._count?.facturas ?? '—'}</td>
                  <td>{fechaHoraCorta(m.creadoEn)}</td>
                  <td>
                    <Insignia estado={m.estado} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Estado>
      </Tarjeta>
      {modal === 'nuevo' && <ModalNuevoManifiesto choferes={choferes.data ?? []} alCerrar={() => setModal(null)} />}
      {modal === 'vehiculo' && <ModalVehiculo alCerrar={() => setModal(null)} />}
    </>
  );
}

function ModalVehiculo({ alCerrar }: { alCerrar: () => void }) {
  const [placa, setPlaca] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const crear = useAccion(() => post('/vehiculos', { placa: placa.trim(), descripcion: descripcion.trim() || undefined }), [['vehiculos']], alCerrar);
  return (
    <Modal titulo="Nuevo vehículo" abierto alCerrar={alCerrar}>
      <div className="formulario">
        <Campo etiqueta="Placa" value={placa} onChange={(e) => setPlaca(e.target.value)} autoFocus />
        <Campo etiqueta="Descripción" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
      </div>
      <MensajeError texto={crear.error} />
      <div className="acciones">
        <Boton variante="primario" disabled={!placa.trim() || crear.enCurso} onClick={() => crear.ejecutar(undefined)}>
          Guardar
        </Boton>
        <Boton onClick={alCerrar}>Cancelar</Boton>
      </div>
    </Modal>
  );
}

function ModalNuevoManifiesto({ choferes, alCerrar }: { choferes: Opcion[]; alCerrar: () => void }) {
  const navegar = useNavigate();
  const vehiculos = useQuery({ queryKey: ['vehiculos'], queryFn: () => get<Vehiculo[]>('/vehiculos') });
  const [vehiculoId, setVehiculoId] = useState('');
  const [choferId, setChoferId] = useState('');
  const crear = useAccion(
    () => post<ManifiestoDetalle>('/manifiestos', { vehiculoId, choferId }),
    [['manifiestos']],
    (m) => navegar(`/manifiestos/${m.id}`),
  );
  return (
    <Modal titulo="Nuevo manifiesto" abierto alCerrar={alCerrar}>
      <div className="formulario">
        <Selector
          etiqueta="Vehículo"
          value={vehiculoId}
          onChange={(e) => setVehiculoId(e.target.value)}
          vacio="Seleccione…"
          opciones={(vehiculos.data ?? []).map((v) => ({ valor: v.id, texto: `${v.placa}${v.descripcion ? ` · ${v.descripcion}` : ''}` }))}
        />
        <Selector
          etiqueta="Chofer"
          value={choferId}
          onChange={(e) => setChoferId(e.target.value)}
          vacio="Seleccione…"
          opciones={choferes.map((c) => ({ valor: c.id, texto: c.nombre ?? c.username ?? c.id }))}
        />
      </div>
      <MensajeError texto={crear.error} />
      <div className="acciones">
        <Boton variante="primario" disabled={!vehiculoId || !choferId || crear.enCurso} onClick={() => crear.ejecutar(undefined)}>
          Crear borrador
        </Boton>
        <Boton onClick={alCerrar}>Cancelar</Boton>
      </div>
    </Modal>
  );
}

export function PaginaDetalleManifiesto() {
  const { id } = useParams();
  const { puede } = useSesion();
  const claves = [['manifiesto', id], ['manifiestos'], ['facturas'], ['cuadre', id], ['existencias']];
  const manifiesto = useQuery({ queryKey: ['manifiesto', id], queryFn: () => get<ManifiestoDetalle>(`/manifiestos/${id}`) });
  const cuadre = useQuery({
    queryKey: ['cuadre', id],
    queryFn: () => get<LineaCuadre[]>(`/manifiestos/${id}/cuadre`),
    enabled: manifiesto.data !== undefined && manifiesto.data.estado !== 'BORRADOR',
  });
  const [modal, setModal] = useState<'agregar' | 'anular' | 'cerrar' | null>(null);
  const confirmar = useAccion(() => post(`/manifiestos/${id}/confirmar`, { version: manifiesto.data!.version }), claves);
  const salir = useAccion(() => post(`/manifiestos/${id}/iniciar-ruta`, { version: manifiesto.data!.version }), claves);
  const quitar = useAccion((facturaId: string) => post(`/manifiestos/${id}/facturas/${facturaId}/quitar`, { version: manifiesto.data!.version }), claves);

  if (!manifiesto.data) return <Estado cargando={manifiesto.isLoading} error={manifiesto.error} />;
  const m = manifiesto.data;
  const borrador = m.estado === 'BORRADOR';
  return (
    <>
      <Encabezado
        titulo={`Manifiesto ${m.numero}`}
        subtitulo={
          <>
            <Insignia estado={m.estado} /> Vehículo {m.vehiculo.placa}
          </>
        }
        acciones={
          <>
            {borrador && puede('manifiesto.crear') && <Boton onClick={() => setModal('agregar')}>Agregar facturas</Boton>}
            {borrador && puede('manifiesto.confirmar') && (
              <Boton variante="primario" disabled={confirmar.enCurso || m.facturas.length === 0} onClick={() => confirmar.ejecutar(undefined)}>
                Confirmar carga
              </Boton>
            )}
            {m.estado === 'CONFIRMADO' && puede('manifiesto.confirmar') && (
              <Boton variante="primario" disabled={salir.enCurso} onClick={() => salir.ejecutar(undefined)}>
                Marcar salida a ruta
              </Boton>
            )}
            {m.estado === 'EN_RUTA' && puede('manifiesto.cerrar') && (
              <Boton variante="primario" onClick={() => setModal('cerrar')}>
                Cerrar y cuadrar
              </Boton>
            )}
            {borrador && puede('manifiesto.crear') && (
              <Boton variante="peligro" onClick={() => setModal('anular')}>
                Anular
              </Boton>
            )}
          </>
        }
      />
      <MensajeError texto={confirmar.error ?? salir.error ?? quitar.error} />
      {borrador && <p className="aviso">Al confirmar la carga, el inventario sale del almacén hacia el vehículo y el manifiesto ya no se puede modificar.</p>}
      <div className="columnas">
        <Tarjeta titulo={`Facturas (${m.facturas.length})`}>
          <Estado vacio={m.facturas.length === 0}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Factura</th>
                  <th>Cliente</th>
                  <th className="num">Total</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {m.facturas.map((f) => (
                  <tr key={f.facturaId}>
                    <td>{f.ordenVisita}</td>
                    <td>
                      <Link to={`/facturas/${f.facturaId}`}>{f.factura.numero}</Link>
                    </td>
                    <td>
                      {f.factura.clienteRazonSocial}
                      <div className="sutil">{f.factura.clienteDireccion}</div>
                    </td>
                    <td className="num">{monto(f.factura.total, f.factura.moneda)}</td>
                    <td>
                      <Insignia estado={f.factura.estado} />
                    </td>
                    <td>
                      {borrador && puede('manifiesto.crear') && (
                        <Boton variante="peligro" disabled={quitar.enCurso} onClick={() => quitar.ejecutar(f.facturaId)}>
                          Quitar
                        </Boton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Estado>
        </Tarjeta>
        <div>
          <Tarjeta titulo="Custodia">
            <div className="rejilla">
              <Dato etiqueta="Carga confirmada">{fechaHoraCorta(m.confirmadoEn)}</Dato>
              <Dato etiqueta="Salida a ruta">{fechaHoraCorta(m.salidaEn)}</Dato>
              <Dato etiqueta="Cierre">{fechaHoraCorta(m.cerradoEn)}</Dato>
            </div>
          </Tarjeta>
          {cuadre.data && (
            <Tarjeta titulo="Cuadre del vehículo">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Cargado</th>
                    <th className="num">Entregado</th>
                    <th className="num">Esperado</th>
                  </tr>
                </thead>
                <tbody>
                  {cuadre.data.map((l) => (
                    <tr key={l.productoId}>
                      <td>{l.nombre}</td>
                      <td className="num">{cant(l.cargado)}</td>
                      <td className="num">{cant(l.entregado)}</td>
                      <td className="num">{cant(l.esperado)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Tarjeta>
          )}
        </div>
      </div>
      {modal === 'agregar' && <ModalAgregarFacturas manifiesto={m} alCerrar={() => setModal(null)} />}
      {modal === 'cerrar' && cuadre.data && <ModalCerrar manifiesto={m} cuadre={cuadre.data} alCerrar={() => setModal(null)} />}
      <ModalMotivo
        titulo={`Anular manifiesto ${m.numero}`}
        abierto={modal === 'anular'}
        alCerrar={() => setModal(null)}
        accion={(motivo) => post(`/manifiestos/${m.id}/anular`, { version: m.version, motivo })}
        invalidar={claves}
      />
    </>
  );
}

function ModalAgregarFacturas({ manifiesto, alCerrar }: { manifiesto: ManifiestoDetalle; alCerrar: () => void }) {
  const facturas = useQuery({ queryKey: ['facturas', 'EMITIDA'], queryFn: () => get<FacturaResumen[]>('/facturas?estado=EMITIDA&limite=200') });
  const [elegidas, setElegidas] = useState<string[]>([]);
  const yaIncluidas = new Set(manifiesto.facturas.map((f) => f.facturaId));
  const disponibles = (facturas.data ?? []).filter((f) => !yaIncluidas.has(f.id));
  const agregar = useAccion(
    () => post(`/manifiestos/${manifiesto.id}/facturas`, { version: manifiesto.version, facturaIds: elegidas }),
    [['manifiesto', manifiesto.id], ['manifiestos'], ['facturas']],
    alCerrar,
  );
  const alternar = (id: string) => setElegidas(elegidas.includes(id) ? elegidas.filter((x) => x !== id) : [...elegidas, id]);
  return (
    <Modal titulo="Agregar facturas pendientes de despacho" abierto alCerrar={alCerrar}>
      <Estado cargando={facturas.isLoading} error={facturas.error} vacio={disponibles.length === 0}>
        <table>
          <tbody>
            {disponibles.map((f) => (
              <tr key={f.id} onClick={() => alternar(f.id)} style={{ cursor: 'pointer' }}>
                <td>
                  <input type="checkbox" checked={elegidas.includes(f.id)} readOnly />
                </td>
                <td>{f.numero}</td>
                <td>{f.clienteRazonSocial}</td>
                <td className="num">{monto(f.total, f.moneda)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Estado>
      <p className="sutil">El orden de selección es el orden de visita.</p>
      <MensajeError texto={agregar.error} />
      <div className="acciones">
        <Boton variante="primario" disabled={elegidas.length === 0 || agregar.enCurso} onClick={() => agregar.ejecutar(undefined)}>
          Agregar {elegidas.length || ''}
        </Boton>
        <Boton onClick={alCerrar}>Cancelar</Boton>
      </div>
    </Modal>
  );
}

/** Cierre: el almacenista cuenta lo que regresa; las diferencias exigen motivo y quedan como ajuste. */
function ModalCerrar({ manifiesto, cuadre, alCerrar }: { manifiesto: ManifiestoDetalle; cuadre: LineaCuadre[]; alCerrar: () => void }) {
  const [conteo, setConteo] = useState<Record<string, string>>(Object.fromEntries(cuadre.map((l) => [l.productoId, String(Number(l.esperado))])));
  const [motivo, setMotivo] = useState('');
  const conDiferencia = cuadre.filter((l) => Number(conteo[l.productoId] ?? 0) !== Number(l.esperado));
  const cerrar = useAccion(
    () =>
      post(`/manifiestos/${manifiesto.id}/cerrar`, {
        version: manifiesto.version,
        conteo: cuadre.map((l) => ({ productoId: l.productoId, cantidad: Number(conteo[l.productoId] ?? 0) })),
        ...(motivo.trim() ? { motivoDiferencias: motivo.trim() } : {}),
      }).catch((e: unknown) => {
        if (e instanceof ErrorApi && e.codigo === 'DIFERENCIAS_SIN_JUSTIFICAR') throw new ErrorApi(e.estado, e.codigo, 'Hay diferencias: indique el motivo');
        throw e;
      }),
    [['manifiesto', manifiesto.id], ['manifiestos'], ['cuadre', manifiesto.id], ['facturas'], ['existencias']],
    alCerrar,
  );
  return (
    <Modal titulo={`Cerrar ${manifiesto.numero}`} abierto alCerrar={alCerrar}>
      <p className="sutil">Indique lo que regresó físicamente en el vehículo. Las facturas no entregadas vuelven a quedar pendientes de despacho.</p>
      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th className="num">Esperado</th>
            <th className="num">Contado</th>
          </tr>
        </thead>
        <tbody>
          {cuadre.map((l) => (
            <tr key={l.productoId}>
              <td>{l.nombre}</td>
              <td className="num">{cant(l.esperado)}</td>
              <td className="num">
                <input
                  className="corto"
                  type="number"
                  min="0"
                  step="0.001"
                  value={conteo[l.productoId] ?? ''}
                  onChange={(e) => setConteo({ ...conteo, [l.productoId]: e.target.value })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {conDiferencia.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p className="aviso curso">Hay {conDiferencia.length} producto(s) con diferencia; se registrarán como ajuste del vehículo.</p>
          <Campo etiqueta="Motivo de las diferencias" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
      )}
      <MensajeError texto={cerrar.error} />
      <div className="acciones" style={{ marginTop: 14 }}>
        <Boton variante="primario" disabled={cerrar.enCurso || (conDiferencia.length > 0 && motivo.trim().length < 5)} onClick={() => cerrar.ejecutar(undefined)}>
          Cerrar manifiesto
        </Boton>
        <Boton onClick={alCerrar}>Volver</Boton>
      </div>
    </Modal>
  );
}
