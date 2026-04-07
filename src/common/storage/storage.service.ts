// src/common/storage/storage.service.ts
import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
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

    this.storageType = this.configService.get('storage.type') || this.detectStorageType();

    // ✅ CORREGIDO: Usar la ruta de red correctamente
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

    // En desarrollo, forzar uso de local
    if (this.isDevelopment && this.storageType === 'supabase') {
      this.logger.warn('⚠️ Entorno de desarrollo detectado - Forzando almacenamiento LOCAL');
      this.storageType = 'local';
    }

    this.logger.log(`📦 ======= CONFIGURACIÓN DE ALMACENAMIENTO =======`);
    this.logger.log(`   Tipo: ${this.storageType.toUpperCase()}`);
    this.logger.log(`   Ruta base: ${this.localPath}`);

    if (this.storageType === 'supabase') {
      const supabaseUrl = this.configService.get('storage.supabase.url') || process.env.SUPABASE_URL;
      const supabaseKey = this.configService.get('storage.supabase.key') || process.env.SUPABASE_KEY;

      if (supabaseUrl && supabaseKey) {
        this.supabaseClient = createClient(supabaseUrl, supabaseKey);
        this.logger.log(`   Supabase URL: ✅ Configurada`);
        this.logger.log(`   Supabase Key: ✅ Configurada`);
        this.logger.log(`   Bucket: ${this.supabaseBucket}`);
      } else {
        this.logger.warn('⚠️ Supabase configurado pero faltan credenciales - Cambiando a LOCAL');
        this.storageType = 'local';
      }
    }

    if (this.storageType === 'local') {
      this.ensureLocalDirectory();
    }

    const fallbackEnabled = this.configService.get('storage.local.fallbackToLocal') ||
      process.env.FALLBACK_TO_LOCAL === 'true';
    this.logger.log(`   Fallback: ${fallbackEnabled ? 'Habilitado' : 'Deshabilitado'}`);
    this.logger.log(`==================================================`);
  }

  private detectStorageType(): string {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY && process.env.NODE_ENV === 'production') {
      return 'supabase';
    }
    return 'local';
  }

  async onModuleInit() {
    if (this.storageType === 'supabase') {
      await this.verifySupabaseConnection();
    } else {
      this.logger.log(`💾 Usando almacenamiento LOCAL`);
      this.logger.log(`📁 Ruta base: ${this.localPath}`);
      this.ensureLocalDirectory();
    }
  }

  private ensureLocalDirectory() {
    try {
      let normalizedPath = this.localPath;

      // Normalizar ruta para Windows
      if (process.platform === 'win32') {
        normalizedPath = this.localPath.replace(/\\\\/g, '\\');
      }

      // Crear directorio si no existe
      if (!fs.existsSync(normalizedPath)) {
        fs.mkdirSync(normalizedPath, { recursive: true });
        this.logger.log(`📁 Directorio local creado: ${normalizedPath}`);
      } else {
        this.logger.log(`📁 Directorio local existente: ${normalizedPath}`);
      }

      // Verificar que podemos escribir en él
      const testFile = path.join(normalizedPath, '.write_test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      this.logger.log(`✅ Directorio local tiene permisos de escritura`);

    } catch (error) {
      this.logger.error(`❌ Error creando directorio local: ${error.message}`);
      // Fallback a directorio local alternativo
      const altPath = path.join(process.cwd(), 'uploads');
      try {
        if (!fs.existsSync(altPath)) {
          fs.mkdirSync(altPath, { recursive: true });
        }
        this.localPath = altPath;
        this.logger.log(`📁 Usando directorio alternativo: ${altPath}`);
      } catch (altError) {
        this.logger.error(`❌ También falló el directorio alternativo: ${altError.message}`);
      }
    }
  }

  private getFullPath(relativePath: string): string {
    // Normalizar la ruta relativa
    const normalizedRelative = relativePath.replace(/\//g, path.sep);
    // Unir con la ruta base
    const fullPath = path.join(this.localPath, normalizedRelative);
    return fullPath;
  }

  private async verifySupabaseConnection() {
    try {
      if (this.storageType === 'supabase' && this.supabaseClient) {
        const { data, error } = await this.supabaseClient
          .storage
          .getBucket(this.supabaseBucket);

        if (error) {
          this.logger.error(`❌ Error verificando conexión Supabase: ${error.message}`);
          if (process.env.FALLBACK_TO_LOCAL === 'true') {
            this.logger.warn('⚠️ Fallback a almacenamiento LOCAL');
            this.storageType = 'local';
            this.ensureLocalDirectory();
          }
        } else {
          this.logger.log(`✅ Conexión con Supabase verificada exitosamente`);
        }
      }
    } catch (error) {
      this.logger.error(`❌ Error verificando Supabase: ${error.message}`);
      if (process.env.FALLBACK_TO_LOCAL === 'true') {
        this.logger.warn('⚠️ Fallback a almacenamiento LOCAL');
        this.storageType = 'local';
        this.ensureLocalDirectory();
      }
    }
  }

  // ============================================================
  // MÉTODO PRINCIPAL PARA SUBIR ARCHIVOS (CORREGIDO)
  // ============================================================
  async uploadFile(fileOrBuffer: any, folderPathOrBuffer?: any, fileNameOrMimeType?: any): Promise<any> {
    let file: any;
    let folderPath: string;
    let fileName: string;

    // Detectar la forma de llamada
    if (typeof folderPathOrBuffer === 'string' && (folderPathOrBuffer.includes('/') || folderPathOrBuffer.includes('\\'))) {
      // Forma 1: uploadFile(file, folderPath, fileName)
      file = fileOrBuffer;
      folderPath = folderPathOrBuffer;
      fileName = fileNameOrMimeType || file.originalname || `file_${Date.now()}`;
    } else if (Buffer.isBuffer(fileOrBuffer) && typeof folderPathOrBuffer === 'string') {
      // Forma 2: uploadFile(buffer, folderPath, mimeType)
      file = {
        buffer: fileOrBuffer,
        originalname: fileNameOrMimeType || `file_${Date.now()}`,
        mimetype: folderPathOrBuffer || 'application/octet-stream'
      };
      folderPath = '';
      fileName = file.originalname;
    } else {
      // Forma 3: uploadFile(file, relativePath)
      file = fileOrBuffer;
      folderPath = '';
      fileName = folderPathOrBuffer || file.originalname || `file_${Date.now()}`;
    }

    // Construir la ruta completa relativa
    const relativePath = folderPath
      ? path.join(folderPath, fileName).replace(/\\/g, '/')
      : fileName;

    this.logger.log(`📤 Subiendo archivo a: ${relativePath}`);

    if (this.storageType === 'supabase' && this.supabaseClient) {
      return this.uploadToSupabase(file, relativePath);
    }
    return this.uploadToLocal(file, relativePath);
  }

  // ============================================================
  // IMPLEMENTACIÓN LOCAL (CORREGIDA)
  // ============================================================
  private async uploadToLocal(file: any, filePath: string): Promise<any> {
    try {
      const fullPath = this.getFullPath(filePath);
      const dir = path.dirname(fullPath);

      // Crear directorio si no existe
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.logger.log(`📁 Directorio creado: ${dir}`);
      }

      // Obtener buffer del archivo
      let buffer: Buffer;
      if (file.buffer) {
        buffer = file.buffer;
      } else if (file.path) {
        buffer = fs.readFileSync(file.path);
      } else if (file.data) {
        buffer = Buffer.from(file.data);
      } else if (typeof file === 'string') {
        buffer = fs.readFileSync(file);
      } else {
        throw new Error('Formato de archivo no soportado');
      }

      // Guardar archivo
      fs.writeFileSync(fullPath, buffer);
      this.logger.log(`💾 Archivo guardado localmente: ${fullPath}`);

      return {
        success: true,
        path: filePath,
        fullPath: fullPath,
        provider: 'local',
        size: buffer.length
      };
    } catch (error) {
      this.logger.error(`❌ Error guardando archivo local: ${error.message}`);
      throw error;
    }
  }

  // ============================================================
  // OBTENER ARCHIVO COMO BUFFER
  // ============================================================
  async getFile(filePath: string): Promise<Buffer> {
    if (this.storageType === 'supabase' && this.supabaseClient) {
      return this.getFromSupabase(filePath);
    }
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
    if (this.storageType === 'supabase' && this.supabaseClient) {
      return this.existsInSupabase(filePath);
    }
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
    if (this.storageType === 'supabase' && this.supabaseClient) {
      return this.deleteFromSupabase(filePath);
    }
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
    if (this.storageType === 'supabase' && this.supabaseClient) {
      const { data } = this.supabaseClient
        .storage
        .from(this.supabaseBucket)
        .getPublicUrl(filePath);
      return data.publicUrl;
    }
    // Para local, devolver la ruta completa
    return this.getFullPath(filePath);
  }

  // ============================================================
  // LISTAR ARCHIVOS EN DIRECTORIO
  // ============================================================
  async listFiles(folderPath: string): Promise<string[]> {
    if (this.storageType === 'supabase' && this.supabaseClient) {
      return this.listFromSupabase(folderPath);
    }
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
    return this.storageType === 'supabase' && this.supabaseClient !== null;
  }

  getStorageInfo(): { type: string; path?: string; bucket?: string } {
    if (this.storageType === 'supabase') {
      return {
        type: 'supabase',
        bucket: this.supabaseBucket,
      };
    }
    return {
      type: 'local',
      path: this.localPath,
    };
  }

  async saveFile(file: any, filePath: string): Promise<string> {
    const result = await this.uploadFile(file, path.dirname(filePath), path.basename(filePath));
    return result.path || result;
  }

  // ============================================================
  // IMPLEMENTACIONES SUPABASE
  // ============================================================
  private async uploadToSupabase(file: any, filePath: string): Promise<any> {
    if (!this.supabaseClient) {
      throw new Error('Supabase no configurado');
    }

    let buffer: Buffer;
    if (file.buffer) {
      buffer = file.buffer;
    } else if (file.path) {
      buffer = fs.readFileSync(file.path);
    } else if (file.data) {
      buffer = Buffer.from(file.data);
    } else if (typeof file === 'string') {
      buffer = fs.readFileSync(file);
    } else {
      throw new Error('Formato de archivo no soportado');
    }

    const { data, error } = await this.supabaseClient
      .storage
      .from(this.supabaseBucket)
      .upload(filePath, buffer, {
        contentType: file.mimetype || 'application/octet-stream',
        upsert: true,
      });

    if (error) {
      this.logger.error(`❌ Error subiendo a Supabase: ${error.message}`);
      if (process.env.FALLBACK_TO_LOCAL === 'true') {
        this.logger.warn('⚠️ Fallback a almacenamiento LOCAL');
        return this.uploadToLocal(file, filePath);
      }
      throw error;
    }

    this.logger.log(`☁️ Archivo guardado en Supabase: ${filePath}`);
    return {
      success: true,
      path: data.path,
      publicUrl: this.supabaseClient.storage.from(this.supabaseBucket).getPublicUrl(data.path).data.publicUrl,
      provider: 'supabase'
    };
  }

  private async getFromSupabase(filePath: string): Promise<Buffer> {
    if (!this.supabaseClient) {
      throw new Error('Supabase no configurado');
    }

    const { data, error } = await this.supabaseClient
      .storage
      .from(this.supabaseBucket)
      .download(filePath);

    if (error) {
      this.logger.error(`❌ Error descargando de Supabase: ${error.message}`);
      throw error;
    }

    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async deleteFromSupabase(filePath: string): Promise<boolean> {
    if (!this.supabaseClient) {
      throw new Error('Supabase no configurado');
    }

    const { error } = await this.supabaseClient
      .storage
      .from(this.supabaseBucket)
      .remove([filePath]);

    if (error) {
      this.logger.error(`❌ Error eliminando de Supabase: ${error.message}`);
      return false;
    }

    this.logger.log(`🗑️ Archivo eliminado de Supabase: ${filePath}`);
    return true;
  }

  private async existsInSupabase(filePath: string): Promise<boolean> {
    if (!this.supabaseClient) {
      return false;
    }

    try {
      const { data, error } = await this.supabaseClient
        .storage
        .from(this.supabaseBucket)
        .list(path.dirname(filePath), {
          search: path.basename(filePath),
        });

      if (error) return false;
      return data && data.length > 0;
    } catch (error) {
      return false;
    }
  }

  private async listFromSupabase(folderPath: string): Promise<string[]> {
    if (!this.supabaseClient) {
      return [];
    }

    const { data, error } = await this.supabaseClient
      .storage
      .from(this.supabaseBucket)
      .list(folderPath);

    if (error) {
      this.logger.error(`❌ Error listando archivos en Supabase: ${error.message}`);
      return [];
    }

    return data.map((file: any) => path.join(folderPath, file.name).replace(/\\/g, '/'));
  }
}