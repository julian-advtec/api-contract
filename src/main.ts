import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { ValidationPipe, Logger } from '@nestjs/common';
import * as fs from 'fs';

// Configurar el entorno del sistema (SOLO WINDOWS)
function setupSystemEnvironment() {
  const logger = new Logger('SystemSetup');

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
      logger.log(`✅ Ruta agregada al PATH: ${criticalPath}`);
    }
  }

  process.env.PATH = pathParts.join(';');
  logger.log('🔧 Entorno configurado (Windows)');
}

async function bootstrap() {
  // 🔥 SOLO ejecutar en Windows (evita error en Render/Linux)
  if (process.platform === 'win32') {
    setupSystemEnvironment();
  }

  const app = await NestFactory.create(AppModule);

  // Prefijo global
  app.setGlobalPrefix('api');

  // 🌍 CORS UNIVERSAL (funciona en los 3 entornos)
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // 🧱 Validaciones globales
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 🌐 Manejo de errores
  app.useGlobalFilters(new HttpExceptionFilter());

  // 💬 Respuesta estándar
  app.useGlobalInterceptors(new ResponseInterceptor());

  // 🚀 Puerto dinámico (Render usa variable PORT)
  const port = process.env.PORT || 3000;

  await app.listen(port);

  console.log(`🚀 Backend corriendo en puerto: ${port}`);
  console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
}
bootstrap();