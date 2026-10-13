-- UUID versión 7 (ordenado por tiempo: mejor localidad en índices que v4).
-- Implementación portable para PostgreSQL 13+; en 18+ equivale a uuidv7().
-- Las apps móviles pueden enviar su propio id (generado offline) y este
-- default solo aplica cuando no se envía.
CREATE FUNCTION uuid_v7() RETURNS uuid
LANGUAGE sql VOLATILE AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid())
                PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
                FROM 1 FOR 6),
        52, 1),
      53, 1),
    'hex')::uuid;
$$;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Moneda" AS ENUM ('USD', 'VES');

-- CreateEnum
CREATE TYPE "TipoDocumentoIdentidad" AS ENUM ('V', 'E', 'J', 'G', 'P');

-- CreateEnum
CREATE TYPE "TipoUbicacion" AS ENUM ('ALMACEN', 'VEHICULO');

-- CreateEnum
CREATE TYPE "TipoMovimiento" AS ENUM ('INGRESO', 'CARGA_SALIDA', 'CARGA_ENTRADA', 'ENTREGA', 'RETORNO_SALIDA', 'RETORNO_ENTRADA', 'DEVOLUCION', 'AJUSTE');

-- CreateEnum
CREATE TYPE "EstadoReserva" AS ENUM ('ACTIVA', 'CONSUMIDA', 'LIBERADA', 'VENCIDA');

-- CreateEnum
CREATE TYPE "EstadoPedido" AS ENUM ('EMITIDO', 'APROBADO', 'RECHAZADO', 'CANCELADO', 'FACTURADO');

-- CreateEnum
CREATE TYPE "EstadoFactura" AS ENUM ('EMITIDA', 'DESPACHADA', 'ENTREGADA', 'ANULADA');

-- CreateEnum
CREATE TYPE "EstadoManifiesto" AS ENUM ('BORRADOR', 'CONFIRMADO', 'EN_RUTA', 'CERRADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "EstadoEntrega" AS ENUM ('CONFIRMADA', 'RECHAZADA', 'ANULADA');

-- CreateEnum
CREATE TYPE "TipoArchivo" AS ENUM ('FIRMA', 'EVIDENCIA_PAGO', 'FOTO', 'PDF');

-- CreateEnum
CREATE TYPE "MetodoPago" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'PAGO_MOVIL', 'PUNTO_VENTA', 'ZELLE');

-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('REGISTRADO', 'VALIDADO', 'RECHAZADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "OrigenEvento" AS ENUM ('WEB', 'APP_PREVENTISTA', 'APP_CHOFER', 'API', 'SISTEMA');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "username" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permisos" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "codigo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,

    CONSTRAINT "permisos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rol_permisos" (
    "rol_id" UUID NOT NULL,
    "permiso_id" UUID NOT NULL,

    CONSTRAINT "rol_permisos_pkey" PRIMARY KEY ("rol_id","permiso_id")
);

-- CreateTable
CREATE TABLE "usuario_roles" (
    "usuario_id" UUID NOT NULL,
    "rol_id" UUID NOT NULL,

    CONSTRAINT "usuario_roles_pkey" PRIMARY KEY ("usuario_id","rol_id")
);

-- CreateTable
CREATE TABLE "dispositivos" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "usuario_id" UUID NOT NULL,
    "identificador" TEXT NOT NULL,
    "plataforma" TEXT NOT NULL,
    "nombre" TEXT,
    "registrado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revocado_en" TIMESTAMPTZ(3),

    CONSTRAINT "dispositivos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "usuario_id" UUID NOT NULL,
    "dispositivo_id" UUID,
    "refresh_token_hash" TEXT NOT NULL,
    "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_en" TIMESTAMPTZ(3) NOT NULL,
    "revocada_en" TIMESTAMPTZ(3),

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendedores" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "usuario_id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vendedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rutas" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "rutas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "tipo_documento" "TipoDocumentoIdentidad" NOT NULL,
    "nro_documento" TEXT NOT NULL,
    "razon_social" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "telefono" TEXT,
    "latitud" DECIMAL(9,6),
    "longitud" DECIMAL(9,6),
    "ruta_id" UUID,
    "vendedor_id" UUID,
    "lista_precio_id" UUID,
    "limite_credito" DECIMAL(18,2),
    "moneda_credito" "Moneda" NOT NULL DEFAULT 'USD',
    "dias_credito" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliente_vendedor_historial" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "cliente_id" UUID NOT NULL,
    "vendedor_id" UUID NOT NULL,
    "fecha_desde" TIMESTAMPTZ(3) NOT NULL,
    "fecha_hasta" TIMESTAMPTZ(3),
    "asignado_por" UUID NOT NULL,

    CONSTRAINT "cliente_vendedor_historial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productos" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "sku" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "unidad" TEXT NOT NULL,
    "alicuota_iva" DECIMAL(5,2) NOT NULL DEFAULT 16,
    "stock_minimo" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "productos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listas_precio" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "moneda" "Moneda" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "listas_precio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "precios_producto" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "lista_precio_id" UUID NOT NULL,
    "producto_id" UUID NOT NULL,
    "precio" DECIMAL(18,4) NOT NULL,
    "vigente_desde" TIMESTAMPTZ(3) NOT NULL,
    "vigente_hasta" TIMESTAMPTZ(3),
    "creado_por" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "precios_producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasas_cambio" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "fecha" DATE NOT NULL,
    "moneda_origen" "Moneda" NOT NULL,
    "moneda_destino" "Moneda" NOT NULL,
    "tasa" DECIMAL(20,8) NOT NULL,
    "fuente" TEXT NOT NULL,
    "creado_por" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasas_cambio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correlativos" (
    "codigo" TEXT NOT NULL,
    "prefijo" TEXT NOT NULL,
    "siguiente" BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT "correlativos_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "vehiculos" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "placa" TEXT NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vehiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ubicaciones" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "TipoUbicacion" NOT NULL,
    "vehiculo_id" UUID,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ubicaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_inventario" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "grupo_id" UUID NOT NULL,
    "producto_id" UUID NOT NULL,
    "ubicacion_id" UUID NOT NULL,
    "tipo" "TipoMovimiento" NOT NULL,
    "cantidad_entrada" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "cantidad_salida" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "documento_origen_tipo" TEXT NOT NULL,
    "documento_origen_id" UUID NOT NULL,
    "fecha_hora" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_id" UUID NOT NULL,
    "motivo" TEXT,

    CONSTRAINT "movimientos_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "existencias" (
    "producto_id" UUID NOT NULL,
    "ubicacion_id" UUID NOT NULL,
    "cantidad_fisica" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "cantidad_reservada" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "existencias_pkey" PRIMARY KEY ("producto_id","ubicacion_id")
);

-- CreateTable
CREATE TABLE "reservas_inventario" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "producto_id" UUID NOT NULL,
    "ubicacion_id" UUID NOT NULL,
    "pedido_item_id" UUID NOT NULL,
    "factura_item_id" UUID,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "estado" "EstadoReserva" NOT NULL DEFAULT 'ACTIVA',
    "vence_en" TIMESTAMPTZ(3),
    "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerrada_en" TIMESTAMPTZ(3),

    CONSTRAINT "reservas_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "numero" TEXT NOT NULL,
    "cliente_id" UUID NOT NULL,
    "vendedor_responsable_id" UUID NOT NULL,
    "ruta_id" UUID,
    "lista_precio_id" UUID NOT NULL,
    "moneda" "Moneda" NOT NULL,
    "estado" "EstadoPedido" NOT NULL DEFAULT 'EMITIDO',
    "subtotal" DECIMAL(18,2) NOT NULL,
    "impuesto" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "observaciones" TEXT,
    "fecha_emision" TIMESTAMPTZ(3) NOT NULL,
    "latitud" DECIMAL(9,6),
    "longitud" DECIMAL(9,6),
    "creado_por" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_items" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "pedido_id" UUID NOT NULL,
    "linea" INTEGER NOT NULL,
    "producto_id" UUID NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "precio_ofertado" DECIMAL(18,4) NOT NULL,
    "descuento_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "alicuota_iva" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "pedido_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facturas" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "numero" TEXT NOT NULL,
    "numero_control" TEXT,
    "pedido_id" UUID,
    "cliente_id" UUID NOT NULL,
    "cliente_tipo_documento" "TipoDocumentoIdentidad" NOT NULL,
    "cliente_nro_documento" TEXT NOT NULL,
    "cliente_razon_social" TEXT NOT NULL,
    "cliente_direccion" TEXT NOT NULL,
    "vendedor_responsable_id" UUID NOT NULL,
    "ruta_id" UUID,
    "moneda" "Moneda" NOT NULL,
    "tasa_cambio" DECIMAL(20,8) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "descuento" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "impuesto" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "estado" "EstadoFactura" NOT NULL DEFAULT 'EMITIDA',
    "fecha_emision" TIMESTAMPTZ(3) NOT NULL,
    "fecha_vencimiento" DATE NOT NULL,
    "emitida_por" UUID NOT NULL,
    "motivo_anulacion" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "facturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factura_items" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "factura_id" UUID NOT NULL,
    "linea" INTEGER NOT NULL,
    "pedido_item_id" UUID,
    "producto_id" UUID NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "precio_unitario" DECIMAL(18,4) NOT NULL,
    "descuento_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "alicuota_iva" DECIMAL(5,2) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "impuesto" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "factura_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manifiestos" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "numero" TEXT NOT NULL,
    "vehiculo_id" UUID NOT NULL,
    "ubicacion_origen_id" UUID NOT NULL,
    "chofer_id" UUID NOT NULL,
    "despachador_id" UUID NOT NULL,
    "estado" "EstadoManifiesto" NOT NULL DEFAULT 'BORRADOR',
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmado_en" TIMESTAMPTZ(3),
    "salida_en" TIMESTAMPTZ(3),
    "cerrado_en" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "manifiestos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manifiesto_facturas" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "manifiesto_id" UUID NOT NULL,
    "factura_id" UUID NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "orden_visita" INTEGER,

    CONSTRAINT "manifiesto_facturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manifiesto_items" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "manifiesto_id" UUID NOT NULL,
    "factura_item_id" UUID NOT NULL,
    "cantidad_cargada" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "manifiesto_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archivos" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "tipo" "TipoArchivo" NOT NULL,
    "ruta_relativa" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamano_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "subido_por" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archivos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entregas" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "factura_id" UUID NOT NULL,
    "manifiesto_id" UUID NOT NULL,
    "chofer_id" UUID NOT NULL,
    "estado" "EstadoEntrega" NOT NULL,
    "fecha_hora" TIMESTAMPTZ(3) NOT NULL,
    "latitud" DECIMAL(9,6),
    "longitud" DECIMAL(9,6),
    "precision_metros" DECIMAL(8,2),
    "firma_archivo_id" UUID,
    "receptor_nombre" TEXT,
    "receptor_documento" TEXT,
    "motivo_rechazo" TEXT,
    "observaciones" TEXT,
    "registrada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entregas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entrega_items" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "entrega_id" UUID NOT NULL,
    "factura_item_id" UUID NOT NULL,
    "cantidad_entregada" DECIMAL(14,3) NOT NULL,
    "cantidad_rechazada" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "motivo_rechazo" TEXT,

    CONSTRAINT "entrega_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagos_recibidos" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "cliente_id" UUID NOT NULL,
    "vendedor_receptor_id" UUID,
    "metodo_pago" "MetodoPago" NOT NULL,
    "entidad_origen" TEXT NOT NULL,
    "referencia_normalizada" TEXT,
    "referencia_original" TEXT,
    "moneda" "Moneda" NOT NULL,
    "monto_total" DECIMAL(18,2) NOT NULL,
    "tasa_cambio" DECIMAL(20,8) NOT NULL,
    "fecha_emision" DATE NOT NULL,
    "fecha_registro" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" "EstadoPago" NOT NULL DEFAULT 'REGISTRADO',
    "evidencia_archivo_id" UUID,
    "latitud" DECIMAL(9,6),
    "longitud" DECIMAL(9,6),
    "creado_por" UUID NOT NULL,
    "validado_por" UUID,
    "validado_en" TIMESTAMPTZ(3),
    "motivo_rechazo" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "pagos_recibidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pago_aplicaciones" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "pago_id" UUID NOT NULL,
    "factura_id" UUID NOT NULL,
    "monto_aplicado" DECIMAL(18,2) NOT NULL,
    "monto_moneda_pago" DECIMAL(18,2) NOT NULL,
    "tasa_cambio" DECIMAL(20,8) NOT NULL,
    "fecha_aplicacion" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por" UUID NOT NULL,

    CONSTRAINT "pago_aplicaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_negocio" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "tipo_entidad" TEXT NOT NULL,
    "id_entidad" UUID NOT NULL,
    "tipo_evento" TEXT NOT NULL,
    "estado_anterior" TEXT,
    "estado_nuevo" TEXT,
    "fecha_hora_utc" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_hora_dispositivo" TIMESTAMPTZ(3),
    "zona_horaria_operativa" TEXT NOT NULL DEFAULT 'America/Caracas',
    "usuario_id" UUID NOT NULL,
    "rol_codigo" TEXT,
    "dispositivo_id" UUID,
    "vendedor_responsable_id" UUID,
    "cliente_id" UUID,
    "ruta_id" UUID,
    "vehiculo_id" UUID,
    "latitud" DECIMAL(9,6),
    "longitud" DECIMAL(9,6),
    "origen" "OrigenEvento" NOT NULL,
    "datos" JSONB,

    CONSTRAINT "eventos_negocio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "fecha_hora_utc" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_id" UUID,
    "dispositivo_id" UUID,
    "origen" "OrigenEvento" NOT NULL,
    "ip" TEXT,
    "accion" TEXT NOT NULL,
    "tabla" TEXT NOT NULL,
    "registro_id" TEXT,
    "datos_antes" JSONB,
    "datos_despues" JSONB,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitudes_idempotentes" (
    "usuario_id" UUID NOT NULL,
    "clave" TEXT NOT NULL,
    "metodo_http" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "hash_solicitud" TEXT NOT NULL,
    "estado_respuesta" INTEGER,
    "cuerpo_respuesta" JSONB,
    "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitudes_idempotentes_pkey" PRIMARY KEY ("usuario_id","clave")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_username_key" ON "usuarios"("username");

-- CreateIndex
CREATE UNIQUE INDEX "roles_codigo_key" ON "roles"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "permisos_codigo_key" ON "permisos"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "dispositivos_usuario_id_identificador_key" ON "dispositivos"("usuario_id", "identificador");

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_refresh_token_hash_key" ON "sesiones"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sesiones_usuario_id_idx" ON "sesiones"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendedores_usuario_id_key" ON "vendedores"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendedores_codigo_key" ON "vendedores"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "rutas_codigo_key" ON "rutas"("codigo");

-- CreateIndex
CREATE INDEX "clientes_vendedor_id_idx" ON "clientes"("vendedor_id");

-- CreateIndex
CREATE INDEX "clientes_ruta_id_idx" ON "clientes"("ruta_id");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_tipo_documento_nro_documento_key" ON "clientes"("tipo_documento", "nro_documento");

-- CreateIndex
CREATE INDEX "cliente_vendedor_historial_cliente_id_fecha_desde_idx" ON "cliente_vendedor_historial"("cliente_id", "fecha_desde");

-- CreateIndex
CREATE UNIQUE INDEX "productos_sku_key" ON "productos"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "listas_precio_codigo_key" ON "listas_precio"("codigo");

-- CreateIndex
CREATE INDEX "precios_producto_producto_id_lista_precio_id_vigente_desde_idx" ON "precios_producto"("producto_id", "lista_precio_id", "vigente_desde");

-- CreateIndex
CREATE UNIQUE INDEX "tasas_cambio_fecha_moneda_origen_moneda_destino_fuente_key" ON "tasas_cambio"("fecha", "moneda_origen", "moneda_destino", "fuente");

-- CreateIndex
CREATE UNIQUE INDEX "vehiculos_placa_key" ON "vehiculos"("placa");

-- CreateIndex
CREATE UNIQUE INDEX "ubicaciones_codigo_key" ON "ubicaciones"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "ubicaciones_vehiculo_id_key" ON "ubicaciones"("vehiculo_id");

-- CreateIndex
CREATE INDEX "movimientos_inventario_producto_id_ubicacion_id_fecha_hora_idx" ON "movimientos_inventario"("producto_id", "ubicacion_id", "fecha_hora");

-- CreateIndex
CREATE INDEX "movimientos_inventario_documento_origen_tipo_documento_orig_idx" ON "movimientos_inventario"("documento_origen_tipo", "documento_origen_id");

-- CreateIndex
CREATE INDEX "movimientos_inventario_grupo_id_idx" ON "movimientos_inventario"("grupo_id");

-- CreateIndex
CREATE UNIQUE INDEX "reservas_inventario_factura_item_id_key" ON "reservas_inventario"("factura_item_id");

-- CreateIndex
CREATE INDEX "reservas_inventario_estado_vence_en_idx" ON "reservas_inventario"("estado", "vence_en");

-- CreateIndex
CREATE INDEX "reservas_inventario_producto_id_ubicacion_id_estado_idx" ON "reservas_inventario"("producto_id", "ubicacion_id", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_numero_key" ON "pedidos"("numero");

-- CreateIndex
CREATE INDEX "pedidos_cliente_id_fecha_emision_idx" ON "pedidos"("cliente_id", "fecha_emision");

-- CreateIndex
CREATE INDEX "pedidos_estado_idx" ON "pedidos"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "pedido_items_pedido_id_linea_key" ON "pedido_items"("pedido_id", "linea");

-- CreateIndex
CREATE UNIQUE INDEX "facturas_numero_key" ON "facturas"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "facturas_numero_control_key" ON "facturas"("numero_control");

-- CreateIndex
CREATE INDEX "facturas_cliente_id_fecha_emision_idx" ON "facturas"("cliente_id", "fecha_emision");

-- CreateIndex
CREATE INDEX "facturas_estado_idx" ON "facturas"("estado");

-- CreateIndex
CREATE INDEX "facturas_fecha_vencimiento_idx" ON "facturas"("fecha_vencimiento");

-- CreateIndex
CREATE UNIQUE INDEX "factura_items_factura_id_linea_key" ON "factura_items"("factura_id", "linea");

-- CreateIndex
CREATE UNIQUE INDEX "manifiestos_numero_key" ON "manifiestos"("numero");

-- CreateIndex
CREATE INDEX "manifiestos_estado_idx" ON "manifiestos"("estado");

-- CreateIndex
CREATE INDEX "manifiestos_chofer_id_estado_idx" ON "manifiestos"("chofer_id", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "manifiesto_facturas_manifiesto_id_factura_id_key" ON "manifiesto_facturas"("manifiesto_id", "factura_id");

-- CreateIndex
CREATE UNIQUE INDEX "manifiesto_items_manifiesto_id_factura_item_id_key" ON "manifiesto_items"("manifiesto_id", "factura_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "archivos_ruta_relativa_key" ON "archivos"("ruta_relativa");

-- CreateIndex
CREATE INDEX "archivos_sha256_idx" ON "archivos"("sha256");

-- CreateIndex
CREATE INDEX "entregas_factura_id_idx" ON "entregas"("factura_id");

-- CreateIndex
CREATE INDEX "entregas_manifiesto_id_idx" ON "entregas"("manifiesto_id");

-- CreateIndex
CREATE UNIQUE INDEX "entrega_items_entrega_id_factura_item_id_key" ON "entrega_items"("entrega_id", "factura_item_id");

-- CreateIndex
CREATE INDEX "pagos_recibidos_cliente_id_fecha_registro_idx" ON "pagos_recibidos"("cliente_id", "fecha_registro");

-- CreateIndex
CREATE INDEX "pagos_recibidos_estado_idx" ON "pagos_recibidos"("estado");

-- CreateIndex
CREATE INDEX "pago_aplicaciones_factura_id_idx" ON "pago_aplicaciones"("factura_id");

-- CreateIndex
CREATE UNIQUE INDEX "pago_aplicaciones_pago_id_factura_id_key" ON "pago_aplicaciones"("pago_id", "factura_id");

-- CreateIndex
CREATE INDEX "eventos_negocio_tipo_entidad_id_entidad_fecha_hora_utc_idx" ON "eventos_negocio"("tipo_entidad", "id_entidad", "fecha_hora_utc");

-- CreateIndex
CREATE INDEX "eventos_negocio_tipo_evento_fecha_hora_utc_idx" ON "eventos_negocio"("tipo_evento", "fecha_hora_utc");

-- CreateIndex
CREATE INDEX "auditoria_tabla_registro_id_idx" ON "auditoria"("tabla", "registro_id");

-- CreateIndex
CREATE INDEX "auditoria_usuario_id_fecha_hora_utc_idx" ON "auditoria"("usuario_id", "fecha_hora_utc");

-- CreateIndex
CREATE INDEX "solicitudes_idempotentes_creada_en_idx" ON "solicitudes_idempotentes"("creada_en");

-- AddForeignKey
ALTER TABLE "rol_permisos" ADD CONSTRAINT "rol_permisos_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rol_permisos" ADD CONSTRAINT "rol_permisos_permiso_id_fkey" FOREIGN KEY ("permiso_id") REFERENCES "permisos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_roles" ADD CONSTRAINT "usuario_roles_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_roles" ADD CONSTRAINT "usuario_roles_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivos" ADD CONSTRAINT "dispositivos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_dispositivo_id_fkey" FOREIGN KEY ("dispositivo_id") REFERENCES "dispositivos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendedores" ADD CONSTRAINT "vendedores_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_ruta_id_fkey" FOREIGN KEY ("ruta_id") REFERENCES "rutas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "vendedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_lista_precio_id_fkey" FOREIGN KEY ("lista_precio_id") REFERENCES "listas_precio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente_vendedor_historial" ADD CONSTRAINT "cliente_vendedor_historial_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente_vendedor_historial" ADD CONSTRAINT "cliente_vendedor_historial_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "vendedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "precios_producto" ADD CONSTRAINT "precios_producto_lista_precio_id_fkey" FOREIGN KEY ("lista_precio_id") REFERENCES "listas_precio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "precios_producto" ADD CONSTRAINT "precios_producto_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ubicaciones" ADD CONSTRAINT "ubicaciones_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "existencias" ADD CONSTRAINT "existencias_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "existencias" ADD CONSTRAINT "existencias_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas_inventario" ADD CONSTRAINT "reservas_inventario_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas_inventario" ADD CONSTRAINT "reservas_inventario_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas_inventario" ADD CONSTRAINT "reservas_inventario_pedido_item_id_fkey" FOREIGN KEY ("pedido_item_id") REFERENCES "pedido_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas_inventario" ADD CONSTRAINT "reservas_inventario_factura_item_id_fkey" FOREIGN KEY ("factura_item_id") REFERENCES "factura_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_vendedor_responsable_id_fkey" FOREIGN KEY ("vendedor_responsable_id") REFERENCES "vendedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_ruta_id_fkey" FOREIGN KEY ("ruta_id") REFERENCES "rutas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_lista_precio_id_fkey" FOREIGN KEY ("lista_precio_id") REFERENCES "listas_precio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_items" ADD CONSTRAINT "pedido_items_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_items" ADD CONSTRAINT "pedido_items_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_vendedor_responsable_id_fkey" FOREIGN KEY ("vendedor_responsable_id") REFERENCES "vendedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_ruta_id_fkey" FOREIGN KEY ("ruta_id") REFERENCES "rutas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factura_items" ADD CONSTRAINT "factura_items_factura_id_fkey" FOREIGN KEY ("factura_id") REFERENCES "facturas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factura_items" ADD CONSTRAINT "factura_items_pedido_item_id_fkey" FOREIGN KEY ("pedido_item_id") REFERENCES "pedido_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factura_items" ADD CONSTRAINT "factura_items_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiestos" ADD CONSTRAINT "manifiestos_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiestos" ADD CONSTRAINT "manifiestos_ubicacion_origen_id_fkey" FOREIGN KEY ("ubicacion_origen_id") REFERENCES "ubicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiesto_facturas" ADD CONSTRAINT "manifiesto_facturas_manifiesto_id_fkey" FOREIGN KEY ("manifiesto_id") REFERENCES "manifiestos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiesto_facturas" ADD CONSTRAINT "manifiesto_facturas_factura_id_fkey" FOREIGN KEY ("factura_id") REFERENCES "facturas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiesto_items" ADD CONSTRAINT "manifiesto_items_manifiesto_id_fkey" FOREIGN KEY ("manifiesto_id") REFERENCES "manifiestos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifiesto_items" ADD CONSTRAINT "manifiesto_items_factura_item_id_fkey" FOREIGN KEY ("factura_item_id") REFERENCES "factura_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entregas" ADD CONSTRAINT "entregas_factura_id_fkey" FOREIGN KEY ("factura_id") REFERENCES "facturas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entregas" ADD CONSTRAINT "entregas_manifiesto_id_fkey" FOREIGN KEY ("manifiesto_id") REFERENCES "manifiestos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entregas" ADD CONSTRAINT "entregas_firma_archivo_id_fkey" FOREIGN KEY ("firma_archivo_id") REFERENCES "archivos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrega_items" ADD CONSTRAINT "entrega_items_entrega_id_fkey" FOREIGN KEY ("entrega_id") REFERENCES "entregas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrega_items" ADD CONSTRAINT "entrega_items_factura_item_id_fkey" FOREIGN KEY ("factura_item_id") REFERENCES "factura_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_recibidos" ADD CONSTRAINT "pagos_recibidos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_recibidos" ADD CONSTRAINT "pagos_recibidos_vendedor_receptor_id_fkey" FOREIGN KEY ("vendedor_receptor_id") REFERENCES "vendedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_recibidos" ADD CONSTRAINT "pagos_recibidos_evidencia_archivo_id_fkey" FOREIGN KEY ("evidencia_archivo_id") REFERENCES "archivos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago_aplicaciones" ADD CONSTRAINT "pago_aplicaciones_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "pagos_recibidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago_aplicaciones" ADD CONSTRAINT "pago_aplicaciones_factura_id_fkey" FOREIGN KEY ("factura_id") REFERENCES "facturas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

