// src/contratista/contratista.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contratista } from './entities/contratista.entity';
import { DocumentoContratista } from './entities/documento-contratista.entity';
import { ContratistaService } from './contratista.service';
import { ContratistasController } from './contratista.controller';
import { StorageModule } from '../common/storage/storage.module';
import { BitacoraSistemaModule } from '../bitacora-sistema/bitacora-sistema.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contratista, DocumentoContratista]),
    StorageModule,
    forwardRef(() => BitacoraSistemaModule),
  ],
  controllers: [ContratistasController],
  providers: [ContratistaService],
  exports: [ContratistaService]
})
export class ContratistasModule {}