import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { get } from '../api';
import { Encabezado } from '../componentes/ui';
import { useSesion } from '../sesion';
import type { FacturaResumen, Pago, PedidoResumen } from '../tipos';

/** Pendientes de cada área, para que cada rol vea qué le toca hacer hoy. */
export function PaginaInicio() {
  const { usuario, puede } = useSesion();
  const verPedidos = puede('pedido.aprobar', 'pedido.ver_todos');
  const emitidos = useQuery({ queryKey: ['pedidos', 'EMITIDO'], queryFn: () => get<PedidoResumen[]>('/pedidos?estado=EMITIDO&limite=200'), enabled: verPedidos });
  const aprobados = useQuery({ queryKey: ['pedidos', 'APROBADO'], queryFn: () => get<PedidoResumen[]>('/pedidos?estado=APROBADO&limite=200'), enabled: verPedidos });
  const sinControl = useQuery({
    queryKey: ['facturas', 'sin-control'],
    queryFn: () => get<FacturaResumen[]>('/facturas?sinNumeroControl=true&limite=200'),
    enabled: puede('factura.emitir'),
  });
  const porDespachar = useQuery({
    queryKey: ['facturas', 'EMITIDA'],
    queryFn: () => get<FacturaResumen[]>('/facturas?estado=EMITIDA&limite=200'),
    enabled: puede('manifiesto.crear'),
  });
  const pagos = useQuery({ queryKey: ['pagos', 'REGISTRADO'], queryFn: () => get<Pago[]>('/pagos?estado=REGISTRADO&limite=200'), enabled: puede('pago.validar') });

  const tarjetas = [
    puede('pedido.aprobar') && { a: '/pedidos', texto: 'Pedidos por aprobar', valor: emitidos.data?.length },
    puede('factura.emitir') && { a: '/facturacion', texto: 'Pedidos por facturar', valor: aprobados.data?.length },
    puede('factura.emitir') && { a: '/facturacion', texto: 'Facturas sin número de control', valor: sinControl.data?.length },
    puede('manifiesto.crear') && { a: '/manifiestos', texto: 'Facturas por despachar', valor: porDespachar.data?.length },
    puede('pago.validar') && { a: '/pagos', texto: 'Pagos por validar', valor: pagos.data?.length },
  ].filter((t): t is { a: string; texto: string; valor: number | undefined } => Boolean(t));

  return (
    <>
      <Encabezado titulo={`Hola, ${usuario?.nombre ?? ''}`} subtitulo="Pendientes de tu área" />
      {tarjetas.length === 0 ? (
        <p className="sutil">No hay pendientes para tu rol en el backoffice.</p>
      ) : (
        <div className="rejilla">
          {tarjetas.map((t) => (
            <Link key={t.texto} to={t.a} className="indicador">
              <span className="sutil">{t.texto}</span>
              <strong>{t.valor ?? '…'}</strong>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
