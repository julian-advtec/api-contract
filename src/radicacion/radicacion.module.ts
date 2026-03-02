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
import { SupervisionModule } from '../supervision/supervisor.module';
import { ContratistaModule } from '../contratista/contratista.module';

// Nuevos imports para estadísticas del radicador
import { EstadisticasRadicadorController } from './estadisticas/estadisticas-radicador.controller';
import { EstadisticasRadicadorService } from './estadisticas/estadisticas-radicador.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Documento, Contratista, User, RegistroAcceso]),
    ContratistaModule,
    EstadosModule,
    forwardRef(() => SupervisionModule),
  ],
  controllers: [
    RadicacionController,
    EstadisticasRadicadorController,      // ← AÑADIDO AQUÍ
  ],
  providers: [
    RadicacionService,
    EstadisticasRadicadorService,         // ← AÑADIDO AQUÍ
  ],
  exports: [RadicacionService],
})
export class RadicacionModule {}