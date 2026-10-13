import { Text, View } from 'react-native';
import { useCache } from '../cache';
import { useApp } from '../contexto';
import { useNavegacion } from '../navegacion';
import type { AgendaApp } from '../tipos';
import { Aviso, Pantalla, Tarjeta, colores, estilos, haceCuanto, textos } from '../ui';

const RESULTADO: Record<string, string> = {
  PEDIDO: 'Pedido',
  COBRO: 'Cobro',
  PEDIDO_Y_COBRO: 'Pedido y cobro',
  SIN_PEDIDO: 'Sin pedido',
  CLIENTE_CERRADO: 'Cliente cerrado',
  NO_ATENDIDO: 'No atendido',
};

/** Agenda del día según el plan de la ruta, con lo ya visitado (incluido lo aún no enviado). */
export function PantallaAgenda() {
  const { navegar } = useNavegacion();
  const { operaciones } = useApp();
  const { entrada, cargando } = useCache<AgendaApp>('agenda');
  const agenda = entrada?.valor;

  /** Estado de la visita combinando el servidor con lo registrado en el teléfono. */
  const estado = (p: AgendaApp['planificadas'][number]): { texto: string; color: string } => {
    if (p.estado === 'CANCELADA') return { texto: 'Cancelada', color: colores.sutil };
    if (p.visita?.resultado) return { texto: RESULTADO[p.visita.resultado] ?? p.visita.resultado, color: colores.ok };
    const local = operaciones.filter((o) => o.tipo === 'VISITA' && (o.cuerpo as { clienteId?: string }).clienteId === p.clienteId && o.creadaEn.slice(0, 10) >= (agenda?.fecha ?? ''));
    const ids = new Set(local.map((o) => (o.cuerpo as { id: string }).id));
    const cierre = operaciones.find((o) => o.tipo === 'CERRAR_VISITA' && [...ids].some((id) => o.ruta.includes(id)));
    if (cierre) return { texto: RESULTADO[(cierre.cuerpo as { resultado: string }).resultado] ?? 'Visitada', color: colores.ok };
    if (local.length || p.visita) return { texto: 'En curso', color: colores.aviso };
    return { texto: 'Pendiente', color: colores.sutil };
  };

  const hechas = agenda?.planificadas.filter((p) => p.estado === 'PROGRAMADA' && estado(p).color === colores.ok).length ?? 0;
  const total = agenda?.planificadas.filter((p) => p.estado === 'PROGRAMADA').length ?? 0;

  return (
    <Pantalla titulo="Agenda de hoy">
      {entrada && (
        <Text style={textos.sutil}>
          {hechas} de {total} visitadas · datos {haceCuanto(entrada.actualizadoEn)}
        </Text>
      )}
      {!cargando && !agenda && <Aviso tono="aviso" texto="Aún no hay agenda descargada. Sincronice con conexión." />}
      {agenda && total === 0 && <Aviso tono="aviso" texto="No hay visitas planificadas para hoy en sus rutas." />}
      {agenda?.planificadas.map((p) => {
        const e = estado(p);
        return (
          <Tarjeta key={p.id ?? p.clienteId} onPress={() => navegar({ nombre: 'cliente', clienteId: p.clienteId })}>
            <View style={estilos.fila}>
              <Text style={[textos.titulo, { flex: 1 }]}>
                {p.orden}. {p.cliente?.razonSocial ?? 'Cliente'}
              </Text>
              <Text style={{ color: e.color, fontWeight: '700' }}>{e.texto}</Text>
            </View>
            <Text style={textos.sutil}>{p.cliente?.direccion}</Text>
          </Tarjeta>
        );
      })}
    </Pantalla>
  );
}
