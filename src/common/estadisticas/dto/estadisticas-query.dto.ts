// src/common/dto/estadisticas-query.dto.ts
import { IsOptional, IsEnum, IsBoolean, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';

export enum PeriodoStats {
  HOY = 'hoy',
  SEMANA = 'semana',
  MES = 'mes',
  TRIMESTRE = 'trimestre',
  ANO = 'ano'
}

export class EstadisticasQueryDto {
  @IsOptional()
  @IsEnum(PeriodoStats, { message: 'Período inválido' })
  periodo?: PeriodoStats = PeriodoStats.MES;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  soloMios?: boolean = false;

  @IsOptional()
  @IsDateString()
  fechaInicio?: string;

  @IsOptional()
  @IsDateString()
  fechaFin?: string;
}