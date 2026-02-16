// users/dto/user-with-signature.dto.ts
import { User } from '../../users/entities/user.entity';
import { SignatureResponseDto } from '../../signatures/dto/signature-response.dto';

export class UserWithSignatureDto {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  signature?: SignatureResponseDto | null;

  constructor(user: User) {
    this.id = user.id;
    this.username = user.username;
    this.email = user.email;
    this.fullName = user.fullName;
    this.role = user.role;
    this.isActive = user.isActive;
    this.createdAt = user.createdAt;
    this.signature = user.signature ? new SignatureResponseDto(user.signature) : null;
  }
}