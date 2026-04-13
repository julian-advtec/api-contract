// src/common/storage/storage.service.ts
import { Injectable, Logger, OnModuleInit, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private networkPath: string;
  private readonly NETWORK_STORAGE_PATH = '\\\\R2-D2\\api-contract';

  constructor(private configService: ConfigService) {
    // ✅ FORZAR USO DE LA RUTA DE RED
    this.networkPath = this.NETWORK_STORAGE_PATH;
    
    this.logger.log(`📦 ======= CONFIGURACIÓN DE ALMACENAMIENTO =======`);
    this.logger.log(`   Tipo: RED (\\\\R2-D2\\api-contract)`);
    this.logger.log(`   Ruta base: ${this.networkPath}`);
    this.logger.log(`==================================================`);
  }

  async onModuleInit() {
    this.logger.log(`💾 Usando almacenamiento en SERVIDOR DE RED`);
    this.logger.log(`📁 Ruta base: ${this.networkPath}`);
    this.ensureNetworkDirectory();
  }

  private ensureNetworkDirectory() {
    try {
      // Normalizar la ruta UNC para Windows
      let normalizedPath = this.networkPath;
      
      if (process.platform === 'win32') {
        // Asegurar formato UNC correcto
        normalizedPath = this.networkPath.replace(/\\\\/g, '\\');
        if (!normalizedPath.startsWith('\\\\')) {
          normalizedPath = '\\\\' + normalizedPath.replace(/\\/g, '\\');
        }
      }

      this.logger.log(`🔍 Verificando directorio de red: ${normalizedPath}`);

      // Verificar si la ruta de red está accesible
      try {
        // Intentar acceder al servidor
        const serverRoot = normalizedPath.split('\\').slice(0, 3).join('\\');
        fs.accessSync(serverRoot, fs.constants.R_OK);
        this.logger.log(`✅ Servidor de red accesible: ${serverRoot}`);
      } catch (error) {
        this.logger.error(`❌ No se puede acceder al servidor de red: ${error.message}`);
        this.logger.error(`   Verifica que:`);
        this.logger.error(`   1. El servidor R2-D2 esté encendido`);
        this.logger.error(`   2. La carpeta compartida 'api-contract' exista`);
        this.logger.error(`   3. Tengas permisos de lectura/escritura`);
        throw new Error(`Servidor de red no disponible: ${this.networkPath}`);
      }

      // Crear directorio base si no existe
      if (!fs.existsSync(normalizedPath)) {
        this.logger.log(`📁 Creando directorio base en red: ${normalizedPath}`);
        fs.mkdirSync(normalizedPath, { recursive: true });
        this.logger.log(`✅ Directorio base creado: ${normalizedPath}`);
      } else {
        this.logger.log(`✅ Directorio base existe: ${normalizedPath}`);
      }

      // Verificar permisos de escritura
      const testFile = path.join(normalizedPath, `.write_test_${Date.now()}.txt`);
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      this.logger.log(`✅ Permisos de escritura verificados en la red`);

      // Actualizar networkPath con la ruta normalizada
      this.networkPath = normalizedPath;

    } catch (error: any) {
      this.logger.error(`❌ Error CRÍTICO con servidor de red: ${error.message}`);
      throw new Error(`No se puede acceder al servidor de red: ${error.message}`);
    }
  }

  private getFullPath(relativePath: string): string {
    // Normalizar la ruta relativa (usar separadores de Windows)
    const normalizedRelative = relativePath.replace(/\//g, '\\');
    
    // Construir la ruta completa UNC
    let fullPath: string;
    
    if (process.platform === 'win32') {
      fullPath = path.join(this.networkPath, normalizedRelative);
    } else {
      // Para Linux/WSL, usar formato especial
      const networkPathUnix = this.networkPath.replace(/\\\\/g, '/');
      fullPath = path.join(networkPathUnix, normalizedRelative);
    }
    
    this.logger.debug(`   Ruta completa: ${fullPath}`);
    return fullPath;
  }

  // ============================================================
  // ✅ MÉTODO PARA GUARDAR SOLO EN RED
  // ============================================================
  private async saveToNetwork(file: any, folderPath: string, fileName: string): Promise<any> {
    try {
      // Construir la ruta relativa
      let relativePath: string;
      if (folderPath && folderPath.trim() !== '') {
        relativePath = path.join(folderPath, fileName).replace(/\\/g, '/');
      } else {
        relativePath = fileName;
      }

      const fullPath = this.getFullPath(relativePath);
      const dir = path.dirname(fullPath);

      this.logger.log(`💾 Guardando archivo en SERVIDOR DE RED:`);
      this.logger.log(`   Ruta relativa: ${relativePath}`);
      this.logger.log(`   Ruta completa: ${fullPath}`);
      this.logger.log(`   Directorio: ${dir}`);

      // Crear directorio si no existe
      if (!fs.existsSync(dir)) {
        this.logger.log(`📁 Creando directorio en red: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
        this.logger.log(`✅ Directorio creado exitosamente en red`);
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
      if (fs.existsSync(fullPath)) {
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

      this.logger.log(`📤 Subiendo archivo (file object) a: ${path.join(folderPath, fileName)}`);
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

      this.logger.log(`📤 Subiendo archivo (buffer directo) a: ${path.join(folderPath, fileName)}`);
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
  // OBTENER ARCHIVO (SOLO DE RED)
  // ============================================================
  async getFile(filePath: string): Promise<Buffer> {
    const fullPath = this.getFullPath(filePath);
    this.logger.debug(`📥 Buscando archivo en red: ${fullPath}`);

    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException(`Archivo no encontrado en red: ${filePath}`);
    }

    return fs.readFileSync(fullPath);
  }

  // ============================================================
  // VERIFICAR SI ARCHIVO EXISTE (SOLO EN RED)
  // ============================================================
  async fileExists(filePath: string): Promise<boolean> {
    const fullPath = this.getFullPath(filePath);
    return fs.existsSync(fullPath);
  }

  // ============================================================
  // ELIMINAR ARCHIVO (SOLO DE RED)
  // ============================================================
  async deleteFile(filePath: string): Promise<boolean> {
    const fullPath = this.getFullPath(filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      this.logger.log(`🗑️ Archivo eliminado de la red: ${fullPath}`);
      return true;
    }
    this.logger.warn(`⚠️ Archivo no encontrado en red para eliminar: ${fullPath}`);
    return false;
  }

  // ============================================================
  // OBTENER URL PÚBLICA
  // ============================================================
  getFileUrl(filePath: string): string {
    return this.getFullPath(filePath);
  }

  // ============================================================
  // LISTAR ARCHIVOS EN DIRECTORIO
  // ============================================================
  async listFiles(folderPath: string): Promise<string[]> {
    const fullPath = this.getFullPath(folderPath);
    if (!fs.existsSync(fullPath)) {
      return [];
    }

    const result: string[] = [];
    const readDir = (dir: string, basePath: string) => {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullItemPath = path.join(dir, item);
        const relativePath = path.join(basePath, item).replace(/\\/g, '/');
        if (fs.statSync(fullItemPath).isDirectory()) {
          readDir(fullItemPath, relativePath);
        } else {
          result.push(relativePath);
        }
      }
    };

    readDir(fullPath, folderPath);
    return result;
  }

  // ============================================================
  // MÉTODOS DE COMPATIBILIDAD
  // ============================================================
  isUsingSupabase(): boolean {
    return false; // Siempre false, usamos red
  }

  getStorageInfo(): { type: string; path?: string; bucket?: string } {
    return {
      type: 'network',
      path: this.networkPath,
      bucket: undefined // Para compatibilidad con código que espera bucket
    };
  }

  async saveFile(file: any, filePath: string): Promise<string> {
    const result = await this.uploadFile(file, path.dirname(filePath), path.basename(filePath));
    return result.path || result;
  }
}