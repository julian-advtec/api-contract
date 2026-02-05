import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ContabilidadController } from './contabilidad.controller';
import { ContabilidadService } from './contabilidad.service';
import { ContabilidadDocumento } from './entities/contabilidad-documento.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { AuditorDocumento } from '../auditor/entities/auditor-documento.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ContabilidadDocumento,
      Documento,
      User,
      AuditorDocumento
    ]),
    ConfigModule,
  ],
  controllers: [ContabilidadController],
  providers: [ContabilidadService],
  exports: [ContabilidadService],
})
export class ContabilidadModule {}