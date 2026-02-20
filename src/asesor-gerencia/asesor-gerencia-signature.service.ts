// src/asesor-gerencia/asesor-gerencia-signature.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import * as fs from 'fs/promises';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Signature } from './../signatures/entities/signature.entity';
import { EncryptionService } from './../signatures/encryption.service';

@Injectable()
export class AsesorGerenciaSignatureService {
  private readonly logger = new Logger(AsesorGerenciaSignatureService.name);

  constructor(
    @InjectRepository(Signature)
    private signaturesRepository: Repository<Signature>,
    private readonly encryptionService: EncryptionService,
  ) {}

  async aplicarFirmaEnPDF(
    pdfPath: string,
    signatureId: string,
    position: { page: number; x: number; y: number; width: number; height: number }
  ): Promise<string> {
    try {
      this.logger.log(`Aplicando firma en ${pdfPath} | firma ID: ${signatureId}`);

      const signature = await this.signaturesRepository.findOneBy({ id: signatureId });
      if (!signature) throw new NotFoundException('Firma no encontrada');

      const signatureBuffer = this.encryptionService.decryptFromDb(signature.encryptedData);
      if (!signatureBuffer || signatureBuffer.length < 100) {
        throw new BadRequestException('Firma desencriptada inválida o vacía');
      }

      const pdfBytes = await fs.readFile(pdfPath);
      const pdfDoc = await PDFDocument.load(pdfBytes);

      const pageIndex = position.page - 1;
      if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) {
        throw new BadRequestException(`Página ${position.page} no existe`);
      }

      const page = pdfDoc.getPage(pageIndex);
      const { width: pageWidth, height: pageHeight } = page.getSize();

      const finalX = Math.max(0, Math.min(position.x, pageWidth - position.width));
      const finalY = Math.max(0, Math.min(position.y, pageHeight - position.height));

      if (signature.type === 'image') {
        await this.drawImageSignature(page, signatureBuffer, { x: finalX, y: finalY, width: position.width, height: position.height });
      } else if (signature.type === 'pdf') {
        await this.drawPdfSignature(pdfDoc, page, signatureBuffer, { x: finalX, y: finalY, width: position.width, height: position.height });
      } else {
        throw new BadRequestException(`Tipo de firma no soportado: ${signature.type}`);
      }

      const signedBytes = await pdfDoc.save();
      await fs.writeFile(pdfPath, signedBytes);

      this.logger.log(`Firma aplicada correctamente en (${finalX}, ${finalY})`);
      return pdfPath;
    } catch (error) {
      this.logger.error(`Error al aplicar firma: ${error.message}`, error.stack);
      throw error;
    }
  }

  private async drawImageSignature(page: any, imageBuffer: Buffer, pos: { x: number; y: number; width: number; height: number }) {
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
    page.drawImage(image, { x: pos.x, y: pos.y, width: pos.width, height: pos.height });
  }

  private async drawPdfSignature(pdfDoc: PDFDocument, targetPage: any, pdfBuffer: Buffer, pos: { x: number; y: number; width: number; height: number }) {
    const signaturePdf = await PDFDocument.load(pdfBuffer);
    if (signaturePdf.getPageCount() === 0) throw new BadRequestException('PDF de firma vacío');

    const [signaturePage] = signaturePdf.getPages();
    const embeddedPage = await pdfDoc.embedPage(signaturePage);
    const { width: origWidth, height: origHeight } = embeddedPage;

    const scaleX = pos.width / origWidth;
    const scaleY = pos.height / origHeight;
    const scale = Math.min(scaleX, scaleY);

    targetPage.drawPage(embeddedPage, {
      x: pos.x,
      y: pos.y,
      xScale: scale,
      yScale: scale,
    });
  }
}