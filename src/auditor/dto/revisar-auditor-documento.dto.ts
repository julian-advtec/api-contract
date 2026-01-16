// src/auditor/dto/revisar-auditor-documento.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';
import { AuditorEstado } from '../entities/auditor-documento.entity';

export class RevisarAuditorDocumentoDto {
  @ApiProperty({ 
    enum: AuditorEstado,
    description: 'Estado resultante de la revisión' 
  })
  @IsEnum(AuditorEstado)
  estado: AuditorEstado;

  @ApiProperty({ 
    required: false,
    description: 'Observaciones del auditor' 
  })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiProperty({ 
    required: false,
    description: 'Correcciones necesarias' 
  })
  @IsOptional()
  @IsString()
  correcciones?: string;
}