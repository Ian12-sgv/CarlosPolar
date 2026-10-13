# Power BI

Los tableros leen **solo el esquema `bi`** con un usuario de solo lectura (`powerbi`). No consultan las tablas operativas.

## Qué hay

| Archivo | Contenido |
|---|---|
| [`powerbi/CarlosPolar.pbip`](../powerbi/CarlosPolar.pbip) | Proyecto de Power BI Desktop (formato PBIP, texto) |
| `powerbi/CarlosPolar.SemanticModel/` | Modelo en TMDL: 17 tablas, 32 relaciones, 46 medidas DAX organizadas por carpeta |
| `powerbi/CarlosPolar.Report/` | Informe con 6 páginas vacías listas para armar |
| [`powerbi/medidas.dax`](../powerbi/medidas.dax) | Las mismas medidas en texto plano, por si se arma el modelo a mano |
| [`powerbi/generar.py`](../powerbi/generar.py) | Genera todo lo anterior desde una sola especificación |

> **Importante:** el proyecto se generó sin Power BI Desktop (no está instalado en el equipo donde se construyó). Se verificó que cada columna que pide el modelo existe en las vistas y que cada medida que referencia a otra está definida, pero **no se ha abierto en Power BI Desktop**. Si al abrirlo da un error, use el camino manual de abajo y avíseme el mensaje para corregir el generador.

## Requisitos

- Power BI Desktop (gratuito, Microsoft Store). Para abrir archivos `.pbip`, active en *Archivo → Opciones → Características de vista previa* la opción **"Formato de guardado de proyecto de Power BI (.pbip)"** si su versión aún la muestra como vista previa.
- Acceso de red al PostgreSQL (puerto 5432).
- Usuario `powerbi`: la clave está en `apps/api/.env` (`POWERBI_CLAVE`). Solo puede leer el esquema `bi`.

## Abrir el proyecto

1. Abra `powerbi/CarlosPolar.pbip` con Power BI Desktop.
2. *Transformar datos → Editar parámetros*: `Servidor` (por defecto `localhost:5432`) y `BaseDatos` (`carlos_polar`).
3. Al actualizar, Power BI pide credenciales para PostgreSQL: elija **Base de datos**, usuario `powerbi` y la clave de `.env`. Si pregunta por cifrado y el servidor es local, acepte la conexión sin cifrar.
4. *Inicio → Actualizar*.

## Camino manual (si el .pbip no abre)

1. *Obtener datos → Base de datos PostgreSQL*, servidor `localhost:5432`, base `carlos_polar`, modo **Importar**.
2. Credenciales de base de datos: usuario `powerbi`.
3. Seleccione las vistas del esquema `bi` y renómbrelas como en la tabla de abajo.
4. Cree las relaciones de la tabla de abajo (todas de varios a uno, filtro en una dirección).
5. Cree la tabla `Calendario` (*Modelado → Nueva tabla*) con la expresión de `CarlosPolar.SemanticModel/definition/tables/Calendario.tmdl` y márquela como tabla de fechas sobre la columna `Fecha`.
6. Copie las medidas de `powerbi/medidas.dax` (*Modelado → Nueva medida*), cada una en su tabla.

| Tabla | Vista | Se relaciona con |
|---|---|---|
| Ventas | `v_ventas` (líneas facturadas) | Calendario, Clientes, Productos, Vendedores, Rutas |
| Pedidos | `v_pedidos` | Calendario, Clientes, Vendedores, Rutas |
| Embudo | `v_embudo` (pedido → factura → carga → entrega por línea) | Calendario, Clientes, Productos, Vendedores |
| Tiempos | `v_tiempos_pedido` (horas entre etapas) | Calendario, Clientes, Vendedores |
| Entregas | `v_entregas` | Calendario, Clientes, Rutas, Choferes |
| Cartera | `v_cartera_facturas` (saldo USD y tramo de antigüedad) | Clientes, Vendedores, Rutas |
| Pagos | `v_pagos` | Calendario, Clientes, Vendedores |
| Existencias | `v_existencias` | Productos |
| Cuadre | `v_cuadre_manifiestos` | Productos, Choferes |
| Visitas | `v_cumplimiento_visitas` | Calendario, Vendedores |
| Sincronizacion | `v_sincronizacion` | Calendario |
| Clientes, Productos, Vendedores, Rutas, Choferes | `v_dim_*` | — |

## Páginas sugeridas

Cada página usa medidas que ya están en el modelo (carpeta entre paréntesis). Filtros comunes en todas: segmentación por `Calendario[Año-Mes]`, `Vendedores[nombre]` y `Rutas[nombre]`.

1. **Resumen**: tarjetas con Ventas USD, Cartera USD, % Cartera vencida, Cobranza sobre ventas, % Entregas exitosas, Pagos por validar. Línea de Ventas USD por `Calendario[Fecha]`.
2. **Ventas** (Ventas, Pedidos): barras de Ventas USD por vendedor y por ruta; tabla de productos con Unidades vendidas y Ventas USD; tarjetas de Ticket promedio USD, Clientes con compra y % Conversión pedido a factura.
3. **Operación** (Embudo, Tiempos, Entregas): embudo con Unidades solicitadas → facturadas → cargadas → entregadas; % Cumplimiento del pedido; barras de horas de aprobación, preparación y reparto; % Entregas exitosas por chofer; tabla de motivos de rechazo (`Entregas[motivo_rechazo]`).
4. **Cobranza** (Cartera, Cobranza): columnas apiladas de Cartera USD por `Cartera[tramo]` (ordene `tramo` por `orden_tramo`); tabla de clientes con Cartera USD, Cartera vencida USD y Días vencidos; Cobrado validado USD por `Pagos[metodo_pago]`; Horas de validación.
5. **Inventario** (Inventario): tabla por producto con Stock físico, Stock disponible y mínimo; tarjeta Productos bajo mínimo; Rotación por producto; Diferencia de inventario en rutas por chofer.
6. **Campo** (Visitas, Sincronización): % Cumplimiento de visitas y % Visitas efectivas por vendedor; Operaciones móviles, % Reintentos duplicados, Conflictos y rechazos por día (señales de mala conectividad o problemas de la app).

## Notas

- Los montos en USD usan la **tasa de cada documento**, nunca la del día: los históricos no cambian.
- La cartera solo descuenta **pagos validados**; lo registrado sin validar se muestra aparte.
- Las fechas están en hora de Caracas.
- Si cambian las vistas, edite `TABLAS` en `powerbi/generar.py` y ejecute `python powerbi/generar.py`.
