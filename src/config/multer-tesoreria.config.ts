import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { memoryStorage } from 'multer';

export const multerTesoreriaConfig : MulterOptions = {
  storage: memoryStorage(), // ← USAR memoryStorage para procesar en memoria
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB por archivo
    files: 1, // Máximo 4 archivos (glosa, causacion, extracto, comprobanteEgreso)
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/jpg',
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`), false);
    }
  },
};