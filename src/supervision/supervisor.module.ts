// src/supervisor/supervisor.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupervisorController } from './supervisor.controller';
import { SupervisorService } from './supervisor.service';
import { SupervisorDocumento } from './entities/supervisor.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { AuthModule } from '../auth/auth.module';
import { RadicacionModule } from '../radicacion/radicacion.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SupervisorDocumento,
      Documento,
      User
    ]),
    AuthModule,
    RadicacionModule
  ],
  controllers: [SupervisorController],
  providers: [SupervisorService],
  exports: [SupervisorService]
})
export class SupervisorModule {}