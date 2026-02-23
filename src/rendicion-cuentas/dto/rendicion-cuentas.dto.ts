// src/rendicion-cuentas/dto/rendicion-cuentas.dto.ts
import { IsUUID, IsOptional, IsString, IsEnum, IsDateString, IsArray, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { RendicionCuentasEstado } from '../entities/rendicion-cuentas-estado.enum';

export class CreateRendicionCuentasDto {
  @IsUUID()
  documentoId: string;

  @IsOptional()
  @IsUUID()
  responsableId?: string;
}

export class AsignarRendicionCuentasDto {
  @IsUUID()
  responsableId: string;
}

export class IniciarRevisionDto {
  @IsOptional()
  @IsString()
  observacion?: string;
}

export class TomarDecisionDto {
  @IsEnum(RendicionCuentasEstado)
  decision: RendicionCuentasEstado.APROBADO | RendicionCuentasEstado.OBSERVADO | RendicionCuentasEstado.RECHAZADO;

  @IsOptional()
  @IsString()
  observacion?: string;
}

export class CompletarDto {
  @IsOptional()
  @IsString()
  observacion?: string;
}

export class FiltrosRendicionCuentasDto {
  @IsOptional()
  @IsArray()
  @IsEnum(RendicionCuentasEstado, { each: true })
  estados?: RendicionCuentasEstado[];

  @IsOptional()
  @IsUUID()
  responsableId?: string;

  @IsOptional()
  @IsDateString()
  desde?: string;

  @IsOptional()
  @IsDateString()
  hasta?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 100;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}