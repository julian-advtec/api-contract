// backend/tesoreria/tesoreria-signature.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
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
  ) {}

  /**
   * Aplica una firma digital en un PDF en la posición especificada
   */
  async aplicarFirmaEnPDF(
    pdfPath: string,
    signatureId: string,
    position: { page: number; x: number; y: number; width: number; height: number }
  ): Promise<string> {
    try {
      this.logger.log(`📝 Aplicando firma en PDF: ${pdfPath}`);
      this.logger.log(`📍 Posición: página ${position.page}, (${position.x}, ${position.y})`);

      // 1. Obtener la firma del usuario
      const signature = await this.signaturesRepository.findOne({
        where: { id: signatureId }
      });

      if (!signature) {
        throw new NotFoundException('Firma no encontrada');
      }

      // 2. Desencriptar la firma
      const signatureBuffer = this.encryptionService.decryptFromDb(signature.encryptedData);
      
      // 3. Cargar el PDF original
      const pdfBytes = await fs.readFile(pdfPath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      
      // 4. Obtener la página específica (las páginas empiezan en índice 0)
      const pageIndex = position.page - 1;
      if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) {
        throw new BadRequestException(`La página ${position.page} no existe. El documento tiene ${pdfDoc.getPageCount()} páginas.`);
      }
      
      const page = pdfDoc.getPage(pageIndex);
      const { height: pageHeight } = page.getSize();
      
      // 5. Aplicar la firma según el tipo
      if (signature.type === 'image') {
        await this.aplicarFirmaImagen(page, signatureBuffer, position, pageHeight);
      } else if (signature.type === 'pdf') {
        await this.aplicarFirmaPDF(pdfDoc, signatureBuffer, position, pageIndex);
      } else {
        throw new BadRequestException('Tipo de firma no soportado');
      }
      
      // 6. Agregar metadatos de la firma (opcional)
      const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      page.drawText(`Firmado digitalmente por tesorería el ${new Date().toLocaleString('es-CO')}`, {
        x: position.x,
        y: position.y - 15,
        size: 8,
        font: helveticaFont,
        color: rgb(0.5, 0.5, 0.5),
      });
      
      // 7. Guardar el PDF firmado (reemplazar el original)
      const signedPdfBytes = await pdfDoc.save();
      await fs.writeFile(pdfPath, signedPdfBytes); // Sobrescribimos el original
      
      this.logger.log(`✅ Firma aplicada correctamente en: ${pdfPath}`);
      
      return pdfPath;
    } catch (error) {
      this.logger.error(`❌ Error aplicando firma: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Aplica una firma de imagen en el PDF
   */
  private async aplicarFirmaImagen(
    page: any,
    imageBuffer: Buffer,
    position: { x: number; y: number; width: number; height: number },
    pageHeight: number
  ) {
    try {
      // Intentar como PNG primero
      let image;
      try {
        image = await page.doc.embedPng(imageBuffer);
      } catch {
        // Si falla, intentar como JPG
        image = await page.doc.embedJpg(imageBuffer);
      }
      
      // En PDF.js las coordenadas Y empiezan desde la parte inferior
      const yFromBottom = pageHeight - position.y - position.height;
      
      page.drawImage(image, {
        x: position.x,
        y: yFromBottom,
        width: position.width,
        height: position.height,
      });
      
      this.logger.log(`✅ Firma de imagen aplicada en posición (${position.x}, ${yFromBottom})`);
    } catch (error) {
      this.logger.error(`❌ Error aplicando firma de imagen: ${error.message}`);
      throw new BadRequestException('No se pudo aplicar la imagen de firma en el PDF');
    }
  }

  /**
   * Aplica una firma PDF (como sello) en el documento
   */
  private async aplicarFirmaPDF(
    pdfDoc: any,
    pdfBuffer: Buffer,
    position: { x: number; y: number; width: number; height: number },
    pageIndex: number
  ) {
    try {
      // Cargar el PDF de la firma
      const signaturePdf = await PDFDocument.load(pdfBuffer);
      
      // Copiar la primera página de la firma
      const [signaturePage] = await pdfDoc.copyPages(signaturePdf, [0]);
      
      // Insertar la página de la firma después de la página actual
      pdfDoc.insertPage(pageIndex + 1, signaturePage);
      
      this.logger.log(`✅ Firma PDF insertada como página ${pageIndex + 2}`);
    } catch (error) {
      this.logger.error(`❌ Error aplicando firma PDF: ${error.message}`);
      throw new BadRequestException('No se pudo aplicar el sello PDF en el documento');
    }
  }
}