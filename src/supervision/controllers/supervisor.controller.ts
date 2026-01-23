import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  Req,
  Res,
  Query,
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { FileInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import * as fs from 'fs';  // ← AÑADIR ESTO
import * as path from 'path';  // ← AÑADIR ESTO

// Importar servicios especializados
import { SupervisorService } from '../services/supervisor.service';
import { SupervisorDocumentosService } from '../services/supervisor-documentos.service';
import { SupervisorRevisionService } from '../services/supervisor-revision.service';
import { SupervisorArchivosService } from '../services/supervisor-archivos.service';
import { SupervisorEstadisticasService } from '../services/supervisor-estadisticas.service';

import { RevisarDocumentoDto } from '../dto/revisar-documento.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SupervisorGuard } from '../../common/guards/supervisor.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../users/enums/user-role.enum';

// Este controlador mantiene compatibilidad con las rutas antiguas
@Controller('supervisor')
@UseGuards(JwtAuthGuard, RolesGuard, SupervisorGuard)
@Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
export class SupervisorController {
  private readonly logger = new Logger(SupervisorController.name);

  constructor(
    private readonly supervisorService: SupervisorService,
    private readonly documentosService: SupervisorDocumentosService,
    private readonly revisionService: SupervisorRevisionService,
    private readonly archivosService: SupervisorArchivosService,
    private readonly estadisticasService: SupervisorEstadisticasService,
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
  // RUTAS PARA MANTENER COMPATIBILIDAD
  // ===============================

  @Get('documentos-disponibles')
  async obtenerDocumentosDisponibles(@Req() req: Request) {
    return this.documentosService.obtenerDocumentosDisponibles(this.getUserIdFromRequest(req));
  }

  @Post('tomar-documento/:documentoId')
  async tomarDocumento(@Param('documentoId') documentoId: string, @Req() req: Request) {
    return this.documentosService.tomarDocumentoParaRevision(documentoId, this.getUserIdFromRequest(req));
  }

  @Post('liberar-documento/:documentoId')
  async liberarDocumento(@Param('documentoId') documentoId: string, @Req() req: Request) {
    return this.documentosService.liberarDocumento(documentoId, this.getUserIdFromRequest(req));
  }

  @Get('mis-revisiones')
  async obtenerMisRevisiones(@Req() req: Request) {
    const documentos = await this.documentosService.obtenerDocumentosEnRevision(this.getUserIdFromRequest(req));
    return { success: true, count: documentos.length, data: documentos };
  }

  @Get('documento/:id')
  async obtenerDetalleDocumento(@Param('id') id: string, @Req() req: Request) {
    const detalle = await this.documentosService.obtenerDetalleDocumento(id, this.getUserIdFromRequest(req));
    return { success: true, data: detalle };
  }

  @Post('revisar/:documentoId')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'archivoAprobacion', maxCount: 1 },
      { name: 'pazSalvo', maxCount: 1 },
    ]),
  )
  async revisarDocumento(
    @Param('documentoId') documentoId: string,
    @Body(new ValidationPipe({ transform: true })) dto: RevisarDocumentoDto,
    @UploadedFiles() files: {
      archivoAprobacion?: Express.Multer.File[];
      pazSalvo?: Express.Multer.File[];
    },
    @Req() req: Request,
  ) {
    const userId = this.getUserIdFromRequest(req);
    const archivoAprobacion = files.archivoAprobacion?.[0];
    const pazSalvo = files.pazSalvo?.[0];

    try {
      const result = await this.revisionService.revisarDocumento(
        documentoId,
        userId,
        dto,
        archivoAprobacion,
        pazSalvo,
      );

      return {
        success: true,
        message: `Documento revisado (${dto.estado})`,
        data: result,
      };
    } catch (error) {
      this.logger.error(`Error revisando documento: ${error.message}`);
      throw new HttpException(
        { success: false, message: error.message || 'Error al revisar' },
        error instanceof HttpException ? error.getStatus() : HttpStatus.BAD_REQUEST,
      );
    }
  }

   @Get('descargar/:documentoId/archivo/:numeroArchivo')
  async descargarArchivoRadicado(
    @Param('documentoId') documentoId: string,
    @Param('numeroArchivo') numeroArchivo: number,
    @Req() req: Request,
    @Res() res: Response,
    @Query('download') download?: string,
  ) {
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`📥 Usuario ${userId} descargando archivo ${numeroArchivo} de ${documentoId}`);

    try {
      const { ruta, nombre } = await this.supervisorService.descargarArchivoRadicado(
        documentoId,
        numeroArchivo,
        userId,
      );

      const isDownload = download === 'true';

      res.setHeader('Content-Type', 'application/octet-stream');
      if (isDownload) {
        res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
      } else {
        // Para previsualización inline (PDF, imágenes)
        const ext = path.extname(nombre).toLowerCase();
        const mime = {
          '.pdf': 'application/pdf',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.doc': 'application/msword',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
      }

      const stream = fs.createReadStream(ruta);
      stream.pipe(res);
    } catch (error) {
      this.logger.error(`❌ Error descargando archivo: ${error.message}`);
      if (!res.headersSent) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          message: error.message || 'Archivo no encontrado',
        });
      }
    }
  }

  @Get('historial')
  async obtenerHistorial(@Req() req: Request, @Query('limit') limit?: number) {
    const historial = await this.estadisticasService.obtenerHistorialSupervisor(this.getUserIdFromRequest(req));
    return {
      success: true,
      count: historial.length,
      data: limit ? historial.slice(0, limit) : historial
    };
  }

  @Get('estadisticas')
  async obtenerEstadisticas(@Req() req: Request) {
    const estadisticas = await this.estadisticasService.obtenerEstadisticasSupervisor(this.getUserIdFromRequest(req));
    return { success: true, data: estadisticas };
  }

  @Post('asignar-todos')
  @Roles(UserRole.ADMIN)
  async asignarTodosDocumentos(@Req() req: Request) {
    const resultado = await this.documentosService.asignarTodosDocumentosASupervisores();
    return {
      success: true,
      message: `Asignación completada: ${resultado.asignados} de ${resultado.total} documentos asignados`,
      data: resultado
    };
  }
}