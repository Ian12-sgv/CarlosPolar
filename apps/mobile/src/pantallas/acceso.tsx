import Constants from 'expo-constants';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { textoError } from '../api';
import { useApp } from '../contexto';
import { Aviso, Boton, Campo, colores, estilos, textos } from '../ui';

export function PantallaAcceso() {
  const { entrar, servidor: guardado } = useApp();
  const predeterminado = (Constants.expoConfig?.extra as { servidorPredeterminado?: string } | undefined)?.servidorPredeterminado;
  const [servidor, setServidor] = useState(guardado || predeterminado || 'https://');
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enCurso, setEnCurso] = useState(false);

  async function enviar() {
    setEnCurso(true);
    setError(null);
    try {
      await entrar(servidor, usuario.trim().toLowerCase(), clave);
    } catch (e) {
      setError(textoError(e));
    } finally {
      setEnCurso(false);
    }
  }

  return (
    <SafeAreaView style={[estilos.pantalla, { justifyContent: 'center' }]}>
      <View style={[estilos.contenido, { gap: 4 }]}>
        <Text style={{ fontSize: 26, fontWeight: '800', color: colores.texto }}>Carlos Polar</Text>
        <Text style={[textos.sutil, { marginBottom: 20 }]}>Preventa, reparto y cobranza</Text>
        {error && <Aviso texto={error} />}
        <Campo etiqueta="Servidor" value={servidor} onChangeText={setServidor} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        <Campo etiqueta="Usuario" value={usuario} onChangeText={setUsuario} autoCapitalize="none" autoCorrect={false} />
        <Campo etiqueta="Contraseña" value={clave} onChangeText={setClave} secureTextEntry />
        <Boton texto="Entrar" onPress={() => void enviar()} cargando={enCurso} deshabilitado={!usuario || !clave || !servidor} />
        <Text style={[textos.sutil, { marginTop: 12 }]}>La primera vez se necesita conexión. Después, la app funciona sin señal y envía lo pendiente al recuperarla.</Text>
      </View>
    </SafeAreaView>
  );
}
