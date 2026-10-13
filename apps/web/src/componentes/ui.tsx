import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { textoError } from '../api';
import { etiqueta, tono } from '../formatos';

export function Insignia({ estado }: { estado: string }) {
  return <span className={`insignia ${tono(estado)}`}>{etiqueta(estado)}</span>;
}

export function Boton({ variante = 'normal', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'normal' | 'primario' | 'peligro' }) {
  return <button {...props} className={`boton ${variante} ${props.className ?? ''}`} />;
}

export function Campo({ etiqueta: texto, ayuda, ...props }: InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; ayuda?: string }) {
  return (
    <label className="campo">
      <span>{texto}</span>
      <input {...props} />
      {ayuda && <small>{ayuda}</small>}
    </label>
  );
}

export function Selector({
  etiqueta: texto,
  opciones,
  vacio,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { etiqueta: string; opciones: { valor: string; texto: string }[]; vacio?: string }) {
  return (
    <label className="campo">
      <span>{texto}</span>
      <select {...props}>
        {vacio !== undefined && <option value="">{vacio}</option>}
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Tarjeta({ titulo, acciones, children }: { titulo?: ReactNode; acciones?: ReactNode; children: ReactNode }) {
  return (
    <section className="tarjeta">
      {(titulo || acciones) && (
        <header>
          {titulo && <h2>{titulo}</h2>}
          {acciones && <div className="acciones">{acciones}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Encabezado({ titulo, subtitulo, acciones }: { titulo: string; subtitulo?: ReactNode; acciones?: ReactNode }) {
  return (
    <div className="encabezado">
      <div>
        <h1>{titulo}</h1>
        {subtitulo && <p className="sutil">{subtitulo}</p>}
      </div>
      {acciones && <div className="acciones">{acciones}</div>}
    </div>
  );
}

export function Estado({ cargando, error, vacio, children }: { cargando?: boolean; error?: unknown; vacio?: boolean; children?: ReactNode }) {
  if (cargando) return <p className="sutil">Cargando…</p>;
  if (error) return <p className="aviso mal">{textoError(error)}</p>;
  if (vacio) return <p className="sutil">No hay registros.</p>;
  return <>{children}</>;
}

export function Modal({ titulo, abierto, alCerrar, children }: { titulo: string; abierto: boolean; alCerrar: () => void; children: ReactNode }) {
  if (!abierto) return null;
  return (
    <div className="fondo-modal" onMouseDown={(e) => e.target === e.currentTarget && alCerrar()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <header>
          <h2>{titulo}</h2>
          <button className="cerrar" onClick={alCerrar} aria-label="Cerrar">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function Dato({ etiqueta: texto, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="dato">
      <span>{texto}</span>
      <strong>{children}</strong>
    </div>
  );
}

/**
 * Mutación con manejo de error y recarga de consultas. Devuelve el error como
 * texto listo para mostrar.
 */
export function useAccion<E, R>(fn: (entrada: E) => Promise<R>, invalidar: QueryKey[] = [], alTerminar?: (r: R) => void) {
  const cliente = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const mutacion = useMutation({
    mutationFn: fn,
    onMutate: () => setError(null),
    onError: (e) => setError(textoError(e)),
    onSuccess: async (r) => {
      await Promise.all(invalidar.map((clave) => cliente.invalidateQueries({ queryKey: clave })));
      alTerminar?.(r);
    },
  });
  return { ejecutar: mutacion.mutate, enCurso: mutacion.isPending, error, limpiar: () => setError(null) };
}

export function MensajeError({ texto }: { texto: string | null }) {
  return texto ? <p className="aviso mal">{texto}</p> : null;
}
