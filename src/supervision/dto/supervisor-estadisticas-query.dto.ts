// src/supervisor/estadisticas/dto/supervisor-estadisticas-query.dto.ts
import { IsOptional, IsNumberString } from 'class-validator';

export class SupervisorEstadisticasQueryDto {
  @IsOptional()
  @IsNumberString()
  limit?: string; // para el historial, opcional
}