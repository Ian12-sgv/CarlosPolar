import { registrarEntregaSchema } from '@cp/domain';
import * as Crypto from 'expo-crypto';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useCache } from '../cache';
import { Firma, type ControlFirma } from '../componentes/firma';
import { useApp } from '../contexto';
import { useNavegacion } from '../navegacion';
import type { Operacion } from '../sincronizacion/cola';
import type { ManifiestoApp } from '../tipos';
import { ubicacionActual } from '../ubicacion';
import { Aviso, Boton, Campo, Opciones, Pantalla, Tarjeta, colores, estilos, haceCuanto, monto, textos } from '../ui';

/** Estado de una factura combinando lo descargado con lo que el chofer registró y aún no se envió. */
function estadoLocal(facturaId: string, estadoServidor: string, operaciones: Operacion[]): { texto: string; color: string } {
  const propia = operaciones.filter((o) => o.tipo === 'ENTREGA' && (o.cuerpo as { facturaId?: string }).facturaId === facturaId).at(-1);
  if (propia?.estado === 'PENDIENTE') return { texto: 'Registrada, por enviar', color: colores.aviso };
  if (propia?.estado === 'RECHAZADA') return { texto: `Rechazada por el servidor: ${propia.error?.mensaje ?? ''}`, color: colores.mal };
  const resultado = (propia?.cuerpo as { resultado?: string } | undefined)?.resultado;
  if (propia?.estado === 'ACEPTADA' && resultado === 'RECHAZADA') return { texto: 'Rechazada por el cliente', color: colores.mal };
  if (estadoServidor === 'ENTREGADA' || propia?.estado === 'ACEPTADA') return { texto: 'Entregada', color: colores.ok };
  return { texto: 'Por entregar', color: colores.sutil };
}

export function PantallaManifiestos() {
  const { navegar } = useNavegacion();
  const { entrada, cargando } = useCache<ManifiestoApp[]>('manifiestos');
  return (
    <Pantalla titulo="Mis rutas">
      {entrada && <Text style={textos.sutil}>Datos {haceCuanto(entrada.actualizadoEn)}</Text>}
      {!cargando && (entrada?.valor.length ?? 0) === 0 && <Aviso tono="aviso" texto="No tiene manifiestos cargados o en ruta." />}
      {entrada?.valor.map((m) => (
        <Tarjeta key={m.id} onPress={() => navegar({ nombre: 'manifiesto', manifiestoId: m.id })}>
          <View style={estilos.fila}>
            <Text style={textos.titulo}>{m.numero}</Text>
            <Text style={textos.sutil}>{m.estado === 'EN_RUTA' ? 'En ruta' : 'Cargado'}</Text>
          </View>
          <Text style={textos.sutil}>
            Vehículo {m.vehiculo.placa} · {m.facturas.length} factura(s)
          </Text>
        </Tarjeta>
      ))}
    </Pantalla>
  );
}

export function PantallaManifiesto({ manifiestoId }: { manifiestoId: string }) {
  const { navegar } = useNavegacion();
  const { operaciones, encolar } = useApp();
  const { entrada } = useCache<ManifiestoApp[]>('manifiestos');
  const m = entrada?.valor.find((x) => x.id === manifiestoId);
  const [saliendo, setSaliendo] = useState(false);
  if (!m) return <Pantalla titulo="Ruta">{null}</Pantalla>;
  const salidaPendiente = operaciones.some((o) => o.tipo === 'INICIAR_RUTA' && o.ruta.includes(m.id) && o.estado !== 'RECHAZADA');

  async function iniciarRuta() {
    setSaliendo(true);
    try {
      const gps = await ubicacionActual();
      await encolar(
        'INICIAR_RUTA',
        `/manifiestos/${m!.id}/iniciar-ruta`,
        { version: m!.version, latitud: gps?.latitud, longitud: gps?.longitud, fechaHoraDispositivo: new Date().toISOString() },
        `Salida a ruta ${m!.numero}`,
      );
    } finally {
      setSaliendo(false);
    }
  }

  return (
    <Pantalla titulo={m.numero}>
      {m.estado === 'CONFIRMADO' &&
        (salidaPendiente ? (
          <Aviso tono="aviso" texto="Salida registrada; se confirmará al sincronizar." />
        ) : (
          <Boton texto="Iniciar ruta" onPress={() => void iniciarRuta()} cargando={saliendo} />
        ))}
      {[...m.facturas]
        .sort((a, b) => (a.ordenVisita ?? 0) - (b.ordenVisita ?? 0))
        .map((f) => {
          const estado = estadoLocal(f.facturaId, f.factura.estado, operaciones);
          return (
            <Tarjeta key={f.facturaId} onPress={() => navegar({ nombre: 'entrega', manifiestoId: m.id, facturaId: f.facturaId })}>
              <View style={estilos.fila}>
                <Text style={textos.titulo}>
                  {f.ordenVisita}. {f.factura.clienteRazonSocial}
                </Text>
                <Text style={textos.monto}>{monto(f.factura.total, f.factura.moneda)}</Text>
              </View>
              <Text style={textos.sutil}>
                {f.factura.numero} · {f.factura.clienteDireccion}
              </Text>
              <Text style={{ color: estado.color, fontWeight: '600' }}>{estado.texto}</Text>
            </Tarjeta>
          );
        })}
    </Pantalla>
  );
}

/** Entrega total con firma y GPS, o rechazo total con motivo. También permite cobrar en el momento. */
export function PantallaEntrega({ manifiestoId, facturaId }: { manifiestoId: string; facturaId: string }) {
  const { encolar, operaciones } = useApp();
  const { volver, navegar } = useNavegacion();
  const { entrada } = useCache<ManifiestoApp[]>('manifiestos');
  const m = entrada?.valor.find((x) => x.id === manifiestoId);
  const f = m?.facturas.find((x) => x.facturaId === facturaId);
  const firma = useRef<ControlFirma>(null);
  const [resultado, setResultado] = useState<'CONFIRMADA' | 'RECHAZADA'>('CONFIRMADA');
  const [receptor, setReceptor] = useState('');
  const [documento, setDocumento] = useState('');
  const [motivo, setMotivo] = useState('');
  const [firmado, setFirmado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  if (!m || !f) return <Pantalla titulo="Entrega">{null}</Pantalla>;
  const estado = estadoLocal(facturaId, f.factura.estado, operaciones);
  const yaRegistrada = estado.texto !== 'Por entregar' && !estado.texto.startsWith('Rechazada por el servidor') && estado.texto !== 'Rechazada por el cliente';
  const lineas = m.items.filter((i) => i.facturaItem.facturaId === facturaId);

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      const gps = await ubicacionActual();
      if (!gps) {
        setError('Active la ubicación: es obligatoria para registrar la entrega.');
        return;
      }
      const imagen = resultado === 'CONFIRMADA' ? await firma.current?.capturar() : null;
      const cuerpo = {
        id: Crypto.randomUUID(),
        facturaId,
        resultado,
        fechaHoraDispositivo: new Date().toISOString(),
        ...gps,
        receptorNombre: resultado === 'CONFIRMADA' ? receptor.trim() : undefined,
        receptorDocumento: resultado === 'CONFIRMADA' && documento.trim() ? documento.trim() : undefined,
        motivoRechazo: resultado === 'RECHAZADA' ? motivo.trim() : undefined,
        firma: imagen ? { mime: 'image/png' as const, contenidoBase64: imagen } : undefined,
      };
      const validado = registrarEntregaSchema.safeParse(cuerpo);
      if (!validado.success) {
        setError(validado.error.issues.map((i) => i.message).join('; '));
        return;
      }
      await encolar(
        'ENTREGA',
        '/entregas',
        validado.data,
        `${resultado === 'CONFIRMADA' ? 'Entrega' : 'Rechazo'} de ${f!.factura.numero} (${f!.factura.clienteRazonSocial})`,
      );
      volver();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Pantalla titulo={f.factura.clienteRazonSocial}>
      <Text style={textos.sutil}>
        {f.factura.numero} · {f.factura.clienteDireccion}
      </Text>
      <Tarjeta>
        {lineas.map((l, i) => (
          <View key={i} style={estilos.fila}>
            <Text style={textos.normal}>{l.facturaItem.producto.nombre}</Text>
            <Text style={textos.monto}>{Number(l.cantidadCargada)}</Text>
          </View>
        ))}
        <View style={[estilos.fila, { marginTop: 6 }]}>
          <Text style={textos.titulo}>Total</Text>
          <Text style={textos.monto}>{monto(f.factura.total, f.factura.moneda)}</Text>
        </View>
      </Tarjeta>
      {m.estado !== 'EN_RUTA' && <Aviso tono="aviso" texto="Inicie la ruta antes de registrar entregas." />}
      {yaRegistrada ? (
        <Aviso tono="ok" texto={estado.texto} />
      ) : (
        <>
          <Opciones
            etiqueta="Resultado"
            valor={resultado}
            alCambiar={setResultado}
            opciones={[
              { valor: 'CONFIRMADA', texto: 'Entregada' },
              { valor: 'RECHAZADA', texto: 'Rechazada' },
            ]}
          />
          {resultado === 'CONFIRMADA' ? (
            <>
              <Campo etiqueta="Nombre de quien recibe" value={receptor} onChangeText={setReceptor} />
              <Campo etiqueta="Cédula (opcional)" value={documento} onChangeText={setDocumento} keyboardType="number-pad" />
              <Firma ref={firma} alCambiar={setFirmado} />
              <Boton texto="Borrar firma" variante="normal" onPress={() => firma.current?.limpiar()} />
            </>
          ) : (
            <Campo etiqueta="Motivo del rechazo" value={motivo} onChangeText={setMotivo} multiline />
          )}
          {error && <Aviso texto={error} />}
          <Boton
            texto={resultado === 'CONFIRMADA' ? 'Confirmar entrega' : 'Registrar rechazo'}
            onPress={() => void guardar()}
            cargando={guardando}
            deshabilitado={m.estado !== 'EN_RUTA' || (resultado === 'CONFIRMADA' ? !firmado || receptor.trim().length < 2 : motivo.trim().length < 3)}
          />
        </>
      )}
      <Boton
        texto="Registrar cobro de esta factura"
        variante="normal"
        onPress={() =>
          navegar({
            nombre: 'pago',
            clienteId: f.factura.clienteId,
            facturas: [{ facturaId, numero: f.factura.numero, moneda: f.factura.moneda as 'USD' | 'VES', saldo: f.factura.total }],
          })
        }
      />
    </Pantalla>
  );
}
