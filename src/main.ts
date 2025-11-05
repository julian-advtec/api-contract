import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
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
