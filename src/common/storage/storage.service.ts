// src/common/storage/storage.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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

  constructor(private configService: ConfigService) {
    this.isDevelopment = process.env.NODE_ENV === 'development' || 
                         process.env.VSCODE_PID !== undefined ||
                         !process.env.SUPABASE_URL;
    
    this.storageType = this.configService.get('storage.type') || this.detectStorageType();
    this.localPath = this.configService.get('storage.local.basePath') || 
                     process.env.LOCAL_STORAGE_PATH || 
                     'uploads';
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
      this.logger.log(`   Local path: ${this.localPath}`);
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
      this.logger.log(`📁 Ruta: ${this.localPath}`);
    }
  }
  
  private ensureLocalDirectory() {
    try {
      let normalizedPath = this.localPath;
      if (process.platform === 'win32') {
        normalizedPath = this.localPath.replace(/\\\\/g, '\\');
      }
      
      if (!fs.existsSync(normalizedPath)) {
        fs.mkdirSync(normalizedPath, { recursive: true });
        this.logger.log(`📁 Directorio local creado: ${normalizedPath}`);
      } else {
        this.logger.log(`📁 Directorio local existente: ${normalizedPath}`);
      }
    } catch (error) {
      this.logger.error(`❌ Error creando directorio local: ${error.message}`);
      try {
        const altPath = './uploads';
        if (!fs.existsSync(altPath)) {
          fs.mkdirSync(altPath, { recursive: true });
          this.localPath = altPath;
          this.logger.log(`📁 Usando directorio alternativo: ${altPath}`);
        }
      } catch (altError) {
        this.logger.error(`❌ También falló el directorio alternativo: ${altError.message}`);
      }
    }
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
  
  // Método para subir archivo (compatible con la interfaz existente)
  async uploadFile(fileOrBuffer: any, folderPathOrBuffer?: any, fileNameOrMimeType?: any): Promise<any> {
    // Soporte para diferentes formas de llamada:
    // 1. uploadFile(file, folderPath, fileName)
    // 2. uploadFile(filePath, buffer, mimeType)
    // 3. uploadFile(buffer, folderPath, fileName)
    
    let file: any;
    let folderPath: string;
    let fileName: string;
    let mimeType: string = 'application/octet-stream';
    
    // Detectar la forma de llamada
    if (typeof folderPathOrBuffer === 'string' && folderPathOrBuffer.includes('/')) {
      // Forma 1 o 3: uploadFile(file, folderPath, fileName)
      file = fileOrBuffer;
      folderPath = folderPathOrBuffer;
      fileName = fileNameOrMimeType || file.originalname || `file_${Date.now()}`;
      if (file.mimetype) mimeType = file.mimetype;
    } else if (Buffer.isBuffer(fileOrBuffer) && typeof folderPathOrBuffer === 'string') {
      // Forma 2: uploadFile(buffer, folderPath, mimeType)
      file = {
        buffer: fileOrBuffer,
        originalname: fileNameOrMimeType || `file_${Date.now()}`,
        mimetype: folderPathOrBuffer || 'application/octet-stream'
      };
      folderPath = '';
      fileName = file.originalname;
    } else if (typeof fileOrBuffer === 'string' && Buffer.isBuffer(folderPathOrBuffer)) {
      // Forma alternativa: uploadFile(filePath, buffer, mimeType)
      file = {
        buffer: folderPathOrBuffer,
        originalname: path.basename(fileOrBuffer),
        mimetype: fileNameOrMimeType || 'application/octet-stream'
      };
      folderPath = path.dirname(fileOrBuffer);
      fileName = file.originalname;
    } else {
      // Fallback
      file = fileOrBuffer;
      folderPath = folderPathOrBuffer || '';
      fileName = fileNameOrMimeType || file.originalname || `file_${Date.now()}`;
      if (file.mimetype) mimeType = file.mimetype;
    }
    
    const finalFileName = fileName;
    const fullPath = folderPath 
      ? path.join(folderPath, finalFileName).replace(/\\/g, '/')
      : finalFileName;
    
    if (this.storageType === 'supabase' && this.supabaseClient) {
      return this.uploadToSupabase(file, fullPath);
    }
    return this.uploadToLocal(file, fullPath);
  }
  
  // Método para obtener URL pública del archivo (SÍNCRONO)
  getFileUrl(filePath: string): string {
    if (this.storageType === 'supabase' && this.supabaseClient) {
      const { data } = this.supabaseClient
        .storage
        .from(this.supabaseBucket)
        .getPublicUrl(filePath);
      return data.publicUrl;
    }
    // Para local, devolver ruta local
    const fullPath = path.join(this.localPath, filePath);
    return fullPath;
  }
  
  // Método para verificar si está usando Supabase
  isUsingSupabase(): boolean {
    return this.storageType === 'supabase' && this.supabaseClient !== null;
  }
  
  // Método para obtener información del almacenamiento
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
  
  // Método para guardar archivo (alias de uploadFile para compatibilidad)
  async saveFile(file: any, filePath: string): Promise<string> {
    const result = await this.uploadFile(file, path.dirname(filePath), path.basename(filePath));
    return result.path || result;
  }
  
  // Método para obtener archivo como buffer
  async getFile(filePath: string): Promise<Buffer> {
    if (this.storageType === 'supabase' && this.supabaseClient) {
      return this.getFromSupabase(filePath);
    }
    return this.getFromLocal(filePath);
  }
  
  // Método para eliminar archivo
  async deleteFile(filePath: string): Promise<boolean> {
    if (this.storageType === 'supabase' && this.supabaseClient) {
      return this.deleteFromSupabase(filePath);
    }
    return this.deleteFromLocal(filePath);
  }
  
  // Método para verificar si archivo existe
  async fileExists(filePath: string): Promise<boolean> {
    if (this.storageType === 'supabase' && this.supabaseClient) {
      return this.existsInSupabase(filePath);
    }
    return this.existsInLocal(filePath);
  }
  
  // Método para listar archivos en un directorio
  async listFiles(folderPath: string): Promise<string[]> {
    if (this.storageType === 'supabase' && this.supabaseClient) {
      return this.listFromSupabase(folderPath);
    }
    return this.listFromLocal(folderPath);
  }
  
  // Implementaciones locales
  private async uploadToLocal(file: any, filePath: string): Promise<any> {
    const fullPath = path.join(this.localPath, filePath);
    const dir = path.dirname(fullPath);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
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
    
    fs.writeFileSync(fullPath, buffer);
    this.logger.debug(`💾 Archivo guardado localmente: ${fullPath}`);
    
    return {
      success: true,
      path: filePath,
      fullPath: fullPath,
      provider: 'local'
    };
  }
  
  private async getFromLocal(filePath: string): Promise<Buffer> {
    const fullPath = path.join(this.localPath, filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Archivo no encontrado: ${fullPath}`);
    }
    return fs.readFileSync(fullPath);
  }
  
  private async deleteFromLocal(filePath: string): Promise<boolean> {
    const fullPath = path.join(this.localPath, filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      this.logger.debug(`🗑️ Archivo eliminado localmente: ${fullPath}`);
      return true;
    }
    return false;
  }
  
  private async existsInLocal(filePath: string): Promise<boolean> {
    const fullPath = path.join(this.localPath, filePath);
    return fs.existsSync(fullPath);
  }
  
  private async listFromLocal(folderPath: string): Promise<string[]> {
    const fullPath = path.join(this.localPath, folderPath);
    if (!fs.existsSync(fullPath)) {
      return [];
    }
    const files = fs.readdirSync(fullPath);
    return files.map((file: string) => path.join(folderPath, file));
  }
  
  // Implementaciones Supabase
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
    
    this.logger.debug(`☁️ Archivo guardado en Supabase: ${filePath}`);
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
    
    this.logger.debug(`🗑️ Archivo eliminado de Supabase: ${filePath}`);
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
    
    return data.map((file: any) => path.join(folderPath, file.name));
  }
}