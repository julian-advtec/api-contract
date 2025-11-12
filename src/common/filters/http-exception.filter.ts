import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Errores tipo HttpException
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res: any = exception.getResponse();

      return response.status(status).json({
        ok: false,
        statusCode: status,
        message: res['message'] || exception.message,
        timestamp: new Date().toISOString(),
        path: request.url,
      });
    }

    // Errores inesperados
    return response.status(500).json({
      ok: false,
      statusCode: 500,
      message: 'Error interno del servidor',
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
