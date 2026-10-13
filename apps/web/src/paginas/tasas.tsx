import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorApi, get, post } from '../api';
import { Boton, Campo, Dato, Encabezado, Estado, MensajeError, Tarjeta, useAccion } from '../componentes/ui';
import { fecha, hoyCaracas, monto } from '../formatos';

interface Tasa {
  id: string;
  fecha: string;
  tasa: string;
  fuente: string;
}

/** Sin tasa reciente no se puede facturar ni registrar pagos: es la primera tarea del día. */
export function PaginaTasas() {
  const vigente = useQuery({
    queryKey: ['tasa-vigente'],
    queryFn: () => get<Tasa>('/tasas/vigente').catch((e: unknown) => (e instanceof ErrorApi && e.estado === 404 ? null : Promise.reject(e))),
  });
  const [fechaValor, setFechaValor] = useState(hoyCaracas());
  const [tasa, setTasa] = useState('');
  const registrar = useAccion(() => post('/tasas', { fecha: fechaValor, tasa: Number(tasa), fuente: 'BCV' }), [['tasa-vigente']], () => setTasa(''));

  return (
    <>
      <Encabezado titulo="Tasa de cambio" subtitulo="Bolívares por dólar (BCV). Cada factura y cada pago guardan la tasa con que se registraron." />
      <Tarjeta titulo="Tasa vigente">
        <Estado cargando={vigente.isLoading} error={vigente.error}>
          {vigente.data ? (
            <div className="rejilla">
              <Dato etiqueta="Tasa">{monto(vigente.data.tasa)} Bs/USD</Dato>
              <Dato etiqueta="Fecha valor">{fecha(vigente.data.fecha)}</Dato>
              <Dato etiqueta="Fuente">{vigente.data.fuente}</Dato>
            </div>
          ) : (
            <p className="aviso mal">No hay tasa reciente: no se puede facturar ni registrar pagos hasta registrarla.</p>
          )}
        </Estado>
      </Tarjeta>
      <Tarjeta titulo="Registrar tasa del día">
        <div className="formulario">
          <Campo etiqueta="Fecha valor" type="date" value={fechaValor} onChange={(e) => setFechaValor(e.target.value)} />
          <Campo etiqueta="Bs por USD" type="number" step="0.0001" min="0" value={tasa} onChange={(e) => setTasa(e.target.value)} />
        </div>
        <MensajeError texto={registrar.error} />
        <Boton variante="primario" disabled={!tasa || registrar.enCurso} onClick={() => registrar.ejecutar(undefined)}>
          Registrar
        </Boton>
      </Tarjeta>
    </>
  );
}
