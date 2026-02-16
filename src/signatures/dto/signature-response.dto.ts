// signatures/dto/signature-response.dto.ts
import { Signature } from '../entities/signature.entity';

export class SignatureResponseDto {
  id: string;
  userId: string;
  name: string;
  type: 'image' | 'pdf';
  mimeType: string;
  fileSize: number;
  createdAt: Date;
  updatedAt: Date;

  constructor(entity: Signature) {
    this.id = entity.id;
    this.userId = entity.userId;
    this.name = entity.name;
    this.type = entity.type;
    this.mimeType = entity.mimeType;
    this.fileSize = entity.fileSize;
    this.createdAt = entity.createdAt;
    this.updatedAt = entity.updatedAt;
  }
  
}