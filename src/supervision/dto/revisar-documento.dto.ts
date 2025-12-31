import { IsString, IsNotEmpty, IsOptional, IsEnum, MinLength, MaxLength } from 'class-validator';
import { SupervisorEstado } from '../entities/supervisor.entity';

export class RevisarDocumentoDto {
  @IsEnum(SupervisorEstado)
  @IsNotEmpty()
  estado: SupervisorEstado;

  @IsString()
  @IsOptional()
  @MinLength(5, { message: 'La observación debe tener al menos 5 caracteres' })
  @MaxLength(1000, { message: 'La observación no puede exceder 1000 caracteres' })
  observacion?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000, { message: 'Las correcciones no pueden exceder 2000 caracteres' })
  correcciones?: string;
}