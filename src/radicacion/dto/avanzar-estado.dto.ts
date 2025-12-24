// src/radicacion/dto/avanzar-estado.dto.ts
import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class AvanzarEstadoDto {
  @IsString()
  @IsNotEmpty()
  estadoSiguiente: string;

  @IsString()
  @IsOptional()
  observacion?: string;

  @IsString()
  @IsOptional()
  correcciones?: string;
}

// src/radicacion/dto/devolver-documento.dto.ts
export class DevolverDocumentoDto {
  @IsString()
  @IsNotEmpty()
  motivo: string;

  @IsString()
  @IsNotEmpty()
  instruccionesCorreccion: string;
}

// src/radicacion/dto/update-documento.dto.ts
export class UpdateDocumentoDto {
  @IsString()
  @IsOptional()
  estado?: string;

  @IsString()
  @IsOptional()
  comentarios?: string;

  @IsString()
  @IsOptional()
  correcciones?: string;
}