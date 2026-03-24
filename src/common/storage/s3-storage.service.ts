// src/common/storage/s3-storage.service.ts
import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IStorageService } from './storage.interface';
import { Readable } from 'stream';

@Injectable()
export class S3StorageService implements IStorageService {
  private readonly logger = new Logger(S3StorageService.name);
  private s3Client: any;
  private bucket: string;
  private region: string;

  constructor(private configService: ConfigService) {
    const regionConfig = this.configService.get<string>('storage.s3.region');
    const bucketConfig = this.configService.get<string>('storage.s3.bucket');
    
    // ✅ Validar configuraciones
    if (!regionConfig) {
      throw new Error('AWS_REGION no está configurado en las variables de entorno');
    }
    if (!bucketConfig) {
      throw new Error('AWS_S3_BUCKET no está configurado en las variables de entorno');
    }
    
    this.region = regionConfig;
    this.bucket = bucketConfig;
    
    this.inicializarS3();
  }

  private async inicializarS3(): Promise<void> {
    try {
      // ✅ Importar dinámicamente para evitar errores si no está instalado
      const { S3Client } = await import('@aws-sdk/client-s3');
      
      const accessKeyId = this.configService.get<string>('storage.s3.accessKeyId');
      const secretAccessKey = this.configService.get<string>('storage.s3.secretAccessKey');

      const s3Config: any = {
        region: this.region,
      };

      if (accessKeyId && secretAccessKey) {
        s3Config.credentials = {
          accessKeyId,
          secretAccessKey,
        };
      }

      const endpoint = this.configService.get<string>('storage.s3.endpoint');
      if (endpoint) {
        s3Config.endpoint = endpoint;
        s3Config.forcePathStyle = this.configService.get<boolean>('storage.s3.forcePathStyle');
        this.logger.log(`📡 Usando endpoint S3 personalizado: ${endpoint}`);
      }

      this.s3Client = new S3Client(s3Config);
      this.logger.log(`✅ S3 Client configurado: bucket=${this.bucket}, region=${this.region}`);
    } catch (error) {
      this.logger.error(`❌ Error inicializando S3: ${error.message}`);
      if (process.env.NODE_ENV === 'development') {
        this.logger.warn(`⚠️ Continuando en modo desarrollo, pero S3 puede no funcionar`);
      } else {
        throw new InternalServerErrorException(`Error al inicializar S3: ${error.message}`);
      }
    }
  }

  async uploadFile(params: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    path: string;
    metadata?: Record<string, any>;
  }): Promise<{ url: string; path: string; key: string }> {
    try {
      if (!this.s3Client) {
        await this.inicializarS3();
      }
      
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.path,
        Body: params.buffer,
        ContentType: params.mimeType,
        Metadata: {
          originalName: params.originalName,
          uploadedAt: new Date().toISOString(),
          ...params.metadata,
        },
      });

      await this.s3Client.send(command);
      
      const url = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${params.path}`;

      this.logger.log(`✅ Archivo subido a S3: ${params.path}`);

      return {
        url,
        path: params.path,
        key: params.path,
      };
    } catch (error) {
      this.logger.error(`❌ Error subiendo archivo a S3: ${error.message}`);
      throw new InternalServerErrorException(`Error subiendo archivo a S3: ${error.message}`);
    }
  }

  async downloadFile(params: { path: string }): Promise<Buffer> {
    try {
      if (!this.s3Client) {
        await this.inicializarS3();
      }
      
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: params.path,
      });

      const response = await this.s3Client.send(command);
      const chunks: Buffer[] = [];

      const stream = response.Body as Readable;
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);
      this.logger.log(`✅ Archivo descargado de S3: ${params.path}`);

      return buffer;
    } catch (error) {
      this.logger.error(`❌ Error descargando archivo de S3: ${error.message}`);
      throw new Error(`Error al descargar archivo de S3: ${error.message}`);
    }
  }

  async deleteFile(params: { path: string }): Promise<void> {
    try {
      if (!this.s3Client) {
        await this.inicializarS3();
      }
      
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: params.path,
      });

      await this.s3Client.send(command);
      this.logger.log(`🗑️ Archivo eliminado de S3: ${params.path}`);
    } catch (error) {
      this.logger.error(`❌ Error eliminando archivo de S3: ${error.message}`);
      throw new Error(`Error al eliminar archivo de S3: ${error.message}`);
    }
  }

  async getFileStream(params: { path: string }): Promise<NodeJS.ReadableStream> {
    try {
      if (!this.s3Client) {
        await this.inicializarS3();
      }
      
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: params.path,
      });

      const response = await this.s3Client.send(command);
      return response.Body as Readable;
    } catch (error) {
      this.logger.error(`❌ Error obteniendo stream de S3: ${error.message}`);
      throw new Error(`Error al obtener stream de S3: ${error.message}`);
    }
  }

  async fileExists(params: { path: string }): Promise<boolean> {
    try {
      if (!this.s3Client) {
        await this.inicializarS3();
      }
      
      const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
      
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: params.path,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      this.logger.error(`❌ Error verificando existencia en S3: ${error.message}`);
      return false;
    }
  }

  async getSignedUrl(params: { path: string; expiresIn?: number }): Promise<string> {
    try {
      if (!this.s3Client) {
        await this.inicializarS3();
      }
      
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: params.path,
      });

      const expiresIn = params.expiresIn || 3600;
      const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn });
      
      return signedUrl;
    } catch (error) {
      this.logger.error(`❌ Error generando URL firmada: ${error.message}`);
      throw new Error(`Error al generar URL firmada: ${error.message}`);
    }
  }
}