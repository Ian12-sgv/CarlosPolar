import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { get, post } from '../api';
import { Boton, Campo, Encabezado, Estado, MensajeError, Modal, Selector, Tarjeta, useAccion } from '../componentes/ui';
import { cant } from '../formatos';
import { useSesion } from '../sesion';
import type { Existencia, Producto } from '../tipos';

export function PaginaInventario() {
  const { puede } = useSesion();
  const [tipo, setTipo] = useState('ALMACEN');
  const [buscar, setBuscar] = useState('');
  const [modal, setModal] = useState<'ingreso' | 'ajuste' | null>(null);
  const existencias = useQuery({ queryKey: ['existencias', tipo], queryFn: () => get<Existencia[]>(`/inventario/existencias${tipo ? `?tipo=${tipo}` : ''}`) });
  const filtradas = (existencias.data ?? []).filter((e) => `${e.sku} ${e.producto}`.toLowerCase().includes(buscar.toLowerCase()));

  return (
    <>
      <Encabezado
        titulo="Inventario"
        subtitulo="Saldos reconstruidos desde el libro de movimientos"
        acciones={
          <>
            {puede('inventario.ingresar') && (
              <Boton variante="primario" onClick={() => setModal('ingreso')}>
                Registrar ingreso
              </Boton>
            )}
            {puede('inventario.ajustar') && <Boton onClick={() => setModal('ajuste')}>Ajuste</Boton>}
          </>
        }
      />
      <Tarjeta>
        <div className="filtros">
          <Selector
            etiqueta="Ubicación"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            vacio="Todas"
            opciones={[
              { valor: 'ALMACEN', texto: 'Almacenes' },
              { valor: 'VEHICULO', texto: 'Vehículos' },
            ]}
          />
          <Campo etiqueta="Buscar producto" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </div>
        <Estado cargando={existencias.isLoading} error={existencias.error} vacio={filtradas.length === 0}>
          <div className="tabla-envoltura">
            <table>
              <thead>
                <tr>
                  <th>Ubicación</th>
                  <th>Producto</th>
                  <th className="num">Físico</th>
                  <th className="num">Reservado</th>
                  <th className="num">Disponible</th>
                  <th className="num">Mínimo</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((e) => (
                  <tr key={`${e.ubicacion}-${e.productoId}`}>
                    <td>{e.ubicacion}</td>
                    <td>
                      {e.producto} <span className="sutil">{e.sku}</span>
                    </td>
                    <td className="num">{cant(e.fisico)}</td>
                    <td className="num">{cant(e.reservado)}</td>
                    <td className="num" style={e.bajoMinimo ? { color: 'var(--mal)', fontWeight: 600 } : undefined}>
                      {cant(e.disponible)}
                    </td>
                    <td className="num">{cant(e.minimo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Estado>
      </Tarjeta>
      {modal && <ModalMovimiento tipo={modal} alCerrar={() => setModal(null)} />}
    </>
  );
}

function ModalMovimiento({ tipo, alCerrar }: { tipo: 'ingreso' | 'ajuste'; alCerrar: () => void }) {
  const productos = useQuery({ queryKey: ['productos'], queryFn: () => get<Producto[]>('/productos') });
  const [productoId, setProductoId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [texto, setTexto] = useState('');
  const registrar = useAccion(
    () =>
      tipo === 'ingreso'
        ? post('/inventario/ingresos', { productoId, cantidad: Number(cantidad), documento: texto.trim() || undefined })
        : post('/inventario/ajustes', { productoId, cantidad: Number(cantidad), motivo: texto.trim() }),
    [['existencias']],
    alCerrar,
  );
  return (
    <Modal titulo={tipo === 'ingreso' ? 'Ingreso de mercancía al almacén' : 'Ajuste de inventario'} abierto alCerrar={alCerrar}>
      <div className="formulario">
        <Selector
          etiqueta="Producto"
          value={productoId}
          onChange={(e) => setProductoId(e.target.value)}
          vacio="Seleccione…"
          opciones={(productos.data ?? []).map((p) => ({ valor: p.id, texto: `${p.sku} · ${p.nombre}` }))}
        />
        <Campo
          etiqueta={tipo === 'ingreso' ? 'Cantidad' : 'Cantidad (negativa para restar)'}
          type="number"
          step="0.001"
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
        />
        <Campo
          etiqueta={tipo === 'ingreso' ? 'Documento de respaldo' : 'Motivo'}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          ayuda={tipo === 'ingreso' ? 'Nota de entrega, orden de compra…' : 'Conteo físico, merma, daño…'}
        />
      </div>
      <MensajeError texto={registrar.error} />
      <div className="acciones">
        <Boton variante="primario" disabled={!productoId || !cantidad || registrar.enCurso} onClick={() => registrar.ejecutar(undefined)}>
          Registrar
        </Boton>
        <Boton onClick={alCerrar}>Cancelar</Boton>
      </div>
    </Modal>
  );
}
