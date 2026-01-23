// src/shared/shared.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RadicacionModule } from '../../radicacion/radicacion.module';
import { SupervisionModule } from '../../supervision/supervisor.module';

@Module({
  imports: [
    forwardRef(() => RadicacionModule),
    forwardRef(() => SupervisionModule),
  ],
  exports: [
    forwardRef(() => RadicacionModule),
    forwardRef(() => SupervisionModule),
  ],
})
export class SharedModule {}