// src/auditor/auditor.module.ts
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
import { Contratista } from '../contratista/entities/contratista.entity';
import { DocumentoContratista } from '../contratista/entities/documento-contratista.entity'; // ← AGREGAR
import { ContratistaService } from '../contratista/services/contratista.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditorDocumento,
      Documento,
      User,
      BitacoraSistema,
      Contratista,
      DocumentoContratista, // ← AGREGAR
    ]),
    JuridicaModule,
  ],
  controllers: [
    AuditorController,
    AuditorEstadisticasController,
  ],
  providers: [
    AuditorService,
    AuditorEstadisticasService,
    BitacoraSistemaService,
    ContratistaService,
  ],
  exports: [AuditorService],
})
export class AuditorModule {}