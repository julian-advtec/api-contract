import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private supabase: SupabaseClient | null = null;
  private useSupabase = false;

  constructor() {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
      try {
        this.supabase = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_KEY,
        );
        this.useSupabase = true;
        this.logger.log('☁️ Supabase activo para almacenamiento');
        this.verificarConexionSupabase();
      } catch (error) {
        this.logger.error(`❌ Error inicializando Supabase: ${error.message}`);
        this.useSupabase = false;
        this.supabase = null;
      }
    } else {
      this.logger.warn('⚠️ No se encontraron credenciales de Supabase. Usando almacenamiento LOCAL');
    }
  }

  private async verificarConexionSupabase(): Promise<void> {
    if (!this.useSupabase || !this.supabase) return;

    try {
      const bucket = process.env.SUPABASE_BUCKET!;
      const { error } = await this.supabase.storage
        .from(bucket)
        .list('', { limit: 1 });

      if (error) {
        this.logger.error(`❌ Error de conexión con Supabase: ${error.message}`);
        if (process.env.FALLBACK_TO_LOCAL === 'true') {
          this.logger.warn('⚠️ Activando fallback a almacenamiento LOCAL');
          this.useSupabase = false;
        } else {
          throw error;
        }
      } else {
        this.logger.log('✅ Conexión con Supabase verificada exitosamente');
      }
    } catch (error) {
      this.logger.error(`❌ Error verificando Supabase: ${error.message}`);
      if (process.env.FALLBACK_TO_LOCAL === 'true') {
        this.logger.warn('⚠️ Activando fallback a almacenamiento LOCAL');
        this.useSupabase = false;
      }
    }
  }

  async uploadFile(
    relativePath: string,
    file: Buffer,
    mimetype: string
  ): Promise<{ path: string; provider: string }> {
    if (this.useSupabase && this.supabase) {
      try {
        this.logger.log(`☁️ Subiendo archivo a Supabase: ${relativePath}`);
        
        const { data, error } = await this.supabase.storage
          .from(process.env.SUPABASE_BUCKET!)
          .upload(relativePath, file, {
            contentType: mimetype,
            upsert: true,
          });

        if (error) {
          this.logger.error(`❌ Error en Supabase upload: ${error.message}`);
          throw error;
        }

        this.logger.log(`✅ Archivo subido a Supabase: ${data.path}`);
        
        const { data: publicUrlData } = this.supabase.storage
          .from(process.env.SUPABASE_BUCKET!)
          .getPublicUrl(relativePath);

        return {
          path: relativePath,
          provider: 'supabase',
        };
      } catch (error) {
        this.logger.error(`❌ Supabase falló: ${error.message}`);

        if (process.env.FALLBACK_TO_LOCAL !== 'true') {
          throw error;
        }
        
        this.logger.warn('⚠️ Activando fallback a almacenamiento LOCAL...');
      }
    }

    const fullPath = this.buildLocalPath(relativePath);
    this.logger.log(`💾 Guardando archivo localmente: ${fullPath}`);

    try {
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(fullPath, file);
      
      this.logger.log(`✅ Archivo guardado localmente: ${fullPath}`);
      
      return {
        path: fullPath,
        provider: 'local',
      };
    } catch (error) {
      this.logger.error(`❌ Error guardando archivo local: ${error.message}`);
      throw error;
    }
  }

  getFileUrl(storedPath: string): string {
    if (this.useSupabase && this.supabase && !storedPath.startsWith('\\\\') && !storedPath.includes(':\\')) {
      try {
        const { data } = this.supabase.storage
          .from(process.env.SUPABASE_BUCKET!)
          .getPublicUrl(storedPath);
        
        this.logger.log(`🔗 URL pública generada: ${data.publicUrl}`);
        return data.publicUrl;
      } catch (error) {
        this.logger.error(`❌ Error generando URL pública: ${error.message}`);
        return storedPath;
      }
    }

    return storedPath;
  }

  async deleteFile(storedPath: string): Promise<boolean> {
    if (this.useSupabase && this.supabase && !storedPath.startsWith('\\\\') && !storedPath.includes(':\\')) {
      try {
        const { error } = await this.supabase.storage
          .from(process.env.SUPABASE_BUCKET!)
          .remove([storedPath]);

        if (error) {
          this.logger.error(`❌ Error eliminando de Supabase: ${error.message}`);
          return false;
        }
        
        this.logger.log(`✅ Archivo eliminado de Supabase: ${storedPath}`);
        return true;
      } catch (error) {
        this.logger.error(`❌ Error eliminando archivo: ${error.message}`);
        return false;
      }
    }
    
    try {
      if (fs.existsSync(storedPath)) {
        fs.unlinkSync(storedPath);
        this.logger.log(`✅ Archivo eliminado localmente: ${storedPath}`);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(`❌ Error eliminando archivo local: ${error.message}`);
      return false;
    }
  }

  async fileExists(storedPath: string): Promise<boolean> {
    if (this.useSupabase && this.supabase && !storedPath.startsWith('\\\\') && !storedPath.includes(':\\')) {
      try {
        const { data, error } = await this.supabase.storage
          .from(process.env.SUPABASE_BUCKET!)
          .list('', { 
            search: storedPath,
            limit: 1 
          });
        
        if (error) return false;
        return data && data.length > 0;
      } catch (error) {
        return false;
      }
    }
    
    try {
      return fs.existsSync(storedPath);
    } catch (error) {
      return false;
    }
  }

  private buildLocalPath(relativePath: string): string {
    const basePath = process.env.LOCAL_STORAGE_PATH || 'uploads';
    const cleanBasePath = basePath.replace(/\\\\/g, '\\');
    return path.join(cleanBasePath, relativePath);
  }

  isUsingSupabase(): boolean {
    return this.useSupabase && this.supabase !== null;
  }

  getStorageInfo(): { type: string; bucket?: string; localPath?: string } {
    if (this.useSupabase) {
      return {
        type: 'supabase',
        bucket: process.env.SUPABASE_BUCKET,
      };
    }
    return {
      type: 'local',
      localPath: process.env.LOCAL_STORAGE_PATH,
    };
  }
}