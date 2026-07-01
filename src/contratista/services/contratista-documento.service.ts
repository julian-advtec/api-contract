// src/contratista/services/contratista-documento.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentoContratista, TipoDocumento } from '../entities/documento-contratista.entity';
import { StorageService } from '../../common/storage/storage.service';
import { ContratistaService } from '../services/contratista.service';
import * as path from 'path';

@Injectable()
export class ContratistaDocumentoService {
  private readonly logger = new Logger(ContratistaDocumentoService.name);

  constructor(
    @InjectRepository(DocumentoContratista)
    private readonly documentoRepository: Repository<DocumentoContratista>,
    private readonly storageService: StorageService,
    private readonly contratistaService: ContratistaService,
    
  ) {}

  /**
   * Sube un documento para un contratista
   */
  async subirDocumento(
    contratistaId: string,
    tipo: TipoDocumento,
    archivo: Express.Multer.File,
    usuario: string
  ): Promise<DocumentoContratista> {
    try {
      const contratista = await this.contratistaService.buscarPorId(contratistaId);

      const extension = path.extname(archivo.originalname).toLowerCase();
      const timestamp = Date.now();
      const nombreUnico = `${tipo}_${timestamp}${extension}`;

      const folderName = contratista.numeroContrato
        ? `${contratista.numeroContrato}_${contratista.razonSocial.replace(/[^a-zA-Z0-9]/g, '_')}`
        : `${contratistaId}`;

      const folder = `contratistas/${folderName}`;
      const filePath = `${folder}/${nombreUnico}`;

      const result = await this.storageService.uploadFile(
        filePath,
        archivo.buffer,
        archivo.mimetype
      );

      const documento = new DocumentoContratista();
      documento.contratistaId = contratistaId;
      documento.tipo = tipo;
      documento.nombreArchivo = nombreUnico;
      documento.rutaArchivo = result.path;
      documento.tipoMime = archivo.mimetype;
      documento.tamanoBytes = archivo.size;
      documento.subidoPor = usuario;

      const saved = await this.documentoRepository.save(documento);
      this.logger.log(`✅ Documento subido: ${tipo} - ${nombreUnico}`);

      return saved;
    } catch (error) {
      this.logger.error(`❌ Error subiendo documento: ${error.message}`);
      throw error;
    }
  }

  /**
   * Descarga un documento
   */
  async descargarDocumento(
    documentoId: string,
    contratistaId: string
  ): Promise<{ buffer: Buffer; nombre: string; mimeType: string }> {
    const documento = await this.obtenerDocumentoPorId(documentoId, contratistaId);

    let buffer: Buffer | null = null;

    try {
      buffer = await this.storageService.getFile(documento.rutaArchivo);
    } catch (error) {
      this.logger.warn(`⚠️ No se encontró en ruta original: ${documento.rutaArchivo}`);
      
      const files = await this.storageService.listFiles('contratistas');
      for (const file of files) {
        if (file.includes(documento.nombreArchivo) || file.includes(documento.tipo)) {
          try {
            buffer = await this.storageService.getFile(file);
            break;
          } catch (e) {
            continue;
          }
        }
      }
    }

    if (!buffer) {
      throw new NotFoundException(`Archivo no encontrado: ${documento.nombreArchivo}`);
    }

    return {
      buffer,
      nombre: documento.nombreArchivo,
      mimeType: documento.tipoMime || 'application/octet-stream',
    };
  }

  /**
   * Obtiene un documento por ID
   */
  async obtenerDocumentoPorId(
    documentoId: string,
    contratistaId: string
  ): Promise<DocumentoContratista> {
    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId, contratistaId }
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    return documento;
  }

  /**
   * Obtiene todos los documentos de un contratista
   */
  async obtenerDocumentos(contratistaId: string): Promise<DocumentoContratista[]> {
    return await this.documentoRepository.find({
      where: { contratistaId },
      order: { fechaSubida: 'DESC' }
    });
  }

  /**
   * Elimina un documento
   */
  async eliminarDocumento(documentoId: string, contratistaId: string): Promise<void> {
    const documento = await this.obtenerDocumentoPorId(documentoId, contratistaId);
    
    await this.storageService.deleteFile(documento.rutaArchivo);
    await this.documentoRepository.delete(documentoId);
    
    this.logger.log(`✅ Documento eliminado: ${documentoId}`);
  }

  /**
   * Descarga todos los documentos en ZIP
   */
  async descargarTodosDocumentos(contratistaId: string): Promise<{ zipBuffer: Buffer; nombreZip: string; totalDocumentos: number }> {
    const contratista = await this.contratistaService.buscarPorId(contratistaId);
    const documentos = await this.obtenerDocumentos(contratistaId);

    if (!documentos || documentos.length === 0) {
      throw new NotFoundException(`El contratista ${contratistaId} no tiene documentos asociados`);
    }

    const archiver = require('archiver');
    const chunks: Buffer[] = [];

    const zipStream = archiver('zip', { zlib: { level: 9 } });

    zipStream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    const zipPromise = new Promise<Buffer>((resolve, reject) => {
      zipStream.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      zipStream.on('error', (err: Error) => reject(err));
    });

    for (const doc of documentos) {
      try {
        const { buffer } = await this.descargarDocumento(doc.id, contratistaId);
        const nombreLimpio = doc.nombreArchivo.replace(/[^a-zA-Z0-9.-]/g, '_');
        zipStream.append(buffer, { name: `${doc.tipo}_${nombreLimpio}` });
      } catch (error) {
        this.logger.error(`❌ Error agregando documento ${doc.id}: ${error.message}`);
      }
    }

    zipStream.finalize();
    const zipBuffer = await zipPromise;

    const nombreContratista = contratista.razonSocial.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const fecha = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const nombreZip = `documentos_${nombreContratista}_${fecha}.zip`;

    return { zipBuffer, nombreZip, totalDocumentos: documentos.length };
  }
}