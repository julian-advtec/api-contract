// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { ValidationPipe, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

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

// Función para detectar el entorno actual
function detectAndConfigureEnvironment() {
    // Detectar si estamos en VSCode
    const isVSCode = process.env.VSCODE_PID !== undefined;
    
    // Detectar si estamos en Render
    const isRender = process.env.RENDER !== undefined || 
                     (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com'));
    
    // Detectar por NODE_ENV
    const nodeEnv = process.env.NODE_ENV || 'development';
    
    // Detectar archivos de entorno
    const hasProductionEnv = fs.existsSync(path.join(process.cwd(), '.env.production'));
    const hasDevelopmentEnv = fs.existsSync(path.join(process.cwd(), '.env.development'));
    
    logger.log('🔍 ========== DETECCIÓN DE ENTORNO ==========');
    logger.log(`   📝 VSCode detectado: ${isVSCode ? 'SÍ' : 'NO'}`);
    logger.log(`   📝 Render detectado: ${isRender ? 'SÍ' : 'NO'}`);
    logger.log(`   📝 NODE_ENV: ${nodeEnv}`);
    logger.log(`   📝 .env.production: ${hasProductionEnv ? 'SÍ' : 'NO'}`);
    logger.log(`   📝 .env.development: ${hasDevelopmentEnv ? 'SÍ' : 'NO'}`);
    
    // Determinar si es producción
    const isProduction = isRender || nodeEnv === 'production' || hasProductionEnv;
    
    if (isProduction) {
        logger.log('☁️ ========== ENTORNO DE PRODUCCIÓN DETECTADO ==========');
        logger.log('   📦 Usando configuración de PRODUCCIÓN');
        
        // Mantener configuración de producción
        if (!process.env.STORAGE_TYPE) {
            process.env.STORAGE_TYPE = 'supabase';
        }
        if (!process.env.NODE_ENV) {
            process.env.NODE_ENV = 'production';
        }
        
        logger.log(`   ✅ STORAGE_TYPE: ${process.env.STORAGE_TYPE}`);
        logger.log(`   ✅ NODE_ENV: ${process.env.NODE_ENV}`);
        logger.log(`   ☁️ Usando Supabase para almacenamiento`);
        
        return false; // No es local
    }
    
    // FORZAR DESARROLLO
    logger.log('💻 ========== ENTORNO DE DESARROLLO DETECTADO ==========');
    logger.log('   🔧 Usando configuración de DESARROLLO');
    
    // Forzar almacenamiento LOCAL
    process.env.STORAGE_TYPE = 'local';
    
    // Forzar NODE_ENV a development
    process.env.NODE_ENV = 'development';
    
    // Configurar base de datos LOCAL
    if (!process.env.DB_HOST) {
        process.env.DB_HOST = 'localhost';
        process.env.DB_PORT = '5432';
        process.env.DB_USER = 'postgres';
        process.env.DB_PASS = process.env.DB_PASS || '132754JU9011';
        process.env.DB_NAME = 'contract_db';
        logger.log('   ✅ Configuración de base de datos LOCAL establecida');
    }
    
    // Configurar ruta local si no existe
    if (!process.env.LOCAL_STORAGE_PATH) {
        process.env.LOCAL_STORAGE_PATH = '\\\\R2-D2\\api-contract';
        logger.log('   ✅ Ruta de almacenamiento LOCAL configurada');
    }
    
    logger.log(`   ✅ STORAGE_TYPE: ${process.env.STORAGE_TYPE}`);
    logger.log(`   ✅ NODE_ENV: ${process.env.NODE_ENV}`);
    logger.log(`   💾 Usando almacenamiento LOCAL`);
    logger.log(`   🗄️ Base de datos: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
    
    return true; // Es local
}

function getCorsOrigins(): string[] {
    const nodeEnv = process.env.NODE_ENV || 'development';
    const origins: string[] = [];

    if (nodeEnv === 'production') {
        origins.push(
            'https://advtec.netlify.app',
            'https://api-contract.onrender.com',
            'http://192.168.7.56:8091',
            'http://localhost:4200',
            'http://localhost:4201',
        );
        
        const frontendUrl = process.env.FRONTEND_URL;
        if (frontendUrl && !origins.includes(frontendUrl)) {
            origins.push(frontendUrl);
        }
        
        const extraOrigins = process.env.EXTRA_CORS_ORIGINS;
        if (extraOrigins) {
            extraOrigins.split(',').forEach(origin => {
                const trimmedOrigin = origin.trim();
                if (trimmedOrigin && !origins.includes(trimmedOrigin)) {
                    origins.push(trimmedOrigin);
                }
            });
        }
    } else {
        origins.push(
            'http://localhost:4200',
            'http://localhost:8091',
            'http://127.0.0.1:4200',
            'http://127.0.0.1:8091',
            'http://192.168.7.56:8091',
            'http://localhost:4201',
        );
    }

    return origins.filter(origin => origin && origin !== 'undefined');
}

async function bootstrap() {
    const startTime = Date.now();
    
    try {
        logger.log('🚀 Iniciando aplicación...');
        logger.log(`💻 Plataforma: ${process.platform}`);
        
        // Configurar entorno automáticamente
        const isLocal = detectAndConfigureEnvironment();
        
        setupSystemEnvironment();

        const app = await NestFactory.create(AppModule, { 
            cors: true,
            logger: ['error', 'warn', 'log', 'debug', 'verbose']
        });

        app.setGlobalPrefix('api');

        const corsOrigins = getCorsOrigins();
        const isProduction = process.env.NODE_ENV === 'production';
        
        app.enableCors({
            origin: (origin: string, callback: (err: Error | null, allow?: boolean) => void) => {
                if (!origin) {
                    return callback(null, true);
                }
                
                if (!isProduction) {
                    return callback(null, true);
                }
                
                if (corsOrigins.includes(origin)) {
                    callback(null, true);
                } else {
                    logger.warn(`❌ CORS bloqueado para origen: ${origin}`);
                    logger.warn(`📋 Orígenes permitidos: ${corsOrigins.join(', ')}`);
                    callback(new Error(`Origen ${origin} no permitido por CORS`));
                }
            },
            credentials: true,
            methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'x-auditor-id', 'X-Requested-With'],
            exposedHeaders: ['Content-Disposition'],
            preflightContinue: false,
            optionsSuccessStatus: 204,
        });
        
        logger.log(`🌐 CORS configurado con ${corsOrigins.length} orígenes permitidos`);
        if (isProduction) {
            corsOrigins.forEach(origin => logger.log(`   ✅ ${origin}`));
        } else {
            logger.log('   🌍 Todos los orígenes permitidos en desarrollo');
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
        
        // Mostrar resumen de configuración
        logger.log('📋 ========== RESUMEN DE CONFIGURACIÓN ==========');
        if (isLocal) {
            logger.log('💾 Almacenamiento: LOCAL');
            logger.log(`📁 Ruta local: ${process.env.LOCAL_STORAGE_PATH || 'uploads'}`);
            logger.log(`🗄️ Base de datos: LOCAL (${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME})`);
        } else {
            logger.log('☁️ Almacenamiento: SUPABASE');
            logger.log(`📦 Bucket: ${process.env.SUPABASE_BUCKET || 'documentos'}`);
            logger.log(`🗄️ Base de datos: REMOTA (${process.env.DB_HOST || 'Render/Supabase'})`);
        }
        logger.log('================================================');
        
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