// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

// Configurar el entorno del sistema antes de iniciar la aplicación
function setupSystemEnvironment() {
  const logger = new Logger('SystemSetup');
  
  // Configurar rutas críticas para Windows
  const criticalPaths = [
    'C:\\Windows\\System32',
    'C:\\Windows\\SysWOW64',
    'C:\\Program Files\\LibreOffice\\program',
    'C:\\Program Files (x86)\\LibreOffice\\program',
    'C:\\Program Files\\LibreOffice 25\\program',
    'C:\\Program Files\\LibreOffice 24\\program',
    'C:\\Program Files\\LibreOffice 7\\program',
  ];
  
  const currentPath = process.env.PATH || '';
  const pathParts = currentPath.split(';');
  
  for (const criticalPath of criticalPaths) {
    if (fs.existsSync(criticalPath) && !pathParts.includes(criticalPath)) {
      pathParts.unshift(criticalPath);
      logger.log(`✅ Ruta crítica agregada al PATH: ${criticalPath}`);
    }
  }
  
  process.env.PATH = pathParts.join(';');
  logger.log('🔧 Entorno del sistema configurado');
}

async function bootstrap() {
  // Configurar entorno del sistema
  setupSystemEnvironment();
  
  const app = await NestFactory.create(AppModule, { cors: true });

  // Prefijo global (todas las rutas comienzan con /api)
  app.setGlobalPrefix('api');

  // CORS para permitir acceso desde Angular
  app.enableCors({
    origin: ['http://localhost:4200'],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // 🧱 Validación global de DTOs (seguridad + consistencia)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // elimina propiedades desconocidas
      forbidNonWhitelisted: true, // lanza error si envían propiedades extra
      transform: true, // transforma los tipos automáticamente
    }),
  );

  // 🌐 Filtro global de errores
  app.useGlobalFilters(new HttpExceptionFilter());

  // 💬 Interceptor global para respuestas consistentes
  app.useGlobalInterceptors(new ResponseInterceptor());

  // 🚀 Levanta servidor
  await app.listen(3000);
  console.log('✅ Backend corriendo en: http://localhost:3000/api');
}
bootstrap();