// src/asesor-gerencia/config/multer-asesor-gerencia.config.ts
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { memoryStorage } from 'multer';

export const multerAsesorGerenciaConfig: MulterOptions = {
  storage: memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB
    files: 1,                   // solo 1 archivo de aprobación por request
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',                                          // lo más común para aprobación/firma
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/jpg',
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no permitido para aprobación gerencial: ${file.mimetype}`), false);
    }
  },
};