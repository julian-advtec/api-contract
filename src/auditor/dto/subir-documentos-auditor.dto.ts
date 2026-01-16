// src/auditor/dto/subir-documentos-auditor.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class SubirDocumentosAuditorDto {
  @ApiProperty({ 
    required: false,
    description: 'Observaciones del auditor sobre los documentos subidos' 
  })
  @IsOptional()
  @IsString()
  observaciones?: string;
}