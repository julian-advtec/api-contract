// src/config/multer-auditor.config.ts
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';
import * as path from 'path';
import { Request } from 'express';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const TEMP_UPLOAD_DIR = './uploads/temp-auditor';

if (!fs.existsSync(TEMP_UPLOAD_DIR)) {
  fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
}

export const multerAuditorConfig: MulterOptions = {
  storage: diskStorage({
    destination: TEMP_UPLOAD_DIR, // ← carpeta temporal local (siempre existe)
    filename: (req: Request, file: Express.Multer.File, cb) => {
      const campo = file.fieldname;
      const ext = extname(file.originalname).toLowerCase() || '.pdf';
      const random = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const nombreFinal = `${campo}-${random}${ext}`;
      cb(null, nombreFinal);
    },
  }),

  limits: {
    fileSize: 30 * 1024 * 1024,
    fields: 20,
    parts: 30,
  },

  fileFilter: (req: Request, file: Express.Multer.File, cb) => {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/jpg',
    ];
    cb(null, allowed.includes(file.mimetype));
  },
};