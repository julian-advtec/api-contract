// src/contratista/contratista.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contratista } from './entities/contratista.entity';
import { DocumentoContratista } from './entities/documento-contratista.entity';
import { ContratistaService } from './contratista.service';
import { ContratistasController } from './contratista.controller';
import { StorageModule } from '../common/storage/storage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contratista, DocumentoContratista]),
    StorageModule,
  ],
  controllers: [ContratistasController],
  providers: [ContratistaService],
  exports: [ContratistaService]
})
export class ContratistasModule {}