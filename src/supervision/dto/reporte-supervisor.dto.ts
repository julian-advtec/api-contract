import { IsOptional, IsDateString, IsEnum, IsArray, IsUUID } from 'class-validator';
import { SupervisorEstado } from '../entities/supervisor.entity';
import { Type } from 'class-transformer';

export class ReporteSupervisorDto {
  @IsOptional()
  @IsDateString()
  fechaInicio?: string;

  @IsOptional()
  @IsDateString()
  fechaFin?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(SupervisorEstado, { each: true })
  estados?: SupervisorEstado[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  supervisorIds?: string[];

  @IsOptional()
  @Type(() => Boolean)
  exportarExcel?: boolean = false;

  @IsOptional()
  @Type(() => Boolean)
  incluirArchivos?: boolean = false;
}