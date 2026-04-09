// src/juridica/dto/create-contrato.dto.ts

import { 
  IsString, 
  IsNumber, 
  IsDate, 
  IsOptional, 
  IsBoolean, 
  Min, 
  Max,
  IsUUID,
  IsPositive,
  IsEnum
} from 'class-validator';
import { Type } from 'class-transformer';
import { TipoContrato } from '../entities/contrato.entity';
import { CreateProveedorDto } from './create-proveedor.dto';

export class CreateContratoDto {
  @IsString()
  vigencia: string;

  @IsString()
  numeroContrato: string;

  @IsEnum(TipoContrato)
  tipoContrato: TipoContrato;

  @IsOptional()
  @IsUUID()
  proveedorId?: string;

  @IsOptional()
  proveedor?: CreateProveedorDto;

  @IsString()
  objeto: string;

  @IsNumber()
  @Min(0)
  valor: number;

  @IsNumber()
  @IsPositive()
  plazoDias: number;

  @IsDate()
  @Type(() => Date)
  fechaInicio: Date;

  @IsDate()
  @Type(() => Date)
  fechaTerminacion: Date;

  @IsDate()
  @Type(() => Date)
  fechaFirma: Date;

  @IsOptional()
  @IsString()
  supervisor?: string;

  @IsOptional()
  @IsString()
  cdp?: string;

  @IsOptional()
  @IsString()
  rp?: string;

  @IsOptional()
  @IsBoolean()
  seDesembolsaAnticipo?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  porcentajeAnticipo?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  valorAnticipo?: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  fechaDesembolsoAnticipo?: Date;

  @IsOptional()
  @IsNumber()
  @Min(0)
  adiciones?: number;

  @IsNumber()
  @Min(0)
  valorTotal: number;

  @IsOptional()
  @IsString()
  creadoPor?: string;

  // ✅ No incluir ultimoUsuario aquí - se usa en UpdateContratoDto

  // Pólizas
  @IsOptional()
  @IsBoolean()
  requierePolizas?: boolean;

  @IsOptional()
  @IsString()
  polizaCumplimientoNumero?: string;

  @IsOptional()
  @IsString()
  polizaCumplimientoAseguradora?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  polizaCumplimientoValor?: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  polizaCumplimientoVigenciaDesde?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  polizaCumplimientoVigenciaHasta?: Date;

  @IsOptional()
  @IsBoolean()
  requierePolizaCalidad?: boolean;

  @IsOptional()
  @IsString()
  polizaCalidadNumero?: string;

  @IsOptional()
  @IsString()
  polizaCalidadAseguradora?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  polizaCalidadValor?: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  polizaCalidadVigenciaDesde?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  polizaCalidadVigenciaHasta?: Date;

  @IsOptional()
  @IsBoolean()
  requierePolizaRC?: boolean;

  @IsOptional()
  @IsString()
  polizaRCNumero?: string;

  @IsOptional()
  @IsString()
  polizaRCAseguradora?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  polizaRCValor?: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  polizaRCVigenciaDesde?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  polizaRCVigenciaHasta?: Date;

  @IsOptional()
  polizas?: any[];
}