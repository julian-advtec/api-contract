// src/auxiliar-auditor/auxiliar-auditor.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuxiliarAuditorController } from './auxiliar-auditor.controller';
import { AuxiliarAuditorService } from './auxiliar-auditor.service';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { StorageService } from '../common/storage/storage.service';
import { JuridicaModule } from '../juridica/juridica.module';
import { StorageModule } from '../common/storage/storage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Documento, User]),
    StorageModule,
    JuridicaModule, 
  ],
  controllers: [AuxiliarAuditorController],
  providers: [AuxiliarAuditorService, StorageService],
  exports: [AuxiliarAuditorService],
})
export class AuxiliarAuditorModule {}