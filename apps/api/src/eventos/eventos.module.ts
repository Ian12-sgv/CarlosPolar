import { Global, Module } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service.js';
import { EventosService } from './eventos.service.js';

@Global()
@Module({
  providers: [EventosService, AuditoriaService],
  exports: [EventosService, AuditoriaService],
})
export class EventosModule {}
