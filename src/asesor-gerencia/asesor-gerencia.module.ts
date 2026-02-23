// asesor-gerencia.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AsesorGerenciaController } from './asesor-gerencia.controller';
import { AsesorGerenciaService } from './asesor-gerencia.service';
import { AsesorGerenciaSignatureService } from './asesor-gerencia-signature.service';
import { EstadisticasAsesorGerenciaService } from './estadisticas/estadisticas-asesor-gerencia.service';
import { EstadisticasAsesorGerenciaController } from './estadisticas/estadisticas-asesor-gerencia.controller'; // ← IMPORTAR
import { AsesorGerenciaDocumento } from './entities/asesor-gerencia-documento.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { Signature } from '../signatures/entities/signature.entity';
import { EncryptionService } from '../signatures/encryption.service';
import { TesoreriaModule } from '../tesoreria/tesoreria.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AsesorGerenciaDocumento,
      Documento,
      User,
      Signature,
    ]),
    TesoreriaModule,
  ],
  controllers: [
    AsesorGerenciaController,
    EstadisticasAsesorGerenciaController, // ← AGREGAR AQUÍ
  ],
  providers: [
    AsesorGerenciaService,
    AsesorGerenciaSignatureService,
    EstadisticasAsesorGerenciaService,
    EncryptionService,
  ],
  exports: [AsesorGerenciaService, EstadisticasAsesorGerenciaService],
})
export class AsesorGerenciaModule {}