-- Reglas de integridad que Prisma no expresa en el esquema.
-- Son la última línea de defensa: la API valida lo mismo antes de escribir,
-- pero la base de datos no acepta un estado inconsistente aunque la API falle.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ═════════════════════════ Índices únicos parciales ═════════════════════════

-- Una referencia de pago no puede repetirse para el mismo método y origen,
-- salvo que el pago anterior esté anulado.
CREATE UNIQUE INDEX pagos_recibidos_referencia_unica
  ON pagos_recibidos (metodo_pago, entidad_origen, referencia_normalizada)
  WHERE estado <> 'ANULADO' AND referencia_normalizada IS NOT NULL;

-- Una factura no puede estar en dos manifiestos activos.
CREATE UNIQUE INDEX manifiesto_facturas_factura_activa_unica
  ON manifiesto_facturas (factura_id)
  WHERE activa;

-- Una factura no puede entregarse dos veces.
CREATE UNIQUE INDEX entregas_factura_confirmada_unica
  ON entregas (factura_id)
  WHERE estado = 'CONFIRMADA';

-- Un cliente tiene como máximo una asignación de vendedor vigente.
CREATE UNIQUE INDEX cliente_vendedor_historial_vigente_unica
  ON cliente_vendedor_historial (cliente_id)
  WHERE fecha_hasta IS NULL;

-- Una línea de pedido tiene como máximo una reserva activa.
CREATE UNIQUE INDEX reservas_inventario_activa_unica
  ON reservas_inventario (pedido_item_id)
  WHERE estado = 'ACTIVA';

-- Vigencias de precio sin solapamiento por producto y lista.
ALTER TABLE precios_producto
  ADD CONSTRAINT precios_producto_vigencia_sin_solape
  EXCLUDE USING gist (
    lista_precio_id WITH =,
    producto_id WITH =,
    tstzrange(vigente_desde, vigente_hasta, '[)') WITH &&
  );

-- ═════════════════════════ CHECK ═════════════════════════

ALTER TABLE precios_producto
  ADD CONSTRAINT precios_producto_precio_positivo CHECK (precio >= 0),
  ADD CONSTRAINT precios_producto_vigencia_valida CHECK (vigente_hasta IS NULL OR vigente_hasta > vigente_desde);

ALTER TABLE tasas_cambio
  ADD CONSTRAINT tasas_cambio_positiva CHECK (tasa > 0),
  ADD CONSTRAINT tasas_cambio_monedas_distintas CHECK (moneda_origen <> moneda_destino);

ALTER TABLE clientes
  ADD CONSTRAINT clientes_limite_credito_positivo CHECK (limite_credito IS NULL OR limite_credito >= 0),
  ADD CONSTRAINT clientes_dias_credito_positivo CHECK (dias_credito >= 0),
  ADD CONSTRAINT clientes_nro_documento_normalizado CHECK (nro_documento ~ '^[0-9]+$');

ALTER TABLE movimientos_inventario
  ADD CONSTRAINT movimientos_un_solo_sentido CHECK (
    (cantidad_entrada > 0 AND cantidad_salida = 0) OR (cantidad_salida > 0 AND cantidad_entrada = 0)
  );

ALTER TABLE existencias
  ADD CONSTRAINT existencias_fisica_no_negativa CHECK (cantidad_fisica >= 0),
  ADD CONSTRAINT existencias_reservada_no_negativa CHECK (cantidad_reservada >= 0);

ALTER TABLE reservas_inventario
  ADD CONSTRAINT reservas_cantidad_positiva CHECK (cantidad > 0),
  ADD CONSTRAINT reservas_cierre_coherente CHECK ((estado = 'ACTIVA') = (cerrada_en IS NULL));

ALTER TABLE pedidos
  ADD CONSTRAINT pedidos_montos_no_negativos CHECK (subtotal >= 0 AND impuesto >= 0 AND total >= 0);

ALTER TABLE pedido_items
  ADD CONSTRAINT pedido_items_cantidad_positiva CHECK (cantidad > 0),
  ADD CONSTRAINT pedido_items_precio_no_negativo CHECK (precio_ofertado >= 0),
  ADD CONSTRAINT pedido_items_descuento_valido CHECK (descuento_pct BETWEEN 0 AND 100);

ALTER TABLE facturas
  ADD CONSTRAINT facturas_montos_no_negativos CHECK (subtotal >= 0 AND descuento >= 0 AND impuesto >= 0 AND total >= 0),
  ADD CONSTRAINT facturas_tasa_positiva CHECK (tasa_cambio > 0),
  ADD CONSTRAINT facturas_anulacion_motivada CHECK (estado <> 'ANULADA' OR motivo_anulacion IS NOT NULL);

ALTER TABLE factura_items
  ADD CONSTRAINT factura_items_cantidad_positiva CHECK (cantidad > 0),
  ADD CONSTRAINT factura_items_precio_no_negativo CHECK (precio_unitario >= 0),
  ADD CONSTRAINT factura_items_descuento_valido CHECK (descuento_pct BETWEEN 0 AND 100);

ALTER TABLE manifiesto_items
  ADD CONSTRAINT manifiesto_items_cantidad_positiva CHECK (cantidad_cargada > 0);

ALTER TABLE entregas
  ADD CONSTRAINT entregas_rechazo_motivado CHECK (estado <> 'RECHAZADA' OR motivo_rechazo IS NOT NULL),
  ADD CONSTRAINT entregas_confirmada_con_receptor CHECK (estado <> 'CONFIRMADA' OR receptor_nombre IS NOT NULL);

ALTER TABLE entrega_items
  ADD CONSTRAINT entrega_items_cantidades_no_negativas CHECK (cantidad_entregada >= 0 AND cantidad_rechazada >= 0),
  ADD CONSTRAINT entrega_items_rechazo_motivado CHECK (cantidad_rechazada = 0 OR motivo_rechazo IS NOT NULL);

ALTER TABLE pagos_recibidos
  ADD CONSTRAINT pagos_monto_positivo CHECK (monto_total > 0),
  ADD CONSTRAINT pagos_tasa_positiva CHECK (tasa_cambio > 0),
  ADD CONSTRAINT pagos_referencia_normalizada CHECK (referencia_normalizada IS NULL OR referencia_normalizada ~ '^[A-Z0-9]+$'),
  ADD CONSTRAINT pagos_validacion_coherente CHECK (estado <> 'VALIDADO' OR (validado_por IS NOT NULL AND validado_en IS NOT NULL)),
  ADD CONSTRAINT pagos_rechazo_motivado CHECK (estado <> 'RECHAZADO' OR motivo_rechazo IS NOT NULL);

ALTER TABLE pago_aplicaciones
  ADD CONSTRAINT pago_aplicaciones_montos_positivos CHECK (monto_aplicado > 0 AND monto_moneda_pago > 0),
  ADD CONSTRAINT pago_aplicaciones_tasa_positiva CHECK (tasa_cambio > 0);

-- ═════════════════════════ Inmutabilidad ═════════════════════════

CREATE FUNCTION fn_prohibir_modificacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% es inmutable: no admite %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE FUNCTION fn_prohibir_borrado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% no admite borrado físico; use anulación o reverso', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- Libros inmutables: ni UPDATE, ni DELETE, ni TRUNCATE.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['eventos_negocio', 'auditoria', 'movimientos_inventario',
                           'factura_items', 'pago_aplicaciones', 'entrega_items', 'archivos']
  LOOP
    EXECUTE format('CREATE TRIGGER %1$s_inmutable BEFORE UPDATE OR DELETE ON %1$I
                    FOR EACH ROW EXECUTE FUNCTION fn_prohibir_modificacion()', t);
    EXECUTE format('CREATE TRIGGER %1$s_sin_truncate BEFORE TRUNCATE ON %1$I
                    FOR EACH STATEMENT EXECUTE FUNCTION fn_prohibir_modificacion()', t);
  END LOOP;
END;
$$;

-- Documentos con estado: admiten UPDATE controlado, nunca DELETE ni TRUNCATE.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pedidos', 'pedido_items', 'facturas', 'manifiestos', 'manifiesto_facturas',
                           'manifiesto_items', 'entregas', 'pagos_recibidos', 'reservas_inventario',
                           'precios_producto', 'tasas_cambio', 'cliente_vendedor_historial']
  LOOP
    EXECUTE format('CREATE TRIGGER %1$s_sin_borrado BEFORE DELETE ON %1$I
                    FOR EACH ROW EXECUTE FUNCTION fn_prohibir_borrado()', t);
    EXECUTE format('CREATE TRIGGER %1$s_sin_truncate BEFORE TRUNCATE ON %1$I
                    FOR EACH STATEMENT EXECUTE FUNCTION fn_prohibir_borrado()', t);
  END LOOP;
END;
$$;

-- Una factura emitida solo cambia de estado; su contenido fiscal queda fijo.
-- El número de control puede asignarse una sola vez (llega del proveedor fiscal).
CREATE FUNCTION fn_factura_contenido_fijo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.numero, OLD.pedido_id, OLD.cliente_id, OLD.cliente_tipo_documento, OLD.cliente_nro_documento,
      OLD.cliente_razon_social, OLD.cliente_direccion, OLD.vendedor_responsable_id, OLD.ruta_id, OLD.moneda,
      OLD.tasa_cambio, OLD.subtotal, OLD.descuento, OLD.impuesto, OLD.total, OLD.fecha_emision,
      OLD.fecha_vencimiento, OLD.emitida_por)
     IS DISTINCT FROM
     (NEW.numero, NEW.pedido_id, NEW.cliente_id, NEW.cliente_tipo_documento, NEW.cliente_nro_documento,
      NEW.cliente_razon_social, NEW.cliente_direccion, NEW.vendedor_responsable_id, NEW.ruta_id, NEW.moneda,
      NEW.tasa_cambio, NEW.subtotal, NEW.descuento, NEW.impuesto, NEW.total, NEW.fecha_emision,
      NEW.fecha_vencimiento, NEW.emitida_por)
  THEN
    RAISE EXCEPTION 'factura %: el contenido de una factura emitida no se modifica', OLD.numero
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.numero_control IS NOT NULL AND NEW.numero_control IS DISTINCT FROM OLD.numero_control THEN
    RAISE EXCEPTION 'factura %: el número de control ya fue asignado', OLD.numero
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER facturas_contenido_fijo BEFORE UPDATE ON facturas
  FOR EACH ROW EXECUTE FUNCTION fn_factura_contenido_fijo();

-- Un pago conserva sus datos de origen; solo cambian estado y validación.
CREATE FUNCTION fn_pago_contenido_fijo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.cliente_id, OLD.vendedor_receptor_id, OLD.metodo_pago, OLD.entidad_origen, OLD.referencia_normalizada,
      OLD.referencia_original, OLD.moneda, OLD.monto_total, OLD.tasa_cambio, OLD.fecha_emision,
      OLD.fecha_registro, OLD.evidencia_archivo_id, OLD.latitud, OLD.longitud, OLD.creado_por)
     IS DISTINCT FROM
     (NEW.cliente_id, NEW.vendedor_receptor_id, NEW.metodo_pago, NEW.entidad_origen, NEW.referencia_normalizada,
      NEW.referencia_original, NEW.moneda, NEW.monto_total, NEW.tasa_cambio, NEW.fecha_emision,
      NEW.fecha_registro, NEW.evidencia_archivo_id, NEW.latitud, NEW.longitud, NEW.creado_por)
  THEN
    RAISE EXCEPTION 'pago %: los datos de un pago registrado no se modifican; anúlelo y regístrelo de nuevo', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pagos_recibidos_contenido_fijo BEFORE UPDATE ON pagos_recibidos
  FOR EACH ROW EXECUTE FUNCTION fn_pago_contenido_fijo();

-- ═════════════════════════ Inventario ═════════════════════════

-- El saldo físico en `existencias` se deriva del libro de movimientos.
CREATE FUNCTION fn_movimiento_actualiza_existencia() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO existencias (producto_id, ubicacion_id, cantidad_fisica, cantidad_reservada, actualizado_en)
  VALUES (NEW.producto_id, NEW.ubicacion_id, NEW.cantidad_entrada - NEW.cantidad_salida, 0, now())
  ON CONFLICT (producto_id, ubicacion_id) DO UPDATE
    SET cantidad_fisica = existencias.cantidad_fisica + EXCLUDED.cantidad_fisica,
        actualizado_en = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER movimientos_inventario_actualiza_existencia AFTER INSERT ON movimientos_inventario
  FOR EACH ROW EXECUTE FUNCTION fn_movimiento_actualiza_existencia();

-- El saldo reservado se recalcula desde las reservas activas.
CREATE FUNCTION fn_reserva_actualiza_existencia() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO existencias AS e (producto_id, ubicacion_id, cantidad_fisica, cantidad_reservada, actualizado_en)
  SELECT NEW.producto_id, NEW.ubicacion_id, 0, coalesce(sum(r.cantidad), 0), now()
  FROM reservas_inventario r
  WHERE r.producto_id = NEW.producto_id AND r.ubicacion_id = NEW.ubicacion_id AND r.estado = 'ACTIVA'
  ON CONFLICT (producto_id, ubicacion_id) DO UPDATE
    SET cantidad_reservada = EXCLUDED.cantidad_reservada,
        actualizado_en = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER reservas_inventario_actualiza_existencia AFTER INSERT OR UPDATE ON reservas_inventario
  FOR EACH ROW EXECUTE FUNCTION fn_reserva_actualiza_existencia();

-- No se puede reservar más de lo que hay. Se verifica al confirmar la
-- transacción para permitir que una carga consuma la reserva y mueva el stock
-- en cualquier orden.
CREATE FUNCTION fn_existencia_reserva_cubierta() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE e existencias%ROWTYPE;
BEGIN
  SELECT * INTO e FROM existencias WHERE producto_id = NEW.producto_id AND ubicacion_id = NEW.ubicacion_id;
  IF e.cantidad_reservada > e.cantidad_fisica THEN
    RAISE EXCEPTION 'stock insuficiente: reservado % supera físico % (producto %, ubicación %)',
      e.cantidad_reservada, e.cantidad_fisica, e.producto_id, e.ubicacion_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER existencias_reserva_cubierta AFTER INSERT OR UPDATE ON existencias
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_existencia_reserva_cubierta();

-- ═════════════════════════ Despacho y entrega ═════════════════════════

-- Un manifiesto solo se edita en BORRADOR. Excepción: desactivar una factura
-- (retorno sin entrega o anulación del manifiesto) en cualquier estado.
CREATE FUNCTION fn_manifiesto_editable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_estado "EstadoManifiesto";
BEGIN
  SELECT estado INTO v_estado FROM manifiestos WHERE id = NEW.manifiesto_id;
  -- IF anidados: OLD.activa solo existe en manifiesto_facturas.
  IF TG_TABLE_NAME = 'manifiesto_facturas' AND TG_OP = 'UPDATE' THEN
    IF OLD.activa AND NOT NEW.activa
       AND (OLD.manifiesto_id, OLD.factura_id, OLD.orden_visita) IS NOT DISTINCT FROM
           (NEW.manifiesto_id, NEW.factura_id, NEW.orden_visita) THEN
      RETURN NEW;
    END IF;
  END IF;
  IF v_estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'el manifiesto % está % y no se modifica; use un documento de ajuste', NEW.manifiesto_id, v_estado
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.manifiesto_id <> OLD.manifiesto_id THEN
    RAISE EXCEPTION 'una línea no cambia de manifiesto' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER manifiesto_facturas_editable BEFORE INSERT OR UPDATE ON manifiesto_facturas
  FOR EACH ROW EXECUTE FUNCTION fn_manifiesto_editable();
CREATE TRIGGER manifiesto_items_editable BEFORE INSERT OR UPDATE ON manifiesto_items
  FOR EACH ROW EXECUTE FUNCTION fn_manifiesto_editable();

-- Lo cargado no supera lo facturado, y la línea pertenece a una factura del manifiesto.
CREATE FUNCTION fn_manifiesto_item_valido() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_factura uuid; v_cantidad numeric;
BEGIN
  SELECT factura_id, cantidad INTO v_factura, v_cantidad FROM factura_items WHERE id = NEW.factura_item_id;
  IF NOT EXISTS (SELECT 1 FROM manifiesto_facturas
                 WHERE manifiesto_id = NEW.manifiesto_id AND factura_id = v_factura AND activa) THEN
    RAISE EXCEPTION 'la línea % no pertenece a una factura activa del manifiesto', NEW.factura_item_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.cantidad_cargada > v_cantidad THEN
    RAISE EXCEPTION 'cantidad cargada % supera la facturada %', NEW.cantidad_cargada, v_cantidad
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER manifiesto_items_valido BEFORE INSERT OR UPDATE ON manifiesto_items
  FOR EACH ROW EXECUTE FUNCTION fn_manifiesto_item_valido();

-- Lo entregado más lo rechazado no supera lo cargado en el manifiesto de la entrega.
CREATE FUNCTION fn_entrega_item_valido() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_cargada numeric;
BEGIN
  SELECT mi.cantidad_cargada INTO v_cargada
  FROM entregas e
  JOIN manifiesto_items mi ON mi.manifiesto_id = e.manifiesto_id AND mi.factura_item_id = NEW.factura_item_id
  WHERE e.id = NEW.entrega_id;
  IF v_cargada IS NULL THEN
    RAISE EXCEPTION 'la línea % no fue cargada en el manifiesto de la entrega', NEW.factura_item_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.cantidad_entregada + NEW.cantidad_rechazada > v_cargada THEN
    RAISE EXCEPTION 'entregado + rechazado (%) supera lo cargado (%)',
      NEW.cantidad_entregada + NEW.cantidad_rechazada, v_cargada
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER entrega_items_valido BEFORE INSERT ON entrega_items
  FOR EACH ROW EXECUTE FUNCTION fn_entrega_item_valido();

-- ═════════════════════════ Cobranzas ═════════════════════════

-- Bloquea pago y factura para que dos aplicaciones concurrentes no puedan
-- superar entre ambas el monto del pago o el saldo de la factura.
CREATE FUNCTION fn_pago_aplicacion_valida() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE p pagos_recibidos%ROWTYPE; f facturas%ROWTYPE; v_usado numeric; v_aplicado numeric;
BEGIN
  SELECT * INTO p FROM pagos_recibidos WHERE id = NEW.pago_id FOR UPDATE;
  SELECT * INTO f FROM facturas WHERE id = NEW.factura_id FOR UPDATE;

  IF p.estado NOT IN ('REGISTRADO', 'VALIDADO') THEN
    RAISE EXCEPTION 'el pago % está % y no puede aplicarse', p.id, p.estado USING ERRCODE = 'check_violation';
  END IF;
  IF f.estado = 'ANULADA' THEN
    RAISE EXCEPTION 'la factura % está anulada', f.numero USING ERRCODE = 'check_violation';
  END IF;
  IF p.cliente_id <> f.cliente_id THEN
    RAISE EXCEPTION 'el pago y la factura % son de clientes distintos', f.numero USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(sum(monto_moneda_pago), 0) INTO v_usado FROM pago_aplicaciones WHERE pago_id = p.id;
  IF v_usado + NEW.monto_moneda_pago > p.monto_total THEN
    RAISE EXCEPTION 'las aplicaciones (%) superan el monto del pago (%)', v_usado + NEW.monto_moneda_pago, p.monto_total
      USING ERRCODE = 'check_violation';
  END IF;

  -- Cuentan los pagos registrados y validados: un pago pendiente de validación
  -- también "ocupa" saldo para impedir que se aplique dos veces lo mismo.
  SELECT coalesce(sum(a.monto_aplicado), 0) INTO v_aplicado
  FROM pago_aplicaciones a JOIN pagos_recibidos pr ON pr.id = a.pago_id
  WHERE a.factura_id = f.id AND pr.estado IN ('REGISTRADO', 'VALIDADO');
  IF v_aplicado + NEW.monto_aplicado > f.total THEN
    RAISE EXCEPTION 'la aplicación supera el saldo de la factura % (saldo %)', f.numero, f.total - v_aplicado
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pago_aplicaciones_valida BEFORE INSERT ON pago_aplicaciones
  FOR EACH ROW EXECUTE FUNCTION fn_pago_aplicacion_valida();

-- ═════════════════════════ Correlativos ═════════════════════════

-- Devuelve el siguiente número (p. ej. 'FAC-00000042') y avanza el correlativo.
-- El UPDATE bloquea la fila hasta el fin de la transacción: sin huecos ni duplicados.
CREATE FUNCTION fn_siguiente_correlativo(p_codigo text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_numero text;
BEGIN
  UPDATE correlativos SET siguiente = siguiente + 1 WHERE codigo = p_codigo
  RETURNING prefijo || lpad((siguiente - 1)::text, 8, '0') INTO v_numero;
  IF v_numero IS NULL THEN
    RAISE EXCEPTION 'correlativo % no existe', p_codigo;
  END IF;
  RETURN v_numero;
END;
$$;

-- ═════════════════════════ Vistas analíticas (Power BI) ═════════════════════════

CREATE SCHEMA bi;

-- Saldo por factura. La deuda oficial solo baja con pagos VALIDADOS; lo
-- registrado sin validar se informa aparte.
CREATE VIEW bi.v_saldo_facturas AS
SELECT
  f.id AS factura_id,
  f.numero,
  f.cliente_id,
  f.cliente_razon_social,
  f.vendedor_responsable_id,
  f.ruta_id,
  f.moneda,
  f.total,
  coalesce(sum(a.monto_aplicado) FILTER (WHERE p.estado = 'VALIDADO'), 0) AS cobrado_validado,
  coalesce(sum(a.monto_aplicado) FILTER (WHERE p.estado = 'REGISTRADO'), 0) AS cobrado_por_validar,
  f.total - coalesce(sum(a.monto_aplicado) FILTER (WHERE p.estado = 'VALIDADO'), 0) AS saldo,
  f.fecha_emision,
  f.fecha_vencimiento,
  greatest((now() AT TIME ZONE 'America/Caracas')::date - f.fecha_vencimiento, 0) AS dias_vencido,
  CASE
    WHEN f.total - coalesce(sum(a.monto_aplicado) FILTER (WHERE p.estado = 'VALIDADO'), 0) <= 0 THEN 'PAGADA'
    WHEN coalesce(sum(a.monto_aplicado) FILTER (WHERE p.estado = 'VALIDADO'), 0) > 0 THEN 'PARCIAL'
    ELSE 'PENDIENTE'
  END AS estado_cobro,
  f.estado AS estado_logistico
FROM facturas f
LEFT JOIN pago_aplicaciones a ON a.factura_id = f.id
LEFT JOIN pagos_recibidos p ON p.id = a.pago_id
WHERE f.estado <> 'ANULADA'
GROUP BY f.id;

-- Antigüedad de cartera por cliente y moneda.
CREATE VIEW bi.v_cartera_antiguedad AS
SELECT
  cliente_id,
  cliente_razon_social,
  vendedor_responsable_id,
  moneda,
  sum(saldo) AS saldo_total,
  sum(saldo) FILTER (WHERE dias_vencido = 0) AS por_vencer,
  sum(saldo) FILTER (WHERE dias_vencido BETWEEN 1 AND 30) AS vencido_1_30,
  sum(saldo) FILTER (WHERE dias_vencido BETWEEN 31 AND 60) AS vencido_31_60,
  sum(saldo) FILTER (WHERE dias_vencido BETWEEN 61 AND 90) AS vencido_61_90,
  sum(saldo) FILTER (WHERE dias_vencido > 90) AS vencido_mas_90,
  sum(cobrado_por_validar) AS pagos_por_validar
FROM bi.v_saldo_facturas
WHERE saldo > 0
GROUP BY cliente_id, cliente_razon_social, vendedor_responsable_id, moneda;

-- Existencias reconstruidas desde el libro, comparadas con la caché.
-- `diferencia_cache` distinta de cero indica una inconsistencia a investigar.
CREATE VIEW bi.v_existencias AS
WITH libro AS (
  SELECT producto_id, ubicacion_id, sum(cantidad_entrada - cantidad_salida) AS fisica
  FROM movimientos_inventario GROUP BY producto_id, ubicacion_id
), reservado AS (
  SELECT producto_id, ubicacion_id, sum(cantidad) AS reservada
  FROM reservas_inventario WHERE estado = 'ACTIVA' GROUP BY producto_id, ubicacion_id
)
SELECT
  pr.id AS producto_id,
  pr.sku,
  pr.nombre AS producto,
  u.id AS ubicacion_id,
  u.codigo AS ubicacion,
  u.tipo AS tipo_ubicacion,
  coalesce(l.fisica, 0) AS stock_fisico,
  coalesce(r.reservada, 0) AS stock_reservado,
  coalesce(l.fisica, 0) - coalesce(r.reservada, 0) AS stock_disponible,
  pr.stock_minimo,
  coalesce(l.fisica, 0) - coalesce(e.cantidad_fisica, 0) AS diferencia_cache
FROM existencias e
FULL JOIN libro l USING (producto_id, ubicacion_id)
LEFT JOIN reservado r USING (producto_id, ubicacion_id)
JOIN productos pr ON pr.id = coalesce(e.producto_id, l.producto_id)
JOIN ubicaciones u ON u.id = coalesce(e.ubicacion_id, l.ubicacion_id);

-- Embudo por línea: solicitado → facturado → cargado → entregado / rechazado.
CREATE VIEW bi.v_embudo_lineas AS
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
  JOIN manifiestos mf ON mf.id = m.manifiesto_id AND mf.estado <> 'ANULADO'
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

CREATE VIEW bi.v_eventos AS
SELECT
  id AS evento_id, tipo_entidad, id_entidad, tipo_evento, estado_anterior, estado_nuevo,
  fecha_hora_utc,
  fecha_hora_utc AT TIME ZONE zona_horaria_operativa AS fecha_hora_local,
  fecha_hora_dispositivo,
  usuario_id, rol_codigo, vendedor_responsable_id, cliente_id, ruta_id, vehiculo_id,
  latitud, longitud, origen
FROM eventos_negocio;

-- Rol de solo lectura para Power BI: ve únicamente el esquema `bi`.
-- Crear un usuario con LOGIN y asignarle este rol: GRANT bi_lector TO <usuario>;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_lector') THEN
    CREATE ROLE bi_lector NOLOGIN;
  END IF;
  GRANT USAGE ON SCHEMA bi TO bi_lector;
  GRANT SELECT ON ALL TABLES IN SCHEMA bi TO bi_lector;
  ALTER DEFAULT PRIVILEGES IN SCHEMA bi GRANT SELECT ON TABLES TO bi_lector;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Sin privilegio para crear el rol bi_lector; créelo manualmente (ver docs/modelo-datos.md).';
END;
$$;
