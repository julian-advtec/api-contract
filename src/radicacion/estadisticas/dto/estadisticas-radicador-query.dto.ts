// src/estadisticas-radicador/dto/estadisticas-radicador-query.dto.ts
import { IsEnum, IsOptional } from 'class-validator';

export enum PeriodoEstadisticas {
  HOY = 'hoy',
  SEMANA = 'semana',
  MES = 'mes',
  TRIMESTRE = 'trimestre',  // ← agrega esto
  ANO = 'ano',
}

export class EstadisticasRadicadorQueryDto {
  @IsOptional()
  @IsEnum(PeriodoEstadisticas)
  periodo?: PeriodoEstadisticas = PeriodoEstadisticas.ANO;
}