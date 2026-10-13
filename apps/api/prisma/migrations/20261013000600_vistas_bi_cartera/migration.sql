-- Cartera por factura con saldo en USD (tasa de la propia factura) y tramo de
-- antigüedad, lista para gráficos de Power BI.
CREATE VIEW bi.v_cartera_facturas AS
SELECT
  s.factura_id,
  s.numero,
  s.cliente_id,
  s.vendedor_responsable_id AS vendedor_id,
  s.ruta_id,
  s.moneda,
  (s.fecha_emision AT TIME ZONE 'America/Caracas')::date AS fecha_emision,
  s.fecha_vencimiento,
  s.dias_vencido,
  s.estado_cobro,
  s.total,
  s.saldo,
  CASE WHEN s.moneda = 'USD' THEN s.saldo ELSE round(s.saldo / f.tasa_cambio, 2) END AS saldo_usd,
  CASE WHEN s.moneda = 'USD' THEN s.cobrado_por_validar ELSE round(s.cobrado_por_validar / f.tasa_cambio, 2) END AS por_validar_usd,
  CASE
    WHEN s.dias_vencido = 0 THEN 'Por vencer'
    WHEN s.dias_vencido <= 30 THEN '1-30 días'
    WHEN s.dias_vencido <= 60 THEN '31-60 días'
    WHEN s.dias_vencido <= 90 THEN '61-90 días'
    ELSE 'Más de 90 días'
  END AS tramo,
  CASE
    WHEN s.dias_vencido = 0 THEN 0
    WHEN s.dias_vencido <= 30 THEN 1
    WHEN s.dias_vencido <= 60 THEN 2
    WHEN s.dias_vencido <= 90 THEN 3
    ELSE 4
  END AS orden_tramo
FROM bi.v_saldo_facturas s
JOIN facturas f ON f.id = s.factura_id
WHERE s.saldo > 0;

-- Embudo por línea con la fecha del pedido en la zona operativa.
CREATE VIEW bi.v_embudo AS
SELECT
  e.*,
  (e.fecha_emision AT TIME ZONE 'America/Caracas')::date AS fecha
FROM bi.v_embudo_lineas e;

DO $$
BEGIN
  GRANT SELECT ON ALL TABLES IN SCHEMA bi TO bi_lector;
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE NOTICE 'No se otorgaron permisos a bi_lector.';
END;
$$;
