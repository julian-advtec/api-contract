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
import { SupervisorModule } from '../supervision/supervisor.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Documento, Contratista, User, RegistroAcceso]),
    EstadosModule,
    forwardRef(() => SupervisorModule), // ✅ USAR forwardRef
  ],
  controllers: [RadicacionController],
  providers: [RadicacionService],
  exports: [RadicacionService],
})
export class RadicacionModule {}