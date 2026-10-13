import { Text, View } from 'react-native';
import { useApp } from '../contexto';
import { Aviso, Boton, Pantalla, Tarjeta, colores, estilos, haceCuanto, textos } from '../ui';

const ESTADOS = {
  PENDIENTE: { texto: 'Por enviar', color: colores.aviso },
  ACEPTADA: { texto: 'Aceptada', color: colores.ok },
  RECHAZADA: { texto: 'Rechazada', color: colores.mal },
} as const;

/** Todo lo registrado en el teléfono y su estado de envío. */
export function PantallaPendientes() {
  const { operaciones, sincronizar, sincronizando, descartar, ultimoEnvio } = useApp();
  const ordenadas = [...operaciones].reverse();
  return (
    <Pantalla titulo="Sincronización">
      {ultimoEnvio?.detenidoPor === 'SIN_CONEXION' && <Aviso tono="aviso" texto="Sin conexión. Lo pendiente se enviará automáticamente al recuperar la señal." />}
      {ultimoEnvio?.detenidoPor === 'SESION' && <Aviso texto="La sesión venció. Cierre la app y vuelva a entrar con conexión." />}
      <Boton texto="Enviar ahora" onPress={() => void sincronizar(true)} cargando={sincronizando} />
      {ordenadas.length === 0 && <Text style={textos.sutil}>No hay operaciones registradas.</Text>}
      {ordenadas.map((o) => (
        <Tarjeta key={o.id}>
          <View style={estilos.fila}>
            <Text style={[textos.normal, { flex: 1 }]}>{o.descripcion}</Text>
            <Text style={{ color: ESTADOS[o.estado].color, fontWeight: '700' }}>{ESTADOS[o.estado].texto}</Text>
          </View>
          <Text style={textos.sutil}>
            Registrada {haceCuanto(o.creadaEn)}
            {o.intentos > 1 ? ` · ${o.intentos} intentos` : ''}
          </Text>
          {o.error && o.estado !== 'ACEPTADA' && <Text style={{ color: o.estado === 'RECHAZADA' ? colores.mal : colores.sutil }}>{o.error.mensaje}</Text>}
          {o.estado === 'RECHAZADA' && (
            <>
              <Text style={textos.sutil}>Corrija y vuelva a registrar la operación; esta no se reenviará.</Text>
              <Boton texto="Entendido, descartar" variante="normal" onPress={() => void descartar(o.id)} />
            </>
          )}
        </Tarjeta>
      ))}
    </Pantalla>
  );
}
