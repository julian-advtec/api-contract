import { Injectable, NestInterceptor, ExecutionContext, CallHandler, BadRequestException, NotFoundException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Documento } from '../../radicacion/entities/documento.entity';
import * as path from 'path'; // ← Añadido

@Injectable()
export class LoadDocumentoInterceptor implements NestInterceptor {
  constructor(
    @InjectRepository(Documento)
    private documentoRepo: Repository<Documento>,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const req = context.switchToHttp().getRequest();

    const documentoId = req.params?.documentoId; // ← ahora sí existe gracias al import

    if (!documentoId) {
      throw new BadRequestException('Falta documentoId en la ruta');
    }

    const documento = await this.documentoRepo.findOne({
      where: { id: documentoId },
      select: ['id', 'rutaCarpetaRadicado', 'numeroRadicado', 'estado'],
    });

    if (!documento) {
      throw new NotFoundException(`Documento ${documentoId} no encontrado`);
    }

    if (!documento.rutaCarpetaRadicado) {
      throw new BadRequestException('El documento no tiene rutaCarpetaRadicado configurada');
    }

    // Guardamos en req para que Multer lo vea
    (req as any).documento = documento;

    return next.handle();
  }
}