// src/contratista/contratista.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contratista } from './entities/contratista.entity';
import { DocumentoContratista } from './entities/documento-contratista.entity';
import { ContratistaService } from './contratista.service';
import { ContratistasController } from './contratista.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contratista, DocumentoContratista])
  ],
  controllers: [ContratistasController],
  providers: [ContratistaService],
  exports: [ContratistaService]
})
export class ContratistasModule {}