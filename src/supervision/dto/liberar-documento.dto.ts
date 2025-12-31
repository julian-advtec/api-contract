import { IsOptional, IsString, MaxLength } from 'class-validator';

export class LiberarDocumentoDto {
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'La observación no puede exceder 500 caracteres' })
  observacion?: string;
}