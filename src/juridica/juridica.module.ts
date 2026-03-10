// src/juridica/juridica.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JuridicaController } from './juridica.controller';
import { JuridicaService } from './juridica.service';
import { Contrato } from './entities/contrato.entity';
import { Proveedor } from './entities/proveedor.entity';
import { Poliza } from './entities/poliza.entity';
import { ModificacionContrato } from './entities/modificacion-contrato.entity';
import { DocumentoContrato } from './entities/documento-contrato.entity';
import { Obligacion } from './entities/obligacion.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contrato,
      Proveedor,
      Poliza,
      ModificacionContrato,
      DocumentoContrato,
      Obligacion,
    ]),
  ],
  controllers: [JuridicaController],
  providers: [JuridicaService],
  exports: [JuridicaService],
})
export class JuridicaModule {}