// src/radicacion/dto/create-documento.dto.ts
import { IsString, IsNotEmpty, IsOptional, Length, Matches } from 'class-validator';

export class CreateDocumentoDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^R\d{4}-\d{3}$/, { message: 'Formato: RAAAA-NNN (ej: R2024-001)' })
  numeroRadicado: string;

  @IsString()
  @IsNotEmpty()
  numeroContrato: string;

  @IsString()
  @IsNotEmpty()
  nombreContratista: string;

  @IsString()
  @IsNotEmpty()
  documentoContratista: string;

  @IsString()
  @IsNotEmpty()
  fechaInicio: string;

  @IsString()
  @IsNotEmpty()
  fechaFin: string;

  // ACTUALIZADO: Nuevos campos de descripción
  @IsString()
  @IsOptional()
  @Length(0, 200)
  descripcionCuentaCobro?: string;

  @IsString()
  @IsOptional()
  @Length(0, 200)
  descripcionSeguridadSocial?: string;

  @IsString()
  @IsOptional()
  @Length(0, 200)
  descripcionInformeActividades?: string;

  // Nuevo campo de observación
  @IsString()
  @IsOptional()
  observacion?: string;
}