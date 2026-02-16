// signatures/signatures.service.ts
import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
    InternalServerErrorException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Signature } from './entities/signature.entity';
import { User } from '../users/entities/user.entity';
import { EncryptionService } from './encryption.service';
import { SignatureResponseDto } from './dto/signature-response.dto';
import { ALLOWED_SIGNATURE_ROLES } from './enums/allowed-signature-roles.enum';

@Injectable()
export class SignaturesService {
    private readonly MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
    private readonly ALLOWED_MIME_TYPES = [
        'image/png',
        'image/jpeg',
        'image/jpg',
        'image/gif',
        'application/pdf'
    ];

    constructor(
        @InjectRepository(Signature)
        private signaturesRepository: Repository<Signature>,
        @InjectRepository(User)
        private usersRepository: Repository<User>,
        private encryptionService: EncryptionService,
    ) { }

    /**
     * Obtiene la firma del usuario
     */
    async getMySignature(userId: string): Promise<SignatureResponseDto | null> {
        try {
            const signature = await this.signaturesRepository.findOne({
                where: { userId }
            });

            return signature ? new SignatureResponseDto(signature) : null;
        } catch (error) {
            console.error('Error getting signature:', error);
            throw new InternalServerErrorException('Error al obtener la firma');
        }
    }

    /**
     * Guarda o actualiza la firma del usuario
     */
    async uploadSignature(
        userId: string,
        file: Express.Multer.File,
        name: string,
    ): Promise<SignatureResponseDto> {
        console.log('📥 uploadSignature llamado con userId:', userId); // 👈 DEBUG
        console.log('📥 file:', file?.originalname);
        console.log('📥 name:', name);

        try {
            // Validar que userId existe
            if (!userId) {
                console.error('❌ userId es null o undefined');
                throw new BadRequestException('ID de usuario no proporcionado');
            }

            // Validar archivo
            if (!file) {
                throw new BadRequestException('No se ha proporcionado ningún archivo');
            }

            // Validar tipo MIME
            if (!this.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
                throw new BadRequestException(
                    'Tipo de archivo no permitido. Usa: PNG, JPG, JPEG, GIF o PDF'
                );
            }

            // Validar tamaño
            if (file.size > this.MAX_FILE_SIZE) {
                throw new BadRequestException('Archivo demasiado grande. Máximo 2MB');
            }

            // Buscar si ya existe una firma
            const existingSignature = await this.signaturesRepository.findOne({
                where: { userId }
            });

            // Encriptar el archivo
            const encryptedJson = this.encryptionService.encryptForDb(file.buffer);
            const type = file.mimetype.includes('pdf') ? 'pdf' : 'image';

            if (existingSignature) {
                // Actualizar firma existente
                existingSignature.name = name;
                existingSignature.type = type;
                existingSignature.encryptedData = encryptedJson;
                existingSignature.mimeType = file.mimetype;
                existingSignature.fileSize = file.size;
                existingSignature.updatedAt = new Date();

                const updated = await this.signaturesRepository.save(existingSignature);
                return new SignatureResponseDto(updated);
            } else {
                // Crear nueva firma
                const newSignature = this.signaturesRepository.create({
                    userId,
                    name,
                    type,
                    encryptedData: encryptedJson,
                    mimeType: file.mimetype,
                    fileSize: file.size
                });

                const saved = await this.signaturesRepository.save(newSignature);
                return new SignatureResponseDto(saved);
            }
        } catch (error) {
            if (error instanceof BadRequestException) {
                console.error('❌ Error en uploadSignature:', error);
                throw error;
            }
            console.error('Error uploading signature:', error);
            throw new InternalServerErrorException('Error al guardar la firma');
        }
    }

    /**
     * Elimina la firma del usuario
     */
    async deleteSignature(userId: string): Promise<void> {
        try {
            const signature = await this.signaturesRepository.findOne({
                where: { userId }
            });

            if (!signature) {
                throw new NotFoundException('No tienes una firma guardada');
            }

            await this.signaturesRepository.remove(signature);
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            console.error('Error deleting signature:', error);
            throw new InternalServerErrorException('Error al eliminar la firma');
        }
    }

    /**
     * Verifica si el usuario tiene firma
     */
    async hasSignature(userId: string): Promise<boolean> {
        const count = await this.signaturesRepository.count({
            where: { userId }
        });
        return count > 0;
    }

    /**
     * Obtiene la firma para firmar documentos
     */
    async getSignatureForSigning(userId: string): Promise<{
        buffer: Buffer;
        mimeType: string;
        type: 'image' | 'pdf';
    }> {
        const signature = await this.signaturesRepository.findOne({
            where: { userId }
        });

        if (!signature) {
            throw new NotFoundException('No tienes una firma guardada');
        }

        const buffer = this.encryptionService.decryptFromDb(signature.encryptedData);

        return {
            buffer,
            mimeType: signature.mimeType,
            type: signature.type
        };
    }

}

