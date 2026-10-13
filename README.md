# Carlos Polar

Sistema de preventa, facturación, despacho, entrega y cobranza.

```
apps/api         API: NestJS + Fastify + Prisma (PostgreSQL)
apps/web         Backoffice: React + Vite (Ventas, Facturación, Logística, Administración)
apps/mobile      App Preventista / Chofer: Expo, funciona sin conexión
packages/domain  Reglas compartidas: ciclos de vida, eventos, permisos y contratos de la API
powerbi/         Modelo de Power BI (PBIP/TMDL) sobre el esquema bi
docs/            Decisiones de diseño y guías
```

- Modelo de datos y reglas: [docs/modelo-datos.md](docs/modelo-datos.md)
- Contrato de la API para las apps: [docs/api.md](docs/api.md)
- App móvil: [docs/app-movil.md](docs/app-movil.md)
- Power BI: [docs/powerbi.md](docs/powerbi.md)
- Distribución (HTTPS y APK): [docs/distribucion.md](docs/distribucion.md)

## Requisitos

- Node.js 24 y pnpm 10
- PostgreSQL 13 o superior (instalación local, o `docker compose up -d`, que expone el puerto 5433)

## Puesta en marcha

```sh
pnpm install
pnpm --filter @cp/domain build

cd apps/api
cp .env.example .env           # ajustar DATABASE_URL
pnpm db:deploy                 # aplica las migraciones
pnpm db:generate               # genera el cliente Prisma
pnpm db:seed                   # roles, permisos, correlativos, almacén principal y usuario técnico
pnpm build
ADMIN_PASSWORD='una-clave-segura' pnpm usuario:admin admin "Nombre del administrador"
pnpm dev                       # http://localhost:3000/salud
```

En otra terminal, desde la raíz:

```sh
pnpm dev:web                   # backoffice en http://localhost:5173 (redirige /api a la API)
pnpm dev:mobile                # app móvil con Expo Go (ver docs/app-movil.md)
```

## Pruebas

```sh
pnpm test
```

Las pruebas de integración (`apps/api/test/`: reglas de base de datos y API de punta a punta) necesitan una base con las migraciones aplicadas y se omiten si no se define:

```sh
TEST_DATABASE_URL="postgresql://usuario:clave@localhost:5432/carlos_polar_test" pnpm --filter @cp/api test
```

Las pruebas de API crean datos reales (con sufijos aleatorios): use una base dedicada a pruebas, nunca la de producción.

## Notas técnicas

- Todo el monorepo es ESM (NestJS 12 lo exige).
- `pnpm dev` compila con `tsc`, no con `tsx`: Nest necesita `emitDecoratorMetadata` para inyectar dependencias y esbuild no lo emite.
- Firmas y evidencias se guardan en `STORAGE_DIR` (por defecto `storage/` en la raíz), con el SHA-256 como nombre. **Respalde esa carpeta junto con la base de datos.**
- Los IDs son UUIDv7 generados por PostgreSQL (`uuid_v7()`), no por Prisma, para que cualquier inserción tenga un id válido.
- **Toda conexión de Prisma debe crearse con `crearPrisma()` / `crearAdaptador()`** (`src/prisma/conexion.ts`). Fijan la sesión en UTC: el adaptador `pg` envía las fechas sin zona horaria y, con la zona del servidor en America/Caracas, quedarían 4 horas desfasadas.
