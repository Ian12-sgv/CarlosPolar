-- CreateEnum
CREATE TYPE "OrigenVisitaPlan" AS ENUM ('PLANTILLA', 'MANUAL');

-- CreateEnum
CREATE TYPE "EstadoVisitaPlan" AS ENUM ('PROGRAMADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "ResultadoVisita" AS ENUM ('PEDIDO', 'COBRO', 'PEDIDO_Y_COBRO', 'SIN_PEDIDO', 'CLIENTE_CERRADO', 'NO_ATENDIDO');

-- CreateEnum
CREATE TYPE "ResultadoSincronizacion" AS ENUM ('ACEPTADO', 'DUPLICADO', 'RECHAZADO', 'CONFLICTO', 'ERROR');

-- AlterTable
ALTER TABLE "pagos_recibidos" ADD COLUMN     "visita_id" UUID;

-- AlterTable
ALTER TABLE "pedidos" ADD COLUMN     "motivo_estado" TEXT,
ADD COLUMN     "visita_id" UUID;

-- AlterTable
ALTER TABLE "rutas" ADD COLUMN     "vendedor_id" UUID;

-- AlterTable
ALTER TABLE "sesiones" ADD COLUMN     "access_expira_en" TIMESTAMPTZ(3) NOT NULL,
ADD COLUMN     "access_token_hash" TEXT NOT NULL,
ADD COLUMN     "ultimo_uso_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "ruta_plan_clientes" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "ruta_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "dia_semana" INTEGER NOT NULL,
    "orden" INTEGER NOT NULL,
    "vigente_desde" DATE NOT NULL,
    "vigente_hasta" DATE,
    "creado_por" UUID NOT NULL,

    CONSTRAINT "ruta_plan_clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitas_planificadas" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "fecha" DATE NOT NULL,
    "ruta_id" UUID,
    "vendedor_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "origen" "OrigenVisitaPlan" NOT NULL,
    "estado" "EstadoVisitaPlan" NOT NULL DEFAULT 'PROGRAMADA',
    "motivo_cancelacion" TEXT,
    "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitas_planificadas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitas" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "visita_planificada_id" UUID,
    "vendedor_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "ruta_id" UUID,
    "inicio_en" TIMESTAMPTZ(3) NOT NULL,
    "fin_en" TIMESTAMPTZ(3),
    "latitud" DECIMAL(9,6),
    "longitud" DECIMAL(9,6),
    "precision_metros" DECIMAL(8,2),
    "resultado" "ResultadoVisita",
    "motivo_sin_venta" TEXT,
    "observaciones" TEXT,
    "registrada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sincronizacion_registros" (
    "id" UUID NOT NULL DEFAULT uuid_v7(),
    "usuario_id" UUID NOT NULL,
    "dispositivo_id" UUID,
    "origen" "OrigenEvento" NOT NULL,
    "metodo_http" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "clave_idempotencia" TEXT,
    "fecha_hora_dispositivo" TIMESTAMPTZ(3),
    "recibido_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resultado" "ResultadoSincronizacion" NOT NULL,
    "estado_http" INTEGER NOT NULL,
    "codigo_motivo" TEXT,
    "duracion_ms" INTEGER NOT NULL,

    CONSTRAINT "sincronizacion_registros_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ruta_plan_clientes_ruta_id_dia_semana_idx" ON "ruta_plan_clientes"("ruta_id", "dia_semana");

-- CreateIndex
CREATE INDEX "visitas_planificadas_vendedor_id_fecha_idx" ON "visitas_planificadas"("vendedor_id", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "visitas_planificadas_fecha_vendedor_id_cliente_id_key" ON "visitas_planificadas"("fecha", "vendedor_id", "cliente_id");

-- CreateIndex
CREATE INDEX "visitas_vendedor_id_inicio_en_idx" ON "visitas"("vendedor_id", "inicio_en");

-- CreateIndex
CREATE INDEX "visitas_cliente_id_inicio_en_idx" ON "visitas"("cliente_id", "inicio_en");

-- CreateIndex
CREATE INDEX "sincronizacion_registros_dispositivo_id_recibido_en_idx" ON "sincronizacion_registros"("dispositivo_id", "recibido_en");

-- CreateIndex
CREATE INDEX "sincronizacion_registros_resultado_recibido_en_idx" ON "sincronizacion_registros"("resultado", "recibido_en");

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_access_token_hash_key" ON "sesiones"("access_token_hash");

-- AddForeignKey
ALTER TABLE "rutas" ADD CONSTRAINT "rutas_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "vendedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_visita_id_fkey" FOREIGN KEY ("visita_id") REFERENCES "visitas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_recibidos" ADD CONSTRAINT "pagos_recibidos_visita_id_fkey" FOREIGN KEY ("visita_id") REFERENCES "visitas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruta_plan_clientes" ADD CONSTRAINT "ruta_plan_clientes_ruta_id_fkey" FOREIGN KEY ("ruta_id") REFERENCES "rutas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruta_plan_clientes" ADD CONSTRAINT "ruta_plan_clientes_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitas_planificadas" ADD CONSTRAINT "visitas_planificadas_ruta_id_fkey" FOREIGN KEY ("ruta_id") REFERENCES "rutas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitas_planificadas" ADD CONSTRAINT "visitas_planificadas_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "vendedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitas_planificadas" ADD CONSTRAINT "visitas_planificadas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitas" ADD CONSTRAINT "visitas_visita_planificada_id_fkey" FOREIGN KEY ("visita_planificada_id") REFERENCES "visitas_planificadas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitas" ADD CONSTRAINT "visitas_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "vendedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitas" ADD CONSTRAINT "visitas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitas" ADD CONSTRAINT "visitas_ruta_id_fkey" FOREIGN KEY ("ruta_id") REFERENCES "rutas"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ═════════════════════════ Reglas adicionales (manuales) ═════════════════════════

-- Un cliente no se repite el mismo día en la plantilla vigente de una ruta.
CREATE UNIQUE INDEX ruta_plan_clientes_vigente_unico
  ON ruta_plan_clientes (ruta_id, cliente_id, dia_semana)
  WHERE vigente_hasta IS NULL;

ALTER TABLE ruta_plan_clientes
  ADD CONSTRAINT ruta_plan_dia_semana_valido CHECK (dia_semana BETWEEN 1 AND 7),
  ADD CONSTRAINT ruta_plan_vigencia_valida CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde);

ALTER TABLE visitas_planificadas
  ADD CONSTRAINT visitas_planificadas_cancelacion_motivada CHECK (estado <> 'CANCELADA' OR motivo_cancelacion IS NOT NULL);

ALTER TABLE visitas
  ADD CONSTRAINT visitas_fin_posterior CHECK (fin_en IS NULL OR fin_en >= inicio_en),
  ADD CONSTRAINT visitas_cerrada_con_resultado CHECK ((fin_en IS NULL) = (resultado IS NULL)),
  ADD CONSTRAINT visitas_sin_venta_motivada CHECK (
    resultado IS NULL OR resultado NOT IN ('SIN_PEDIDO', 'CLIENTE_CERRADO', 'NO_ATENDIDO') OR motivo_sin_venta IS NOT NULL
  );

-- Una visita cerrada no se modifica.
CREATE FUNCTION fn_visita_cerrada_fija() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.fin_en IS NOT NULL THEN
    RAISE EXCEPTION 'la visita % ya está cerrada', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER visitas_cerrada_fija BEFORE UPDATE ON visitas
  FOR EACH ROW EXECUTE FUNCTION fn_visita_cerrada_fija();

CREATE TRIGGER sincronizacion_registros_inmutable BEFORE UPDATE OR DELETE ON sincronizacion_registros
  FOR EACH ROW EXECUTE FUNCTION fn_prohibir_modificacion();
CREATE TRIGGER sincronizacion_registros_sin_truncate BEFORE TRUNCATE ON sincronizacion_registros
  FOR EACH STATEMENT EXECUTE FUNCTION fn_prohibir_modificacion();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ruta_plan_clientes', 'visitas_planificadas', 'visitas']
  LOOP
    EXECUTE format('CREATE TRIGGER %1$s_sin_borrado BEFORE DELETE ON %1$I
                    FOR EACH ROW EXECUTE FUNCTION fn_prohibir_borrado()', t);
    EXECUTE format('CREATE TRIGGER %1$s_sin_truncate BEFORE TRUNCATE ON %1$I
                    FOR EACH STATEMENT EXECUTE FUNCTION fn_prohibir_borrado()', t);
  END LOOP;
END;
$$;

-- ═════════════════════════ Vistas analíticas ═════════════════════════

-- Cumplimiento de visitas por día y vendedor. Una visita es "efectiva" si
-- terminó con pedido o cobro.
CREATE VIEW bi.v_cumplimiento_visitas AS
WITH plan AS (
  SELECT vp.fecha, vp.vendedor_id, vp.ruta_id, vp.id, vp.cliente_id
  FROM visitas_planificadas vp
  WHERE vp.estado = 'PROGRAMADA'
), hechas AS (
  SELECT v.*, (v.inicio_en AT TIME ZONE 'America/Caracas')::date AS fecha
  FROM visitas v
  WHERE v.fin_en IS NOT NULL
)
SELECT
  coalesce(p.fecha, h.fecha) AS fecha,
  coalesce(p.vendedor_id, h.vendedor_id) AS vendedor_id,
  count(DISTINCT p.id) AS planificadas,
  count(DISTINCT p.id) FILTER (WHERE h.id IS NOT NULL) AS planificadas_visitadas,
  count(DISTINCT h.id) FILTER (WHERE h.visita_planificada_id IS NULL) AS fuera_de_plan,
  count(DISTINCT h.id) FILTER (WHERE h.resultado IN ('PEDIDO', 'COBRO', 'PEDIDO_Y_COBRO')) AS efectivas
FROM plan p
FULL JOIN hechas h ON h.visita_planificada_id = p.id
GROUP BY 1, 2;

-- Reintentos, duplicados y conflictos de sincronización por día y dispositivo.
CREATE VIEW bi.v_sincronizacion AS
SELECT
  (recibido_en AT TIME ZONE 'America/Caracas')::date AS fecha,
  usuario_id,
  dispositivo_id,
  origen,
  ruta,
  count(*) AS operaciones,
  count(*) FILTER (WHERE resultado = 'ACEPTADO') AS aceptadas,
  count(*) FILTER (WHERE resultado = 'DUPLICADO') AS duplicadas,
  count(*) FILTER (WHERE resultado = 'RECHAZADO') AS rechazadas,
  count(*) FILTER (WHERE resultado = 'CONFLICTO') AS conflictos,
  count(*) FILTER (WHERE resultado = 'ERROR') AS errores,
  avg(extract(epoch FROM recibido_en - fecha_hora_dispositivo)) FILTER (WHERE fecha_hora_dispositivo IS NOT NULL)
    AS retraso_promedio_seg
FROM sincronizacion_registros
GROUP BY 1, 2, 3, 4, 5;

DO $$
BEGIN
  GRANT SELECT ON ALL TABLES IN SCHEMA bi TO bi_lector;
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
  RAISE NOTICE 'No se otorgaron permisos a bi_lector.';
END;
$$;
