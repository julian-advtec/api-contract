import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContratistasController } from './contratista.controller';
import { ContratistaService } from './contratista.service';
import { Contratista } from './entities/contratista.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Contratista])],
  controllers: [ContratistasController],
  providers: [ContratistaService],
  exports: [ContratistaService]
})
export class ContratistaModule {}