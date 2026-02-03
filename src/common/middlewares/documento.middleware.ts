// src/common/middlewares/documento.middleware.ts
import { Injectable, NestMiddleware, BadRequestException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { Documento } from 'src/radicacion/entities/documento.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class LoadDocumentoMiddleware implements NestMiddleware {
  constructor(
    @InjectRepository(Documento)
    private documentoRepo: Repository<Documento>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const documentoId = req.params.documentoId;

    if (documentoId) {
      const doc = await this.documentoRepo.findOne({
        where: { id: documentoId },
        select: ['id', 'rutaCarpetaRadicado', 'numeroRadicado'],
      });

      if (!doc) {
        return res.status(404).json({ message: 'Documento no encontrado' });
      }

      if (!doc.rutaCarpetaRadicado) {
        return res.status(400).json({ message: 'El documento no tiene ruta de carpeta' });
      }

      (req as any).documento = doc;
    }

    next();
  }
}