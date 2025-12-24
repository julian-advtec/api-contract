// src/radicacion/dto/devolver-documento.dto.ts
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class DevolverDocumentoDto {
  @IsString()
  @IsNotEmpty()
  motivo: string;

  @IsString()
  @IsNotEmpty()
  instruccionesCorreccion: string;

  @IsString()
  @IsOptional()
  observacion?: string;
}