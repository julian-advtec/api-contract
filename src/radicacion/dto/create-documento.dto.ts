// src/radicacion/dto/create-documento.dto.ts
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, IsEmail } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateDocumentoDto {
    @IsString()
    @Matches(/^R\d{4}-\d{4,8}$/, {
        message: 'El número de radicado debe tener formato RAAAA-NNNN (ej: R2025-0001) donde NNNN puede ser de 4 a 8 dígitos'
    })
    numeroRadicado: string;

    @IsString()
    @MaxLength(50)
    numeroContrato: string;

    @IsString()
    @MaxLength(200)
    nombreContratista: string;

    @IsString()
    @MaxLength(50)
    documentoContratista: string;

    // ✅ NUEVOS CAMPOS
    @IsOptional()
    @IsEmail()
    @MaxLength(100)
    emailContratista?: string;

    @IsOptional()
    @IsString()
    @MaxLength(50)
    telefonoContratista?: string;

    @IsString()
    fechaInicio: string;

    @IsString()
    fechaFin: string;

    @IsString()
    @IsOptional()
    @MaxLength(200)
    descripcionCuentaCobro?: string;

    @IsString()
    @IsOptional()
    @MaxLength(200)
    descripcionSeguridadSocial?: string;

    @IsString()
    @IsOptional()
    @MaxLength(200)
    descripcionInformeActividades?: string;

    @IsString()
    @IsOptional()
    @MaxLength(500)
    observacion?: string;

    @IsOptional()
    @Transform(({ value }) => {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true' || value === '1';
        }
        if (typeof value === 'number') {
            return value === 1;
        }
        return Boolean(value);
    })
    @IsBoolean({ 
        message: 'primerRadicadoDelAno debe ser un valor booleano (true o false)' 
    })
    primerRadicadoDelAno?: boolean;
}