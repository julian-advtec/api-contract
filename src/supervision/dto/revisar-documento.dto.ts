import { IsEnum, IsOptional, IsString, MaxLength, MinLength, IsBoolean } from 'class-validator';
import { SupervisorEstado } from '../entities/supervisor.entity';

export class RevisarDocumentoDto {
    @IsEnum(SupervisorEstado)
    estado: SupervisorEstado;

    @IsString()
    @IsOptional()
    @MinLength(10, { message: 'La observación debe tener al menos 10 caracteres' })
    @MaxLength(2000, { message: 'La observación no puede exceder los 2000 caracteres' })
    observacion?: string;

    @IsString()
    @IsOptional()
    @MaxLength(1000, { message: 'Las correcciones no pueden exceder los 1000 caracteres' })
    correcciones?: string;

    @IsBoolean()
    @IsOptional()
    requierePazSalvo?: boolean;
}