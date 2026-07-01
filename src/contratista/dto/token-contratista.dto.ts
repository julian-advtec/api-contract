// src/contratista/dto/token-contratista.dto.ts
import { IsString, IsNotEmpty, IsEmail, IsOptional } from 'class-validator';

export class EnviarEnlaceContratistaDto {
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class VerificarTokenContratistaDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class TokenContratistaResponseDto {
  token: string;
  expiraEn: Date;
  enlace: string;
  enviadoA: string;
}