import { IsString, IsNotEmpty, IsOptional, MinLength, MaxLength } from 'class-validator';

export class DevolverDocumentoDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'El motivo debe tener al menos 10 caracteres' })
  @MaxLength(500, { message: 'El motivo no puede exceder 500 caracteres' })
  motivo: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'Las instrucciones deben tener al menos 10 caracteres' })
  @MaxLength(2000, { message: 'Las instrucciones no pueden exceder 2000 caracteres' })
  instruccionesCorreccion: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'La observación no puede exceder 1000 caracteres' })
  observacion?: string;
}