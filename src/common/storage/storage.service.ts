// src/common/storage/storage.service.ts

import { Injectable, Logger, OnModuleInit, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  // ✅ IMPORTANTE: 4 barras invertidas para UNC en string literal de JS
  private readonly NETWORK_BASE_PATH = '\\\\R2-D2\\api-contract';
  private basePath: string;

  constructor(private configService: ConfigService) {
    // Usar la ruta UNC directamente
    this.basePath = this.NETWORK_BASE_PATH;
    
    this.logger.log(`📦 ======= CONFIGURACIÓN DE ALMACENAMIENTO =======`);
    this.logger.log(`   Tipo: RED (UNC)`);
    this.logger.log(`   Ruta base: ${this.basePath}`);
    this.logger.log(`==================================================`);
  }

  async onModuleInit() {
    this.logger.log(`💾 Usando almacenamiento en SERVIDOR DE RED`);
    this.logger.log(`📁 Ruta base: ${this.basePath}`);
    await this.ensureNetworkDirectory();
  }

  private async ensureNetworkDirectory() {
    try {
      // ✅ Usar la ruta UNC directamente sin modificar
      const uncPath = this.basePath;
      
      this.logger.log(`🔍 Verificando directorio de red: ${uncPath}`);

      // ✅ Verificar si la ruta UNC existe usando try-catch
      let pathExists = false;
      try {
        // fs.existsSync funciona con rutas UNC en Windows
        pathExists = fs.existsSync(uncPath);
      } catch (err: any) {
        this.logger.warn(`Error verificando ruta: ${err.message}`);
        pathExists = false;
      }

      if (!pathExists) {
        this.logger.log(`📁 Creando directorio base en red: ${uncPath}`);
        try {
          fs.mkdirSync(uncPath, { recursive: true });
          this.logger.log(`✅ Directorio base creado: ${uncPath}`);
        } catch (mkdirErr: any) {
          this.logger.error(`Error creando directorio: ${mkdirErr.message}`);
          // No fallamos, intentamos continuar
        }
      } else {
        this.logger.log(`✅ Directorio base existe: ${uncPath}`);
      }

      // ✅ Verificar permisos de escritura
      const testFilePath = uncPath + `\\.write_test_${Date.now()}.txt`;
      try {
        fs.writeFileSync(testFilePath, 'test');
        fs.unlinkSync(testFilePath);
        this.logger.log(`✅ Permisos de escritura verificados en la red`);
      } catch (permErr: any) {
        this.logger.warn(`⚠️ No se pudieron verificar permisos de escritura: ${permErr.message}`);
      }

    } catch (error: any) {
      this.logger.error(`❌ Error con servidor de red: ${error.message}`);
      // No lanzamos error para que la app pueda continuar
    }
  }

  private getFullPath(relativePath: string): string {
    // Limpiar la ruta relativa - eliminar cualquier prefijo UNC
    let cleanRelative = relativePath;
    
    // Si la ruta relativa comienza con \\, eliminarlo
    if (cleanRelative.startsWith('\\\\')) {
      cleanRelative = cleanRelative.substring(2);
    }
    if (cleanRelative.startsWith('\\')) {
      cleanRelative = cleanRelative.substring(1);
    }
    
    // Reemplazar / con \ para Windows
    cleanRelative = cleanRelative.replace(/\//g, '\\');
    
    // ✅ Construir ruta UNC correctamente - concatenación directa
    const fullPath = this.basePath + '\\' + cleanRelative;
    
    this.logger.debug(`   Ruta completa: ${fullPath}`);
    return fullPath;
  }

  // ============================================================
  // ✅ NUEVO MÉTODO PARA SUBIR ARCHIVO DESDE BUFFER
  // ============================================================
  async uploadFileFromBuffer(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    folderPath: string
  ): Promise<any> {
    try {
      this.logger.log(`📤 Subiendo archivo desde buffer a red:`);
      this.logger.log(`   Carpeta: ${folderPath}`);
      this.logger.log(`   Archivo: ${fileName}`);
      this.logger.log(`   Tamaño: ${buffer.length} bytes`);
      this.logger.log(`   Tipo MIME: ${mimeType}`);

      // Construir el objeto file simulado
      const file = {
        buffer: buffer,
        originalname: fileName,
        mimetype: mimeType
      };

      // Usar el método saveToNetwork existente
      const result = await this.saveToNetwork(file, folderPath, fileName);
      
      this.logger.log(`✅ Archivo subido desde buffer exitosamente`);
      return result;
    } catch (error: any) {
      this.logger.error(`❌ Error subiendo archivo desde buffer: ${error.message}`);
      throw error;
    }
  }

  // ============================================================
  // ✅ MÉTODO PRINCIPAL PARA SUBIR ARCHIVOS
  // ============================================================
  async uploadFile(fileOrBuffer: any, folderPathOrBuffer?: any, fileNameOrMimeType?: any): Promise<any> {
    let file: any;
    let folderPath: string = '';
    let fileName: string = '';

    this.logger.debug(`🔍 uploadFile llamado`);
    this.logger.debug(`   fileOrBuffer type: ${typeof fileOrBuffer}`);

    // ============================================================
    // FORMA 1: uploadFile(relativePath, buffer, mimeType)
    // ============================================================
    if (typeof fileOrBuffer === 'string' && Buffer.isBuffer(folderPathOrBuffer)) {
      const relativePath = fileOrBuffer;
      const buffer = folderPathOrBuffer;
      const mimeType = fileNameOrMimeType || 'application/octet-stream';

      this.logger.log(`📤 Subiendo archivo (buffer) a: ${relativePath}`);
      this.logger.log(`   Buffer size: ${buffer?.length || 0} bytes`);

      // Extraer folderPath y fileName del relativePath
      const normalizedPath = relativePath.replace(/\\/g, '/');
      const lastSlashIndex = normalizedPath.lastIndexOf('/');

      if (lastSlashIndex !== -1) {
        folderPath = normalizedPath.substring(0, lastSlashIndex);
        fileName = normalizedPath.substring(lastSlashIndex + 1);
      } else {
        folderPath = '';
        fileName = normalizedPath;
      }

      file = {
        buffer: buffer,
        originalname: fileName,
        mimetype: mimeType
      };

      return this.saveToNetwork(file, folderPath, fileName);
    }

    // ============================================================
    // FORMA 2: uploadFile(file, folderPath, fileName)
    // ============================================================
    if (fileOrBuffer && typeof fileOrBuffer === 'object' && fileOrBuffer.buffer) {
      file = fileOrBuffer;
      folderPath = typeof folderPathOrBuffer === 'string' ? folderPathOrBuffer : '';
      fileName = fileNameOrMimeType || file.originalname || `file_${Date.now()}`;

      this.logger.log(`📤 Subiendo archivo (file object) a: ${folderPath}/${fileName}`);
      return this.saveToNetwork(file, folderPath, fileName);
    }

    // ============================================================
    // FORMA 3: uploadFile(buffer, folderPath, mimeType)
    // ============================================================
    if (Buffer.isBuffer(fileOrBuffer) && typeof folderPathOrBuffer === 'string') {
      const buffer = fileOrBuffer;
      const mimeType = fileNameOrMimeType || 'application/octet-stream';
      folderPath = folderPathOrBuffer;
      fileName = `file_${Date.now()}`;

      file = {
        buffer: buffer,
        originalname: fileName,
        mimetype: mimeType
      };

      this.logger.log(`📤 Subiendo archivo (buffer directo) a: ${folderPath}/${fileName}`);
      return this.saveToNetwork(file, folderPath, fileName);
    }

    // ============================================================
    // ❌ ERROR: No se reconoció la llamada
    // ============================================================
    this.logger.error(`❌ No se pudo determinar la forma de llamada`);
    throw new BadRequestException(
      `Formato de llamada a uploadFile no reconocido. ` +
      `Esperaba (string, buffer, string) o (file, string, string) o (buffer, string, string)`
    );
  }

  // ============================================================
  // ✅ MÉTODO PARA GUARDAR EN RED
  // ============================================================
  private async saveToNetwork(file: any, folderPath: string, fileName: string): Promise<any> {
    try {
      // Limpiar folderPath - eliminar prefijos UNC
      let cleanFolder = folderPath;
      if (cleanFolder.startsWith('\\\\')) {
        cleanFolder = cleanFolder.substring(2);
      }
      if (cleanFolder.startsWith('\\')) {
        cleanFolder = cleanFolder.substring(1);
      }
      // Eliminar también la ruta base si está presente
      if (cleanFolder.startsWith('R2-D2\\api-contract\\')) {
        cleanFolder = cleanFolder.substring('R2-D2\\api-contract\\'.length);
      }
      
      // Construir la ruta relativa
      let relativePath: string;
      if (cleanFolder && cleanFolder.trim() !== '') {
        relativePath = cleanFolder.replace(/\\/g, '/') + '/' + fileName;
      } else {
        relativePath = fileName;
      }

      const fullPath = this.basePath + '\\' + cleanFolder.replace(/\//g, '\\') + '\\' + fileName;
      const dirPath = this.basePath + '\\' + cleanFolder.replace(/\//g, '\\');

      this.logger.log(`💾 Guardando archivo en SERVIDOR DE RED:`);
      this.logger.log(`   Ruta relativa: ${relativePath}`);
      this.logger.log(`   Ruta completa: ${fullPath}`);
      this.logger.log(`   Directorio: ${dirPath}`);

      // Crear directorio si no existe
      let dirExists = false;
      try {
        dirExists = fs.existsSync(dirPath);
      } catch (err) {
        dirExists = false;
      }

      if (!dirExists) {
        this.logger.log(`📁 Creando directorio en red: ${dirPath}`);
        try {
          fs.mkdirSync(dirPath, { recursive: true });
          this.logger.log(`✅ Directorio creado exitosamente en red`);
        } catch (mkdirErr: any) {
          this.logger.error(`❌ Error creando directorio: ${mkdirErr.message}`);
          throw new Error(`No se pudo crear el directorio en la red: ${mkdirErr.message}`);
        }
      }

      // Obtener buffer del archivo
      let buffer: Buffer;
      if (file.buffer) {
        buffer = file.buffer;
        this.logger.log(`📄 Usando buffer del archivo (${buffer.length} bytes)`);
      } else if (file.path) {
        buffer = fs.readFileSync(file.path);
        this.logger.log(`📄 Leyendo archivo desde: ${file.path}`);
      } else if (file.data) {
        buffer = Buffer.from(file.data);
        this.logger.log(`📄 Usando data del archivo`);
      } else if (typeof file === 'string') {
        buffer = fs.readFileSync(file);
        this.logger.log(`📄 Leyendo archivo desde string path`);
      } else {
        throw new Error('Formato de archivo no soportado: no se pudo obtener buffer');
      }

      // Validar buffer
      if (!buffer || buffer.length === 0) {
        throw new Error('El buffer del archivo está vacío');
      }

      // Guardar archivo SOLO en red
      fs.writeFileSync(fullPath, buffer);
      this.logger.log(`✅ Archivo guardado exitosamente en RED: ${fullPath}`);
      this.logger.log(`   Tamaño: ${buffer.length} bytes`);

      // Verificar que el archivo se guardó correctamente
      let fileExists = false;
      try {
        fileExists = fs.existsSync(fullPath);
      } catch (err) {
        fileExists = false;
      }

      if (fileExists) {
        const stats = fs.statSync(fullPath);
        this.logger.log(`✅ Verificación: archivo existe en red (${stats.size} bytes)`);
      } else {
        this.logger.error(`❌ ERROR: El archivo no existe después de guardarlo en red`);
        throw new Error('El archivo no se guardó correctamente en la red');
      }

      return {
        success: true,
        path: relativePath,
        fullPath: fullPath,
        provider: 'network',
        size: buffer.length,
        fileName: fileName,
        folderPath: folderPath
      };
    } catch (error: any) {
      this.logger.error(`❌ Error guardando archivo en RED: ${error.message}`);
      this.logger.error(`   Stack: ${error.stack}`);
      throw error;
    }
  }

  // ============================================================
  // OBTENER ARCHIVO
  // ============================================================
  async getFile(filePath: string): Promise<Buffer> {
    // Limpiar la ruta
    let cleanPath = filePath;
    if (cleanPath.startsWith('\\\\')) {
      cleanPath = cleanPath.substring(2);
    }
    if (cleanPath.startsWith('R2-D2\\api-contract\\')) {
      cleanPath = cleanPath.substring('R2-D2\\api-contract\\'.length);
    }
    
    const fullPath = this.basePath + '\\' + cleanPath.replace(/\//g, '\\');
    this.logger.debug(`📥 Buscando archivo en red: ${fullPath}`);

    let fileExists = false;
    try {
      fileExists = fs.existsSync(fullPath);
    } catch (err) {
      fileExists = false;
    }

    if (!fileExists) {
      throw new NotFoundException(`Archivo no encontrado en red: ${filePath}`);
    }

    return fs.readFileSync(fullPath);
  }

  // ============================================================
  // VERIFICAR SI ARCHIVO EXISTE
  // ============================================================
  async fileExists(filePath: string): Promise<boolean> {
    let cleanPath = filePath;
    if (cleanPath.startsWith('\\\\')) {
      cleanPath = cleanPath.substring(2);
    }
    if (cleanPath.startsWith('R2-D2\\api-contract\\')) {
      cleanPath = cleanPath.substring('R2-D2\\api-contract\\'.length);
    }
    
    const fullPath = this.basePath + '\\' + cleanPath.replace(/\//g, '\\');
    try {
      return fs.existsSync(fullPath);
    } catch (err) {
      return false;
    }
  }

  // ============================================================
  // ELIMINAR ARCHIVO
  // ============================================================
  async deleteFile(filePath: string): Promise<boolean> {
    let cleanPath = filePath;
    if (cleanPath.startsWith('\\\\')) {
      cleanPath = cleanPath.substring(2);
    }
    if (cleanPath.startsWith('R2-D2\\api-contract\\')) {
      cleanPath = cleanPath.substring('R2-D2\\api-contract\\'.length);
    }
    
    const fullPath = this.basePath + '\\' + cleanPath.replace(/\//g, '\\');
    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        this.logger.log(`🗑️ Archivo eliminado de la red: ${fullPath}`);
        return true;
      }
    } catch (err) {
      this.logger.warn(`⚠️ Error eliminando archivo: ${err.message}`);
    }
    return false;
  }

  // ============================================================
  // OBTENER URL PÚBLICA
  // ============================================================
  getFileUrl(filePath: string): string {
    let cleanPath = filePath;
    if (cleanPath.startsWith('\\\\')) {
      cleanPath = cleanPath.substring(2);
    }
    return this.basePath + '\\' + cleanPath.replace(/\//g, '\\');
  }

  // ============================================================
  // LISTAR ARCHIVOS EN DIRECTORIO
  // ============================================================
  async listFiles(folderPath: string): Promise<string[]> {
    let cleanFolder = folderPath;
    if (cleanFolder.startsWith('\\\\')) {
      cleanFolder = cleanFolder.substring(2);
    }
    
    const fullPath = this.basePath + '\\' + cleanFolder.replace(/\//g, '\\');
    try {
      if (!fs.existsSync(fullPath)) {
        return [];
      }
    } catch (err) {
      return [];
    }

    const result: string[] = [];
    const readDir = (dir: string, basePath: string) => {
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullItemPath = dir + '\\' + item;
          const relativePath = (basePath ? basePath + '/' : '') + item;
          try {
            if (fs.statSync(fullItemPath).isDirectory()) {
              readDir(fullItemPath, relativePath);
            } else {
              result.push(relativePath);
            }
          } catch (err) {
            this.logger.warn(`Error leyendo ${fullItemPath}: ${err.message}`);
          }
        }
      } catch (err) {
        this.logger.warn(`Error leyendo directorio ${dir}: ${err.message}`);
      }
    };

    readDir(fullPath, folderPath);
    return result;
  }

  // ============================================================
  // MÉTODOS DE COMPATIBILIDAD
  // ============================================================
  isUsingSupabase(): boolean {
    return false;
  }

  getStorageInfo(): { type: string; path?: string; bucket?: string } {
    return {
      type: 'network',
      path: this.basePath,
      bucket: undefined
    };
  }

  async saveFile(file: any, filePath: string): Promise<string> {
    const result = await this.uploadFile(file, path.dirname(filePath), path.basename(filePath));
    return result.path || result;
  }
}