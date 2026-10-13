"""
Genera el proyecto Power BI (PBIP con modelo TMDL) y medidas.dax a partir de una sola
especificación. Si cambian las vistas del esquema bi, edite TABLAS aquí y ejecute:

    python powerbi/generar.py
"""
import io, json, os, sys, uuid

SALIDA = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
NOMBRE = 'CarlosPolar'
T = '\t'

# tipo: (tipo Power Query, dataType TMDL, formatString, summarizeBy)
TIPOS = {
    'texto': ('type text', 'string', None, 'none'),
    'fecha': ('type date', 'dateTime', 'Short Date', 'none'),
    'entero': ('Int64.Type', 'int64', '0', 'none'),
    'numero': ('type number', 'double', '#,0.00', 'none'),
    'cantidad': ('type number', 'double', '#,0.###', 'none'),
    'logico': ('type logical', 'boolean', None, 'none'),
}

# tabla del modelo: (vista, [(columna, tipo)], [medidas (nombre, DAX, formato, carpeta, descripción)])
TABLAS = {
    'Clientes': ('v_dim_clientes', [('cliente_id', 'texto'), ('documento', 'texto'), ('razon_social', 'texto'), ('ruta_id', 'texto'), ('limite_credito', 'numero'), ('moneda_credito', 'texto'), ('dias_credito', 'entero'), ('activo', 'logico')], []),
    'Productos': ('v_dim_productos', [('producto_id', 'texto'), ('sku', 'texto'), ('nombre', 'texto'), ('unidad', 'texto'), ('stock_minimo', 'cantidad'), ('activo', 'logico')], []),
    'Vendedores': ('v_dim_vendedores', [('vendedor_id', 'texto'), ('codigo', 'texto'), ('nombre', 'texto')], []),
    'Rutas': ('v_dim_rutas', [('ruta_id', 'texto'), ('codigo', 'texto'), ('nombre', 'texto')], []),
    'Choferes': ('v_dim_choferes', [('chofer_id', 'texto'), ('nombre', 'texto')], []),
    'Ventas': ('v_ventas', [('factura_item_id', 'texto'), ('factura_id', 'texto'), ('numero', 'texto'), ('fecha', 'fecha'), ('cliente_id', 'texto'), ('vendedor_id', 'texto'), ('ruta_id', 'texto'), ('producto_id', 'texto'), ('cantidad', 'cantidad'), ('moneda', 'texto'), ('total', 'numero'), ('total_usd', 'numero'), ('subtotal_usd', 'numero')], [
        ('Ventas USD', 'SUM(Ventas[total_usd])', '\\$#,0.00', 'Ventas', 'Total facturado con IVA, convertido a USD con la tasa de cada factura.'),
        ('Ventas sin IVA USD', 'SUM(Ventas[subtotal_usd])', '\\$#,0.00', 'Ventas', 'Base imponible facturada en USD.'),
        ('Facturas', 'DISTINCTCOUNT(Ventas[factura_id])', '#,0', 'Ventas', 'Facturas emitidas no anuladas.'),
        ('Ticket promedio USD', 'DIVIDE([Ventas USD], [Facturas])', '\\$#,0.00', 'Ventas', 'Monto promedio por factura.'),
        ('Unidades vendidas', 'SUM(Ventas[cantidad])', '#,0.###', 'Ventas', 'Cantidad facturada.'),
        ('Clientes con compra', 'DISTINCTCOUNT(Ventas[cliente_id])', '#,0', 'Ventas', 'Clientes distintos con al menos una factura.'),
    ]),
    'Pedidos': ('v_pedidos', [('pedido_id', 'texto'), ('numero', 'texto'), ('estado', 'texto'), ('fecha', 'fecha'), ('cliente_id', 'texto'), ('vendedor_id', 'texto'), ('ruta_id', 'texto'), ('moneda', 'texto'), ('total', 'numero'), ('tomado_en_visita', 'logico')], [
        ('Pedidos', 'COUNTROWS(Pedidos)', '#,0', 'Pedidos', 'Pedidos emitidos.'),
        ('Pedidos facturados', 'CALCULATE(COUNTROWS(Pedidos), Pedidos[estado] = "FACTURADO")', '#,0', 'Pedidos', ''),
        ('Pedidos rechazados o cancelados', 'CALCULATE(COUNTROWS(Pedidos), Pedidos[estado] IN { "RECHAZADO", "CANCELADO" })', '#,0', 'Pedidos', ''),
        ('% Conversión pedido a factura', 'DIVIDE([Pedidos facturados], [Pedidos])', '0.0%', 'Pedidos', 'Pedidos que terminaron facturados.'),
    ]),
    'Embudo': ('v_embudo', [('pedido_item_id', 'texto'), ('pedido_id', 'texto'), ('fecha', 'fecha'), ('cliente_id', 'texto'), ('vendedor_responsable_id', 'texto'), ('producto_id', 'texto'), ('solicitado', 'cantidad'), ('facturado', 'cantidad'), ('cargado', 'cantidad'), ('entregado', 'cantidad'), ('rechazado', 'cantidad')], [
        ('Unidades solicitadas', 'SUM(Embudo[solicitado])', '#,0.###', 'Embudo', ''),
        ('Unidades facturadas', 'SUM(Embudo[facturado])', '#,0.###', 'Embudo', ''),
        ('Unidades cargadas', 'SUM(Embudo[cargado])', '#,0.###', 'Embudo', ''),
        ('Unidades entregadas', 'SUM(Embudo[entregado])', '#,0.###', 'Embudo', ''),
        ('Faltante en facturación', '[Unidades solicitadas] - [Unidades facturadas]', '#,0.###', 'Embudo', 'Lo pedido que no llegó a facturarse (faltantes de stock o ajustes).'),
        ('% Cumplimiento del pedido', 'DIVIDE([Unidades entregadas], [Unidades solicitadas])', '0.0%', 'Embudo', 'Fill rate: entregado sobre solicitado.'),
    ]),
    'Tiempos': ('v_tiempos_pedido', [('pedido_id', 'texto'), ('fecha', 'fecha'), ('vendedor_id', 'texto'), ('ruta_id', 'texto'), ('cliente_id', 'texto'), ('horas_aprobacion', 'numero'), ('horas_preparacion', 'numero'), ('horas_reparto', 'numero'), ('horas_ciclo_total', 'numero')], [
        ('Horas de aprobación (prom.)', 'AVERAGE(Tiempos[horas_aprobacion])', '#,0.0', 'Tiempos', 'Desde que el preventista emite hasta que Ventas aprueba.'),
        ('Horas de preparación (prom.)', 'AVERAGE(Tiempos[horas_preparacion])', '#,0.0', 'Tiempos', 'Desde la aprobación hasta la carga en el camión.'),
        ('Horas de reparto (prom.)', 'AVERAGE(Tiempos[horas_reparto])', '#,0.0', 'Tiempos', 'Desde la carga hasta la entrega confirmada.'),
        ('Horas de ciclo total (prom.)', 'AVERAGE(Tiempos[horas_ciclo_total])', '#,0.0', 'Tiempos', 'Desde el pedido hasta la entrega.'),
    ]),
    'Entregas': ('v_entregas', [('entrega_id', 'texto'), ('factura_id', 'texto'), ('manifiesto_id', 'texto'), ('chofer_id', 'texto'), ('estado', 'texto'), ('fecha', 'fecha'), ('cliente_id', 'texto'), ('ruta_id', 'texto'), ('vendedor_id', 'texto'), ('distancia_cliente_metros', 'numero'), ('motivo_rechazo', 'texto')], [
        ('Entregas confirmadas', 'CALCULATE(COUNTROWS(Entregas), Entregas[estado] = "CONFIRMADA")', '#,0', 'Entregas', ''),
        ('Entregas rechazadas', 'CALCULATE(COUNTROWS(Entregas), Entregas[estado] = "RECHAZADA")', '#,0', 'Entregas', ''),
        ('% Entregas exitosas', 'DIVIDE([Entregas confirmadas], [Entregas confirmadas] + [Entregas rechazadas])', '0.0%', 'Entregas', 'Las entregas anuladas (correcciones) no cuentan.'),
        ('Distancia al cliente (prom. m)', 'CALCULATE(AVERAGE(Entregas[distancia_cliente_metros]), Entregas[estado] = "CONFIRMADA")', '#,0', 'Entregas', 'Distancia entre el GPS de la entrega y la ubicación registrada del cliente.'),
    ]),
    'Cartera': ('v_cartera_facturas', [('factura_id', 'texto'), ('numero', 'texto'), ('cliente_id', 'texto'), ('vendedor_id', 'texto'), ('ruta_id', 'texto'), ('moneda', 'texto'), ('fecha_emision', 'fecha'), ('fecha_vencimiento', 'fecha'), ('dias_vencido', 'entero'), ('estado_cobro', 'texto'), ('saldo', 'numero'), ('saldo_usd', 'numero'), ('por_validar_usd', 'numero'), ('tramo', 'texto'), ('orden_tramo', 'entero')], [
        ('Cartera USD', 'SUM(Cartera[saldo_usd])', '\\$#,0.00', 'Cartera', 'Saldo oficial por cobrar (solo descuenta pagos validados).'),
        ('Cartera vencida USD', 'CALCULATE([Cartera USD], Cartera[dias_vencido] > 0)', '\\$#,0.00', 'Cartera', ''),
        ('% Cartera vencida', 'DIVIDE([Cartera vencida USD], [Cartera USD])', '0.0%', 'Cartera', ''),
        ('Pagos por validar USD (cartera)', 'SUM(Cartera[por_validar_usd])', '\\$#,0.00', 'Cartera', 'Abonos registrados en campo que Administración aún no valida.'),
        ('Días vencidos (prom. ponderado)', 'DIVIDE(SUMX(Cartera, Cartera[saldo_usd] * Cartera[dias_vencido]), [Cartera USD])', '#,0.0', 'Cartera', 'Antigüedad promedio ponderada por saldo.'),
    ]),
    'Pagos': ('v_pagos', [('pago_id', 'texto'), ('fecha', 'fecha'), ('cliente_id', 'texto'), ('vendedor_id', 'texto'), ('metodo_pago', 'texto'), ('moneda', 'texto'), ('monto_total', 'numero'), ('monto_usd', 'numero'), ('estado', 'texto'), ('horas_validacion', 'numero'), ('con_evidencia', 'logico')], [
        ('Cobrado validado USD', 'CALCULATE(SUM(Pagos[monto_usd]), Pagos[estado] = "VALIDADO")', '\\$#,0.00', 'Cobranza', ''),
        ('Pagos por validar', 'CALCULATE(COUNTROWS(Pagos), Pagos[estado] = "REGISTRADO")', '#,0', 'Cobranza', ''),
        ('Pagos por validar USD', 'CALCULATE(SUM(Pagos[monto_usd]), Pagos[estado] = "REGISTRADO")', '\\$#,0.00', 'Cobranza', ''),
        ('Pagos rechazados', 'CALCULATE(COUNTROWS(Pagos), Pagos[estado] = "RECHAZADO")', '#,0', 'Cobranza', ''),
        ('Horas de validación (prom.)', 'AVERAGE(Pagos[horas_validacion])', '#,0.0', 'Cobranza', 'Desde que se registra el pago hasta que Administración lo valida.'),
        ('Cobranza sobre ventas', 'DIVIDE([Cobrado validado USD], [Ventas USD])', '0.0%', 'Cobranza', 'Efectividad de cobranza del período (cobrado validado / facturado).'),
    ]),
    'Existencias': ('v_existencias', [('producto_id', 'texto'), ('ubicacion', 'texto'), ('tipo_ubicacion', 'texto'), ('stock_fisico', 'cantidad'), ('stock_reservado', 'cantidad'), ('stock_disponible', 'cantidad'), ('stock_minimo', 'cantidad')], [
        ('Stock físico', 'SUM(Existencias[stock_fisico])', '#,0.###', 'Inventario', ''),
        ('Stock disponible', 'SUM(Existencias[stock_disponible])', '#,0.###', 'Inventario', 'Físico menos reservado.'),
        ('Productos bajo mínimo', 'COUNTROWS(FILTER(Existencias, Existencias[tipo_ubicacion] = "ALMACEN" && Existencias[stock_disponible] < Existencias[stock_minimo]))', '#,0', 'Inventario', ''),
        ('Rotación (ventas / stock)', 'DIVIDE([Unidades vendidas], CALCULATE([Stock físico], Existencias[tipo_ubicacion] = "ALMACEN"))', '#,0.00', 'Inventario', 'Unidades vendidas en el período sobre el stock actual del almacén.'),
    ]),
    'Cuadre': ('v_cuadre_manifiestos', [('manifiesto_id', 'texto'), ('numero', 'texto'), ('estado', 'texto'), ('chofer_id', 'texto'), ('producto_id', 'texto'), ('cargado', 'cantidad'), ('entregado', 'cantidad'), ('retornado', 'cantidad'), ('faltante', 'cantidad')], [
        ('Diferencia de inventario en rutas', 'SUM(Cuadre[faltante])', '#,0.###', 'Inventario', 'Faltantes (+) o sobrantes (−) registrados al cerrar rutas.'),
    ]),
    'Visitas': ('v_cumplimiento_visitas', [('fecha', 'fecha'), ('vendedor_id', 'texto'), ('planificadas', 'entero'), ('planificadas_visitadas', 'entero'), ('fuera_de_plan', 'entero'), ('efectivas', 'entero')], [
        ('% Cumplimiento de visitas', 'DIVIDE(SUM(Visitas[planificadas_visitadas]), SUM(Visitas[planificadas]))', '0.0%', 'Visitas', 'Visitas planificadas que se realizaron.'),
        ('% Visitas efectivas', 'DIVIDE(SUM(Visitas[efectivas]), SUM(Visitas[planificadas_visitadas]) + SUM(Visitas[fuera_de_plan]))', '0.0%', 'Visitas', 'Visitas que terminaron en pedido o cobro.'),
    ]),
    'Sincronizacion': ('v_sincronizacion', [('fecha', 'fecha'), ('usuario_id', 'texto'), ('dispositivo_id', 'texto'), ('origen', 'texto'), ('ruta', 'texto'), ('operaciones', 'entero'), ('aceptadas', 'entero'), ('duplicadas', 'entero'), ('rechazadas', 'entero'), ('conflictos', 'entero'), ('errores', 'entero'), ('retraso_promedio_seg', 'numero')], [
        ('Operaciones móviles', 'SUM(Sincronizacion[operaciones])', '#,0', 'Sincronización', ''),
        ('% Reintentos duplicados', 'DIVIDE(SUM(Sincronizacion[duplicadas]), [Operaciones móviles])', '0.0%', 'Sincronización', 'Reenvíos reconocidos por idempotencia (señal de mala conectividad).'),
        ('Conflictos y rechazos', 'SUM(Sincronizacion[conflictos]) + SUM(Sincronizacion[rechazadas])', '#,0', 'Sincronización', ''),
        ('Errores de servidor', 'SUM(Sincronizacion[errores])', '#,0', 'Sincronización', ''),
    ]),
}

# (desde, hacia): la columna del hecho filtra por la dimensión
RELACIONES = [
    ('Ventas.fecha', 'Calendario.Fecha'), ('Pedidos.fecha', 'Calendario.Fecha'), ('Embudo.fecha', 'Calendario.Fecha'),
    ('Tiempos.fecha', 'Calendario.Fecha'), ('Entregas.fecha', 'Calendario.Fecha'), ('Pagos.fecha', 'Calendario.Fecha'),
    ('Visitas.fecha', 'Calendario.Fecha'), ('Sincronizacion.fecha', 'Calendario.Fecha'),
    ('Ventas.cliente_id', 'Clientes.cliente_id'), ('Pedidos.cliente_id', 'Clientes.cliente_id'), ('Embudo.cliente_id', 'Clientes.cliente_id'),
    ('Tiempos.cliente_id', 'Clientes.cliente_id'), ('Entregas.cliente_id', 'Clientes.cliente_id'), ('Cartera.cliente_id', 'Clientes.cliente_id'),
    ('Pagos.cliente_id', 'Clientes.cliente_id'),
    ('Ventas.producto_id', 'Productos.producto_id'), ('Embudo.producto_id', 'Productos.producto_id'),
    ('Existencias.producto_id', 'Productos.producto_id'), ('Cuadre.producto_id', 'Productos.producto_id'),
    ('Ventas.vendedor_id', 'Vendedores.vendedor_id'), ('Pedidos.vendedor_id', 'Vendedores.vendedor_id'),
    ('Embudo.vendedor_responsable_id', 'Vendedores.vendedor_id'), ('Tiempos.vendedor_id', 'Vendedores.vendedor_id'),
    ('Cartera.vendedor_id', 'Vendedores.vendedor_id'), ('Pagos.vendedor_id', 'Vendedores.vendedor_id'), ('Visitas.vendedor_id', 'Vendedores.vendedor_id'),
    ('Ventas.ruta_id', 'Rutas.ruta_id'), ('Pedidos.ruta_id', 'Rutas.ruta_id'), ('Entregas.ruta_id', 'Rutas.ruta_id'), ('Cartera.ruta_id', 'Rutas.ruta_id'),
    ('Entregas.chofer_id', 'Choferes.chofer_id'), ('Cuadre.chofer_id', 'Choferes.chofer_id'),
]

# Tablas de dimensión: sus columnas de clave no se resumen y se ocultan las claves técnicas.
DIMENSIONES = {'Clientes', 'Productos', 'Vendedores', 'Rutas', 'Choferes'}


def escribir(ruta, texto):
    ruta = os.path.join(SALIDA, ruta)
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    io.open(ruta, 'w', encoding='utf-8', newline='\n').write(texto)


def ident(nombre):
    return f"'{nombre}'" if any(c in nombre for c in " .=:'%()/-") or not nombre.isascii() else nombre


def tabla_tmdl(nombre, vista, columnas, medidas):
    lineas = [f'table {nombre}', '']
    for (mnombre, dax, formato, carpeta, desc) in medidas:
        if desc:
            lineas.append(f'{T}/// {desc}')
        lineas.append(f'{T}measure {ident(mnombre)} = {dax}')
        lineas.append(f'{T}{T}formatString: {formato}')
        lineas.append(f'{T}{T}displayFolder: {carpeta}')
        lineas.append('')
    for (col, tipo) in columnas:
        _, dt, fmt, resumen = TIPOS[tipo]
        lineas.append(f'{T}column {col}')
        lineas.append(f'{T}{T}dataType: {dt}')
        if fmt:
            lineas.append(f'{T}{T}formatString: {fmt}')
        lineas.append(f'{T}{T}summarizeBy: {resumen}')
        lineas.append(f'{T}{T}sourceColumn: {col}')
        if col.endswith('_id'):
            lineas.append(f'{T}{T}isHidden')
        lineas.append('')
    seleccion = ', '.join(f'"{c}"' for c, _ in columnas)
    tipos = ', '.join(f'{{"{c}", {TIPOS[t][0]}}}' for c, t in columnas)
    lineas += [
        f'{T}partition {nombre} = m',
        f'{T}{T}mode: import',
        f'{T}{T}source =',
        f'{T}{T}{T}{T}let',
        f'{T}{T}{T}{T}    Origen = PostgreSQL.Database(Servidor, BaseDatos),',
        f'{T}{T}{T}{T}    Vista = Origen{{[Schema = "bi", Item = "{vista}"]}}[Data],',
        f'{T}{T}{T}{T}    Columnas = Table.SelectColumns(Vista, {{{seleccion}}}),',
        f'{T}{T}{T}{T}    Tipos = Table.TransformColumnTypes(Columnas, {{{tipos}}})',
        f'{T}{T}{T}{T}in',
        f'{T}{T}{T}{T}    Tipos',
        '',
    ]
    return '\n'.join(lineas)


CALENDARIO = f"""table Calendario
{T}dataCategory: Time

{T}column Fecha
{T}{T}dataType: dateTime
{T}{T}isKey
{T}{T}formatString: Short Date
{T}{T}summarizeBy: none
{T}{T}sourceColumn: [Fecha]

{T}column Año
{T}{T}dataType: int64
{T}{T}formatString: 0
{T}{T}summarizeBy: none
{T}{T}sourceColumn: [Año]

{T}column Mes
{T}{T}dataType: int64
{T}{T}formatString: 0
{T}{T}summarizeBy: none
{T}{T}sourceColumn: [Mes]

{T}column 'Nombre del mes'
{T}{T}dataType: string
{T}{T}summarizeBy: none
{T}{T}sourceColumn: [Nombre del mes]
{T}{T}sortByColumn: Mes

{T}column 'Año-Mes'
{T}{T}dataType: string
{T}{T}summarizeBy: none
{T}{T}sourceColumn: [Año-Mes]

{T}column 'Día de la semana'
{T}{T}dataType: string
{T}{T}summarizeBy: none
{T}{T}sourceColumn: [Día de la semana]

{T}partition Calendario = calculated
{T}{T}mode: import
{T}{T}source = ```
{T}{T}{T}{T}VAR Inicio = DATE(2026, 1, 1)
{T}{T}{T}{T}VAR Fin = DATE(YEAR(TODAY()) + 1, 12, 31)
{T}{T}{T}{T}RETURN
{T}{T}{T}{T}    ADDCOLUMNS(
{T}{T}{T}{T}        CALENDAR(Inicio, Fin),
{T}{T}{T}{T}        "Fecha", [Date],
{T}{T}{T}{T}        "Año", YEAR([Date]),
{T}{T}{T}{T}        "Mes", MONTH([Date]),
{T}{T}{T}{T}        "Nombre del mes", FORMAT([Date], "mmmm"),
{T}{T}{T}{T}        "Año-Mes", FORMAT([Date], "yyyy-mm"),
{T}{T}{T}{T}        "Día de la semana", FORMAT([Date], "dddd")
{T}{T}{T}{T}    )
{T}{T}{T}{T}```
"""

modelo = f"""model Model
{T}culture: es-VE
{T}defaultPowerBIDataSourceVersion: powerBI_V3
{T}discourageImplicitMeasures
{T}sourceQueryCulture: es-VE

""" + '\n'.join(f'ref table {t}' for t in ['Calendario', *TABLAS]) + '\n'

expresiones = f"""/// Servidor PostgreSQL (host:puerto).
expression Servidor = "localhost:5432" meta [IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = true]

/// Base de datos del sistema.
expression BaseDatos = "carlos_polar" meta [IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = true]
"""

relaciones = []
for desde, hacia in RELACIONES:
    t1, c1 = desde.split('.')
    t2, c2 = hacia.split('.')
    relaciones.append(f'relationship {uuid.uuid5(uuid.NAMESPACE_URL, desde + hacia)}\n{T}fromColumn: {t1}.{c1}\n{T}toColumn: {t2}.{c2}\n')

modelo_dir = f'{NOMBRE}.SemanticModel'
escribir(f'{modelo_dir}/definition.pbism', json.dumps({'version': '4.0', 'settings': {}}, indent=2) + '\n')
escribir(f'{modelo_dir}/definition/database.tmdl', f'database\n{T}compatibilityLevel: 1567\n')
escribir(f'{modelo_dir}/definition/model.tmdl', modelo)
escribir(f'{modelo_dir}/definition/expressions.tmdl', expresiones)
escribir(f'{modelo_dir}/definition/relationships.tmdl', '\n'.join(relaciones))
escribir(f'{modelo_dir}/definition/tables/Calendario.tmdl', CALENDARIO)
for nombre, (vista, columnas, medidas) in TABLAS.items():
    escribir(f'{modelo_dir}/definition/tables/{nombre}.tmdl', tabla_tmdl(nombre, vista, columnas, medidas))

reporte_dir = f'{NOMBRE}.Report'
escribir(f'{reporte_dir}/definition.pbir', json.dumps({'version': '4.0', 'datasetReference': {'byPath': {'path': f'../{modelo_dir}'}}}, indent=2) + '\n')
paginas = ['Resumen', 'Ventas', 'Operación', 'Cobranza', 'Inventario', 'Campo']
escribir(f'{reporte_dir}/report.json', json.dumps({
    'config': json.dumps({'version': '5.59', 'themeCollection': {}, 'activeSectionIndex': 0}),
    'layoutOptimization': 0,
    'resourcePackages': [],
    'sections': [
        {'name': f'Seccion{i}', 'displayName': p, 'displayOption': 1, 'filters': '[]', 'config': '{}', 'height': 720, 'width': 1280, 'ordinal': i, 'visualContainers': []}
        for i, p in enumerate(paginas)
    ],
}, indent=2, ensure_ascii=False) + '\n')
escribir(f'{NOMBRE}.pbip', json.dumps({'version': '1.0', 'artifacts': [{'report': {'path': reporte_dir}}], 'settings': {'enableAutoRecovery': True}}, indent=2) + '\n')
escribir('.gitignore', '**/.pbi/localSettings.json\n**/.pbi/cache.abf\n')

# Catálogo de medidas en texto plano, para crearlas a mano si el proyecto no abre.
dax = ['// Medidas DAX del modelo Carlos Polar. Generado desde la misma especificación que el modelo TMDL.', '']
for nombre, (_, _, medidas) in TABLAS.items():
    for (mnombre, expr, formato, carpeta, desc) in medidas:
        if desc:
            dax.append(f'// {desc}')
        dax.append(f'// Tabla: {nombre} · Carpeta: {carpeta} · Formato: {formato.replace(chr(92), "")}')
        dax.append(f'{mnombre} = {expr}')
        dax.append('')
escribir('medidas.dax', '\n'.join(dax))
print(f'{len(TABLAS) + 1} tablas, {sum(len(m) for _, _, m in TABLAS.values())} medidas, {len(RELACIONES)} relaciones')
