-- Vistas analíticas para Power BI (esquema bi). Las fechas se expresan en la
-- zona operativa (America/Caracas) para que "hoy" y "este mes" coincidan con
-- la operación. Los montos se dan en la moneda original y convertidos a USD
-- con la tasa del propio documento (nunca con la tasa actual).

-- ─── Dimensiones ───

CREATE VIEW bi.v_dim_clientes AS
SELECT
  c.id AS cliente_id,
  c.tipo_documento || '-' || c.nro_documento AS documento,
  c.razon_social,
  c.direccion,
  c.ruta_id,
  c.vendedor_id AS vendedor_actual_id,
  c.limite_credito,
  c.moneda_credito,
  c.dias_credito,
  c.activo,
  (c.creado_en AT TIME ZONE 'America/Caracas')::date AS fecha_alta
FROM clientes c;

CREATE VIEW bi.v_dim_productos AS
SELECT id AS producto_id, sku, nombre, unidad, alicuota_iva, stock_minimo, activo
FROM productos;

CREATE VIEW bi.v_dim_vendedores AS
SELECT v.id AS vendedor_id, v.codigo, u.nombre, v.activo
FROM vendedores v JOIN usuarios u ON u.id = v.usuario_id;

CREATE VIEW bi.v_dim_rutas AS
SELECT id AS ruta_id, codigo, nombre, vendedor_id, activo
FROM rutas;

CREATE VIEW bi.v_dim_choferes AS
SELECT DISTINCT u.id AS chofer_id, u.username, u.nombre
FROM usuarios u
JOIN usuario_roles ur ON ur.usuario_id = u.id
JOIN rol_permisos rp ON rp.rol_id = ur.rol_id
JOIN permisos p ON p.id = rp.permiso_id AND p.codigo = 'entrega.registrar';

-- ─── Hechos ───

-- Ventas facturadas por línea (facturas no anuladas).
CREATE VIEW bi.v_ventas AS
SELECT
  fi.id AS factura_item_id,
  f.id AS factura_id,
  f.numero,
  f.estado AS estado_factura,
  (f.fecha_emision AT TIME ZONE 'America/Caracas')::date AS fecha,
  f.cliente_id,
  f.vendedor_responsable_id AS vendedor_id,
  f.ruta_id,
  fi.producto_id,
  fi.cantidad,
  f.moneda,
  f.tasa_cambio,
  fi.subtotal,
  fi.impuesto,
  fi.total,
  CASE WHEN f.moneda = 'USD' THEN fi.total ELSE round(fi.total / f.tasa_cambio, 2) END AS total_usd,
  CASE WHEN f.moneda = 'USD' THEN round(fi.subtotal, 2) ELSE round(fi.subtotal / f.tasa_cambio, 2) END AS subtotal_usd
FROM factura_items fi
JOIN facturas f ON f.id = fi.factura_id
WHERE f.estado <> 'ANULADA';

-- Pedidos con su total en USD (para medir conversión pedido → factura).
CREATE VIEW bi.v_pedidos AS
SELECT
  p.id AS pedido_id,
  p.numero,
  p.estado,
  (p.fecha_emision AT TIME ZONE 'America/Caracas')::date AS fecha,
  p.cliente_id,
  p.vendedor_responsable_id AS vendedor_id,
  p.ruta_id,
  p.moneda,
  p.total,
  p.visita_id IS NOT NULL AS tomado_en_visita
FROM pedidos p;

-- Tiempos entre etapas por pedido, a partir de los eventos de negocio.
CREATE VIEW bi.v_tiempos_pedido AS
WITH hitos AS (
  SELECT
    p.id AS pedido_id,
    p.vendedor_responsable_id AS vendedor_id,
    p.ruta_id,
    p.cliente_id,
    min(e.fecha_hora_utc) FILTER (WHERE e.tipo_evento = 'PEDIDO_EMITIDO') AS emitido_en,
    min(e.fecha_hora_utc) FILTER (WHERE e.tipo_evento = 'PEDIDO_APROBADO') AS aprobado_en,
    min(e.fecha_hora_utc) FILTER (WHERE e.tipo_evento = 'PEDIDO_FACTURADO') AS facturado_en
  FROM pedidos p
  JOIN eventos_negocio e ON e.tipo_entidad = 'PEDIDO' AND e.id_entidad = p.id
  GROUP BY p.id
), logistica AS (
  SELECT
    f.pedido_id,
    min(e.fecha_hora_utc) FILTER (WHERE e.tipo_evento = 'FACTURA_DESPACHADA') AS despachado_en,
    min(e.fecha_hora_utc) FILTER (WHERE e.tipo_evento = 'FACTURA_ENTREGADA') AS entregado_en
  FROM facturas f
  JOIN eventos_negocio e ON e.tipo_entidad = 'FACTURA' AND e.id_entidad = f.id
  WHERE f.pedido_id IS NOT NULL
  GROUP BY f.pedido_id
)
SELECT
  h.pedido_id,
  h.vendedor_id,
  h.ruta_id,
  h.cliente_id,
  (h.emitido_en AT TIME ZONE 'America/Caracas')::date AS fecha,
  h.emitido_en,
  h.aprobado_en,
  h.facturado_en,
  l.despachado_en,
  l.entregado_en,
  round(extract(epoch FROM h.aprobado_en - h.emitido_en) / 3600, 2) AS horas_aprobacion,
  round(extract(epoch FROM l.despachado_en - h.aprobado_en) / 3600, 2) AS horas_preparacion,
  round(extract(epoch FROM l.entregado_en - l.despachado_en) / 3600, 2) AS horas_reparto,
  round(extract(epoch FROM l.entregado_en - h.emitido_en) / 3600, 2) AS horas_ciclo_total
FROM hitos h
LEFT JOIN logistica l ON l.pedido_id = h.pedido_id;

CREATE VIEW bi.v_pagos AS
SELECT
  p.id AS pago_id,
  p.cliente_id,
  p.vendedor_receptor_id AS vendedor_id,
  p.creado_por,
  p.metodo_pago,
  p.moneda,
  p.monto_total,
  CASE WHEN p.moneda = 'USD' THEN p.monto_total ELSE round(p.monto_total / p.tasa_cambio, 2) END AS monto_usd,
  p.estado,
  (p.fecha_registro AT TIME ZONE 'America/Caracas')::date AS fecha,
  p.fecha_registro,
  p.validado_en,
  round(extract(epoch FROM p.validado_en - p.fecha_registro) / 3600, 2) AS horas_validacion,
  p.evidencia_archivo_id IS NOT NULL AS con_evidencia
FROM pagos_recibidos p;

CREATE VIEW bi.v_entregas AS
SELECT
  e.id AS entrega_id,
  e.factura_id,
  e.manifiesto_id,
  e.chofer_id,
  e.estado,
  (e.fecha_hora AT TIME ZONE 'America/Caracas')::date AS fecha,
  e.fecha_hora,
  f.cliente_id,
  f.ruta_id,
  f.vendedor_responsable_id AS vendedor_id,
  m.vehiculo_id,
  (ev.datos ->> 'distanciaClienteMetros')::numeric AS distancia_cliente_metros,
  e.motivo_rechazo
FROM entregas e
JOIN facturas f ON f.id = e.factura_id
JOIN manifiestos m ON m.id = e.manifiesto_id
LEFT JOIN LATERAL (
  SELECT datos FROM eventos_negocio
  WHERE tipo_entidad = 'ENTREGA' AND id_entidad = e.id AND tipo_evento IN ('ENTREGA_CONFIRMADA', 'ENTREGA_RECHAZADA')
  ORDER BY fecha_hora_utc LIMIT 1
) ev ON true;

DO $$
BEGIN
  GRANT SELECT ON ALL TABLES IN SCHEMA bi TO bi_lector;
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE NOTICE 'No se otorgaron permisos a bi_lector.';
END;
$$;
