// src/common/storage/storage.service.ts
import { Injectable, Logger, OnModuleInit, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private supabaseClient: any;
  private storageType: string;
  private localPath: string;
  private isDevelopment: boolean;
  private supabaseBucket: string;
  private readonly NETWORK_STORAGE_PATH = '\\\\R2-D2\\api-contract';

  constructor(private configService: ConfigService) {
    this.isDevelopment = process.env.NODE_ENV === 'development' ||
      process.env.VSCODE_PID !== undefined ||
      !process.env.SUPABASE_URL;

    // ✅ FORZAR USO DE ALMACENAMIENTO LOCAL SIEMPRE
    this.storageType = 'local'; // Siempre local

    // ✅ USAR LA RUTA DE RED CORRECTAMENTE
    const configuredPath = this.configService.get('storage.local.basePath') ||
      process.env.LOCAL_STORAGE_PATH ||
      this.NETWORK_STORAGE_PATH;

    // Normalizar la ruta de red para Windows
    if (process.platform === 'win32') {
      this.localPath = configuredPath.replace(/\\\\/g, '\\');
    } else {
      this.localPath = configuredPath;
    }

    this.supabaseBucket = this.configService.get('storage.supabase.bucket') ||
      process.env.SUPABASE_BUCKET ||
      'documentos';

    this.logger.log(`📦 ======= CONFIGURACIÓN DE ALMACENAMIENTO =======`);
    this.logger.log(`   Tipo: LOCAL (forzado)`);
    this.logger.log(`   Ruta base: ${this.localPath}`);
    this.logger.log(`   Entorno: ${this.isDevelopment ? 'DESARROLLO' : 'PRODUCCIÓN'}`);
    this.logger.log(`==================================================`);

    // Asegurar que el directorio local existe
    this.ensureLocalDirectory();
  }

  private detectStorageType(): string {
    // ✅ SIEMPRE RETORNAR 'local'
    return 'local';
  }

  async onModuleInit() {
    this.logger.log(`💾 Usando almacenamiento LOCAL (SIEMPRE)`);
    this.logger.log(`📁 Ruta base: ${this.localPath}`);
    this.ensureLocalDirectory();
  }

  private ensureLocalDirectory() {
    try {
      let normalizedPath = this.localPath;

      // Normalizar ruta para Windows
      if (process.platform === 'win32') {
        normalizedPath = this.localPath.replace(/\\\\/g, '\\');
      }

      this.logger.log(`🔍 Verificando directorio: ${normalizedPath}`);

      // Verificar si la ruta de red está accesible
      const isNetworkPath = normalizedPath.startsWith('\\\\');

      if (isNetworkPath) {
        this.logger.log(`🌐 Es una ruta de red: ${normalizedPath}`);
        // Intentar acceder a la ruta de red
        try {
          fs.accessSync(path.dirname(normalizedPath), fs.constants.R_OK);
          this.logger.log(`✅ Ruta de red accesible`);
        } catch (error) {
          this.logger.warn(`⚠️ Ruta de red no accesible: ${error.message}`);
          if (this.isDevelopment) {
            // En desarrollo, usar ruta local como fallback
            const fallbackPath = path.join(process.cwd(), 'uploads-dev');
            this.logger.warn(`📁 Usando fallback local en desarrollo: ${fallbackPath}`);
            normalizedPath = fallbackPath;
            this.localPath = fallbackPath;
          }
        }
      }

      // Crear directorio si no existe
      if (!fs.existsSync(normalizedPath)) {
        this.logger.log(`📁 Creando directorio: ${normalizedPath}`);
        fs.mkdirSync(normalizedPath, { recursive: true });
        this.logger.log(`✅ Directorio creado: ${normalizedPath}`);
      } else {
        this.logger.log(`✅ Directorio existente: ${normalizedPath}`);
      }

      // Verificar permisos de escritura
      const testFile = path.join(normalizedPath, `.write_test_${Date.now()}.txt`);
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      this.logger.log(`✅ Directorio tiene permisos de escritura`);

    } catch (error: any) {
      this.logger.error(`❌ Error con directorio: ${error.message}`);

      // Fallback a directorio local alternativo
      const altPath = path.join(process.cwd(), 'uploads');
      try {
        if (!fs.existsSync(altPath)) {
          fs.mkdirSync(altPath, { recursive: true });
        }
        this.localPath = altPath;
        this.logger.log(`📁 Usando directorio alternativo: ${altPath}`);
      } catch (altError: any) {
        this.logger.error(`❌ También falló el directorio alternativo: ${altError.message}`);
        throw new Error(`No se pudo establecer el directorio de almacenamiento: ${error.message}`);
      }
    }
  }

  private getFullPath(relativePath: string): string {
    // Normalizar la ruta relativa (usar separadores de Windows)
    const normalizedRelative = relativePath.replace(/\//g, path.sep);
    // Unir con la ruta base
    const fullPath = path.join(this.localPath, normalizedRelative);
    return fullPath;
  }

  async uploadFile(fileOrBuffer: any, folderPathOrBuffer?: any, fileNameOrMimeType?: any): Promise<any> {
    let file: any;
    let folderPath: string = '';
    let fileName: string = '';

    this.logger.debug(`🔍 uploadFile llamado con:`);
    this.logger.debug(`   fileOrBuffer type: ${typeof fileOrBuffer}`);
    this.logger.debug(`   fileOrBuffer constructor: ${fileOrBuffer?.constructor?.name}`);
    this.logger.debug(`   folderPathOrBuffer type: ${typeof folderPathOrBuffer}`);
    this.logger.debug(`   fileNameOrMimeType type: ${typeof fileNameOrMimeType}`);

    // ============================================================
    // ✅ FORMA 1: uploadFile(relativePath, buffer, mimeType)
    // Esta es la forma que usa radicacion.service.ts
    // ============================================================
    if (typeof fileOrBuffer === 'string' && Buffer.isBuffer(folderPathOrBuffer)) {
      // fileOrBuffer = ruta relativa (string)
      // folderPathOrBuffer = buffer del archivo
      // fileNameOrMimeType = mimeType

      const relativePath = fileOrBuffer;  // ← Este es el fileRelativePath completo
      const buffer = folderPathOrBuffer;
      const mimeType = fileNameOrMimeType || 'application/octet-stream';

      this.logger.log(`📤 Subiendo archivo (buffer) a: ${relativePath}`);
      this.logger.log(`   Buffer size: ${buffer?.length || 0} bytes`);
      this.logger.log(`   MimeType: ${mimeType}`);

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

      // Crear objeto file simulado
      file = {
        buffer: buffer,
        originalname: fileName,
        mimetype: mimeType
      };

      return this.saveToLocal(file, folderPath, fileName);
    }

    // ============================================================
    // ✅ FORMA 2: uploadFile(file, folderPath, fileName)
    // ============================================================
    if (fileOrBuffer && typeof fileOrBuffer === 'object' && (fileOrBuffer.buffer || fileOrBuffer.path)) {
      file = fileOrBuffer;
      folderPath = typeof folderPathOrBuffer === 'string' ? folderPathOrBuffer : '';
      fileName = fileNameOrMimeType || file.originalname || `file_${Date.now()}`;

      this.logger.log(`📤 Subiendo archivo (file object) a: ${path.join(folderPath, fileName)}`);
      return this.saveToLocal(file, folderPath, fileName);
    }

    // ============================================================
    // ✅ FORMA 3: uploadFile(buffer, folderPath, mimeType)
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
      return this.saveToLocal(file, folderPath, fileName);
    }

    // ============================================================
    // ❌ Si llegamos aquí, no se reconoció la llamada
    // ============================================================
    this.logger.error(`❌ No se pudo determinar la forma de llamada`);
    this.logger.error(`   fileOrBuffer: ${typeof fileOrBuffer} = ${JSON.stringify(fileOrBuffer)?.substring(0, 100)}`);
    this.logger.error(`   folderPathOrBuffer: ${typeof folderPathOrBuffer}`);
    this.logger.error(`   fileNameOrMimeType: ${typeof fileNameOrMimeType}`);

    throw new BadRequestException(
      `Formato de llamada a uploadFile no reconocido. ` +
      `Esperaba (string, buffer, string) o (file, string, string) o (buffer, string, string)`
    );
  }

  // ============================================================
  // ✅ MÉTODO PARA GUARDAR LOCALMENTE
  // ============================================================
  private async saveToLocal(file: any, folderPath: string, fileName: string): Promise<any> {
    try {
      // Construir la ruta completa
      let relativePath: string;
      if (folderPath && folderPath.trim() !== '') {
        relativePath = path.join(folderPath, fileName).replace(/\\/g, '/');
      } else {
        relativePath = fileName;
      }

      const fullPath = this.getFullPath(relativePath);
      const dir = path.dirname(fullPath);

      this.logger.log(`💾 Guardando archivo localmente:`);
      this.logger.log(`   Ruta relativa: ${relativePath}`);
      this.logger.log(`   Ruta completa: ${fullPath}`);
      this.logger.log(`   Directorio: ${dir}`);

      // Crear directorio si no existe
      if (!fs.existsSync(dir)) {
        this.logger.log(`📁 Creando directorio: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
        this.logger.log(`✅ Directorio creado exitosamente`);
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

      // Guardar archivo
      fs.writeFileSync(fullPath, buffer);
      this.logger.log(`✅ Archivo guardado exitosamente: ${fullPath}`);
      this.logger.log(`   Tamaño: ${buffer.length} bytes`);

      // Verificar que el archivo se guardó correctamente
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        this.logger.log(`✅ Verificación: archivo existe (${stats.size} bytes)`);
      } else {
        this.logger.error(`❌ ERROR: El archivo no existe después de guardarlo`);
        throw new Error('El archivo no se guardó correctamente');
      }

      return {
        success: true,
        path: relativePath,
        fullPath: fullPath,
        provider: 'local',
        size: buffer.length,
        fileName: fileName,
        folderPath: folderPath
      };
    } catch (error: any) {
      this.logger.error(`❌ Error guardando archivo local: ${error.message}`);
      this.logger.error(`   Stack: ${error.stack}`);
      throw error;
    }
  }

  // ============================================================
  // OBTENER ARCHIVO COMO BUFFER
  // ============================================================
  async getFile(filePath: string): Promise<Buffer> {
    // Siempre local
    return this.getFromLocal(filePath);
  }

  private async getFromLocal(filePath: string): Promise<Buffer> {
    const fullPath = this.getFullPath(filePath);
    this.logger.debug(`📥 Buscando archivo local: ${fullPath}`);

    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException(`Archivo no encontrado: ${filePath}`);
    }

    return fs.readFileSync(fullPath);
  }

  // ============================================================
  // VERIFICAR SI ARCHIVO EXISTE
  // ============================================================
  async fileExists(filePath: string): Promise<boolean> {
    return this.existsInLocal(filePath);
  }

  private existsInLocal(filePath: string): boolean {
    const fullPath = this.getFullPath(filePath);
    return fs.existsSync(fullPath);
  }

  // ============================================================
  // ELIMINAR ARCHIVO
  // ============================================================
  async deleteFile(filePath: string): Promise<boolean> {
    return this.deleteFromLocal(filePath);
  }

  private async deleteFromLocal(filePath: string): Promise<boolean> {
    const fullPath = this.getFullPath(filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      this.logger.log(`🗑️ Archivo eliminado localmente: ${fullPath}`);
      return true;
    }
    this.logger.warn(`⚠️ Archivo no encontrado para eliminar: ${fullPath}`);
    return false;
  }

  // ============================================================
  // OBTENER URL PÚBLICA
  // ============================================================
  getFileUrl(filePath: string): string {
    // Para local, devolver la ruta completa
    return this.getFullPath(filePath);
  }

  // ============================================================
  // LISTAR ARCHIVOS EN DIRECTORIO
  // ============================================================
  async listFiles(folderPath: string): Promise<string[]> {
    return this.listFromLocal(folderPath);
  }

  private async listFromLocal(folderPath: string): Promise<string[]> {
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
    return false; // Siempre false, usamos local
  }

  getStorageInfo(): { type: string; path?: string; bucket?: string } {
    return {
      type: 'local',
      path: this.localPath,
    };
  }

  async saveFile(file: any, filePath: string): Promise<string> {
    const result = await this.uploadFile(file, path.dirname(filePath), path.basename(filePath));
    return result.path || result;
  }
}