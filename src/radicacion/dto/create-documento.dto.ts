import { IsString, IsDateString, Matches, IsOptional } from 'class-validator';

export class CreateDocumentoDto {
  @IsString()
  @Matches(/^R\d{4}-\d{3}$/, { message: 'Formato: RAAAA-NNN (ej: R2024-001)' })
  numeroRadicado: string;

  @IsString()
  numeroContrato: string;

  @IsString()
  nombreContratista: string;

  @IsString()
  documentoContratista: string;

  @IsDateString()
  fechaInicio: Date;

  @IsDateString()
  fechaFin: Date;

  @IsOptional()
  @IsString()
  descripcionDoc1?: string;

  @IsOptional()
  @IsString()
  descripcionDoc2?: string;

  @IsOptional()
  @IsString()
  descripcionDoc3?: string;
}