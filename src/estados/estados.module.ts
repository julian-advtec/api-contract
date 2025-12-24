// src/radicacion/estados/estados.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EstadosController } from './estados.controller';
import { EstadosService } from './estados.service';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { RegistroAcceso } from '../radicacion/entities/registro-acceso.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Documento, User, RegistroAcceso]),
  ],
  controllers: [EstadosController],
  providers: [EstadosService],
  exports: [EstadosService],
})
export class EstadosModule {}