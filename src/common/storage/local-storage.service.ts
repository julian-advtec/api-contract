// src/common/storage/local-storage.service.ts
import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { IStorageService } from './storage.interface';

@Injectable()
export class LocalStorageService implements IStorageService {
  private readonly logger = new Logger(LocalStorageService.name);
  private basePath: string;

  constructor(private configService: ConfigService) {
    const basePathConfig = this.configService.get<string>('storage.local.basePath');
    // ✅ Validar que basePathConfig no sea undefined
    if (!basePathConfig) {
      throw new Error('LOCAL_STORAGE_PATH no está configurado en las variables de entorno');
    }
    this.basePath = basePathConfig;
    this.verificarYConfigurarRuta();
  }

  private verificarYConfigurarRuta(): void {
    try {
      this.logger.log(`📁 ======= CONFIGURACIÓN RUTA LOCAL =======`);
      this.logger.log(`🌐 Ruta configurada: ${this.basePath}`);
      
      // Probar diferentes formatos de ruta para Windows
      const rutasAProbar = [
        this.basePath,
        this.basePath.replace(/\\\\/g, '\\\\\\\\'),
        this.basePath.replace(/\\\\/g, '//'),
        this.basePath.replace(/\\/g, '/'),
      ];

      let rutaFuncional = null;

      for (const rutaTest of rutasAProbar) {
        try {
          this.logger.log(`🔍 Probando ruta: ${rutaTest}`);
          
          if (fs.existsSync(rutaTest)) {
            rutaFuncional = rutaTest;
            this.logger.log(`✅ Ruta accesible: ${rutaTest}`);
            break;
          } else {
            // Intentar crear el directorio si no existe
            try {
              fs.mkdirSync(rutaTest, { recursive: true });
              if (fs.existsSync(rutaTest)) {
                rutaFuncional = rutaTest;
                this.logger.log(`✅ Directorio creado y accesible: ${rutaTest}`);
                break;
              }
            } catch (mkdirError) {
              this.logger.warn(`⚠️ No se pudo crear directorio: ${mkdirError.message}`);
            }
          }
        } catch (error) {
          this.logger.warn(`⚠️ Error accediendo a ruta ${rutaTest}: ${error.message}`);
        }
      }

      if (rutaFuncional) {
        this.basePath = rutaFuncional;
        this.verificarPermisosEscritura();
      } else {
        this.logger.error(`❌ No se pudo acceder a ninguna ruta del servidor local`);
        
        if (process.env.NODE_ENV === 'development') {
          const rutaLocal = path.join(process.cwd(), 'uploads-local');
          this.basePath = rutaLocal;
          this.logger.warn(`⚠️ EN DESARROLLO: Usando ruta local: ${this.basePath}`);
          
          if (!fs.existsSync(this.basePath)) {
            fs.mkdirSync(this.basePath, { recursive: true });
            this.logger.log(`✅ Carpeta local creada en: ${this.basePath}`);
          }
          this.verificarPermisosEscritura();
        } else {
          throw new InternalServerErrorException(
            `No se puede acceder al servidor de archivos local en: ${this.basePath}. Verifique la ruta y permisos.`
          );
        }
      }
    } catch (error) {
      this.logger.error(`❌ Error configurando ruta local: ${error.message}`);
      throw error;
    }
  }

  private verificarPermisosEscritura(): void {
    try {
      const testFile = path.join(this.basePath, 'test-escritura-' + Date.now() + '.txt');
      const testContent = `Test de escritura: ${new Date().toISOString()}\n`;

      fs.writeFileSync(testFile, testContent, 'utf8');
      this.logger.log(`✅ Permisos de escritura OK`);

      const contenidoLeido = fs.readFileSync(testFile, 'utf8');
      if (contenidoLeido === testContent) {
        this.logger.log(`✅ Permisos de lectura OK`);
      }

      fs.unlinkSync(testFile);
      this.logger.log(`✅ Archivo de test eliminado correctamente`);
      
      this.logger.log(`✅ Ruta de almacenamiento local configurada: ${this.basePath}`);
    } catch (error) {
      this.logger.error(`❌ Error verificando permisos: ${error.message}`);
      throw new Error(`No hay permisos de lectura/escritura en el servidor local: ${error.message}`);
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
      // Normalizar la ruta para el sistema de archivos
      const normalizedPath = params.path.replace(/\//g, path.sep);
      const fullPath = path.join(this.basePath, normalizedPath);
      const dir = path.dirname(fullPath);

      // Crear directorio si no existe
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.logger.log(`📁 Directorio creado: ${dir}`);
      }

      // Guardar archivo
      fs.writeFileSync(fullPath, params.buffer);
      
      // Verificar que se guardó correctamente
      if (!fs.existsSync(fullPath)) {
        throw new Error(`No se pudo guardar el archivo: ${fullPath}`);
      }

      this.logger.log(`✅ Archivo guardado localmente: ${fullPath} (${params.buffer.length} bytes)`);

      return {
        url: fullPath,
        path: params.path,
        key: params.path,
      };
    } catch (error) {
      this.logger.error(`❌ Error guardando archivo localmente: ${error.message}`);
      throw new InternalServerErrorException(`Error al guardar archivo: ${error.message}`);
    }
  }

  async downloadFile(params: { path: string }): Promise<Buffer> {
    try {
      const normalizedPath = params.path.replace(/\//g, path.sep);
      const fullPath = path.join(this.basePath, normalizedPath);
      
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Archivo no encontrado: ${fullPath}`);
      }
      
      const buffer = fs.readFileSync(fullPath);
      this.logger.log(`✅ Archivo descargado: ${fullPath} (${buffer.length} bytes)`);
      
      return buffer;
    } catch (error) {
      this.logger.error(`❌ Error descargando archivo local: ${error.message}`);
      throw new Error(`Error al descargar archivo: ${error.message}`);
    }
  }

  async deleteFile(params: { path: string }): Promise<void> {
    try {
      const normalizedPath = params.path.replace(/\//g, path.sep);
      const fullPath = path.join(this.basePath, normalizedPath);
      
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        this.logger.log(`🗑️ Archivo eliminado localmente: ${fullPath}`);
      } else {
        this.logger.warn(`⚠️ Archivo no encontrado para eliminar: ${fullPath}`);
      }
    } catch (error) {
      this.logger.error(`❌ Error eliminando archivo local: ${error.message}`);
      throw new Error(`Error al eliminar archivo: ${error.message}`);
    }
  }

  async getFileStream(params: { path: string }): Promise<NodeJS.ReadableStream> {
    try {
      const normalizedPath = params.path.replace(/\//g, path.sep);
      const fullPath = path.join(this.basePath, normalizedPath);
      
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Archivo no encontrado: ${fullPath}`);
      }
      
      return fs.createReadStream(fullPath);
    } catch (error) {
      this.logger.error(`❌ Error obteniendo stream de archivo local: ${error.message}`);
      throw new Error(`Error al obtener stream: ${error.message}`);
    }
  }

  async fileExists(params: { path: string }): Promise<boolean> {
    try {
      const normalizedPath = params.path.replace(/\//g, path.sep);
      const fullPath = path.join(this.basePath, normalizedPath);
      return fs.existsSync(fullPath);
    } catch (error) {
      this.logger.error(`❌ Error verificando existencia de archivo: ${error.message}`);
      return false;
    }
  }

  getBasePath(): string {
    return this.basePath;
  }
}