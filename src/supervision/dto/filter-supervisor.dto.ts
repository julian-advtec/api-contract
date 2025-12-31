import { IsOptional, IsEnum, IsDateString, IsString, IsNumber, IsUUID } from 'class-validator';
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
  @IsUUID()
  supervisorId?: string;

  @IsOptional()
  @IsUUID()
  documentoId?: string;

  @IsOptional()
  @IsString()
  numeroRadicado?: string;

  @IsOptional()
  @IsString()
  nombreContratista?: string;

  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  sortBy?: string = 'fechaCreacion';

  @IsOptional()
  @IsString()
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}