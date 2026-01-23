import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupervisorDocumento } from './entities/supervisor.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';

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

@Module({
  imports: [
    TypeOrmModule.forFeature([SupervisorDocumento, Documento, User]),
  ],
  controllers: [
    SupervisorController, // Mantener para compatibilidad
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
  ],
  exports: [SupervisorService],
})
export class SupervisionModule {}