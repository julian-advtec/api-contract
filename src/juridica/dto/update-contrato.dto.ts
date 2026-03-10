// src/juridica/dto/update-contrato.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateContratoDto } from './create-contrato.dto';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { EstadoContrato } from '../entities/contrato.entity';

export class UpdateContratoDto extends PartialType(CreateContratoDto) {
  @IsEnum(EstadoContrato)
  @IsOptional()
  estado?: EstadoContrato;

  @IsString()
  @IsOptional()
  ultimoUsuario?: string;
}