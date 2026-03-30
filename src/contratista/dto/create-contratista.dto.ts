// src/contratista/dto/create-contratista.dto.ts
import { IsOptional, IsString, IsEmail, MaxLength, IsIn } from 'class-validator';

export class CreateContratistaDto {
  @IsString()
  @MaxLength(10)
  tipoDocumento: string;

  @IsString()
  @MaxLength(20)
  documentoIdentidad: string;

  @IsString()
  @MaxLength(200)
  razonSocial: string;

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
  @IsEmail()
  email?: string;

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
  @MaxLength(50)
  tipoContratista?: string;

  @IsOptional()
  @IsIn(['ACTIVO', 'INACTIVO'])
  estado?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  numeroContrato?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cargo?: string;

  @IsOptional()
  @IsString()
  observaciones?: string;
}