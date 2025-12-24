// src/modules/supervisor/dto/create-supervisor.dto.ts
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { SupervisorEstado } from '../entities/supervisor.entity';

export class CreateSupervisorDto {
  @IsEnum(SupervisorEstado)
  estado: SupervisorEstado;

  @IsOptional()
  @IsString()
  observacion?: string;
}