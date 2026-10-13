import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from './contexto';
import { useNavegacion } from './navegacion';

export const colores = {
  fondo: '#f5f6f8',
  superficie: '#ffffff',
  borde: '#e2e5ea',
  texto: '#1d2330',
  sutil: '#667085',
  acento: '#1f5fbf',
  ok: '#157347',
  okSuave: '#e6f4ec',
  aviso: '#8a5a00',
  avisoSuave: '#fdf3dc',
  mal: '#b42318',
  malSuave: '#fdecea',
};

/** Pantalla con encabezado, botón de volver y aviso de modo sin conexión. */
export function Pantalla({ titulo, children, acciones, sinDesplazamiento }: { titulo: string; children: ReactNode; acciones?: ReactNode; sinDesplazamiento?: boolean }) {
  const { volver, puedeVolver } = useNavegacion();
  const { sinConexion, operaciones } = useApp();
  const pendientes = operaciones.filter((o) => o.estado === 'PENDIENTE').length;
  return (
    <SafeAreaView style={estilos.pantalla} edges={['top', 'bottom']}>
      <View style={estilos.encabezado}>
        {puedeVolver && (
          <Pressable onPress={volver} hitSlop={12} accessibilityRole="button" accessibilityLabel="Volver">
            <Text style={estilos.volver}>‹</Text>
          </Pressable>
        )}
        <Text style={estilos.titulo} numberOfLines={1}>
          {titulo}
        </Text>
        {acciones}
      </View>
      {(sinConexion || pendientes > 0) && (
        <Text style={[estilos.banda, sinConexion ? { backgroundColor: colores.avisoSuave, color: colores.aviso } : null]}>
          {sinConexion ? 'Sin conexión: trabajando con los datos guardados. ' : ''}
          {pendientes > 0 ? `${pendientes} operación(es) por enviar.` : ''}
        </Text>
      )}
      {sinDesplazamiento ? (
        <View style={estilos.contenido}>{children}</View>
      ) : (
        <ScrollView contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export function Boton({ texto, onPress, variante = 'primario', deshabilitado, cargando }: { texto: string; onPress: () => void; variante?: 'primario' | 'normal' | 'peligro'; deshabilitado?: boolean; cargando?: boolean }) {
  const estilo = variante === 'primario' ? estilos.botonPrimario : variante === 'peligro' ? estilos.botonPeligro : estilos.botonNormal;
  const color = variante === 'primario' ? '#fff' : variante === 'peligro' ? colores.mal : colores.texto;
  return (
    <Pressable
      onPress={onPress}
      disabled={deshabilitado || cargando}
      accessibilityRole="button"
      style={({ pressed }) => [estilos.boton, estilo, (deshabilitado || cargando) && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
    >
      {cargando ? <ActivityIndicator color={color} /> : <Text style={[estilos.textoBoton, { color }]}>{texto}</Text>}
    </Pressable>
  );
}

export function Campo({ etiqueta, ...props }: TextInputProps & { etiqueta: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={estilos.etiqueta}>{etiqueta}</Text>
      <TextInput placeholderTextColor={colores.sutil} {...props} style={[estilos.entrada, props.style]} />
    </View>
  );
}

export function Tarjeta({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  if (!onPress) return <View style={estilos.tarjeta}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [estilos.tarjeta, pressed && { backgroundColor: '#eef2f8' }]} accessibilityRole="button">
      {children}
    </Pressable>
  );
}

export function Aviso({ texto, tono = 'mal' }: { texto: string; tono?: 'mal' | 'aviso' | 'ok' }) {
  const fondo = tono === 'mal' ? colores.malSuave : tono === 'aviso' ? colores.avisoSuave : colores.okSuave;
  const color = tono === 'mal' ? colores.mal : tono === 'aviso' ? colores.aviso : colores.ok;
  return <Text style={[estilos.aviso, { backgroundColor: fondo, color }]}>{texto}</Text>;
}

/** Selector de opciones como botones segmentados. */
export function Opciones<T extends string>({ etiqueta, opciones, valor, alCambiar }: { etiqueta: string; opciones: { valor: T; texto: string }[]; valor: T; alCambiar: (v: T) => void }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={estilos.etiqueta}>{etiqueta}</Text>
      <View style={estilos.opciones}>
        {opciones.map((o) => (
          <Pressable key={o.valor} onPress={() => alCambiar(o.valor)} style={[estilos.opcion, o.valor === valor && estilos.opcionActiva]} accessibilityRole="button">
            <Text style={{ color: o.valor === valor ? '#fff' : colores.texto, fontWeight: '600' }}>{o.texto}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export const textos = StyleSheet.create({
  titulo: { fontSize: 16, fontWeight: '700', color: colores.texto },
  normal: { fontSize: 14, color: colores.texto },
  sutil: { fontSize: 13, color: colores.sutil },
  monto: { fontSize: 15, fontWeight: '700', color: colores.texto, fontVariant: ['tabular-nums'] },
});

export const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  encabezado: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#16213a' },
  volver: { color: '#fff', fontSize: 30, lineHeight: 30, marginTop: -4 },
  titulo: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '700' },
  banda: { backgroundColor: '#e8f0fc', color: colores.acento, paddingHorizontal: 16, paddingVertical: 6, fontSize: 13 },
  contenido: { padding: 16, gap: 10 },
  boton: { borderRadius: 8, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', borderWidth: 1 },
  botonPrimario: { backgroundColor: colores.acento, borderColor: colores.acento },
  botonNormal: { backgroundColor: colores.superficie, borderColor: colores.borde },
  botonPeligro: { backgroundColor: colores.superficie, borderColor: '#f1b8b3' },
  textoBoton: { fontSize: 15, fontWeight: '600' },
  etiqueta: { fontSize: 13, color: colores.sutil, marginBottom: 4, fontWeight: '500' },
  entrada: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, backgroundColor: colores.superficie, color: colores.texto },
  tarjeta: { backgroundColor: colores.superficie, borderRadius: 10, borderWidth: 1, borderColor: colores.borde, padding: 14, gap: 4 },
  aviso: { padding: 10, borderRadius: 8, fontSize: 14 },
  opciones: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  opcion: { borderWidth: 1, borderColor: colores.borde, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: colores.superficie },
  opcionActiva: { backgroundColor: colores.acento, borderColor: colores.acento },
  fila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
});

const numero = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function monto(valor: string | number | null | undefined, moneda?: string): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  const texto = numero.format(Number(valor));
  return moneda ? `${moneda === 'USD' ? '$' : 'Bs'} ${texto}` : texto;
}

export function haceCuanto(iso: string): string {
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutos < 1) return 'hace un momento';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  return horas < 24 ? `hace ${horas} h` : `hace ${Math.round(horas / 24)} d`;
}
