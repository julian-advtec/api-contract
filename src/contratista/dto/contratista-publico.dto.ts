// src/contratista/dto/contratista-publico.dto.ts
import { IsOptional, IsString, IsEmail, MaxLength } from 'class-validator';

export class ActualizarContratistaPublicoDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  representanteLegal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  documentoRepresentante?: string;

  @IsOptional()
  @IsString()
  @MaxLength(15)
  telefono?: string;

  @IsOptional()
  @IsString()
  direccion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  departamento?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  ciudad?: string;

  @IsOptional()
  @IsString()
  tipoContratista?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cargo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  objetivoContrato?: string;
}