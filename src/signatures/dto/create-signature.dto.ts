// signatures/dto/create-signature.dto.ts
import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

export class CreateSignatureDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la firma es requerido' })
  @MinLength(3, { message: 'El nombre debe tener al menos 3 caracteres' })
  @MaxLength(100, { message: 'El nombre no puede exceder 100 caracteres' })
  name: string;
}