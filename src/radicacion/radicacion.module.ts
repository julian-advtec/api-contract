// src/radicacion/radicacion.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RadicacionController } from './radicacion.controller';
import { RadicacionService } from './radicacion.service';
import { Documento } from './entities/documento.entity';
import { Contratista } from './entities/contratista.entity';
import { User } from '../users/entities/user.entity';


@Module({
  imports: [
    TypeOrmModule.forFeature([Documento, Contratista, User]),
    
  ],
  controllers: [RadicacionController],
  providers: [RadicacionService],
  exports: [RadicacionService],
})
export class RadicacionModule {}