// src/auditor/auditor.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditorController } from './auditor.controller';
import { AuditorService } from './auditor.service';
import { AuditorDocumento } from './entities/auditor-documento.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditorDocumento, Documento, User])
  ],
  controllers: [AuditorController],
  providers: [AuditorService],
  exports: [AuditorService]
})
export class AuditorModule {}