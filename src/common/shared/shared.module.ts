// src/shared/shared.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RadicacionModule } from '../../radicacion/radicacion.module';
import { SupervisorModule } from '../../supervision/supervisor.module';

@Module({
  imports: [
    forwardRef(() => RadicacionModule),
    forwardRef(() => SupervisorModule),
  ],
  exports: [
    forwardRef(() => RadicacionModule),
    forwardRef(() => SupervisorModule),
  ],
})
export class SharedModule {}