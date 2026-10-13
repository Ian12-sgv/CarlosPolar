import { METODOS_PAGO, registrarPagoSchema, type Imagen, type MetodoPago } from '@cp/domain';
import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { Image, Text, TextInput, View } from 'react-native';
import { useCache } from '../cache';
import { fotografiarComprobante } from '../comprobante';
import { useApp } from '../contexto';
import { useNavegacion, type FacturaCobrable } from '../navegacion';
import type { ClienteApp } from '../tipos';
import { ubicacionActual } from '../ubicacion';
import { Aviso, Boton, Campo, Opciones, Pantalla, Tarjeta, estilos, monto, textos } from '../ui';
import { registrarAccionEnVisita, visitaEnCurso } from '../visita';

const ETIQUETA_METODO: Record<MetodoPago, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  PAGO_MOVIL: 'Pago móvil',
  PUNTO_VENTA: 'Punto de venta',
  ZELLE: 'Zelle',
};

function hoy(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas' }).format(new Date());
}

/**
 * Registro de un cobro en campo. Queda "por validar" hasta que Administración
 * lo confirma; los abonos van en la moneda de cada factura y el servidor
 * convierte con la tasa del día.
 */
export function PantallaPago({ clienteId, facturas = [] }: { clienteId: string; facturas?: FacturaCobrable[] }) {
  const { encolar } = useApp();
  const { reiniciar } = useNavegacion();
  const clientes = useCache<ClienteApp[]>('clientes');
  const nombre = clientes.entrada?.valor.find((c) => c.id === clienteId)?.razonSocial ?? 'cliente';
  const [metodo, setMetodo] = useState<MetodoPago>('EFECTIVO');
  const [moneda, setMoneda] = useState<'USD' | 'VES'>('USD');
  const [montoTotal, setMontoTotal] = useState('');
  const [entidad, setEntidad] = useState('');
  const [referencia, setReferencia] = useState('');
  const [abonos, setAbonos] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [foto, setFoto] = useState<{ imagen: Imagen; uri: string } | null>(null);

  async function fotografiar() {
    setError(null);
    const r = await fotografiarComprobante();
    if (r && 'error' in r) setError(r.error);
    else if (r) setFoto(r);
  }
  const numero = (v: string | undefined) => Number((v ?? '').replace(',', '.'));

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
        evidencia: foto?.imagen,
        metodoPago: metodo,
        entidadOrigen: metodo === 'EFECTIVO' ? undefined : entidad.trim(),
        referencia: metodo === 'EFECTIVO' ? undefined : referencia,
        moneda,
        montoTotal: numero(montoTotal),
        fechaEmision: hoy(),
        aplicaciones: facturas.filter((f) => numero(abonos[f.facturaId]) > 0).map((f) => ({ facturaId: f.facturaId, montoAplicado: numero(abonos[f.facturaId]) })),
        latitud: gps?.latitud,
        longitud: gps?.longitud,
        fechaHoraDispositivo: new Date().toISOString(),
      };
      const validado = registrarPagoSchema.safeParse(cuerpo);
      if (!validado.success) {
        setError(validado.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
        return;
      }
      await encolar('PAGO', '/pagos', validado.data, `Cobro de ${monto(cuerpo.montoTotal, moneda)} a ${nombre} (${ETIQUETA_METODO[metodo]})`);
      if (visitaId) {
        await registrarAccionEnVisita(clienteId, 'cobro');
        reiniciar({ nombre: 'cliente', clienteId });
      } else {
        reiniciar({ nombre: 'pendientes' });
      }
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Pantalla titulo={`Cobro · ${nombre}`}>
      <Opciones etiqueta="Método" valor={metodo} alCambiar={setMetodo} opciones={METODOS_PAGO.map((m) => ({ valor: m, texto: ETIQUETA_METODO[m] }))} />
      <Opciones
        etiqueta="Moneda"
        valor={moneda}
        alCambiar={setMoneda}
        opciones={[
          { valor: 'USD', texto: 'Dólares' },
          { valor: 'VES', texto: 'Bolívares' },
        ]}
      />
      <Campo etiqueta="Monto recibido" value={montoTotal} onChangeText={setMontoTotal} keyboardType="decimal-pad" />
      {metodo !== 'EFECTIVO' && (
        <>
          <Campo etiqueta="Banco (código)" value={entidad} onChangeText={setEntidad} placeholder="0102" />
          <Campo etiqueta="Referencia" value={referencia} onChangeText={setReferencia} keyboardType="number-pad" />
        </>
      )}
      {facturas.length > 0 && (
        <Tarjeta>
          <Text style={textos.titulo}>Abonar a facturas</Text>
          <Text style={textos.sutil}>Monto en la moneda de cada factura. Lo no abonado queda a favor del cliente.</Text>
          {facturas.map((f) => (
            <View key={f.facturaId} style={[estilos.fila, { marginTop: 8 }]}>
              <View style={{ flex: 1 }}>
                <Text style={textos.normal}>{f.numero}</Text>
                <Text style={textos.sutil}>Saldo {monto(f.saldo, f.moneda)}</Text>
              </View>
              <TextInput
                value={abonos[f.facturaId] ?? ''}
                onChangeText={(v) => setAbonos({ ...abonos, [f.facturaId]: v })}
                keyboardType="decimal-pad"
                placeholder="0"
                style={[estilos.entrada, { width: 100, textAlign: 'right' }]}
                accessibilityLabel={`Abono a ${f.numero}`}
              />
            </View>
          ))}
        </Tarjeta>
      )}
      <Tarjeta>
        <Text style={textos.titulo}>Comprobante</Text>
        <Text style={textos.sutil}>
          {metodo === 'EFECTIVO' ? 'Opcional en efectivo.' : 'Recomendado: Administración lo usa para validar el pago.'}
        </Text>
        {foto && <Image source={{ uri: foto.uri }} style={{ width: '100%', height: 220, borderRadius: 8, marginTop: 8 }} resizeMode="contain" accessibilityLabel="Foto del comprobante" />}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <View style={{ flex: 1 }}>
            <Boton texto={foto ? 'Tomar otra foto' : 'Fotografiar comprobante'} variante="normal" onPress={() => void fotografiar()} />
          </View>
          {foto && (
            <View style={{ flex: 1 }}>
              <Boton texto="Quitar foto" variante="peligro" onPress={() => setFoto(null)} />
            </View>
          )}
        </View>
      </Tarjeta>
      {error && <Aviso texto={error} />}
      <Boton texto="Guardar cobro" onPress={() => void guardar()} deshabilitado={!(numero(montoTotal) > 0)} cargando={guardando} />
    </Pantalla>
  );
}
