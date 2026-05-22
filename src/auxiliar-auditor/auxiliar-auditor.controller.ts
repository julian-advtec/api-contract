// src/auxiliar-auditor/auxiliar-auditor.controller.ts
import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  Res,
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { AuxiliarAuditorService } from './auxiliar-auditor.service';

@Controller('auxiliar-auditor')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.AUXILIAR_AUDITOR, UserRole.ADMIN)
export class AuxiliarAuditorController {
  private readonly logger = new Logger(AuxiliarAuditorController.name);

  constructor(
    private readonly auxiliarService: AuxiliarAuditorService,
  ) {}

  @Get('documentos/disponibles')
  async getDocumentosDisponibles(@Req() req: Request) {
    try {
      const user = req.user as any;
      this.logger.log(`📋 Auxiliar ${user.username} solicitando documentos disponibles`);
      
      const documentos = await this.auxiliarService.obtenerDocumentosDisponibles(user.id);
      
      return {
        success: true,
        count: documentos.length,
        data: documentos,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error(`❌ Error obteniendo documentos: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error al obtener documentos disponibles',
        },
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('documentos/:documentoId')
  async getDocumentoDetalle(
    @Param('documentoId') documentoId: string,
    @Req() req: Request,
  ) {
    try {
      const user = req.user as any;
      this.logger.log(`🔍 Auxiliar ${user.username} viendo detalle del documento ${documentoId}`);
      
      const detalle = await this.auxiliarService.obtenerDetalleDocumento(documentoId, user.id);
      
      return {
        success: true,
        data: detalle,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error(`❌ Error obteniendo detalle: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error al obtener detalle del documento',
        },
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('documentos/:documentoId/subir-acta')
  @UseInterceptors(FileInterceptor('actaSupervision'))
  async subirActaSupervision(
    @Param('documentoId') documentoId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    try {
      const user = req.user as any;
      
      if (!file) {
        throw new BadRequestException('Debe adjuntar el acta de supervisión');
      }

      const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
      if (!allowedTypes.includes(file.mimetype)) {
        throw new BadRequestException('El acta debe ser PDF o Word (doc, docx)');
      }

      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        throw new BadRequestException('El archivo no puede superar los 10MB');
      }

      this.logger.log(`📤 Auxiliar ${user.username} subiendo acta para documento ${documentoId}`);
      
      const resultado = await this.auxiliarService.subirActaSupervision(
        documentoId,
        user.id,
        file,
      );
      
      return {
        success: true,
        message: 'Acta de supervisión subida exitosamente',
        data: resultado,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error(`❌ Error subiendo acta: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error al subir el acta de supervisión',
        },
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('documentos/:documentoId/acta')
  async descargarActaSupervision(
    @Param('documentoId') documentoId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const user = req.user as any;
      this.logger.log(`📥 Auxiliar ${user.username} descargando acta del documento ${documentoId}`);
      
      const result = await this.auxiliarService.obtenerActaSupervision(documentoId, user.id);
      
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(result.nombre)}"`);
      res.setHeader('Content-Length', result.buffer.length);
      
      res.end(result.buffer);
    } catch (error: any) {
      this.logger.error(`❌ Error descargando acta: ${error.message}`);
      if (!res.headersSent) {
        const status = error.status || HttpStatus.NOT_FOUND;
        res.status(status).json({
          success: false,
          message: error.message || 'Error al descargar el acta',
        });
      }
    }
  }
}