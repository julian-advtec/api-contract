// src/config/multer-auditor.config.ts
import { diskStorage } from 'multer';
import { extname } from 'path';
import { Request } from 'express';

export const multerAuditorConfig = {
  storage: diskStorage({
    destination: (req: Request, file: Express.Multer.File, callback: (error: Error | null, destination: string) => void) => {
      try {
        const documentoId = req.params.documentoId;
        const basePath = '\\\\R2-D2\\api-contract';
        const user = req.user as any; // Usamos 'any' temporalmente
        
        // Verificar que user existe
        if (!user) {
          return callback(new Error('Usuario no autenticado'), '');
        }
        
        // Obtener el ID del usuario - puede estar en user.id o user.userId
        const userId = user.id || user.userId || user.sub || 'unknown';
        
        if (userId === 'unknown') {
          return callback(new Error('No se pudo identificar al usuario'), '');
        }
        
        // Crear estructura de carpetas similar a supervisor
        const destino = `${basePath}/auditor/${documentoId}/${userId}`;
        callback(null, destino);
      } catch (error) {
        callback(error as Error, '');
      }
    },
    filename: (req: Request, file: Express.Multer.File, callback: (error: Error | null, filename: string) => void) => {
      try {
        const documentoId = req.params.documentoId;
        const user = req.user as any;
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(2, 8);
        const ext = extname(file.originalname);
        
        // Obtener el ID del usuario
        const userId = user?.id || user?.userId || user?.sub || 'unknown';
        
        // Nombre con información del tipo de documento y auditor
        const tipo = file.fieldname || 'documento';
        const filename = `auditor-${tipo}-${documentoId}-${timestamp}-${randomStr}${ext}`;
        
        callback(null, filename);
      } catch (error) {
        callback(error as Error, '');
      }
    },
  }),
  fileFilter: (req: Request, file: Express.Multer.File, callback: (error: Error | null, acceptFile: boolean) => void) => {
    const allowedMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
    ];

    if (allowedMimes.includes(file.mimetype)) {
      callback(null, true);
    } else {
      callback(new Error('Tipo de archivo no permitido'), false);
    }
  },
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB
  },
};