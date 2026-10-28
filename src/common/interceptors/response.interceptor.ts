// src/common/interceptors/response.interceptor.ts
import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    Logger,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
    private readonly logger = new Logger(ResponseInterceptor.name);

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const request = context.switchToHttp().getRequest();
        const contentType = request.headers['content-type'] || '';
        const accept = request.headers['accept'] || '';

        // ✅ NO transformar respuestas de archivos binarios o multipart
        const isMultipart = contentType.includes('multipart/form-data');
        const isFileDownload =
            accept.includes('application/pdf') ||
            accept.includes('application/octet-stream') ||
            accept.includes('image/');

        if (isMultipart || isFileDownload) {
            this.logger.debug(`⏭️ Omitiendo transformación para ${request.url}`);
            return next.handle();
        }

        return next.handle().pipe(
            map((data) => {
                // ✅ Si la respuesta ya tiene el formato esperado, no modificar
                if (data && typeof data === 'object' && 'ok' in data) {
                    return data;
                }

                // ✅ Si es un stream o buffer, no modificar
                if (data instanceof Buffer || data instanceof ReadableStream) {
                    return data;
                }

                return {
                    ok: true,
                    path: request.url,
                    timestamp: new Date().toISOString(),
                    data: data,
                };
            }),
        );
    }
}