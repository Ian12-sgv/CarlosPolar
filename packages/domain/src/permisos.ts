/**
 * Permisos por acción. La API los exige en cada endpoint; la web y las apps
 * los usan para mostrar u ocultar acciones. Un rol es un conjunto de permisos.
 */
export const PERMISOS = {
  'cliente.ver': 'Ver clientes',
  'cliente.editar': 'Crear y editar clientes',
  'cliente.asignar_vendedor': 'Cambiar el vendedor asignado a un cliente',
  'cliente.editar_credito': 'Modificar cupo y días de crédito',
  'producto.editar': 'Crear y editar productos',
  'precio.editar': 'Publicar listas y versiones de precio',
  'tasa.registrar': 'Registrar tasas de cambio',
  'pedido.emitir': 'Emitir pedidos',
  'visita.registrar': 'Registrar visitas a clientes',
  'ruta.planificar': 'Planificar las visitas semanales de las rutas',
  'pedido.ver_todos': 'Ver pedidos de todos los vendedores',
  'pedido.aprobar': 'Aprobar o rechazar pedidos',
  'pedido.cancelar': 'Cancelar pedidos',
  'pedido.excepcion_credito': 'Aprobar pedidos que exceden el cupo o con deuda vencida',
  'factura.emitir': 'Emitir facturas',
  'factura.anular': 'Anular facturas',
  'inventario.ingresar': 'Registrar ingresos de mercancía',
  'inventario.ajustar': 'Registrar ajustes de inventario',
  'vehiculo.editar': 'Registrar y editar vehículos',
  'manifiesto.crear': 'Crear y editar manifiestos en borrador',
  'manifiesto.confirmar': 'Confirmar la carga de un manifiesto',
  'manifiesto.cerrar': 'Cerrar y cuadrar manifiestos',
  'entrega.registrar': 'Registrar entregas y rechazos',
  'entrega.anular': 'Anular entregas',
  'pago.registrar': 'Registrar pagos recibidos',
  'pago.validar': 'Validar o rechazar pagos',
  'pago.anular': 'Anular pagos',
  'usuario.administrar': 'Administrar usuarios, roles y dispositivos',
  'auditoria.ver': 'Consultar auditoría y eventos',
} as const;

export type Permiso = keyof typeof PERMISOS;

export const ROLES_PREDETERMINADOS: Record<string, { nombre: string; permisos: readonly Permiso[] }> = {
  ADMIN: { nombre: 'Administrador del sistema', permisos: Object.keys(PERMISOS) as Permiso[] },
  PREVENTISTA: {
    nombre: 'Preventista',
    permisos: ['cliente.ver', 'pedido.emitir', 'pago.registrar', 'visita.registrar'],
  },
  VENTAS: {
    nombre: 'Ventas',
    permisos: [
      'cliente.ver',
      'cliente.editar',
      'cliente.asignar_vendedor',
      'pedido.ver_todos',
      'pedido.aprobar',
      'pedido.cancelar',
      'ruta.planificar',
    ],
  },
  FACTURACION: {
    nombre: 'Facturación',
    permisos: ['cliente.ver', 'pedido.ver_todos', 'factura.emitir'],
  },
  LOGISTICA: {
    nombre: 'Logística y almacén',
    permisos: ['inventario.ingresar', 'vehiculo.editar', 'manifiesto.crear', 'manifiesto.confirmar', 'manifiesto.cerrar'],
  },
  CHOFER: {
    nombre: 'Chofer',
    permisos: ['entrega.registrar', 'pago.registrar'],
  },
  ADMINISTRACION: {
    nombre: 'Administración y cobranzas',
    permisos: [
      'cliente.ver',
      'cliente.editar_credito',
      'pedido.ver_todos',
      'pedido.excepcion_credito',
      'factura.anular',
      'inventario.ajustar',
      'entrega.anular',
      'pago.validar',
      'pago.anular',
      'precio.editar',
      'producto.editar',
      'tasa.registrar',
      'auditoria.ver',
    ],
  },
};
