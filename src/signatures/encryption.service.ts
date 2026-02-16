// signatures/encryption.service.ts
import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;
  
  constructor() {
    const masterPassword = process.env.SIGNATURE_ENCRYPTION_KEY || 'signature-default-key-change-in-production';
    this.key = crypto.scryptSync(masterPassword, 'signature-salt', 32);
  }

  encrypt(buffer: Buffer): { iv: string; authTag: string; data: string; algorithm: string } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(buffer),
      cipher.final()
    ]);
    
    const authTag = cipher.getAuthTag();
    
    return {
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      data: encrypted.toString('base64'),
      algorithm: this.algorithm
    };
  }

  decrypt(encryptedData: { iv: string; authTag: string; data: string; algorithm: string }): Buffer {
    const iv = Buffer.from(encryptedData.iv, 'base64');
    const authTag = Buffer.from(encryptedData.authTag, 'base64');
    const encrypted = Buffer.from(encryptedData.data, 'base64');
    
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    return decrypted;
  }

  encryptForDb(buffer: Buffer): string {
    const encrypted = this.encrypt(buffer);
    return JSON.stringify(encrypted);
  }

  decryptFromDb(encryptedJson: string): Buffer {
    const encryptedData = JSON.parse(encryptedJson);
    return this.decrypt(encryptedData);
  }
}