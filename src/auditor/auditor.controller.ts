// src/auditor/controllers/auditor.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Body,
  ParseUUIDPipe,
  Res,
  Query,
  Delete
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express'; // ✅ CAMBIO: Importar como type
import * as fs from 'fs';
import * as path from 'path';

import { JwtAuthGuard } from './../common/guards/jwt-auth.guard';
import { RolesGuard } from './../common/guards/roles.guard';
import { AuditorGuard } from './../common/guards/auditor.guard';
import { Roles } from './../auth/decorators/roles.decorator';
import { GetUser } from './../auth/decorators/get-user.decorator';
import { UserRole } from './../users/enums/user-role.enum';
import { AuditorService } from './auditor.service';
import { SubirDocumentosAuditorDto } from './dto/subir-documentos-auditor.dto';
import { RevisarAuditorDocumentoDto } from './dto/revisar-auditor-documento.dto';
import { multerAuditorConfig } from './../config/multer-auditor.config';

@Controller('auditor')
@UseGuards(JwtAuthGuard, RolesGuard, AuditorGuard)
@Roles(UserRole.AUDITOR_CUENTAS, UserRole.ADMIN)
export class AuditorController {
  constructor(private readonly auditorService: AuditorService) {}

  /**
   * ✅ ENDPOINT 1: Obtener documentos disponibles para auditoría
   * GET /auditor/documentos/disponibles
   */
  @Get('documentos/disponibles')
  async getDocumentosDisponibles(@GetUser() user: any) {
    return this.auditorService.obtenerDocumentosDisponibles(user.id); // ✅ user.id en lugar de user.userId
  }

  /**
   * ✅ ENDPOINT 2: Tomar documento para revisión
   * POST /auditor/documentos/:documentoId/tomar
   */
  @Post('documentos/:documentoId/tomar')
  async tomarDocumentoParaRevision(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any
  ) {
    return this.auditorService.tomarDocumentoParaRevision(documentoId, user.id); // ✅ user.id
  }

  /**
   * ✅ ENDPOINT 3: Obtener documentos que estoy revisando
   * GET /auditor/mis-documentos
   */
  @Get('mis-documentos')
  async getMisDocumentos(@GetUser() user: any) {
    return this.auditorService.obtenerDocumentosEnRevision(user.id); // ✅ user.id
  }

  /**
   * ✅ ENDPOINT 4: Obtener detalle de un documento
   * GET /auditor/documentos/:documentoId
   */
  @Get('documentos/:documentoId')
  async getDetalleDocumento(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any
  ) {
    return this.auditorService.obtenerDetalleDocumento(documentoId, user.id); // ✅ user.id
  }

  /**
   * ✅ ENDPOINT 5: Subir documentos del auditor (MULTIPART)
   * POST /auditor/documentos/:documentoId/subir-documentos
   * IMPORTANTE: Sube los 6 archivos requeridos
   */
  @Post('documentos/:documentoId/subir-documentos')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'rp', maxCount: 1 },
        { name: 'cdp', maxCount: 1 },
        { name: 'poliza', maxCount: 1 },
        { name: 'certificadoBancario', maxCount: 1 },
        { name: 'minuta', maxCount: 1 },
        { name: 'actaInicio', maxCount: 1 },
      ],
      multerAuditorConfig,
    ),
  )
  async subirDocumentosAuditor(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any,
    @Body() subirDto: SubirDocumentosAuditorDto,
    @UploadedFiles() files: { [fieldname: string]: Express.Multer.File[] },
  ) {
    return this.auditorService.subirDocumentosAuditor(
      documentoId,
      user.id, // ✅ user.id
      subirDto,
      files,
    );
  }

  /**
   * ✅ ENDPOINT 6: Revisar y aprobar/rechazar documento
   * PUT /auditor/documentos/:documentoId/revisar
   */
  @Put('documentos/:documentoId/revisar')
  async revisarDocumento(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any,
    @Body() revisarDto: RevisarAuditorDocumentoDto,
  ) {
    return this.auditorService.revisarDocumento(
      documentoId,
      user.id, // ✅ user.id
      revisarDto,
    );
  }

  /**
   * ✅ ENDPOINT 7: Descargar archivo del radicador
   * GET /auditor/documentos/:documentoId/descargar-radicado/:numeroArchivo
   */
  @Get('documentos/:documentoId/descargar-radicado/:numeroArchivo')
  async descargarArchivoRadicado(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @Param('numeroArchivo') numeroArchivo: number,
    @GetUser() user: any,
    @Res() res: Response,
  ) {
    const { ruta, nombre } = await this.auditorService.descargarArchivoRadicado(
      documentoId,
      numeroArchivo,
      user.id, // ✅ user.id
    );

    res.download(ruta, nombre);
  }

  /**
   * ✅ ENDPOINT 8: Descargar archivo subido por el auditor
   * GET /auditor/documentos/:documentoId/descargar-auditor/:tipoArchivo
   */
  @Get('documentos/:documentoId/descargar-auditor/:tipoArchivo')
  async descargarArchivoAuditor(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @Param('tipoArchivo') tipoArchivo: string,
    @GetUser() user: any,
    @Res() res: Response,
  ) {
    const { ruta, nombre } = await this.auditorService.descargarArchivoAuditor(
      documentoId,
      tipoArchivo,
      user.id, // ✅ user.id
    );

    res.download(ruta, nombre);
  }

  /**
   * ✅ ENDPOINT 9: Liberar documento
   * DELETE /auditor/documentos/:documentoId/liberar
   */
  @Delete('documentos/:documentoId/liberar')
  async liberarDocumento(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any,
  ) {
    return this.auditorService.liberarDocumento(documentoId, user.id); // ✅ user.id
  }

  /**
   * ✅ ENDPOINT 10: Obtener estadísticas
   * GET /auditor/estadisticas
   */
  @Get('estadisticas')
  async getEstadisticas(@GetUser() user: any) {
    return this.auditorService.obtenerEstadisticasAuditor(user.id); // ✅ user.id
  }

  /**
   * ✅ ENDPOINT 11: Buscar documentos por criterios
   * GET /auditor/buscar
   */
  @Get('buscar')
  async buscarDocumentos(
    @GetUser() user: any,
    @Query('numeroRadicado') numeroRadicado?: string,
    @Query('numeroContrato') numeroContrato?: string,
    @Query('documentoContratista') documentoContratista?: string,
    @Query('estado') estado?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    return this.auditorService.obtenerDocumentosDisponibles(user.id); // ✅ user.id
  }

  /**
   * ✅ ENDPOINT 12: Obtener historial de auditorías realizadas
   * GET /auditor/historial
   */
  @Get('historial')
  async getHistorial(@GetUser() user: any) {
    // Este método deberías implementarlo en el servicio
    // Por ahora retornamos los documentos que ha revisado
    return this.auditorService.obtenerDocumentosEnRevision(user.id); // ✅ user.id
  }
}