// src/radicacion/radicacion.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RadicacionController } from './radicacion.controller';
import { RadicacionService } from './radicacion.service';
import { Documento } from './entities/documento.entity';
import { Contratista } from '../contratista/entities/contratista.entity';
import { User } from '../users/entities/user.entity';
import { RegistroAcceso } from './entities/registro-acceso.entity';
import { EstadosModule } from '../estados/estados.module';
import { ContratistasModule } from '../contratista/contratista.module';
import { EstadisticasRadicadorController } from './estadisticas/estadisticas-radicador.controller';
import { EstadisticasRadicadorService } from './estadisticas/estadisticas-radicador.service';
import { StorageService } from '../common/storage/storage.service';
import { AuditorModule } from '../auditor/auditor.module'; // ✅ AGREGAR

@Module({
  imports: [
    TypeOrmModule.forFeature([Documento, Contratista, User, RegistroAcceso]),
    ContratistasModule,
    EstadosModule,
    AuditorModule, // ✅ AGREGAR (en lugar de SupervisionModule)
  ],
  controllers: [
    RadicacionController,
    EstadisticasRadicadorController,
  ],
  providers: [
    RadicacionService,
    EstadisticasRadicadorService,
    StorageService,
  ],
  exports: [RadicacionService, StorageService],
})
export class RadicacionModule {}