// src/juridica/juridica.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JuridicaController } from './juridica.controller';
import { JuridicaService } from './juridica.service';
import { ContratistaService } from '../contratista/contratista.service'; // ✅ Importar
import { Contratista } from '../contratista/entities/contratista.entity'; // ✅ Importar
import { DocumentoContratista } from '../contratista/entities/documento-contratista.entity'; // ✅ Importar
import { Contrato } from './entities/contrato.entity';
import { Proveedor } from './entities/proveedor.entity';
import { Poliza } from './entities/poliza.entity';
import { ModificacionContrato } from './entities/modificacion-contrato.entity';
import { DocumentoContrato } from './entities/documento-contrato.entity';
import { BitacoraSistemaService } from '../bitacora-sistema/bitacora-sistema.service';
import { BitacoraSistema } from '../bitacora-sistema/entities/bitacora-sistema.entity';
import { StorageService } from '../common/storage/storage.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contrato,
      Proveedor,
      Poliza,
      ModificacionContrato,
      DocumentoContrato,
      Contratista, // ✅ Agregar
      DocumentoContratista, // ✅ Agregar
      BitacoraSistema,
    ])
  ],
  controllers: [JuridicaController],
  providers: [
    JuridicaService,
    ContratistaService, // ✅ Agregar
    BitacoraSistemaService,
    StorageService,
  ],
  exports: [JuridicaService],
})
export class JuridicaModule {}