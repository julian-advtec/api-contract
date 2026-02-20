import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AsesorGerenciaController } from './asesor-gerencia.controller';
import { AsesorGerenciaService } from './asesor-gerencia.service';
import { AsesorGerenciaSignatureService } from './asesor-gerencia-signature.service';
import { AsesorGerenciaDocumento } from './entities/asesor-gerencia-documento.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { Signature } from '../signatures/entities/signature.entity';
import { EncryptionService } from '../signatures/encryption.service';

// ← AGREGAR ESTA LÍNEA (ajusta la ruta si tesoreria está en otro lugar)
import { TesoreriaModule } from '../tesoreria/tesoreria.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AsesorGerenciaDocumento,
      Documento,
      User,
      Signature,
    ]),
    TesoreriaModule,  // ← AGREGAR AQUÍ
  ],
  controllers: [AsesorGerenciaController],
  providers: [
    AsesorGerenciaService,
    AsesorGerenciaSignatureService,
    EncryptionService,
  ],
  exports: [AsesorGerenciaService],
})
export class AsesorGerenciaModule {}