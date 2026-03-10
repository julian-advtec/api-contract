// src/juridica/dto/cambiar-estado.dto.ts
import { IsEnum, IsString, IsOptional } from 'class-validator';
import { EstadoContrato } from '../entities/contrato.entity';

export class CambiarEstadoDto {
  @IsEnum(EstadoContrato)
  estado: EstadoContrato;

  @IsString()
  @IsOptional()
  observacion?: string;

  @IsString()
  @IsOptional()
  justificacion?: string;

  @IsString()
  @IsOptional()
  usuario?: string;
}