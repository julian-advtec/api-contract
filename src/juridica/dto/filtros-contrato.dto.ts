// src/juridica/dto/filtros-contrato.dto.ts
import { IsEnum, IsOptional, IsString, IsDate } from 'class-validator';
import { Type } from 'class-transformer';
import { EstadoContrato, TipoContrato } from '../entities/contrato.entity';

export class FiltrosContratoDto {
  @IsString()
  @IsOptional()
  vigencia?: string;

  @IsEnum(TipoContrato)
  @IsOptional()
  tipoContrato?: TipoContrato;

  @IsEnum(EstadoContrato)
  @IsOptional()
  estado?: EstadoContrato;

  @IsString()
  @IsOptional()
  proveedorId?: string;

  @IsString()
  @IsOptional()
  numeroContrato?: string;

  @IsString()
  @IsOptional()
  supervisor?: string;

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  fechaInicioDesde?: Date;

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  fechaInicioHasta?: Date;

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  fechaTerminacionDesde?: Date;

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  fechaTerminacionHasta?: Date;
}