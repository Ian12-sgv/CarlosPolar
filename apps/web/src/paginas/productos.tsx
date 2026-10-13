import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { get, patch, post } from '../api';
import { Boton, Campo, Encabezado, Estado, Insignia, MensajeError, Modal, Selector, Tarjeta, useAccion } from '../componentes/ui';
import { cant, fechaHoraCorta, monto } from '../formatos';
import { useSesion } from '../sesion';
import type { ListaPrecio, Producto } from '../tipos';

interface PrecioVersion {
  id: string;
  productoId: string;
  precio: string;
  vigenteDesde: string;
  vigenteHasta: string | null;
  producto: { sku: string; nombre: string };
}

export function PaginaProductos() {
  const { puede } = useSesion();
  const productos = useQuery({ queryKey: ['productos', 'todos'], queryFn: () => get<Producto[]>('/productos?incluirInactivos=true') });
  const listas = useQuery({ queryKey: ['listas'], queryFn: () => get<ListaPrecio[]>('/listas-precio') });
  const [listaId, setListaId] = useState('');
  const lista = listas.data?.find((l) => l.id === (listaId || listas.data?.[0]?.id));
  const precios = useQuery({
    queryKey: ['precios', lista?.id],
    queryFn: () => get<PrecioVersion[]>(`/listas-precio/${lista!.id}/precios`),
    enabled: Boolean(lista),
  });
  const vigentes = new Map((precios.data ?? []).filter((p) => p.vigenteHasta === null).map((p) => [p.productoId, p]));
  const [modal, setModal] = useState<{ tipo: 'producto'; producto: Producto | null } | { tipo: 'precio'; producto: Producto } | { tipo: 'lista' } | null>(null);

  return (
    <>
      <Encabezado
        titulo="Productos y precios"
        subtitulo="Cada cambio de precio crea una versión nueva; los documentos emitidos conservan su precio"
        acciones={
          <>
            {puede('precio.editar') && <Boton onClick={() => setModal({ tipo: 'lista' })}>Nueva lista</Boton>}
            {puede('producto.editar') && (
              <Boton variante="primario" onClick={() => setModal({ tipo: 'producto', producto: null })}>
                Nuevo producto
              </Boton>
            )}
          </>
        }
      />
      <Tarjeta>
        <div className="filtros">
          <Selector
            etiqueta="Lista de precios"
            value={lista?.id ?? ''}
            onChange={(e) => setListaId(e.target.value)}
            opciones={(listas.data ?? []).map((l) => ({ valor: l.id, texto: `${l.codigo} · ${l.nombre} (${l.moneda})` }))}
          />
        </div>
        <Estado cargando={productos.isLoading} error={productos.error} vacio={productos.data?.length === 0}>
          <div className="tabla-envoltura">
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Unidad</th>
                  <th className="num">IVA %</th>
                  <th className="num">Mínimo</th>
                  <th className="num">Precio vigente</th>
                  <th>Desde</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {productos.data?.map((p) => {
                  const precio = vigentes.get(p.id);
                  return (
                    <tr key={p.id}>
                      <td>{p.sku}</td>
                      <td>
                        {p.nombre} {!p.activo && <Insignia estado="ANULADO" />}
                      </td>
                      <td>{p.unidad}</td>
                      <td className="num">{cant(p.alicuotaIva)}</td>
                      <td className="num">{cant(p.stockMinimo)}</td>
                      <td className="num">{precio ? monto(precio.precio, lista?.moneda) : <span className="sutil">sin precio</span>}</td>
                      <td>{precio ? fechaHoraCorta(precio.vigenteDesde) : '—'}</td>
                      <td>
                        <div className="acciones">
                          {puede('precio.editar') && lista && <Boton onClick={() => setModal({ tipo: 'precio', producto: p })}>Precio</Boton>}
                          {puede('producto.editar') && <Boton onClick={() => setModal({ tipo: 'producto', producto: p })}>Editar</Boton>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Estado>
      </Tarjeta>
      {modal?.tipo === 'producto' && <ModalProducto producto={modal.producto} alCerrar={() => setModal(null)} />}
      {modal?.tipo === 'precio' && lista && (
        <ModalPrecio
          producto={modal.producto}
          lista={lista}
          historial={(precios.data ?? []).filter((x) => x.productoId === modal.producto.id)}
          alCerrar={() => setModal(null)}
        />
      )}
      {modal?.tipo === 'lista' && <ModalLista alCerrar={() => setModal(null)} />}
    </>
  );
}

function ModalProducto({ producto, alCerrar }: { producto: Producto | null; alCerrar: () => void }) {
  const [f, setF] = useState({
    sku: producto?.sku ?? '',
    nombre: producto?.nombre ?? '',
    unidad: producto?.unidad ?? 'UND',
    alicuotaIva: producto?.alicuotaIva ?? '16',
    stockMinimo: producto?.stockMinimo ?? '0',
    activo: producto?.activo ?? true,
  });
  const guardar = useAccion(
    () => {
      const comunes = { nombre: f.nombre, unidad: f.unidad, alicuotaIva: Number(f.alicuotaIva), stockMinimo: Number(f.stockMinimo) };
      return producto ? patch(`/productos/${producto.id}`, { ...comunes, activo: f.activo }) : post('/productos', { ...comunes, sku: f.sku });
    },
    [['productos']],
    alCerrar,
  );
  const cambiar = (campo: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [campo]: e.target.value });
  return (
    <Modal titulo={producto ? `Editar ${producto.sku}` : 'Nuevo producto'} abierto alCerrar={alCerrar}>
      <div className="formulario">
        <Campo etiqueta="SKU" value={f.sku} onChange={cambiar('sku')} disabled={Boolean(producto)} />
        <Campo etiqueta="Nombre" value={f.nombre} onChange={cambiar('nombre')} />
        <Campo etiqueta="Unidad" value={f.unidad} onChange={cambiar('unidad')} />
        <Campo etiqueta="IVA %" type="number" step="0.01" value={f.alicuotaIva} onChange={cambiar('alicuotaIva')} />
        <Campo etiqueta="Stock mínimo" type="number" step="0.001" value={f.stockMinimo} onChange={cambiar('stockMinimo')} />
      </div>
      {producto && (
        <label className="casilla">
          <input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} /> Producto activo
        </label>
      )}
      <MensajeError texto={guardar.error} />
      <div className="acciones" style={{ marginTop: 14 }}>
        <Boton variante="primario" disabled={guardar.enCurso} onClick={() => guardar.ejecutar(undefined)}>
          Guardar
        </Boton>
        <Boton onClick={alCerrar}>Cancelar</Boton>
      </div>
    </Modal>
  );
}

function ModalPrecio({ producto, lista, historial, alCerrar }: { producto: Producto; lista: ListaPrecio; historial: PrecioVersion[]; alCerrar: () => void }) {
  const [precio, setPrecio] = useState('');
  const publicar = useAccion(() => post(`/listas-precio/${lista.id}/precios`, { productoId: producto.id, precio: Number(precio) }), [['precios', lista.id], ['catalogo']], alCerrar);
  return (
    <Modal titulo={`Precio de ${producto.nombre} · ${lista.codigo}`} abierto alCerrar={alCerrar}>
      <Campo etiqueta={`Precio nuevo (${lista.moneda}), rige desde ahora`} type="number" step="0.0001" min="0" value={precio} onChange={(e) => setPrecio(e.target.value)} autoFocus />
      <MensajeError texto={publicar.error} />
      <div className="acciones" style={{ margin: '14px 0' }}>
        <Boton variante="primario" disabled={!precio || publicar.enCurso} onClick={() => publicar.ejecutar(undefined)}>
          Publicar
        </Boton>
        <Boton onClick={alCerrar}>Cancelar</Boton>
      </div>
      <h2>Historial</h2>
      <Estado vacio={historial.length === 0}>
        <table>
          <thead>
            <tr>
              <th className="num">Precio</th>
              <th>Desde</th>
              <th>Hasta</th>
            </tr>
          </thead>
          <tbody>
            {historial.map((h) => (
              <tr key={h.id}>
                <td className="num">{monto(h.precio, lista.moneda)}</td>
                <td>{fechaHoraCorta(h.vigenteDesde)}</td>
                <td>{h.vigenteHasta ? fechaHoraCorta(h.vigenteHasta) : 'vigente'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Estado>
    </Modal>
  );
}

function ModalLista({ alCerrar }: { alCerrar: () => void }) {
  const [f, setF] = useState({ codigo: '', nombre: '', moneda: 'USD' });
  const crear = useAccion(() => post('/listas-precio', f), [['listas']], alCerrar);
  return (
    <Modal titulo="Nueva lista de precios" abierto alCerrar={alCerrar}>
      <div className="formulario">
        <Campo etiqueta="Código" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} />
        <Campo etiqueta="Nombre" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
        <Selector etiqueta="Moneda" value={f.moneda} onChange={(e) => setF({ ...f, moneda: e.target.value })} opciones={['USD', 'VES'].map((m) => ({ valor: m, texto: m }))} />
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
