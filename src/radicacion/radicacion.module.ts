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
import { ContratistaModule } from '../contratista/contratista.module'; // 👈 AÑADIR ESTO

@Module({
  imports: [
    TypeOrmModule.forFeature([Documento, Contratista, User, RegistroAcceso]),
    ContratistaModule, // 👈 IMPORTAR EL MÓDULO COMPLETO
    EstadosModule,
    forwardRef(() => SupervisionModule),
  ],
  controllers: [RadicacionController],
  providers: [RadicacionService],
  exports: [RadicacionService],
})
export class RadicacionModule {}