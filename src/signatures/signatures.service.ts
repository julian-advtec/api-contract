// src/signatures/signatures.service.ts
import {
    Injectable,
    NotFoundException,
    BadRequestException,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Signature } from './entities/signature.entity';
import { User } from '../users/entities/user.entity';
import { EncryptionService } from './encryption.service';
import { SignatureResponseDto } from './dto/signature-response.dto';
import { ALLOWED_SIGNATURE_ROLES } from './enums/allowed-signature-roles.enum';
import { UserRole } from '../users/enums/user-role.enum';

@Injectable()
export class SignaturesService {
    private readonly logger = new Logger(SignaturesService.name);
    private readonly MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
    private readonly ALLOWED_MIME_TYPES = [
        'image/png',
        'image/jpeg',
        'image/jpg',
        'image/gif',
        'application/pdf',
    ];

    constructor(
        @InjectRepository(Signature)
        private signaturesRepository: Repository<Signature>,
        @InjectRepository(User)
        private usersRepository: Repository<User>,
        private encryptionService: EncryptionService,
    ) { }

async getMySignature(userId: string): Promise<SignatureResponseDto | null> {
  const signature = await this.signaturesRepository.findOne({
    where: { userId },
    select: [
      'id',           // ← asegúrate de que esté aquí
      'userId',
      'name',
      'type',
      'mimeType',
      'fileSize',
      'createdAt',
      'updatedAt'
    ]
  });

  return signature ? new SignatureResponseDto(signature) : null;
}

    async uploadSignature(
        userId: string,
        file: Express.Multer.File,
        name: string,
    ): Promise<SignatureResponseDto> {
        this.logger.log(`Subiendo firma → user: ${userId} | archivo: ${file?.originalname || 'sin archivo'}`);

        if (!userId) throw new BadRequestException('ID de usuario obligatorio');
        if (!file) throw new BadRequestException('Archivo de firma obligatorio');
        if (!this.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            throw new BadRequestException('Formato no permitido (PNG, JPG, GIF, PDF)');
        }
        if (file.size > this.MAX_FILE_SIZE) {
            throw new BadRequestException(`Archivo muy grande (máx. 2MB)`);
        }
        if (!name?.trim() || name.trim().length < 3) {
            throw new BadRequestException('Nombre de firma debe tener al menos 3 caracteres');
        }

        try {
            const encryptedJson = this.encryptionService.encryptForDb(file.buffer);
            const type: 'image' | 'pdf' = file.mimetype.includes('pdf') ? 'pdf' : 'image';

            let signature = await this.signaturesRepository.findOne({ where: { userId } });

            if (signature) {
                signature.name = name.trim();
                signature.type = type;
                signature.encryptedData = encryptedJson;
                signature.mimeType = file.mimetype;
                signature.fileSize = file.size;
                signature.updatedAt = new Date();
                signature = await this.signaturesRepository.save(signature);
                this.logger.log(`Firma actualizada → ID: ${signature.id}`);
            } else {
                signature = this.signaturesRepository.create({
                    userId,
                    name: name.trim(),
                    type,
                    encryptedData: encryptedJson,
                    mimeType: file.mimetype,
                    fileSize: file.size,
                });
                signature = await this.signaturesRepository.save(signature);
                this.logger.log(`Nueva firma creada → ID: ${signature.id}`);
            }

            return new SignatureResponseDto(signature);
        } catch (error) {
            this.logger.error(`Error al guardar firma de ${userId}`, error.stack);
            throw error instanceof BadRequestException ? error : new InternalServerErrorException('Fallo al guardar firma');
        }
    }

    async deleteSignature(userId: string): Promise<void> {
        const signature = await this.signaturesRepository.findOne({ where: { userId } });
        if (!signature) {
            throw new NotFoundException('No tienes firma registrada para eliminar');
        }
        await this.signaturesRepository.remove(signature);
        this.logger.log(`Firma eliminada → userId: ${userId}`);
    }

    async hasSignature(userId: string): Promise<boolean> {
        return (await this.signaturesRepository.count({ where: { userId } })) > 0;
    }

    async getSignatureForSigning(userId: string): Promise<{
        buffer: Buffer;
        mimeType: string;
        type: 'image' | 'pdf';
    }> {
        const signature = await this.signaturesRepository.findOne({ where: { userId } });
        if (!signature) throw new NotFoundException('No tienes una firma registrada');

        try {
            const buffer = this.encryptionService.decryptFromDb(signature.encryptedData);
            if (!buffer || buffer.length < 100) {
                throw new InternalServerErrorException('Contenido de firma inválido o corrupto');
            }

            return {
                buffer,
                mimeType: signature.mimeType,
                type: signature.type as 'image' | 'pdf',
            };
        } catch (err) {
            this.logger.error(`Error desencriptando firma de ${userId}`, err);
            throw new InternalServerErrorException('No se pudo preparar la firma para su uso');
        }
    }

    async getSignatureBlob(userId: string): Promise<Buffer> {
        const { buffer } = await this.getSignatureForSigning(userId);
        return buffer;
    }

    canUserHaveSignature(role: string): boolean {
        if (!role) return false;

        // Normalizamos el rol entrante (case-insensitive)
        const normalizedRole = role.trim().toLowerCase();

        // Lista de roles permitidos también normalizados
        const allowedRoles = [
            UserRole.ADMIN,
            UserRole.ASESOR_GERENCIA,
            UserRole.RENDICION_CUENTAS,
            UserRole.TESORERIA
        ].map(r => r.toLowerCase());

        return allowedRoles.includes(normalizedRole);
    }
}