// src/juridica/dto/create-contrato.dto.ts
import {
  IsString,
  IsNumber,
  IsDate,
  IsEnum,
  IsOptional,
  IsBoolean,
  Min,
  Max,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TipoContrato } from '../entities/contrato.entity';
import { CreateProveedorDto } from './create-proveedor.dto';
import { CreatePolizaDto } from './create-poliza.dto';

export class CreateContratoDto {
  @IsString()
  vigencia: string;

  @IsString()
  numeroContrato: string;

  @IsEnum(TipoContrato)
  tipoContrato: TipoContrato;

  @ValidateNested()
  @Type(() => CreateProveedorDto)
  @IsOptional()
  proveedor?: CreateProveedorDto;

  @IsString()
  @IsOptional()
  proveedorId?: string;

  @IsString()
  objeto: string;

  @IsNumber()
  @Min(0)
  valor: number;

  @IsNumber()
  @Min(1)
  plazoDias: number;

  @IsString()
  @IsOptional()
  cdp?: string;

  @IsString()
  @IsOptional()
  rp?: string;

  @IsDate()
  @Type(() => Date)
  fechaFirma: Date;

  @IsDate()
  @Type(() => Date)
  fechaInicio: Date;

  @IsDate()
  @Type(() => Date)
  fechaTerminacion: Date;

  @IsBoolean()
  @IsOptional()
  seDesembolsaAnticipo?: boolean;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  porcentajeAnticipo?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  valorAnticipo?: number;

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  fechaDesembolsoAnticipo?: Date;

  @IsNumber()
  @Min(0)
  @IsOptional()
  adiciones?: number;

  @IsNumber()
  @Min(0)
  valorTotal: number;

  @IsString()
  @IsOptional()
  supervisor?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePolizaDto)
  @IsOptional()
  polizas?: CreatePolizaDto[];

  @IsString()
  @IsOptional()
  creadoPor?: string;
}