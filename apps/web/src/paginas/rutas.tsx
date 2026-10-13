import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { DIAS_SEMANA } from '@cp/domain';
import { get, patch, post } from '../api';
import { Boton, Campo, Dato, Encabezado, Estado, Insignia, MensajeError, Modal, Selector, Tarjeta, useAccion } from '../componentes/ui';
import { fechaHoraCorta, hoyCaracas } from '../formatos';
import { useSesion } from '../sesion';
import type { ClienteResumen, Opcion } from '../tipos';

interface Ruta {
  id: string;
  codigo: string;
  nombre: string;
  vendedorId: string | null;
  vendedor: { codigo: string; usuario: { nombre: string } } | null;
}

interface RutaDetalle extends Ruta {
  planClientes: { id: string; diaSemana: number; orden: number; clienteId: string; cliente: { id: string; razonSocial: string; direccion: string; activo: boolean } }[];
}

export function PaginaRutas() {
  const { puede } = useSesion();
  const rutas = useQuery({ queryKey: ['rutas'], queryFn: () => get<Ruta[]>('/rutas') });
  const [elegida, setElegida] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const id = elegida ?? rutas.data?.[0]?.id ?? null;

  return (
    <>
      <Encabezado
        titulo="Rutas"
        subtitulo="Plan semanal de visitas: qué clientes visita cada preventista cada día"
        acciones={
          puede('cliente.editar') && (
            <Boton variante="primario" onClick={() => setNueva(true)}>
              Nueva ruta
            </Boton>
          )
        }
      />
      <Estado cargando={rutas.isLoading} error={rutas.error} vacio={rutas.data?.length === 0}>
        <div className="columnas" style={{ gridTemplateColumns: '1fr 3fr' }}>
          <Tarjeta titulo="Rutas">
            {rutas.data?.map((r) => (
              <div key={r.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--borde)' }}>
                <a href="#" onClick={(e) => (e.preventDefault(), setElegida(r.id))} style={{ fontWeight: r.id === id ? 700 : 400 }}>
                  {r.codigo} · {r.nombre}
                </a>
                <div className="sutil">{r.vendedor ? `${r.vendedor.codigo} · ${r.vendedor.usuario.nombre}` : 'Sin preventista'}</div>
              </div>
            ))}
          </Tarjeta>
          {id && <DetalleRuta id={id} />}
        </div>
      </Estado>
      {nueva && <ModalNuevaRuta alCerrar={() => setNueva(false)} />}
    </>
  );
}

function DetalleRuta({ id }: { id: string }) {
  const { puede } = useSesion();
  const ruta = useQuery({ queryKey: ['ruta', id], queryFn: () => get<RutaDetalle>(`/rutas/${id}`) });
  const vendedores = useQuery({ queryKey: ['vendedores'], queryFn: () => get<Opcion[]>('/vendedores') });
  const [dia, setDia] = useState(1);
  const cambiarVendedor = useAccion((vendedorId: string) => patch(`/rutas/${id}`, { vendedorId: vendedorId || null }), [['ruta', id], ['rutas']]);
  if (!ruta.data) return <Estado cargando={ruta.isLoading} error={ruta.error} />;
  const r = ruta.data;
  const planificar = puede('ruta.planificar');
  return (
    <Tarjeta titulo={`${r.codigo} · ${r.nombre}`}>
      <div className="filtros">
        <Selector
          etiqueta="Preventista de la ruta"
          value={r.vendedorId ?? ''}
          disabled={!planificar || cambiarVendedor.enCurso}
          onChange={(e) => cambiarVendedor.ejecutar(e.target.value)}
          vacio="Sin preventista"
          opciones={(vendedores.data ?? []).map((v) => ({ valor: v.id, texto: `${v.codigo} · ${v.usuario?.nombre ?? ''}` }))}
        />
      </div>
      <MensajeError texto={cambiarVendedor.error} />
      <div className="acciones" style={{ marginBottom: 12 }}>
        {DIAS_SEMANA.map((nombre, i) => (
          <Boton key={nombre} variante={dia === i + 1 ? 'primario' : 'normal'} onClick={() => setDia(i + 1)}>
            {nombre} ({r.planClientes.filter((p) => p.diaSemana === i + 1).length})
          </Boton>
        ))}
      </div>
      <EditorDia key={`${id}-${dia}`} rutaId={id} dia={dia} plan={r.planClientes.filter((p) => p.diaSemana === dia)} editable={planificar} />
    </Tarjeta>
  );
}

/** Lista ordenada de clientes de un día. Guardar reemplaza el plan de ese día (el anterior queda en el historial). */
function EditorDia({ rutaId, dia, plan, editable }: { rutaId: string; dia: number; plan: RutaDetalle['planClientes']; editable: boolean }) {
  const clientes = useQuery({ queryKey: ['clientes', ''], queryFn: () => get<ClienteResumen[]>('/clientes?buscar=') });
  const [lista, setLista] = useState(plan.map((p) => ({ id: p.clienteId, nombre: p.cliente.razonSocial, direccion: p.cliente.direccion })));
  const [agregar, setAgregar] = useState('');
  const original = plan.map((p) => p.clienteId).join(',');
  // Al guardar, el plan del servidor reemplaza la lista local.
  useEffect(() => setLista(plan.map((p) => ({ id: p.clienteId, nombre: p.cliente.razonSocial, direccion: p.cliente.direccion }))), [original]);
  const guardar = useAccion(() => post(`/rutas/${rutaId}/plan`, { diaSemana: dia, clienteIds: lista.map((c) => c.id) }), [['ruta', rutaId], ['agenda']]);
  const cambiado = lista.map((c) => c.id).join(',') !== original;
  const mover = (i: number, d: number) => {
    const copia = [...lista];
    const [x] = copia.splice(i, 1);
    copia.splice(i + d, 0, x!);
    setLista(copia);
  };
  const disponibles = (clientes.data ?? []).filter((c) => !lista.some((l) => l.id === c.id));

  return (
    <>
      <Estado vacio={lista.length === 0}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Cliente</th>
              <th>Dirección</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lista.map((c, i) => (
              <tr key={c.id}>
                <td>{i + 1}</td>
                <td>{c.nombre}</td>
                <td className="sutil">{c.direccion}</td>
                <td>
                  {editable && (
                    <div className="acciones">
                      <Boton disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir">
                        ↑
                      </Boton>
                      <Boton disabled={i === lista.length - 1} onClick={() => mover(i, 1)} aria-label="Bajar">
                        ↓
                      </Boton>
                      <Boton variante="peligro" onClick={() => setLista(lista.filter((x) => x.id !== c.id))}>
                        Quitar
                      </Boton>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Estado>
      {editable && (
        <>
          <div className="filtros" style={{ marginTop: 12 }}>
            <Selector
              etiqueta="Agregar cliente"
              value={agregar}
              onChange={(e) => setAgregar(e.target.value)}
              vacio="Seleccione…"
              opciones={disponibles.map((c) => ({ valor: c.id, texto: `${c.razonSocial} · ${c.direccion}` }))}
            />
            <Boton
              disabled={!agregar}
              onClick={() => {
                const c = disponibles.find((x) => x.id === agregar);
                if (c) setLista([...lista, { id: c.id, nombre: c.razonSocial, direccion: c.direccion }]);
                setAgregar('');
              }}
            >
              Agregar
            </Boton>
          </div>
          <MensajeError texto={guardar.error} />
          <Boton variante="primario" disabled={!cambiado || guardar.enCurso} onClick={() => guardar.ejecutar(undefined)}>
            Guardar plan del {DIAS_SEMANA[dia - 1]}
          </Boton>
          <p className="sutil">Los clientes agregados entran en la agenda de hoy si es {DIAS_SEMANA[dia - 1]}; los quitados dejan de aparecer desde mañana.</p>
        </>
      )}
    </>
  );
}

function ModalNuevaRuta({ alCerrar }: { alCerrar: () => void }) {
  const vendedores = useQuery({ queryKey: ['vendedores'], queryFn: () => get<Opcion[]>('/vendedores') });
  const [f, setF] = useState({ codigo: '', nombre: '', vendedorId: '' });
  const crear = useAccion(() => post('/rutas', { ...f, vendedorId: f.vendedorId || null }), [['rutas']], alCerrar);
  return (
    <Modal titulo="Nueva ruta" abierto alCerrar={alCerrar}>
      <div className="formulario">
        <Campo etiqueta="Código" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} />
        <Campo etiqueta="Nombre" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
        <Selector
          etiqueta="Preventista"
          value={f.vendedorId}
          onChange={(e) => setF({ ...f, vendedorId: e.target.value })}
          vacio="Sin preventista"
          opciones={(vendedores.data ?? []).map((v) => ({ valor: v.id, texto: `${v.codigo} · ${v.usuario?.nombre ?? ''}` }))}
        />
      </div>
      <MensajeError texto={crear.error} />
      <div className="acciones">
        <Boton variante="primario" disabled={!f.codigo || !f.nombre || crear.enCurso} onClick={() => crear.ejecutar(undefined)}>
          Crear
        </Boton>
        <Boton onClick={alCerrar}>Cancelar</Boton>
      </div>
    </Modal>
  );
}

interface Agenda {
  fecha: string;
  previsualizacion: boolean;
  planificadas: {
    id: string | null;
    orden: number;
    estado: string;
    motivoCancelacion: string | null;
    cliente: { razonSocial: string; direccion: string } | null;
    visita: { inicioEn: string; finEn: string | null; resultado: string | null; motivoSinVenta: string | null } | null;
  }[];
  fueraDePlan: { id: string; inicioEn: string; finEn: string | null; resultado: string | null; motivoSinVenta: string | null; cliente: { razonSocial: string } | null }[];
  resumen: { planificadas: number; visitadas: number; fueraDePlan: number; efectivas: number; cumplimiento: number | null };
}

const RESULTADO: Record<string, string> = {
  PEDIDO: 'Pedido',
  COBRO: 'Cobro',
  PEDIDO_Y_COBRO: 'Pedido y cobro',
  SIN_PEDIDO: 'Sin pedido',
  CLIENTE_CERRADO: 'Cliente cerrado',
  NO_ATENDIDO: 'No atendido',
};

/** Seguimiento diario: plan contra lo visitado por cada preventista. */
export function PaginaVisitas() {
  const { puede } = useSesion();
  const vendedores = useQuery({ queryKey: ['vendedores'], queryFn: () => get<Opcion[]>('/vendedores') });
  const [fecha, setFecha] = useState(hoyCaracas());
  const [vendedorId, setVendedorId] = useState('');
  const vendedor = vendedorId || vendedores.data?.[0]?.id || '';
  const agenda = useQuery({
    queryKey: ['agenda', fecha, vendedor],
    queryFn: () => get<Agenda>(`/visitas/agenda?fecha=${fecha}&vendedorId=${vendedor}`),
    enabled: Boolean(vendedor),
  });
  const [cancelar, setCancelar] = useState<string | null>(null);
  const a = agenda.data;

  return (
    <>
      <Encabezado titulo="Visitas" subtitulo="Cumplimiento del plan de visitas por preventista" />
      <Tarjeta>
        <div className="filtros">
          <Campo etiqueta="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          <Selector
            etiqueta="Preventista"
            value={vendedor}
            onChange={(e) => setVendedorId(e.target.value)}
            opciones={(vendedores.data ?? []).map((v) => ({ valor: v.id, texto: `${v.codigo} · ${v.usuario?.nombre ?? ''}` }))}
          />
        </div>
        <Estado cargando={agenda.isLoading} error={agenda.error}>
          {a && (
            <>
              {a.previsualizacion && <p className="aviso">Fecha futura: se muestra el plan vigente; la agenda se genera ese día.</p>}
              <div className="rejilla" style={{ marginBottom: 14 }}>
                <Dato etiqueta="Planificadas">{a.resumen.planificadas}</Dato>
                <Dato etiqueta="Visitadas">{a.resumen.visitadas}</Dato>
                <Dato etiqueta="Cumplimiento">{a.resumen.cumplimiento === null ? '—' : `${Math.round(a.resumen.cumplimiento * 100)} %`}</Dato>
                <Dato etiqueta="Fuera de plan">{a.resumen.fueraDePlan}</Dato>
                <Dato etiqueta="Efectivas (pedido o cobro)">{a.resumen.efectivas}</Dato>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Cliente</th>
                    <th>Llegada</th>
                    <th>Resultado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {a.planificadas.map((p, i) => (
                    <tr key={p.id ?? i}>
                      <td>{p.orden}</td>
                      <td>
                        {p.cliente?.razonSocial}
                        <div className="sutil">{p.cliente?.direccion}</div>
                      </td>
                      <td>{p.visita ? fechaHoraCorta(p.visita.inicioEn) : '—'}</td>
                      <td>
                        {p.estado === 'CANCELADA' ? (
                          <>
                            <Insignia estado="ANULADO" /> <span className="sutil">{p.motivoCancelacion}</span>
                          </>
                        ) : p.visita?.resultado ? (
                          <>
                            {RESULTADO[p.visita.resultado]} {p.visita.motivoSinVenta && <span className="sutil">· {p.visita.motivoSinVenta}</span>}
                          </>
                        ) : p.visita ? (
                          'En curso'
                        ) : (
                          <span className="sutil">Pendiente</span>
                        )}
                      </td>
                      <td>
                        {p.id && p.estado === 'PROGRAMADA' && !p.visita && puede('ruta.planificar') && (
                          <Boton variante="peligro" onClick={() => setCancelar(p.id)}>
                            Cancelar
                          </Boton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {a.fueraDePlan.length > 0 && (
                <>
                  <h2 style={{ marginTop: 18 }}>Fuera de plan</h2>
                  <table>
                    <tbody>
                      {a.fueraDePlan.map((v) => (
                        <tr key={v.id}>
                          <td>{v.cliente?.razonSocial}</td>
                          <td>{fechaHoraCorta(v.inicioEn)}</td>
                          <td>{v.resultado ? RESULTADO[v.resultado] : 'En curso'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}
        </Estado>
      </Tarjeta>
      {cancelar && <ModalCancelarVisita id={cancelar} alCerrar={() => setCancelar(null)} />}
    </>
  );
}

function ModalCancelarVisita({ id, alCerrar }: { id: string; alCerrar: () => void }) {
  const [motivo, setMotivo] = useState('');
  const cancelar = useAccion(() => post(`/visitas-planificadas/${id}/cancelar`, { motivo: motivo.trim() }), [['agenda']], alCerrar);
  return (
    <Modal titulo="Cancelar visita planificada" abierto alCerrar={alCerrar}>
      <p className="sutil">La visita deja de contar para el cumplimiento del día.</p>
      <Campo etiqueta="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
      <MensajeError texto={cancelar.error} />
      <div className="acciones" style={{ marginTop: 14 }}>
        <Boton variante="peligro" disabled={motivo.trim().length < 3 || cancelar.enCurso} onClick={() => cancelar.ejecutar(undefined)}>
          Cancelar visita
        </Boton>
        <Boton onClick={alCerrar}>Volver</Boton>
      </div>
    </Modal>
  );
}
