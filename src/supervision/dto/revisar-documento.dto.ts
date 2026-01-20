import { IsEnum, IsOptional, IsString, MaxLength, MinLength, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
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
    @Transform(({ value }) => {
        if (value === 'true' || value === true || value === 1 || value === '1') {
            return true;
        }
        if (value === 'false' || value === false || value === 0 || value === '0') {
            return false;
        }
        return value;
    })
    requierePazSalvo?: boolean;

    @IsBoolean()
    @IsOptional()
    @Transform(({ value }) => {
        console.log(`🔄 Transformando esUltimoRadicado:`, {
            valor: value,
            tipo: typeof value,
            valorOriginal: JSON.stringify(value)
        });

        // Aceptar string, boolean o number
        if (value === 'true' || value === true || value === 1 || value === '1') {
            return true;
        }
        if (value === 'false' || value === false || value === 0 || value === '0') {
            return false;
        }

        // Si no se puede convertir, devolver el valor original
        console.warn(`⚠️ No se pudo transformar esUltimoRadicado: ${value}`);
        return value;
    })
    esUltimoRadicado?: boolean;
}