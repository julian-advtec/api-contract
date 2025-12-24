// src/supervisor/dto/revisar-documento.dto.ts
import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { SupervisorEstado } from '../entities/supervisor.entity';

export class RevisarDocumentoDto {
  @IsEnum(SupervisorEstado)
  @IsNotEmpty()
  estado: SupervisorEstado;

  @IsString()
  @IsOptional()
  observacion?: string;

  @IsString()
  @IsOptional()
  correcciones?: string;
}