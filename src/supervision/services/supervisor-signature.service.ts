// src/supervisor/services/supervisor-signature.service.ts

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Signature } from '../../signatures/entities/signature.entity';
import { EncryptionService } from '../../signatures/encryption.service';
import { SignaturePositionDto } from '../dto/signature-position.dto';

@Injectable()
export class SupervisorSignatureService {
  private readonly logger = new Logger(SupervisorSignatureService.name);

  constructor(
    @InjectRepository(Signature)
    private signaturesRepository: Repository<Signature>,
    private readonly encryptionService: EncryptionService,
  ) { }

  async aplicarFirmaEnActa(
    actaBuffer: Buffer,
    signatureId: string,
    position: SignaturePositionDto  // ✅ Cambiar el tipo a SignaturePositionDto
  ): Promise<Buffer> {
    try {
      this.logger.log(`Aplicando firma en acta | firma ID: ${signatureId}`);
      
      // ✅ Valores por defecto para propiedades opcionales
      const finalPosition = {
        page: position.page || 1,
        x: position.x || 50,
        y: position.y || 50,
        width: position.width || 200,
        height: position.height || 100
      };
      
      this.logger.log(`Posición: página ${finalPosition.page}, (${finalPosition.x}, ${finalPosition.y}), tamaño ${finalPosition.width}×${finalPosition.height}`);

      // 1. Obtener la firma desencriptada
      const signature = await this.signaturesRepository.findOneBy({ id: signatureId });
      if (!signature) throw new NotFoundException('Firma no encontrada');

      const signatureBuffer = this.encryptionService.decryptFromDb(signature.encryptedData);
      if (!signatureBuffer || signatureBuffer.length < 100) {
        throw new BadRequestException('Firma desencriptada inválida o vacía');
      }

      // 2. Cargar el PDF del acta
      const pdfDoc = await PDFDocument.load(actaBuffer);

      // 3. Validar página objetivo
      const pageIndex = finalPosition.page - 1;
      if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) {
        throw new BadRequestException(`Página ${finalPosition.page} no existe`);
      }

      const page = pdfDoc.getPage(pageIndex);
      const { width: pageWidth, height: pageHeight } = page.getSize();

      this.logger.log(`Tamaño de página PDF: ${pageWidth}×${pageHeight}`);

      // 4. Validar que la posición esté dentro de la página
      const finalX = Math.max(0, Math.min(finalPosition.x, pageWidth - finalPosition.width));
      const finalY = Math.max(0, Math.min(finalPosition.y, pageHeight - finalPosition.height));

      this.logger.log(`Posición final validada: (${finalX}, ${finalY})`);

      // 5. Aplicar la firma según el tipo
      if (signature.type === 'image') {
        await this.drawImageSignature(page, signatureBuffer, {
          x: finalX,
          y: finalY,
          width: finalPosition.width,
          height: finalPosition.height
        });
      } else if (signature.type === 'pdf') {
        await this.drawPdfSignature(pdfDoc, page, signatureBuffer, {
          x: finalX,
          y: finalY,
          width: finalPosition.width,
          height: finalPosition.height
        });
      } else {
        throw new BadRequestException(`Tipo de firma no soportado: ${signature.type}`);
      }

      // 6. Guardar el PDF modificado
      const signedBytes = await pdfDoc.save();
      
      this.logger.log(`✅ Firma aplicada correctamente`);
      return Buffer.from(signedBytes);

    } catch (error) {
      this.logger.error(`Error al aplicar firma: ${error.message}`, error.stack);
      throw error;
    }
  }

  private async drawImageSignature(
    page: any,
    imageBuffer: Buffer,
    pos: { x: number; y: number; width: number; height: number }
  ) {
    let image;
    try {
      image = await page.doc.embedPng(imageBuffer);
    } catch {
      try {
        image = await page.doc.embedJpg(imageBuffer);
      } catch {
        throw new BadRequestException('No se pudo interpretar la firma como imagen');
      }
    }

    page.drawImage(image, {
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
    });

    this.logger.debug(`Imagen de firma dibujada en (${pos.x}, ${pos.y})`);
  }

  private async drawPdfSignature(
    pdfDoc: PDFDocument,
    targetPage: any,
    pdfBuffer: Buffer,
    pos: { x: number; y: number; width: number; height: number }
  ) {
    try {
      // 1. Cargar el PDF de la firma
      const signaturePdf = await PDFDocument.load(pdfBuffer);
      if (signaturePdf.getPageCount() === 0) {
        throw new BadRequestException('PDF de firma vacío');
      }

      // 2. Obtener la primera página de la firma
      const [signaturePage] = signaturePdf.getPages();
      
      // 3. EMBED la página de la firma en el PDF destino
      const embeddedPage = await pdfDoc.embedPage(signaturePage);
      
      // 4. Obtener dimensiones originales de la página embebida
      const { width: origWidth, height: origHeight } = embeddedPage;
      
      // 5. Calcular escala para ajustar al tamaño deseado
      const scaleX = pos.width / origWidth;
      const scaleY = pos.height / origHeight;
      const scale = Math.min(scaleX, scaleY);

      this.logger.log(`Dibujando firma PDF: original=${origWidth}×${origHeight}, target=${pos.width}×${pos.height}, scale=${scale}`);

      // 6. Dibujar la firma usando la página embebida
      targetPage.drawPage(embeddedPage, {
        x: pos.x,
        y: pos.y,
        xScale: scale,
        yScale: scale,
      });

    } catch (error) {
      this.logger.error(`Error dibujando firma PDF: ${error.message}`);
      throw new BadRequestException(`Error al aplicar firma PDF: ${error.message}`);
    }
  }
}