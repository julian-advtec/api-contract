// src/supervisor/controllers/supervisor-documentos.controller.ts

import {
Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Req,
  HttpException,
  HttpStatus,
  Logger,
  Body,
  Res,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { SupervisorDocumentosService } from '../services/supervisor-documentos.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SupervisorGuard } from '../../common/guards/supervisor.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../users/enums/user-role.enum';
import { SignaturePositionDto } from '../dto/signature-position.dto';

@Controller('supervisor/documentos')
@UseGuards(JwtAuthGuard, RolesGuard, SupervisorGuard)
@Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
export class SupervisorDocumentosController {
  private readonly logger = new Logger(SupervisorDocumentosController.name);

  constructor(
    private readonly supervisorDocumentosService: SupervisorDocumentosService,
  ) { }

  private getUserIdFromRequest(req: Request): string {
    const user = (req as any).user;
    const userId = user?.id || user?.userId || user?.sub || user?.user?.id;

    if (!userId) {
      throw new HttpException(
        { success: false, message: 'No se pudo identificar al usuario' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return userId;
  }

  @Get('disponibles')
  async obtenerDocumentosDisponibles(@Req() req: Request) {
    const userId = this.getUserIdFromRequest(req);
    const docs = await this.supervisorDocumentosService.obtenerDocumentosDisponibles(userId);
    return { success: true, data: docs };
  }

  @Get('mis-revisiones')
  async obtenerMisRevisiones(@Req() req: Request) {
    const user = (req as any).user;
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`📋 ${user.role} ${user.username} solicitando sus revisiones activas`);

    try {
      const documentos = await this.supervisorDocumentosService.obtenerDocumentosEnRevision(userId);
      return {
        success: true,
        count: documentos.length,
        data: documentos
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo revisiones activas: ${error.message}`);
      throw new HttpException(
        { success: false, message: 'Error al obtener revisiones activas' },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('mis-supervisiones')
  async obtenerMisSupervisiones(@Req() req: Request) {
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`📋 Usuario ${userId} solicitando todas sus supervisiones`);

    try {
      const supervisiones = await this.supervisorDocumentosService.obtenerMisSupervisiones(userId);
      return {
        success: true,
        count: supervisiones.length,
        data: supervisiones
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo supervisiones: ${error.message}`);
      throw new HttpException(
        { success: false, message: 'Error al obtener supervisiones' },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('conteo/radicados')
  async obtenerConteoRadicados(@Req() req: Request) {
    const user = (req as any).user;
    this.logger.log(`📊 ${user.role} ${user.username} solicitando conteo de radicados`);

    try {
      const totalRadicados = await this.supervisorDocumentosService.obtenerConteoDocumentosRadicados();
      return {
        success: true,
        data: {
          totalRadicados: totalRadicados,
          fechaConsulta: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo conteo: ${error.message}`);
      throw new HttpException(
        { success: false, message: 'Error al obtener conteo de radicados' },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(':id')
  async obtenerDetalleDocumento(@Param('id') id: string, @Req() req: Request) {
    const userId = this.getUserIdFromRequest(req);
    try {
      const detalle = await this.supervisorDocumentosService.obtenerDetalleDocumento(id, userId);
      return { success: true, data: detalle };
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
      throw new HttpException({ success: false, message: error.message }, status);
    }
  }




  @Post('tomar/:documentoId')
  async tomarDocumento(@Param('documentoId') documentoId: string, @Req() req: Request) {
    const user = (req as any).user;
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`🤝 ${user.role} ${user.username} tomando documento ${documentoId}`);

    try {
      const resultado = await this.supervisorDocumentosService.tomarDocumentoParaRevision(documentoId, userId);
      return resultado;
    } catch (error) {
      this.logger.error(`❌ Error tomando documento: ${error.message}`);
      const status = error instanceof HttpException ? error.getStatus() : HttpStatus.BAD_REQUEST;
      throw new HttpException(
        { success: false, message: error.message || 'Error al tomar documento para revisión' },
        status
      );
    }
  }

  @Post('liberar/:documentoId')
  async liberarDocumento(@Param('documentoId') documentoId: string, @Req() req: Request) {
    const user = (req as any).user;
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`🔄 ${user.role} ${user.username} liberando documento ${documentoId}`);

    try {
      const resultado = await this.supervisorDocumentosService.liberarDocumento(documentoId, userId);
      return resultado;
    } catch (error) {
      this.logger.error(`❌ Error liberando documento: ${error.message}`);
      const status = error instanceof HttpException ? error.getStatus() : HttpStatus.BAD_REQUEST;
      throw new HttpException(
        { success: false, message: error.message || 'Error al liberar documento' },
        status
      );
    }
  }

  @Post(':documentoId/firmar-acta')
  async firmarActa(
    @Param('documentoId') documentoId: string,
    @Body() body: { signatureId: string; position: SignaturePositionDto },
    @Req() req: Request,
  ) {
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`🔏 Recibiendo firma: documento=${documentoId}, signatureId=${body.signatureId}`);
    this.logger.log(`📐 Posición: ${JSON.stringify(body.position)}`);

    return this.supervisorDocumentosService.firmarActa(
      documentoId,
      userId,
      body.signatureId,
      body.position
    );
  }

  @Post('webhook/cambio-estado')
  async webhookCambioEstado(@Req() req: Request) {
    const body = req.body;
    this.logger.log(`🔄 Webhook: Documento ${body.documentoId} cambió de ${body.estadoAnterior} a ${body.nuevoEstado}`);

    try {
      if (body.nuevoEstado === 'APROBADO_AUDITOR') {
        await this.supervisorDocumentosService.onDocumentoCambiaEstado(body.documentoId, body.nuevoEstado);
      }
      return { success: true, message: 'Webhook procesado correctamente' };
    } catch (error) {
      this.logger.error(`❌ Error procesando webhook: ${error.message}`);
      throw new HttpException(
        { success: false, message: 'Error procesando webhook' },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

@Get(':documentoId/acta')
async verActaInteligente(
  @Param('documentoId') documentoId: string,
  @Req() req: Request,
  @Res() res: Response,
) {
  const userId = this.getUserIdFromRequest(req);
  const user = (req as any).user;
  const soloLectura = req.query.soloLectura === 'true';
  
  this.logger.log(`👁️ Usuario ${userId} (${user.role}) viendo acta del documento ${documentoId} (modo lectura: ${soloLectura})`);

  try {
    let result;
    let tipoActa = 'original';
    
    if (soloLectura) {
      // Prioridad 1: Acta firmada por supervisor
      try {
        result = await this.supervisorDocumentosService.obtenerActaFirmada(documentoId, userId);
        tipoActa = 'firmada';
        this.logger.log(`✅ Mostrando acta FIRMADA`);
      } catch (error) {
        this.logger.log(`⚠️ No se encontró acta firmada: ${error.message}`);
        
        // Prioridad 2: Acta de supervisión (subida por auxiliar)
        try {
          result = await this.supervisorDocumentosService.obtenerActaSupervision(documentoId, userId);
          tipoActa = 'supervision';
          this.logger.log(`✅ Mostrando acta de SUPERVISIÓN`);
        } catch (error2) {
          this.logger.log(`⚠️ No se encontró acta de supervisión: ${error2.message}`);
          
          // Prioridad 3: Acta original (generada automáticamente)
          try {
            result = await this.supervisorDocumentosService.obtenerActaOriginal(documentoId, userId);
            tipoActa = 'original';
            this.logger.log(`✅ Mostrando acta ORIGINAL`);
          } catch (error3) {
            this.logger.error(`❌ No se pudo obtener ningún tipo de acta: ${error3.message}`);
            throw new NotFoundException('No se encontró ningún documento para mostrar');
          }
        }
      }
    } else {
      // Modo edición - siempre mostrar original para firmar
      result = await this.supervisorDocumentosService.obtenerActaOriginal(documentoId, userId);
      tipoActa = 'original';
      this.logger.log(`✅ Modo edición - mostrando acta ORIGINAL`);
    }
    
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(result.nombre)}"`);
    res.setHeader('Content-Length', result.buffer.length);
    res.setHeader('X-Tipo-Acta', tipoActa);
    
    res.end(result.buffer);
  } catch (error: any) {
    this.logger.error(`❌ Error viendo acta: ${error.message}`);
    if (!res.headersSent) {
      const status = error.status || HttpStatus.NOT_FOUND;
      res.status(status).json({
        success: false,
        message: error.message || 'Error al cargar el acta'
      });
    }
  }
}

  // Mantener los endpoints originales para compatibilidad
  @Get(':documentoId/acta-original')
  async verActaOriginal(
    @Param('documentoId') documentoId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`👁️ Supervisor ${userId} viendo acta original del documento ${documentoId}`);

    try {
      const result = await this.supervisorDocumentosService.obtenerActaOriginal(documentoId, userId);

      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(result.nombre)}"`);
      res.setHeader('Content-Length', result.buffer.length);

      res.end(result.buffer);
    } catch (error: any) {
      this.logger.error(`❌ Error viendo acta original: ${error.message}`);
      if (!res.headersSent) {
        const status = error.status || HttpStatus.NOT_FOUND;
        res.status(status).json({
          success: false,
          message: error.message || 'Error al cargar el acta'
        });
      }
    }
  }

  @Get(':documentoId/acta-firmada')
  async verActaFirmada(
    @Param('documentoId') documentoId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = this.getUserIdFromRequest(req);
    const user = (req as any).user;
    // ✅ Cambiar el mensaje para que no asuma que es supervisor
    this.logger.log(`👁️ Usuario ${userId} (${user.role}) viendo acta firmada del documento ${documentoId}`);

    try {
      const result = await this.supervisorDocumentosService.obtenerActaFirmada(documentoId, userId);
      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(result.nombre)}"`);
      res.setHeader('Content-Length', result.buffer.length);

      res.end(result.buffer);
    } catch (error: any) {
      this.logger.error(`❌ Error viendo acta firmada: ${error.message}`);
      if (!res.headersSent) {
        const status = error.status || HttpStatus.NOT_FOUND;
        res.status(status).json({
          success: false,
          message: error.message || 'Error al cargar el acta firmada'
        });
      }
    }
  }


 @Get(':documentoId/acta-disponible')
async verActaDisponible(
    @Param('documentoId') documentoId: string,
    @Req() req: Request,
    @Res() res: Response,
) {
    const userId = this.getUserIdFromRequest(req);
    const user = (req as any).user;
    
    this.logger.log(`👁️ Usuario ${userId} (${user.role}) solicitando acta disponible del documento ${documentoId}`);

    try {
        let result;
        let tipoActa = 'original';
        
        // Intentar obtener acta firmada primero
        try {
            result = await this.supervisorDocumentosService.obtenerActaFirmada(documentoId, userId);
            tipoActa = 'firmada';
            this.logger.log(`✅ Mostrando acta FIRMADA`);
        } catch (error) {
            // Si no hay firmada, intentar obtener acta de supervisión
            try {
                result = await this.supervisorDocumentosService.obtenerActaSupervision(documentoId, userId);
                tipoActa = 'supervision';
                this.logger.log(`✅ Mostrando acta de SUPERVISIÓN`);
            } catch (error2) {
                // Finalmente, mostrar acta original
                result = await this.supervisorDocumentosService.obtenerActaOriginal(documentoId, userId);
                tipoActa = 'original';
                this.logger.log(`✅ Mostrando acta ORIGINAL`);
            }
        }
        
        res.setHeader('Content-Type', result.mimeType);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(result.nombre)}"`);
        res.setHeader('Content-Length', result.buffer.length);
        res.setHeader('X-Tipo-Acta', tipoActa);
        
        res.end(result.buffer);
    } catch (error: any) {
        this.logger.error(`❌ Error viendo acta: ${error.message}`);
        if (!res.headersSent) {
            const status = error.status || HttpStatus.NOT_FOUND;
            res.status(status).json({
                success: false,
                message: error.message || 'Error al cargar el acta'
            });
        }
    }
}
}