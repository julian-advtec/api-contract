import { IsOptional, IsString, MaxLength } from 'class-validator';

export class TomarDocumentoDto {
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'La observación inicial no puede exceder 500 caracteres' })
  observacionInicial?: string;
}