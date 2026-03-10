// src/juridica/dto/create-proveedor.dto.ts
import { IsString, IsEmail, IsOptional, IsBoolean } from 'class-validator';

export class CreateProveedorDto {
  @IsString()
  tipoIdentificacion: string;

  @IsString()
  numeroIdentificacion: string;

  @IsString()
  nombreRazonSocial: string;

  @IsString()
  @IsOptional()
  direccion?: string;

  @IsString()
  @IsOptional()
  telefono?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  contactoNombre?: string;

  @IsString()
  @IsOptional()
  contactoTeléfono?: string;

  @IsEmail()
  @IsOptional()
  contactoEmail?: string;

  @IsBoolean()
  @IsOptional()
  activo?: boolean;
}