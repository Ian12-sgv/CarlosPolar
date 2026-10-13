import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ProveedorApp, useApp } from './contexto';
import { ProveedorNavegacion, useNavegacion } from './navegacion';
import { PantallaAcceso } from './pantallas/acceso';
import { PantallaAgenda } from './pantallas/agenda';
import { PantallaPago } from './pantallas/cobro';
import { PantallaInicio } from './pantallas/inicio';
import { PantallaPendientes } from './pantallas/pendientes';
import { PantallaCliente, PantallaClientes, PantallaPedido } from './pantallas/preventa';
import { PantallaEntrega, PantallaManifiesto, PantallaManifiestos } from './pantallas/reparto';
import { colores } from './ui';

export function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <ProveedorApp>
        <Raiz />
      </ProveedorApp>
    </SafeAreaProvider>
  );
}

function Raiz() {
  const { usuario, cargando } = useApp();
  if (cargando) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colores.fondo }}>
        <ActivityIndicator size="large" color={colores.acento} />
      </View>
    );
  }
  if (!usuario) return <PantallaAcceso />;
  return (
    <ProveedorNavegacion>
      <Rutas />
    </ProveedorNavegacion>
  );
}

function Rutas() {
  const { actual } = useNavegacion();
  switch (actual.nombre) {
    case 'inicio':
      return <PantallaInicio />;
    case 'clientes':
      return <PantallaClientes />;
    case 'agenda':
      return <PantallaAgenda />;
    case 'cliente':
      return <PantallaCliente clienteId={actual.clienteId} />;
    case 'pedido':
      return <PantallaPedido clienteId={actual.clienteId} />;
    case 'pago':
      return <PantallaPago clienteId={actual.clienteId} facturas={actual.facturas} />;
    case 'manifiestos':
      return <PantallaManifiestos />;
    case 'manifiesto':
      return <PantallaManifiesto manifiestoId={actual.manifiestoId} />;
    case 'entrega':
      return <PantallaEntrega manifiestoId={actual.manifiestoId} facturaId={actual.facturaId} />;
    case 'pendientes':
      return <PantallaPendientes />;
  }
}
