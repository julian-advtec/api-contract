import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import * as fs from 'fs/promises';
import * as path from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Signature } from '../signatures/entities/signature.entity';
import { EncryptionService } from '../signatures/encryption.service';

@Injectable()
export class TesoreriaSignatureService {
  private readonly logger = new Logger(TesoreriaSignatureService.name);

  constructor(
    @InjectRepository(Signature)
    private signaturesRepository: Repository<Signature>,
    private readonly encryptionService: EncryptionService,
  ) { }

  async aplicarFirmaEnPDF(
    pdfPath: string,
    signatureId: string,
    position: { page: number; x: number; y: number; width: number; height: number }
  ): Promise<string> {
    try {
      this.logger.log(`Aplicando firma en ${pdfPath} | firma ID: ${signatureId}`);
      this.logger.log(`Posición recibida: página ${position.page}, (${position.x}, ${position.y}), tamaño ${position.width}×${position.height}`);

      // 1. Obtener la firma desencriptada
      const signature = await this.signaturesRepository.findOneBy({ id: signatureId });
      if (!signature) throw new NotFoundException('Firma no encontrada');

      const signatureBuffer = this.encryptionService.decryptFromDb(signature.encryptedData);
      if (!signatureBuffer || signatureBuffer.length < 100) {
        throw new BadRequestException('Firma desencriptada inválida o vacía');
      }

      // 2. Cargar el PDF del comprobante
      const pdfBytes = await fs.readFile(pdfPath);
      const pdfDoc = await PDFDocument.load(pdfBytes);

      // 3. Validar página objetivo
      const pageIndex = position.page - 1;
      if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) {
        throw new BadRequestException(`Página ${position.page} no existe`);
      }

      const page = pdfDoc.getPage(pageIndex);
      const { width: pageWidth, height: pageHeight } = page.getSize();

      this.logger.log(`Tamaño de página PDF: ${pageWidth}×${pageHeight}`);

      // 4. Validar que la posición esté dentro de la página
      const finalX = Math.max(0, Math.min(position.x, pageWidth - position.width));
      const finalY = Math.max(0, Math.min(position.y, pageHeight - position.height));

      this.logger.log(`Posición final validada: (${finalX}, ${finalY})`);

      // 5. Aplicar la firma según el tipo
      if (signature.type === 'image') {
        await this.drawImageSignature(page, signatureBuffer, {
          x: finalX,
          y: finalY,
          width: position.width,
          height: position.height
        });
      } else if (signature.type === 'pdf') {
        await this.drawPdfSignature(pdfDoc, page, signatureBuffer, {
          x: finalX,
          y: finalY,
          width: position.width,
          height: position.height
        });
      } else {
        throw new BadRequestException(`Tipo de firma no soportado: ${signature.type}`);
      }

      // 6. Guardar el PDF modificado
      const signedBytes = await pdfDoc.save();
      await fs.writeFile(pdfPath, signedBytes);

      this.logger.log(`✅ Firma aplicada correctamente en (${finalX}, ${finalY})`);
      return pdfPath;

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
      
      // 3. EMBED la página de la firma en el PDF destino (NO copyPages)
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