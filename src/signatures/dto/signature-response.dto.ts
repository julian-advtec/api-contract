// signatures/dto/signature-response.dto.ts
import { Signature } from '../entities/signature.entity';

export class SignatureResponseDto {
  id: string;
  name: string;
  type: 'image' | 'pdf';
  mimeType: string;
  fileSize: number;
  createdAt: Date;
  updatedAt: Date;

  constructor(signature: Signature) {
    this.id = signature.id;
    this.name = signature.name;
    this.type = signature.type;
    this.mimeType = signature.mimeType;
    this.fileSize = signature.fileSize;
    this.createdAt = signature.createdAt;
    this.updatedAt = signature.updatedAt;
  }
}