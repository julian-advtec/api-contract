import { IsOptional, IsDateString, IsEnum, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export enum PeriodoStats {
  HOY = 'hoy',
  SEMANA = 'semana',
  MES = 'mes',
  TRIMESTRE = 'trimestre'
}

export class EstadisticasQueryDto {
  @IsOptional()
  @IsEnum(PeriodoStats)
  periodo?: PeriodoStats = PeriodoStats.MES;

  @IsOptional()
  @IsDateString()
  fechaInicio?: string;

  @IsOptional()
  @IsDateString()
  fechaFin?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  soloMios?: boolean;
}