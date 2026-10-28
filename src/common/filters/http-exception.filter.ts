// src/common/filters/http-exception.filter.ts
import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(HttpExceptionFilter.name);

    catch(exception: any, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        // ✅ NO responder si ya se enviaron headers
        if (response.headersSent) {
            this.logger.warn('⚠️ Headers ya enviados, no se puede responder');
            return;
        }

        const contentType = request.headers['content-type'] || '';
        const isMultipart = contentType.includes('multipart/form-data');

        if (exception instanceof HttpException) {
            const status = exception.getStatus();
            const res: any = exception.getResponse();

            // ✅ LOG DETALLADO para errores en multipart
            if (isMultipart) {
                this.logger.error('════════════════════════════════════════');
                this.logger.error(`❌ ERROR ${status} EN PETICIÓN MULTIPART`);
                this.logger.error(`   URL: ${request.method} ${request.url}`);
                this.logger.error(`   Content-Type: ${contentType}`);
                this.logger.error(`   Content-Length: ${request.headers['content-length']}`);
                this.logger.error(`   Exception: ${JSON.stringify(exception, null, 2)}`);
                this.logger.error(`   Response: ${JSON.stringify(res, null, 2)}`);
                this.logger.error('════════════════════════════════════════');
            }

            const message = res['message'] || exception.message;
            const errorDetail = Array.isArray(message) ? message.join(', ') : message;

            return response.status(status).json({
                ok: false,
                statusCode: status,
                message: errorDetail,
                timestamp: new Date().toISOString(),
                path: request.url,
            });
        }

        // ✅ LOG DETALLADO para errores inesperados
        this.logger.error('════════════════════════════════════════');
        this.logger.error('❌ ERROR INESPERADO');
        this.logger.error(`   URL: ${request.method} ${request.url}`);
        this.logger.error(`   Exception:`, exception);
        this.logger.error(`   Stack:`, exception?.stack);
        this.logger.error('════════════════════════════════════════');

        return response.status(500).json({
            ok: false,
            statusCode: 500,
            message: exception?.message || 'Error interno del servidor',
            timestamp: new Date().toISOString(),
            path: request.url,
        });
    }
}