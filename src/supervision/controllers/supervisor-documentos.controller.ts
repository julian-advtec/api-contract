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
} from '@nestjs/common';
import type { Request } from 'express';

import { SupervisorDocumentosService } from '../services/supervisor-documentos.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SupervisorGuard } from '../../common/guards/supervisor.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../users/enums/user-role.enum';

@Controller('supervisor/documentos')
@UseGuards(JwtAuthGuard, RolesGuard, SupervisorGuard)
@Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
export class SupervisorDocumentosController {
  private readonly logger = new Logger(SupervisorDocumentosController.name);

  constructor(
    private readonly supervisorDocumentosService: SupervisorDocumentosService,
  ) {}

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

  // ===============================
  // ✅ RUTAS ESPECÍFICAS (DEBEN IR PRIMERO)
  // ===============================

  // 1. DOCUMENTOS DISPONIBLES
  @Get('disponibles')
  async obtenerDocumentosDisponibles(@Req() req: Request) {
    const userId = this.getUserIdFromRequest(req);
    const docs = await this.supervisorDocumentosService.obtenerDocumentosDisponibles(userId);
    return { success: true, data: docs };
  }

  // 2. MIS REVISIONES ACTIVAS
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
        {
          success: false,
          message: 'Error al obtener revisiones activas'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // 3. MIS SUPERVISIONES (TODAS)
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

  // 4. CONTEO DE DOCUMENTOS RADICADOS
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
        {
          success: false,
          message: 'Error al obtener conteo de radicados'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // ===============================
  // ⚠️ RUTA CON PARÁMETRO (DEBE IR AL FINAL)
  // ===============================
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

  // ===============================
  // POST (PUEDEN IR DESPUÉS)
  // ===============================
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
        {
          success: false,
          message: error.message || 'Error al tomar documento para revisión'
        },
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
        {
          success: false,
          message: error.message || 'Error al liberar documento'
        },
        status
      );
    }
  }

  @Post('webhook/cambio-estado')
  async webhookCambioEstado(@Req() req: Request) {
    const body = req.body;
    this.logger.log(`🔄 Webhook: Documento ${body.documentoId} cambió de ${body.estadoAnterior} a ${body.nuevoEstado}`);

    try {
      if (body.nuevoEstado === 'RADICADO') {
        await this.supervisorDocumentosService.onDocumentoCambiaEstado(body.documentoId, body.nuevoEstado);
      }

      return {
        success: true,
        message: 'Webhook procesado correctamente'
      };
    } catch (error) {
      this.logger.error(`❌ Error procesando webhook: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error procesando webhook'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
