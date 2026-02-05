// src/config/multer-contabilidad.config.ts
import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

export const multerContabilidadConfig = {
  storage: diskStorage({
    destination: (req: any, file: Express.Multer.File, cb: Function) => {
      // Aquí deberías obtener la ruta del documento desde la base de datos
      const documentoId = req.params.documentoId;
      
      // Ruta base temporal - deberás ajustar esto según tu estructura
      const uploadPath = './uploads/contabilidad';
      
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }
      
      cb(null, uploadPath);
    },
    filename: (req: any, file: Express.Multer.File, cb: Function) => {
      const documentoId = req.params.documentoId;
      const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const extension = path.extname(file.originalname);
      
      // Nombre del archivo: tipo_documentoId_timestamp_hash.ext
      const filename = `${file.fieldname}_${documentoId}_${uniqueSuffix}${extension}`;
      cb(null, filename);
    },
  }),
  fileFilter: (req: any, file: Express.Multer.File, cb: Function) => {
    const allowedMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/jpg',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new BadRequestException(
          `Tipo de archivo no permitido: ${file.mimetype}. Solo se permiten PDF, Word, Excel e imágenes.`,
        ),
        false,
      );
    }
  },
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB máximo
  },
};