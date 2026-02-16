// backend/tesoreria/tesoreria.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TesoreriaController } from './tesoreria.controller';
import { TesoreriaService } from './tesoreria.service';
import { TesoreriaSignatureService } from './tesoreria-signature.service';
import { TesoreriaDocumento } from './entities/tesoreria-documento.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { ContabilidadDocumento } from '../contabilidad/entities/contabilidad-documento.entity';
import { Signature } from '../signatures/entities/signature.entity';
import { EncryptionService } from '../signatures/encryption.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TesoreriaDocumento,
      Documento,
      User,
      ContabilidadDocumento,
      Signature, // 👈 IMPORTANTE: agregar Signature aquí
    ]),
  ],
  controllers: [TesoreriaController],
  providers: [
    TesoreriaService,
    TesoreriaSignatureService,
    EncryptionService,
  ],
  exports: [TesoreriaService],
})
export class TesoreriaModule {}