// src/asesor-gerencia/dto/estadisticas-query.dto.ts
import { IsOptional, IsEnum, IsString } from 'class-validator';

export enum PeriodoStats {
  HOY = 'hoy',
  SEMANA = 'semana',
  MES = 'mes',
  TRIMESTRE = 'trimestre'
}

export class EstadisticasQueryDto {
  @IsOptional()
  @IsEnum(PeriodoStats)
  periodo?: PeriodoStats;

  @IsOptional()
  @IsString()
  soloMios?: string;
}