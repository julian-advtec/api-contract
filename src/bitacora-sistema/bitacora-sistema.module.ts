// src/bitacora-sistema/bitacora-sistema.module.ts
import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BitacoraSistema } from './entities/bitacora-sistema.entity';
import { BitacoraSistemaService } from './bitacora-sistema.service';
import { BitacoraSistemaController } from './bitacora-sistema.controller';
import { User } from '../users/entities/user.entity';
import { Documento } from '../radicacion/entities/documento.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([BitacoraSistema, User, Documento])
  ],
  providers: [BitacoraSistemaService],
  controllers: [BitacoraSistemaController],
  exports: [BitacoraSistemaService],
})
export class BitacoraSistemaModule {}