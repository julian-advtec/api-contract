// src/config/multer-auditor.config.ts
import { memoryStorage } from 'multer';
import { Request } from 'express';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

export const multerAuditorConfig: MulterOptions = {
  storage: memoryStorage(),  // ← Esto es lo clave: archivos en memoria → file.buffer existe
  fileFilter: (
    req: Request,
    file: Express.Multer.File,
    callback: (error: Error | null, accept: boolean) => void
  ) => {
    const allowedMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/jpg',
    ];

    if (allowedMimes.includes(file.mimetype)) {
      callback(null, true);
    } else {
      callback(new Error('Tipo de archivo no permitido'), false);
    }
  },
  limits: {
    fileSize: 30 * 1024 * 1024, // 30 MB
    files: 6,
  },
};