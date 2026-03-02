import { IsEnum, IsOptional, IsNumberString } from 'class-validator';

export enum PeriodoEstadisticasSupervisor {
  HOY = 'hoy',
  SEMANA = 'semana',
  MES = 'mes',
  TRIMESTRE = 'trimestre',
  ANO = 'ano',
}

export class EstadisticasSupervisorQueryDto {
  @IsOptional()
  @IsEnum(PeriodoEstadisticasSupervisor)
  periodo?: PeriodoEstadisticasSupervisor = PeriodoEstadisticasSupervisor.ANO;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}