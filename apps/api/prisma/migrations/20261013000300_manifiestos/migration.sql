-- DropIndex
DROP INDEX "reservas_inventario_factura_item_id_key";

-- CreateIndex
CREATE INDEX "reservas_inventario_factura_item_id_idx" ON "reservas_inventario"("factura_item_id");


-- ═════════════════════════ Reglas adicionales (manuales) ═════════════════════════

-- Una línea de factura tiene como máximo una reserva activa (puede tener
-- varias en su historia: consumida al cargar y otra nueva si la factura retorna).
CREATE UNIQUE INDEX reservas_inventario_factura_item_activa_unica
  ON reservas_inventario (factura_item_id)
  WHERE estado = 'ACTIVA' AND factura_item_id IS NOT NULL;

-- Un vehículo tiene como máximo un manifiesto abierto. Así el vehículo queda
-- vacío entre rutas y el cuadre de cierre es exacto.
CREATE UNIQUE INDEX manifiestos_vehiculo_abierto_unico
  ON manifiestos (vehiculo_id)
  WHERE estado IN ('BORRADOR', 'CONFIRMADO', 'EN_RUTA');

-- Un borrador no es custodia todavía: sus facturas y líneas sí pueden
-- quitarse. Después de confirmado, nada se borra.
DROP TRIGGER manifiesto_facturas_sin_borrado ON manifiesto_facturas;
DROP TRIGGER manifiesto_items_sin_borrado ON manifiesto_items;

CREATE FUNCTION fn_manifiesto_borrado_solo_borrador() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_estado "EstadoManifiesto";
BEGIN
  SELECT estado INTO v_estado FROM manifiestos WHERE id = OLD.manifiesto_id;
  IF v_estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'el manifiesto % está % y no admite borrados', OLD.manifiesto_id, v_estado
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER manifiesto_facturas_borrado_borrador BEFORE DELETE ON manifiesto_facturas
  FOR EACH ROW EXECUTE FUNCTION fn_manifiesto_borrado_solo_borrador();
CREATE TRIGGER manifiesto_items_borrado_borrador BEFORE DELETE ON manifiesto_items
  FOR EACH ROW EXECUTE FUNCTION fn_manifiesto_borrado_solo_borrador();

-- El embudo solo cuenta como "cargado" lo que realmente se cargó (manifiestos
-- confirmados en adelante), no los borradores.
CREATE OR REPLACE VIEW bi.v_embudo_lineas AS
SELECT
  p.id AS pedido_id,
  p.numero AS pedido_numero,
  p.cliente_id,
  p.vendedor_responsable_id,
  p.fecha_emision,
  pi.id AS pedido_item_id,
  pi.producto_id,
  pi.cantidad AS solicitado,
  coalesce(fi.facturado, 0) AS facturado,
  coalesce(mi.cargado, 0) AS cargado,
  coalesce(ei.entregado, 0) AS entregado,
  coalesce(ei.rechazado, 0) AS rechazado
FROM pedidos p
JOIN pedido_items pi ON pi.pedido_id = p.id
LEFT JOIN LATERAL (
  SELECT sum(x.cantidad) AS facturado FROM factura_items x
  JOIN facturas f ON f.id = x.factura_id AND f.estado <> 'ANULADA'
  WHERE x.pedido_item_id = pi.id
) fi ON true
LEFT JOIN LATERAL (
  SELECT sum(m.cantidad_cargada) AS cargado FROM manifiesto_items m
  JOIN manifiestos mf ON mf.id = m.manifiesto_id AND mf.estado IN ('CONFIRMADO', 'EN_RUTA', 'CERRADO')
  JOIN factura_items x ON x.id = m.factura_item_id
  WHERE x.pedido_item_id = pi.id
) mi ON true
LEFT JOIN LATERAL (
  SELECT sum(ei.cantidad_entregada) AS entregado, sum(ei.cantidad_rechazada) AS rechazado
  FROM entrega_items ei
  JOIN entregas e ON e.id = ei.entrega_id AND e.estado <> 'ANULADA'
  JOIN factura_items x ON x.id = ei.factura_item_id
  WHERE x.pedido_item_id = pi.id
) ei ON true;

-- Cuadre de cada manifiesto por producto: cargado, entregado y retornado.
CREATE VIEW bi.v_cuadre_manifiestos AS
SELECT
  m.id AS manifiesto_id,
  m.numero,
  m.estado,
  m.vehiculo_id,
  m.chofer_id,
  mv.producto_id,
  sum(mv.cantidad_entrada) FILTER (WHERE mv.tipo = 'CARGA_ENTRADA') AS cargado,
  coalesce(sum(mv.cantidad_salida) FILTER (WHERE mv.tipo = 'ENTREGA'), 0) AS entregado,
  coalesce(sum(mv.cantidad_salida) FILTER (WHERE mv.tipo = 'RETORNO_SALIDA'), 0) AS retornado,
  coalesce(sum(mv.cantidad_salida - mv.cantidad_entrada) FILTER (WHERE mv.tipo = 'AJUSTE'), 0) AS faltante
FROM manifiestos m
JOIN ubicaciones u ON u.vehiculo_id = m.vehiculo_id
JOIN movimientos_inventario mv ON mv.ubicacion_id = u.id
  AND (mv.documento_origen_id = m.id
       OR mv.documento_origen_id IN (SELECT e.id FROM entregas e WHERE e.manifiesto_id = m.id))
GROUP BY m.id, mv.producto_id;

DO $$
BEGIN
  GRANT SELECT ON ALL TABLES IN SCHEMA bi TO bi_lector;
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE NOTICE 'No se otorgaron permisos a bi_lector.';
END;
$$;

-- Corrección: con INSERT ... ON CONFLICT, PostgreSQL valida los CHECK sobre la
-- fila candidata antes de detectar el conflicto, así que toda salida (valor
-- negativo) fallaba por existencias_fisica_no_negativa aunque hubiera stock.
-- Ahora se actualiza primero y solo se inserta si la fila no existe.
CREATE OR REPLACE FUNCTION fn_movimiento_actualiza_existencia() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_delta numeric := NEW.cantidad_entrada - NEW.cantidad_salida;
BEGIN
  UPDATE existencias
  SET cantidad_fisica = cantidad_fisica + v_delta, actualizado_en = now()
  WHERE producto_id = NEW.producto_id AND ubicacion_id = NEW.ubicacion_id;
  IF NOT FOUND THEN
    INSERT INTO existencias (producto_id, ubicacion_id, cantidad_fisica, cantidad_reservada, actualizado_en)
    VALUES (NEW.producto_id, NEW.ubicacion_id, v_delta, 0, now())
    ON CONFLICT (producto_id, ubicacion_id) DO UPDATE
      SET cantidad_fisica = existencias.cantidad_fisica + EXCLUDED.cantidad_fisica,
          actualizado_en = now();
  END IF;
  RETURN NEW;
END;
$$;
