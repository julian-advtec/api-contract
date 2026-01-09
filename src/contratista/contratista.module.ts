import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contratista } from './entities/contratista.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contratista]),
  ],
  exports: [
    TypeOrmModule, // ← Esto exporta el Repository<Contratista>
  ],
})
export class ContratistaModule {}