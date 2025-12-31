import { IsEnum, IsOptional, IsString, IsUUID, MinLength, MaxLength, IsNotEmpty } from 'class-validator';
import { SupervisorEstado } from '../entities/supervisor.entity';

export class CreateSupervisorDto {
  @IsUUID()
  @IsNotEmpty()
  documentoId: string;

  @IsUUID()
  @IsOptional()
  supervisorId?: string;

  @IsEnum(SupervisorEstado)
  @IsNotEmpty()
  estado: SupervisorEstado;

  @IsOptional()
  @IsString()
  @MinLength(5, { message: 'La observación debe tener al menos 5 caracteres' })
  @MaxLength(1000, { message: 'La observación no puede exceder 1000 caracteres' })
  observacion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Las correcciones no pueden exceder 2000 caracteres' })
  correcciones?: string;
}