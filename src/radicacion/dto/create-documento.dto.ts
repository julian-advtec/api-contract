// src/radicacion/dto/create-documento.dto.ts
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateDocumentoDto {
    @IsString()
    @Matches(/^R\d{4}-\d{4}$/)
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

    // ✅ CORREGIDO: Transformar string a booleano
    @IsOptional()
    @Transform(({ value }) => {
        // Si ya es booleano, devolverlo directamente
        if (typeof value === 'boolean') return value;
        
        // Si es string, convertirlo
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true' || value === '1';
        }
        
        // Si es número (1/0)
        if (typeof value === 'number') {
            return value === 1;
        }
        
        // Cualquier otro caso, convertir a booleano
        return Boolean(value);
    })
    @IsBoolean({ 
        message: 'primerRadicadoDelAno debe ser un valor booleano (true o false)' 
    })
    primerRadicadoDelAno?: boolean;
}