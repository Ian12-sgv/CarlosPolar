import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ArchivosController } from './archivos/archivos.controller.js';
import { ArchivosService } from './archivos/archivos.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { CatalogoController } from './catalogo/catalogo.controller.js';
import { PreciosService } from './catalogo/precios.service.js';
import { ClientesService } from './clientes/clientes.service.js';
import { ClientesController } from './clientes/clientes.controller.js';
import { EstadoCuentaService } from './clientes/estado-cuenta.service.js';
import { EntregasController } from './entregas/entregas.controller.js';
import { EntregasService } from './entregas/entregas.service.js';
import { EventosModule } from './eventos/eventos.module.js';
import { FacturasController } from './facturas/facturas.controller.js';
import { FacturasService } from './facturas/facturas.service.js';
import { InventarioController } from './inventario/inventario.controller.js';
import { PersonalController } from './maestros/personal.controller.js';
import { PreciosController } from './maestros/precios.controller.js';
import { ProductosController } from './maestros/productos.controller.js';
import { ManifiestosController } from './manifiestos/manifiestos.controller.js';
import { ManifiestosService } from './manifiestos/manifiestos.service.js';
import { VehiculosController } from './manifiestos/vehiculos.controller.js';
import { IdempotenciaInterceptor } from './idempotencia/idempotencia.interceptor.js';
import { PagosController } from './pagos/pagos.controller.js';
import { PagosService } from './pagos/pagos.service.js';
import { PedidosController } from './pedidos/pedidos.controller.js';
import { PedidosService } from './pedidos/pedidos.service.js';
import { ReservasService } from './pedidos/reservas.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SaludController } from './salud/salud.controller.js';
import { TasasController } from './tasas/tasas.controller.js';
import { TasasService } from './tasas/tasas.service.js';
import { RutasController } from './visitas/rutas.controller.js';
import { VisitasController } from './visitas/visitas.controller.js';
import { VisitasService } from './visitas/visitas.service.js';
import { UsuariosController } from './usuarios/usuarios.controller.js';

@Module({
  imports: [PrismaModule, EventosModule],
  controllers: [
    SaludController,
    AuthController,
    UsuariosController,
    ClientesController,
    CatalogoController,
    PedidosController,
    FacturasController,
    TasasController,
    VehiculosController,
    ManifiestosController,
    EntregasController,
    ArchivosController,
    PagosController,
    ProductosController,
    PreciosController,
    PersonalController,
    InventarioController,
    RutasController,
    VisitasController,
  ],
  providers: [
    AuthService,
    EstadoCuentaService,
    PreciosService,
    PedidosService,
    ReservasService,
    FacturasService,
    TasasService,
    ManifiestosService,
    EntregasService,
    ArchivosService,
    PagosService,
    ClientesService,
    VisitasService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotenciaInterceptor },
  ],
})
export class AppModule {}
