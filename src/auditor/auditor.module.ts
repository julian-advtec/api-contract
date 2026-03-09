// src/auditor/auditor.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditorController } from './auditor.controller';
import { AuditorEstadisticasController } from './auditor-estadisticas.controller'; // ← IMPORTAR
import { AuditorService } from './auditor.service';
import { AuditorEstadisticasService } from './auditor-estadisticas.service'; // ← IMPORTAR
import { AuditorDocumento } from './entities/auditor-documento.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';

@Module({

  imports: [
    TypeOrmModule.forFeature([AuditorDocumento, Documento, User]),
  ],
  controllers: [
    AuditorController,
    AuditorEstadisticasController, // ← AÑADIR AQUÍ
  ],
  providers: [
    AuditorService,
    AuditorEstadisticasService, // ← AÑADIR AQUÍ
  ],
  exports: [AuditorService],
})
export class AuditorModule {}
