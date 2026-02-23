// dto/estadisticas-query.dto.ts
import { IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export enum PeriodoStats {
  HOY = 'hoy',
  SEMANA = 'semana',
  MES = 'mes',
  TRIMESTRE = 'trimestre'
}

export class EstadisticasQueryDto {
  @IsEnum(PeriodoStats)
  @IsOptional()
  periodo?: PeriodoStats = PeriodoStats.MES;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  soloMios?: boolean = false;
}