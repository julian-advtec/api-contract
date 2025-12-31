import { IsOptional, IsDateString, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class EstadisticasSupervisorDto {
  @IsOptional()
  @IsDateString()
  fechaInicio?: string;

  @IsOptional()
  @IsDateString()
  fechaFin?: string;

  @IsOptional()
  @Type(() => Boolean)
  incluirDetalles?: boolean = false;
}