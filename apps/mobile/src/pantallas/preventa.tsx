import { cerrarVisitaSchema, emitirPedidoSchema, type ResultadoVisita } from '@cp/domain';
import * as Crypto from 'expo-crypto';
import { useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useCache } from '../cache';
import { useApp } from '../contexto';
import { useNavegacion } from '../navegacion';
import type { CatalogoApp, ClienteApp, EstadoCuentaApp } from '../tipos';
import { ubicacionActual } from '../ubicacion';
import { Aviso, Boton, Campo, Opciones, Pantalla, Tarjeta, colores, estilos, haceCuanto, monto, textos } from '../ui';
import { registrarAccionEnVisita, useVisitaActiva, visitaEnCurso } from '../visita';

export function PantallaClientes() {
  const { navegar } = useNavegacion();
  const { entrada, cargando } = useCache<ClienteApp[]>('clientes');
  const [buscar, setBuscar] = useState('');
  const clientes = (entrada?.valor ?? []).filter((c) => `${c.razonSocial} ${c.nroDocumento}`.toLowerCase().includes(buscar.toLowerCase()));
  return (
    <Pantalla titulo="Mis clientes">
      <Campo etiqueta="Buscar" value={buscar} onChangeText={setBuscar} placeholder="Nombre o documento" />
      {entrada && <Text style={textos.sutil}>Datos {haceCuanto(entrada.actualizadoEn)}</Text>}
      {!cargando && !entrada && <Aviso tono="aviso" texto="Aún no hay datos descargados. Sincronice con conexión." />}
      {clientes.map((c) => (
        <Tarjeta key={c.id} onPress={() => navegar({ nombre: 'cliente', clienteId: c.id })}>
          <Text style={textos.titulo}>{c.razonSocial}</Text>
          <Text style={textos.sutil}>
            {c.tipoDocumento}-{c.nroDocumento} · {c.direccion}
          </Text>
        </Tarjeta>
      ))}
    </Pantalla>
  );
}

export function PantallaCliente({ clienteId }: { clienteId: string }) {
  const { navegar } = useNavegacion();
  const clientes = useCache<ClienteApp[]>('clientes');
  const cuenta = useCache<EstadoCuentaApp>(`cuenta:${clienteId}`);
  const cliente = clientes.entrada?.valor.find((c) => c.id === clienteId);
  const c = cuenta.entrada?.valor;
  if (!cliente) return <Pantalla titulo="Cliente">{null}</Pantalla>;
  return (
    <Pantalla titulo={cliente.razonSocial}>
      <Text style={textos.sutil}>
        {cliente.tipoDocumento}-{cliente.nroDocumento} · {cliente.direccion}
        {cliente.telefono ? ` · ${cliente.telefono}` : ''}
      </Text>
      <BloqueVisita clienteId={cliente.id} razonSocial={cliente.razonSocial} />
      {c?.restricciones.map((r) => <Aviso key={r.codigo} texto={r.mensaje} />)}
      <Tarjeta>
        <Text style={textos.titulo}>Estado de cuenta</Text>
        {cuenta.entrada && <Text style={textos.sutil}>Actualizado {haceCuanto(cuenta.entrada.actualizadoEn)}</Text>}
        {!c && <Text style={textos.sutil}>Sin datos descargados.</Text>}
        {c?.porMoneda.length === 0 && <Text style={textos.normal}>Sin deuda pendiente.</Text>}
        {c?.porMoneda.map((m) => (
          <View key={m.moneda} style={{ marginTop: 6 }}>
            <View style={estilos.fila}>
              <Text style={textos.normal}>Saldo</Text>
              <Text style={textos.monto}>{monto(m.saldo, m.moneda)}</Text>
            </View>
            <View style={estilos.fila}>
              <Text style={textos.sutil}>Vencido</Text>
              <Text style={[textos.monto, Number(m.vencido) > 0 && { color: colores.mal }]}>{monto(m.vencido, m.moneda)}</Text>
            </View>
            <View style={estilos.fila}>
              <Text style={textos.sutil}>Por vencer (7 días)</Text>
              <Text style={textos.monto}>{monto(m.proximoAVencer, m.moneda)}</Text>
            </View>
            <View style={estilos.fila}>
              <Text style={textos.sutil}>Pagos por validar</Text>
              <Text style={textos.monto}>{monto(m.pagosPorValidar, m.moneda)}</Text>
            </View>
          </View>
        ))}
        {c?.credito && (
          <View style={[estilos.fila, { marginTop: 6 }]}>
            <Text style={textos.sutil}>Crédito disponible</Text>
            <Text style={textos.monto}>{monto(c.credito.disponible, c.monedaCredito)}</Text>
          </View>
        )}
      </Tarjeta>
      {c?.facturas.map((f) => (
        <Tarjeta key={f.facturaId}>
          <View style={estilos.fila}>
            <Text style={textos.normal}>{f.numero}</Text>
            <Text style={textos.monto}>{monto(f.saldo, f.moneda)}</Text>
          </View>
          <Text style={[textos.sutil, f.diasVencido > 0 && { color: colores.mal }]}>
            {f.diasVencido > 0 ? `Vencida hace ${f.diasVencido} día(s)` : `Vence ${f.fechaVencimiento.slice(0, 10).split('-').reverse().join('/')}`}
          </Text>
        </Tarjeta>
      ))}
      <Boton texto="Nuevo pedido" onPress={() => navegar({ nombre: 'pedido', clienteId })} deshabilitado={!cliente.listaPrecioId} />
      <Boton
        texto="Registrar cobro"
        variante="normal"
        onPress={() =>
          navegar({ nombre: 'pago', clienteId, facturas: (c?.facturas ?? []).map((f) => ({ facturaId: f.facturaId, numero: f.numero, moneda: f.moneda, saldo: f.saldo })) })
        }
      />
    </Pantalla>
  );
}

/**
 * Pedido con el catálogo guardado en el teléfono. El precio y el stock se
 * revalidan en el servidor al enviarlo; si el precio cambió, el pedido vuelve
 * rechazado con el precio nuevo para corregirlo.
 */
export function PantallaPedido({ clienteId }: { clienteId: string }) {
  const { encolar } = useApp();
  const { reiniciar } = useNavegacion();
  const clientes = useCache<ClienteApp[]>('clientes');
  const cliente = clientes.entrada?.valor.find((c) => c.id === clienteId);
  const catalogo = useCache<CatalogoApp>(cliente?.listaPrecioId ? `catalogo:${cliente.listaPrecioId}` : null);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [buscar, setBuscar] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const productos = catalogo.entrada?.valor.productos ?? [];
  const moneda = catalogo.entrada?.valor.listaPrecio.moneda ?? 'USD';
  const lineas = useMemo(
    () =>
      productos
        .map((p) => ({ p, cantidad: Number((cantidades[p.id] ?? '').replace(',', '.')) }))
        .filter((l) => Number.isFinite(l.cantidad) && l.cantidad > 0),
    [productos, cantidades],
  );
  const total = lineas.reduce((s, l) => s + l.cantidad * Number(l.p.precio) * (1 + Number(l.p.alicuotaIva) / 100), 0);

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      const gps = await ubicacionActual();
      const visitaId = await visitaEnCurso(clienteId);
      const cuerpo = {
        id: Crypto.randomUUID(),
        clienteId,
        visitaId,
        items: lineas.map((l) => ({ productoId: l.p.id, cantidad: l.cantidad, precioOfertado: Number(l.p.precio) })),
        observaciones: observaciones.trim() || undefined,
        latitud: gps?.latitud,
        longitud: gps?.longitud,
        fechaHoraDispositivo: new Date().toISOString(),
      };
      const validado = emitirPedidoSchema.safeParse(cuerpo);
      if (!validado.success) {
        setError(validado.error.issues.map((i) => i.message).join('; '));
        return;
      }
      await encolar('PEDIDO', '/pedidos', validado.data, `Pedido a ${cliente?.razonSocial ?? ''} por ${monto(total, moneda)}`);
      if (visitaId) {
        await registrarAccionEnVisita(clienteId, 'pedido');
        reiniciar({ nombre: 'cliente', clienteId });
      } else {
        reiniciar({ nombre: 'pendientes' });
      }
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Pantalla titulo={`Pedido · ${cliente?.razonSocial ?? ''}`}>
      {catalogo.entrada && <Text style={textos.sutil}>Catálogo {haceCuanto(catalogo.entrada.actualizadoEn)}. Stock y precio se confirman al enviar.</Text>}
      {!catalogo.cargando && !catalogo.entrada && <Aviso tono="aviso" texto="No hay catálogo descargado para la lista de este cliente." />}
      <Campo etiqueta="Buscar producto" value={buscar} onChangeText={setBuscar} />
      {productos
        .filter((p) => `${p.sku} ${p.nombre}`.toLowerCase().includes(buscar.toLowerCase()))
        .map((p) => {
          const pedido = Number((cantidades[p.id] ?? '').replace(',', '.')) || 0;
          const sinStock = pedido > Number(p.disponible);
          return (
            <Tarjeta key={p.id}>
              <View style={estilos.fila}>
                <View style={{ flex: 1 }}>
                  <Text style={textos.normal}>{p.nombre}</Text>
                  <Text style={[textos.sutil, sinStock && { color: colores.aviso }]}>
                    {monto(p.precio, moneda)} · disponible {Number(p.disponible)} {p.unidad}
                  </Text>
                </View>
                <TextInput
                  value={cantidades[p.id] ?? ''}
                  onChangeText={(v) => setCantidades({ ...cantidades, [p.id]: v })}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  style={[estilos.entrada, { width: 80, textAlign: 'right' }]}
                  accessibilityLabel={`Cantidad de ${p.nombre}`}
                />
              </View>
            </Tarjeta>
          );
        })}
      <Campo etiqueta="Observaciones" value={observaciones} onChangeText={setObservaciones} multiline />
      <Tarjeta>
        <View style={estilos.fila}>
          <Text style={textos.titulo}>Total estimado (con IVA)</Text>
          <Text style={textos.monto}>{monto(total, moneda)}</Text>
        </View>
        <Text style={textos.sutil}>{lineas.length} producto(s)</Text>
      </Tarjeta>
      {error && <Aviso texto={error} />}
      <Boton texto="Guardar pedido" onPress={() => void guardar()} deshabilitado={lineas.length === 0} cargando={guardando} />
    </Pantalla>
  );
}

const RESULTADOS_SIN_VENTA: { valor: ResultadoVisita; texto: string }[] = [
  { valor: 'SIN_PEDIDO', texto: 'Sin pedido' },
  { valor: 'CLIENTE_CERRADO', texto: 'Cerrado' },
  { valor: 'NO_ATENDIDO', texto: 'No atendido' },
];

/**
 * Inicio y cierre de la visita al cliente. Al iniciar se registra la llegada
 * con GPS; los pedidos y cobros hechos mientras está abierta quedan ligados a
 * ella; al cerrar se elige el resultado (sugerido según lo que se hizo).
 */
function BloqueVisita({ clienteId, razonSocial }: { clienteId: string; razonSocial: string }) {
  const { encolar } = useApp();
  const { navegar } = useNavegacion();
  const { visita, guardar, cargando } = useVisitaActiva();
  const [sinVenta, setSinVenta] = useState<ResultadoVisita>('SIN_PEDIDO');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enCurso, setEnCurso] = useState(false);
  if (cargando) return null;

  if (visita && visita.clienteId !== clienteId) {
    return (
      <Tarjeta onPress={() => navegar({ nombre: 'cliente', clienteId: visita.clienteId })}>
        <Text style={textos.normal}>Tiene una visita abierta en {visita.razonSocial}.</Text>
        <Text style={textos.sutil}>Ciérrela antes de iniciar otra. Toque para ir.</Text>
      </Tarjeta>
    );
  }

  async function iniciar() {
    setError(null);
    setEnCurso(true);
    try {
      const gps = await ubicacionActual();
      if (!gps) {
        setError('Active la ubicación: la llegada al cliente se registra con GPS.');
        return;
      }
      const nueva = { id: Crypto.randomUUID(), clienteId, inicioEn: new Date().toISOString(), ...gps };
      await encolar('VISITA', '/visitas', nueva, `Visita a ${razonSocial}`);
      await guardar({ id: nueva.id, clienteId, razonSocial, inicioEn: nueva.inicioEn, huboPedido: false, huboCobro: false });
    } finally {
      setEnCurso(false);
    }
  }

  async function cerrar() {
    if (!visita) return;
    setError(null);
    const resultado: ResultadoVisita =
      visita.huboPedido && visita.huboCobro ? 'PEDIDO_Y_COBRO' : visita.huboPedido ? 'PEDIDO' : visita.huboCobro ? 'COBRO' : sinVenta;
    const cuerpo = {
      resultado,
      finEn: new Date().toISOString(),
      motivoSinVenta: resultado === sinVenta && motivo.trim() ? motivo.trim() : undefined,
    };
    const validado = cerrarVisitaSchema.safeParse(cuerpo);
    if (!validado.success) {
      setError('Indique el motivo de la visita sin venta.');
      return;
    }
    setEnCurso(true);
    try {
      await encolar('CERRAR_VISITA', `/visitas/${visita.id}/cerrar`, validado.data, `Cierre de visita a ${razonSocial}`);
      await guardar(null);
      setMotivo('');
    } finally {
      setEnCurso(false);
    }
  }

  if (!visita) {
    return (
      <>
        {error && <Aviso texto={error} />}
        <Boton texto="Iniciar visita" onPress={() => void iniciar()} cargando={enCurso} />
      </>
    );
  }

  const conVenta = visita.huboPedido || visita.huboCobro;
  const hora = new Date(visita.inicioEn).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
  return (
    <Tarjeta>
      <Text style={textos.titulo}>Visita en curso desde las {hora}</Text>
      <Text style={textos.sutil}>
        {conVenta ? `Registrado: ${[visita.huboPedido && 'pedido', visita.huboCobro && 'cobro'].filter(Boolean).join(' y ')}.` : 'Sin pedido ni cobro todavía.'}
      </Text>
      {!conVenta && (
        <>
          <Opciones etiqueta="Resultado" valor={sinVenta} alCambiar={setSinVenta} opciones={RESULTADOS_SIN_VENTA} />
          <Campo etiqueta="Motivo" value={motivo} onChangeText={setMotivo} placeholder="Tenía inventario, sin dinero, cerrado…" />
        </>
      )}
      {error && <Aviso texto={error} />}
      <Boton texto="Terminar visita" variante="normal" onPress={() => void cerrar()} cargando={enCurso} />
    </Tarjeta>
  );
}
