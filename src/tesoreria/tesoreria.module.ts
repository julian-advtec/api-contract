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

// 👇 IMPORTAR el nuevo controlador y servicio
import { EstadisticasTesoreriaController } from './estadisticas/estadisticas-tesoreria.controller';
import { EstadisticasTesoreriaService } from './estadisticas/estadisticas-tesoreria.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TesoreriaDocumento,
      Documento,
      User,
      ContabilidadDocumento,
      Signature,
    ]),
  ],
  controllers: [
    TesoreriaController,
    EstadisticasTesoreriaController,
  ],
  providers: [
    TesoreriaService,
    TesoreriaSignatureService,
    EncryptionService,
    EstadisticasTesoreriaService,
  ],
  exports: [
    TesoreriaService,
    TypeOrmModule.forFeature([TesoreriaDocumento]),  // ← AGREGAR ESTA LÍNEA
  ],
})


export class TesoreriaModule { }