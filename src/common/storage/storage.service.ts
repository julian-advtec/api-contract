// src/common/storage/storage.service.ts

import { Injectable, Logger, OnModuleInit, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly NETWORK_BASE_PATH = '\\\\R2-D2\\api-contract';
  private basePath: string;

  constructor(private configService: ConfigService) {
    this.basePath = this.NETWORK_BASE_PATH;
    this.logger.log(`📦 STORAGE SERVICE INICIALIZADO`);
    this.logger.log(`   Tipo: RED (UNC)`);
    this.logger.log(`   Ruta base: ${this.basePath}`);
  }

  async onModuleInit() {
    await this.ensureNetworkDirectory();
  }

  private async ensureNetworkDirectory() {
    try {
      this.logger.log(`🔍 Verificando directorio de red: ${this.basePath}`);
      let pathExists = false;
      try {
        pathExists = fs.existsSync(this.basePath);
      } catch (err: any) {
        this.logger.warn(`Error verificando ruta: ${err.message}`);
        pathExists = false;
      }

      if (!pathExists) {
        this.logger.log(`📁 Creando directorio base en red: ${this.basePath}`);
        try {
          fs.mkdirSync(this.basePath, { recursive: true });
          this.logger.log(`✅ Directorio base creado`);
        } catch (mkdirErr: any) {
          this.logger.error(`Error creando directorio: ${mkdirErr.message}`);
        }
      } else {
        this.logger.log(`✅ Directorio base existe`);
      }
    } catch (error: any) {
      this.logger.error(`❌ Error con servidor de red: ${error.message}`);
    }
  }

  // ============================================================
  // ✅ LIMPIAR RUTA (ELIMINA DUPLICADOS DE LA RUTA BASE)
  // ============================================================
  private normalizePath(inputPath: string): string {
    if (!inputPath) return '';
    let cleanPath = inputPath;
    const basePattern = /^\\\\R2-D2\\api-contract\\/i;
    if (basePattern.test(cleanPath)) {
      cleanPath = cleanPath.replace(basePattern, '');
    }
    if (cleanPath.startsWith('\\\\')) {
      cleanPath = cleanPath.substring(2);
    }
    if (cleanPath.startsWith('\\')) {
      cleanPath = cleanPath.substring(1);
    }
    if (cleanPath.toLowerCase().startsWith('r2-d2\\api-contract\\')) {
      cleanPath = cleanPath.substring('r2-d2\\api-contract\\'.length);
    }
    cleanPath = cleanPath.replace(/\//g, '\\');
    cleanPath = cleanPath.replace(/\\\\+/g, '\\');
    if (cleanPath.startsWith('\\')) {
      cleanPath = cleanPath.substring(1);
    }
    this.logger.debug(`   normalizePath: "${inputPath}" → "${cleanPath}"`);
    return cleanPath;
  }

  // ============================================================
  // ✅ CONSTRUIR RUTA ABSOLUTA
  // ============================================================
  private buildAbsolutePath(relativePath: string): string {
    const cleanRelative = this.normalizePath(relativePath);
    if (!cleanRelative) {
      return this.basePath;
    }
    let absolutePath = path.join(this.basePath, cleanRelative);
    absolutePath = absolutePath.replace(/\//g, '\\');
    return absolutePath;
  }

  // ============================================================
  // ✅ CREAR DIRECTORIO
  // ============================================================
  private ensureDirectoryExists(dirPath: string): void {
    const absolutePath = this.buildAbsolutePath(dirPath);
    try {
      if (!fs.existsSync(absolutePath)) {
        fs.mkdirSync(absolutePath, { recursive: true });
        this.logger.log(`📁 Directorio creado: ${absolutePath}`);
      }
    } catch (error: any) {
      this.logger.error(`❌ Error creando directorio: ${error.message}`);
      throw new BadRequestException(`No se pudo crear el directorio: ${error.message}`);
    }
  }

  // ============================================================
  // ✅ SUBIR ARCHIVO (con ruta completa)
  // ============================================================
  async uploadFile(relativePath: string, buffer: Buffer, mimeType: string): Promise<any> {
    this.logger.log(`📤 uploadFile`);
    this.logger.log(`   relativePath: ${relativePath}`);
    this.logger.log(`   buffer size: ${buffer?.length || 0} bytes`);

    const normalizedPath = relativePath.replace(/\\/g, '/');
    const lastSlashIndex = normalizedPath.lastIndexOf('/');
    
    let folderPath: string;
    let fileName: string;
    
    if (lastSlashIndex !== -1) {
      folderPath = normalizedPath.substring(0, lastSlashIndex);
      fileName = normalizedPath.substring(lastSlashIndex + 1);
    } else {
      folderPath = '';
      fileName = normalizedPath;
    }

    const cleanFolder = this.normalizePath(folderPath);
    const cleanFileName = this.normalizePath(fileName);
    this.ensureDirectoryExists(cleanFolder);

    const relativePathFinal = cleanFolder ? `${cleanFolder}\\${cleanFileName}` : cleanFileName;
    const absolutePath = this.buildAbsolutePath(relativePathFinal);

    try {
      fs.writeFileSync(absolutePath, buffer);
      this.logger.log(`✅ Archivo guardado: ${absolutePath} (${buffer.length} bytes)`);

      return {
        success: true,
        path: relativePathFinal,
        fullPath: absolutePath,
        fileName: cleanFileName,
        size: buffer.length,
        mimeType: mimeType,
        provider: 'network'
      };
    } catch (error: any) {
      this.logger.error(`❌ Error guardando archivo: ${error.message}`);
      throw new BadRequestException(`Error al guardar archivo: ${error.message}`);
    }
  }

  // ============================================================
  // ✅ SUBIR ARCHIVO DESDE BUFFER (carpeta y nombre separados)
  // ============================================================
  async uploadFileFromBuffer(buffer: Buffer, fileName: string, mimeType: string, folderPath: string): Promise<any> {
    this.logger.log(`📤 uploadFileFromBuffer`);
    this.logger.log(`   folderPath: ${folderPath}`);
    this.logger.log(`   fileName: ${fileName}`);
    this.logger.log(`   buffer size: ${buffer?.length || 0} bytes`);

    const cleanFolder = this.normalizePath(folderPath);
    const cleanFileName = this.normalizePath(fileName);
    this.ensureDirectoryExists(cleanFolder);

    const relativePath = cleanFolder ? `${cleanFolder}\\${cleanFileName}` : cleanFileName;
    const absolutePath = this.buildAbsolutePath(relativePath);

    try {
      fs.writeFileSync(absolutePath, buffer);
      this.logger.log(`✅ Archivo guardado: ${absolutePath} (${buffer.length} bytes)`);

      return {
        success: true,
        path: relativePath,
        fullPath: absolutePath,
        fileName: cleanFileName,
        size: buffer.length,
        mimeType: mimeType,
        provider: 'network'
      };
    } catch (error: any) {
      this.logger.error(`❌ Error guardando archivo: ${error.message}`);
      throw new BadRequestException(`Error al guardar archivo: ${error.message}`);
    }
  }

  // ============================================================
  // ✅ GUARDAR PDF DESDE BUFFER
  // ============================================================
  async savePdfFromBuffer(buffer: Buffer, folderPath: string, fileName: string): Promise<any> {
    return this.uploadFileFromBuffer(buffer, fileName, 'application/pdf', folderPath);
  }

  // ============================================================
  // ✅ OBTENER ARCHIVO
  // ============================================================
  async getFile(filePath: string): Promise<Buffer> {
    const cleanPath = this.normalizePath(filePath);
    const absolutePath = this.buildAbsolutePath(cleanPath);
    if (!fs.existsSync(absolutePath)) {
      throw new NotFoundException(`Archivo no encontrado: ${filePath}`);
    }
    return fs.readFileSync(absolutePath);
  }

  // ============================================================
  // ✅ VERIFICAR SI ARCHIVO EXISTE
  // ============================================================
  async fileExists(filePath: string): Promise<boolean> {
    const cleanPath = this.normalizePath(filePath);
    const absolutePath = this.buildAbsolutePath(cleanPath);
    try {
      return fs.existsSync(absolutePath);
    } catch (err) {
      return false;
    }
  }

  // ============================================================
  // ✅ ELIMINAR ARCHIVO
  // ============================================================
  async deleteFile(filePath: string): Promise<boolean> {
    const cleanPath = this.normalizePath(filePath);
    const absolutePath = this.buildAbsolutePath(cleanPath);
    try {
      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
        return true;
      }
    } catch (error: any) {
      this.logger.warn(`Error eliminando archivo: ${error.message}`);
    }
    return false;
  }

  // ============================================================
  // ✅ OBTENER URL
  // ============================================================
  getFileUrl(filePath: string): string {
    const cleanPath = this.normalizePath(filePath);
    return this.buildAbsolutePath(cleanPath);
  }

  // ============================================================
  // ✅ MÉTODOS DE COMPATIBILIDAD
  // ============================================================
  isUsingSupabase(): boolean {
    return false;
  }

  getStorageInfo(): { type: string; path?: string; bucket?: string } {
    return { type: 'network', path: this.basePath, bucket: undefined };
  }

  async saveFile(file: any, filePath: string): Promise<string> {
    const dirPath = path.dirname(filePath);
    const fileName = path.basename(filePath);
    const result = await this.uploadFileFromBuffer(file.buffer, fileName, file.mimetype, dirPath);
    return result.path;
  }

  async listFiles(folderPath: string): Promise<string[]> {
    const cleanFolder = this.normalizePath(folderPath);
    const absolutePath = this.buildAbsolutePath(cleanFolder);
    try {
      if (!fs.existsSync(absolutePath)) return [];
      const items = fs.readdirSync(absolutePath);
      const result: string[] = [];
      for (const item of items) {
        const fullPath = path.join(absolutePath, item);
        if (fs.statSync(fullPath).isDirectory()) {
          const subFiles = await this.listFiles(path.join(cleanFolder, item));
          result.push(...subFiles);
        } else {
          result.push(path.join(cleanFolder, item).replace(/\\/g, '/'));
        }
      }
      return result;
    } catch (error: any) {
      return [];
    }
  }
}