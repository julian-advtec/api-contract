// En auditor.module.ts - alternativa sin BitacoraSistemaModule

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditorController } from './auditor.controller';
import { AuditorEstadisticasController } from './auditor-estadisticas.controller';
import { AuditorService } from './auditor.service';
import { AuditorEstadisticasService } from './auditor-estadisticas.service';
import { AuditorDocumento } from './entities/auditor-documento.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { JuridicaModule } from '../juridica/juridica.module';
import { BitacoraSistemaService } from '../bitacora-sistema/bitacora-sistema.service';
import { BitacoraSistema } from '../bitacora-sistema/entities/bitacora-sistema.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditorDocumento, Documento, User, BitacoraSistema]),
    JuridicaModule,
  ],
  controllers: [
    AuditorController,
    AuditorEstadisticasController,
  ],
  providers: [
    AuditorService,
    AuditorEstadisticasService,
    BitacoraSistemaService, // ✅ Agregar directamente
  ],
  exports: [AuditorService],
})
export class AuditorModule {}