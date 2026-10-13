import { Text, View } from 'react-native';
import { useApp } from '../contexto';
import { useNavegacion } from '../navegacion';
import { Aviso, Boton, Pantalla, Tarjeta, estilos, haceCuanto, textos } from '../ui';

export function PantallaInicio() {
  const { usuario, esChofer, operaciones, sincronizar, sincronizando, ultimoEnvio, salir } = useApp();
  const { navegar } = useNavegacion();
  const pendientes = operaciones.filter((o) => o.estado === 'PENDIENTE');
  const rechazadas = operaciones.filter((o) => o.estado === 'RECHAZADA');
  const ultima = operaciones.filter((o) => o.estado === 'ACEPTADA').at(-1);

  return (
    <Pantalla titulo={`Hola, ${usuario?.nombre.split(' ')[0] ?? ''}`}>
      {rechazadas.length > 0 && <Aviso texto={`${rechazadas.length} operación(es) rechazada(s) por el servidor: revíselas.`} />}
      {esChofer ? (
        <Tarjeta onPress={() => navegar({ nombre: 'manifiestos' })}>
          <Text style={textos.titulo}>Mis rutas</Text>
          <Text style={textos.sutil}>Facturas por entregar, firma y cobro</Text>
        </Tarjeta>
      ) : (
        <>
          <Tarjeta onPress={() => navegar({ nombre: 'agenda' })}>
            <Text style={textos.titulo}>Agenda de hoy</Text>
            <Text style={textos.sutil}>Clientes a visitar según el plan de la ruta</Text>
          </Tarjeta>
          <Tarjeta onPress={() => navegar({ nombre: 'clientes' })}>
            <Text style={textos.titulo}>Mis clientes</Text>
            <Text style={textos.sutil}>Estado de cuenta, pedidos y cobros</Text>
          </Tarjeta>
        </>
      )}
      <Tarjeta onPress={() => navegar({ nombre: 'pendientes' })}>
        <View style={estilos.fila}>
          <Text style={textos.titulo}>Sincronización</Text>
          <Text style={textos.sutil}>{pendientes.length ? `${pendientes.length} por enviar` : 'al día'}</Text>
        </View>
        <Text style={textos.sutil}>
          {ultimoEnvio?.detenidoPor === 'SIN_CONEXION'
            ? 'Sin conexión: se enviará al recuperar la señal.'
            : ultima
              ? `Último envío aceptado ${haceCuanto(ultima.ultimoIntentoEn ?? ultima.creadaEn)}.`
              : 'Sin envíos todavía.'}
        </Text>
      </Tarjeta>
      <Boton texto={sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'} variante="normal" onPress={() => void sincronizar(true)} cargando={sincronizando} />
      <Boton
        texto="Cerrar sesión"
        variante="peligro"
        deshabilitado={pendientes.length > 0}
        onPress={() => void salir()}
      />
      {pendientes.length > 0 && <Text style={textos.sutil}>No se puede cerrar sesión con operaciones sin enviar.</Text>}
    </Pantalla>
  );
}
