// src/supervisor/supervisor.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupervisorDocumento } from './entities/supervisor.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { AuditorDocumento } from '../auditor/entities/auditor-documento.entity';
import { StorageService } from '../common/storage/storage.service';
import { SignaturesModule } from '../signatures/signatures.module';
import { EncryptionService } from '../signatures/encryption.service';
import { Signature } from '../signatures/entities/signature.entity';

// Controllers
import { SupervisorController } from './controllers/supervisor.controller';
import { SupervisorDocumentosController } from './controllers/supervisor-documentos.controller';
import { SupervisorRevisionController } from './controllers/supervisor-revision.controller';
import { SupervisorArchivosController } from './controllers/supervisor-archivos.controller';
import { SupervisorEstadisticasController } from './controllers/supervisor-estadisticas.controller';
import { SupervisorAdminController } from './controllers/supervisor-admin.controller';

// Services
import { SupervisorService } from './services/supervisor.service';
import { SupervisorDocumentosService } from './services/supervisor-documentos.service';
import { SupervisorRevisionService } from './services/supervisor-revision.service';
import { SupervisorArchivosService } from './services/supervisor-archivos.service';
import { SupervisorEstadisticasService } from './services/supervisor-estadisticas.service';
import { SupervisorSignatureService } from './services/supervisor-signature.service'; // ✅ AGREGAR IMPORT

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SupervisorDocumento,
      Documento,
      User,
      AuditorDocumento,
      Signature, // ✅ AGREGAR Signature para que TypeORM lo reconozca
    ]),
    SignaturesModule,
  ],
  controllers: [
    SupervisorController,
    SupervisorDocumentosController,
    SupervisorRevisionController,
    SupervisorArchivosController,
    SupervisorEstadisticasController,
    SupervisorAdminController,
  ],
  providers: [
    SupervisorService,
    SupervisorDocumentosService,
    SupervisorRevisionService,
    SupervisorArchivosService,
    SupervisorEstadisticasService,
    StorageService,
    SupervisorSignatureService, // ✅ AGREGAR EL NUEVO SERVICIO
    EncryptionService, // ✅ AGREGAR EncryptionService (necesario para firmas)
  ],
  exports: [SupervisorService],
})

export class SupervisionModule {}