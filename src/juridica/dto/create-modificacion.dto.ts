// src/juridica/dto/create-modificacion.dto.ts
import { IsString, IsDate, IsEnum, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { TipoModificacion } from '../entities/modificacion-contrato.entity';

export class CreateModificacionDto {
  @IsEnum(TipoModificacion)
  tipoModificacion: TipoModificacion;

  @IsString()
  numeroModificacion: string;

  @IsDate()
  @Type(() => Date)
  fechaModificacion: Date;

  @IsString()
  descripcion: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  valorModificacion?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  diasModificacion?: number;

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  nuevaFechaTerminacion?: Date;

  @IsUUID()
  contratoId: string;

  @IsString()
  @IsOptional()
  solicitadaPor?: string;
}