// src/bitacora-sistema/bitacora-sistema.module.ts
import { Module, Global, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BitacoraSistema } from './entities/bitacora-sistema.entity';
import { BitacoraSistemaService } from './bitacora-sistema.service';
import { BitacoraSistemaController } from './bitacora-sistema.controller';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([BitacoraSistema])  // Solo BitacoraSistema
  ],
  controllers: [BitacoraSistemaController],
  providers: [BitacoraSistemaService, Logger],
  exports: [BitacoraSistemaService],
})
export class BitacoraSistemaModule {}