import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { ValidationPipe, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';

const logger = new Logger('Bootstrap');

function setupSystemEnvironment() {
  if (process.platform !== 'win32') {
    logger.log('🐧 Sistema Linux/Unix detectado - Omitiendo configuración de rutas Windows');
    return;
  }

  logger.log('🪟 Configurando entorno para Windows...');
  
  const criticalPaths = [
    'C:\\Windows\\System32',
    'C:\\Windows\\SysWOW64',
    'C:\\Program Files\\LibreOffice\\program',
    'C:\\Program Files (x86)\\LibreOffice\\program',
    'C:\\Program Files\\LibreOffice 25\\program',
    'C:\\Program Files\\LibreOffice 24\\program',
    'C:\\Program Files\\LibreOffice 7\\program',
    'C:\\Program Files\\LibreOffice\\program',
  ];

  const currentPath = process.env.PATH || '';
  const pathParts = currentPath.split(';');
  let pathsAdded = 0;

  for (const criticalPath of criticalPaths) {
    try {
      if (fs.existsSync(criticalPath) && !pathParts.includes(criticalPath)) {
        pathParts.unshift(criticalPath);
        logger.log(`✅ Ruta agregada al PATH: ${criticalPath}`);
        pathsAdded++;
      }
    } catch (error) {
      logger.warn(`⚠️ No se pudo verificar ruta: ${criticalPath}`);
    }
  }

  if (pathsAdded > 0) {
    process.env.PATH = pathParts.join(';');
    logger.log(`🔧 Entorno Windows configurado (${pathsAdded} rutas agregadas)`);
  } else {
    logger.log('ℹ️ No se encontraron rutas críticas adicionales para agregar');
  }
}

function getCorsOrigins(): string[] {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const origins: string[] = [];

  if (nodeEnv === 'production') {
    origins.push(
      'http://192.168.7.56:8091',
      'https://tu-dominio-produccion.com',
    );
    const frontendUrl = process.env.FRONTEND_URL;
    if (frontendUrl) {
      origins.push(frontendUrl);
    }
  } else {
    origins.push(
      'http://localhost:4200',
      'http://localhost:8091',
      'http://127.0.0.1:4200',
      'http://127.0.0.1:8091'
    );
  }

  return origins.filter(origin => origin && origin !== 'undefined');
}

function getDatabaseConfig() {
  const databaseUrl = process.env.DATABASE_URL;
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  if (databaseUrl) {
    logger.log(`📦 Usando DATABASE_URL para conexión (${nodeEnv})`);
    return { url: databaseUrl };
  }
  
  logger.log(`📦 Usando configuración individual para conexión (${nodeEnv})`);
  
  const dbPort = process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432;
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbUser = process.env.DB_USER || 'postgres';
  const dbPassword = process.env.DB_PASS || 'postgres';
  const dbName = process.env.DB_NAME || 'contract_db';
  
  return {
    host: dbHost,
    port: dbPort,
    username: dbUser,
    password: dbPassword,
    database: dbName,
  };
}

async function bootstrap() {
  const startTime = Date.now();
  
  try {
    logger.log('🚀 Iniciando aplicación...');
    logger.log(`💻 Plataforma: ${process.platform}`);
    logger.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
    
    setupSystemEnvironment();

    const app = await NestFactory.create(AppModule, { 
      cors: true,
      logger: ['error', 'warn', 'log', 'debug', 'verbose']
    });

    app.setGlobalPrefix('api');

    const corsOrigins = getCorsOrigins();
    const isProduction = process.env.NODE_ENV === 'production';
    
    app.enableCors({
      origin: isProduction ? corsOrigins : true,
      credentials: true,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'x-auditor-id'],
      exposedHeaders: ['Content-Disposition'],
    });
    
    if (isProduction) {
      logger.log(`🌐 CORS configurado para ${corsOrigins.length} orígenes`);
      corsOrigins.forEach(origin => logger.log(`   - ${origin}`));
    } else {
      logger.log('🌐 CORS configurado para todos los orígenes (modo desarrollo)');
    }

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: false,
        },
      }),
    );

    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());

    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
    await app.listen(port, '0.0.0.0');
    
    const elapsedTime = Date.now() - startTime;
    
    logger.log(`✅ Aplicación iniciada exitosamente en ${elapsedTime}ms`);
    logger.log(`🚀 Servidor escuchando en puerto: ${port}`);
    logger.log(`📡 API disponible en: http://localhost:${port}/api`);
    
    const publicUrl = process.env.PUBLIC_URL || `http://localhost:${port}`;
    logger.log(`🌐 URL pública: ${publicUrl}`);
    
    if (isProduction) {
      logger.log('🔒 Modo producción activado');
      if (process.env.DATABASE_URL) {
        logger.log('🗄️ Base de datos: URL configurada (producción)');
      } else {
        logger.log('🗄️ Base de datos: Configuración individual');
      }
    }
    
    const storageType = process.env.STORAGE_TYPE || 'local';
    if (storageType === 'supabase') {
      logger.log('☁️ Usando Supabase como almacenamiento principal');
      const bucket = process.env.SUPABASE_BUCKET || 'documentos';
      logger.log(`📦 Bucket: ${bucket}`);
      const fallbackEnabled = process.env.FALLBACK_TO_LOCAL === 'true';
      if (fallbackEnabled) {
        logger.log('⚠️ Fallback a almacenamiento local habilitado');
      }
    } else {
      logger.log('💾 Usando almacenamiento local');
      const localPath = process.env.LOCAL_STORAGE_PATH || 'uploads';
      logger.log(`📁 Ruta local: ${localPath}`);
    }
    
  } catch (error) {
    logger.error('❌ Error crítico al iniciar la aplicación:', error.stack);
    process.exit(1);
  }
}

process.on('uncaughtException', (error) => {
  logger.error('🔴 Excepción no capturada:', error);
  if (process.env.NODE_ENV === 'development') {
    console.error(error);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('🔴 Promesa rechazada no manejada:', reason);
  if (process.env.NODE_ENV === 'development') {
    console.error(reason);
  }
  process.exit(1);
  
});

process.on('SIGTERM', () => {
  logger.log('🛑 Recibida señal SIGTERM, cerrando aplicación...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.log('🛑 Recibida señal SIGINT, cerrando aplicación...');
  process.exit(0);
});

bootstrap();