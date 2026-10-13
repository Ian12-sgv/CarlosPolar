-- Anular una entrega revierte su salida del vehículo con un movimiento ENTREGA
-- de entrada. El cuadre cuenta lo entregado neto (salidas − reversos).
CREATE OR REPLACE VIEW bi.v_cuadre_manifiestos AS
SELECT
  m.id AS manifiesto_id,
  m.numero,
  m.estado,
  m.vehiculo_id,
  m.chofer_id,
  mv.producto_id,
  sum(mv.cantidad_entrada) FILTER (WHERE mv.tipo = 'CARGA_ENTRADA') AS cargado,
  coalesce(sum(mv.cantidad_salida - mv.cantidad_entrada) FILTER (WHERE mv.tipo = 'ENTREGA'), 0) AS entregado,
  coalesce(sum(mv.cantidad_salida) FILTER (WHERE mv.tipo = 'RETORNO_SALIDA'), 0) AS retornado,
  coalesce(sum(mv.cantidad_salida - mv.cantidad_entrada) FILTER (WHERE mv.tipo = 'AJUSTE'), 0) AS faltante
FROM manifiestos m
JOIN ubicaciones u ON u.vehiculo_id = m.vehiculo_id
JOIN movimientos_inventario mv ON mv.ubicacion_id = u.id
  AND (mv.documento_origen_id = m.id
       OR mv.documento_origen_id IN (SELECT e.id FROM entregas e WHERE e.manifiesto_id = m.id))
GROUP BY m.id, mv.producto_id;

-- Una entrega registrada conserva sus datos (GPS, firma, receptor, hora):
-- solo cambia su estado al anularse; el motivo queda en el evento ENTREGA_ANULADA.
CREATE FUNCTION fn_entrega_contenido_fijo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.factura_id, OLD.manifiesto_id, OLD.chofer_id, OLD.fecha_hora, OLD.latitud, OLD.longitud,
      OLD.precision_metros, OLD.firma_archivo_id, OLD.receptor_nombre, OLD.receptor_documento,
      OLD.motivo_rechazo, OLD.registrada_en)
     IS DISTINCT FROM
     (NEW.factura_id, NEW.manifiesto_id, NEW.chofer_id, NEW.fecha_hora, NEW.latitud, NEW.longitud,
      NEW.precision_metros, NEW.firma_archivo_id, NEW.receptor_nombre, NEW.receptor_documento,
      NEW.motivo_rechazo, NEW.registrada_en)
  THEN
    RAISE EXCEPTION 'entrega %: los datos de una entrega registrada no se modifican', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER entregas_contenido_fijo BEFORE UPDATE ON entregas
  FOR EACH ROW EXECUTE FUNCTION fn_entrega_contenido_fijo();
