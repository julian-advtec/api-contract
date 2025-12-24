// src/modules/supervisor/dto/filter-supervisor.dto.ts
import { IsOptional, IsEnum, IsDateString, IsString } from 'class-validator';
import { SupervisorEstado } from '../entities/supervisor.entity';
import { Type } from 'class-transformer';

export class FilterSupervisorDto {
  @IsOptional()
  @IsEnum(SupervisorEstado)
  estado?: SupervisorEstado;

  @IsOptional()
  @IsDateString()
  fechaInicio?: string;

  @IsOptional()
  @IsDateString()
  fechaFin?: string;

  @IsOptional()
  @IsString()
  supervisorId?: string;

  @IsOptional()
  @IsString()
  radicadorId?: string;

  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 10;
}