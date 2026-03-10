// src/juridica/dto/create-poliza.dto.ts
import { IsString, IsNumber, IsDate, IsEnum, IsOptional, IsBoolean, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { TipoPoliza } from '../entities/poliza.entity';

export class CreatePolizaDto {
  @IsString()
  numeroPoliza: string;

  @IsEnum(TipoPoliza)
  tipoPoliza: TipoPoliza;

  @IsString()
  aseguradora: string;

  @IsNumber()
  @Min(0)
  valorAsegurado: number;

  @IsDate()
  @Type(() => Date)
  fechaExpedicion: Date;

  @IsDate()
  @Type(() => Date)
  fechaVigenciaInicio: Date;

  @IsDate()
  @Type(() => Date)
  fechaVigenciaFin: Date;

  @IsBoolean()
  @IsOptional()
  aprobada?: boolean;

  @IsString()
  @IsOptional()
  observaciones?: string;

  @IsString()
  @IsOptional()
  usuario?: string;
}