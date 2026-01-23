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
import type { Response } from 'express';
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
  constructor(private readonly auditorService: AuditorService) { }

  @Get('documentos/disponibles')
  async getDocumentosDisponibles(@GetUser() user: any) {
    return this.auditorService.obtenerDocumentosDisponibles(user.id);
  }

  @Post('documentos/:documentoId/tomar')
  async tomarDocumentoParaRevision(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any
  ) {
    return this.auditorService.tomarDocumentoParaRevision(documentoId, user.id);
  }

  @Get('mis-documentos')
  async getMisDocumentos(@GetUser() user: any) {
    return this.auditorService.obtenerDocumentosEnRevision(user.id);
  }

  @Get('documentos/:documentoId')
  async getDetalleDocumento(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any
  ) {
    return this.auditorService.obtenerDetalleDocumento(documentoId, user.id);
  }

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
      user.id,
      subirDto,
      files,
    );
  }

  @Put('documentos/:documentoId/revisar')
  async revisarDocumento(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any,
    @Body() revisarDto: RevisarAuditorDocumentoDto,
  ) {
    return this.auditorService.revisarDocumento(
      documentoId,
      user.id,
      revisarDto,
    );
  }

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
      user.id,
    );

    res.download(ruta, nombre);
  }

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
      user.id,
    );

    res.download(ruta, nombre);
  }

  @Delete('documentos/:documentoId/liberar')
  async liberarDocumento(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any,
  ) {
    return this.auditorService.liberarDocumento(documentoId, user.id);
  }

  @Get('estadisticas')
  async getEstadisticas(@GetUser() user: any) {
    return this.auditorService.obtenerEstadisticasAuditor(user.id);
  }

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
    return this.auditorService.obtenerDocumentosDisponibles(user.id);
  }

  @Get('historial')
  async getHistorial(@GetUser() user: any) {
    return this.auditorService.obtenerHistorialAuditor(user.id);
  }

  @Get('documentos/:documentoId/vista')
  async getDocumentoParaVista(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any
  ) {
    console.log('[CONTROLLER] Solicitud para documento:', documentoId);
    console.log('[CONTROLLER] Usuario:', user.id, user.username);

    const resultado = await this.auditorService.obtenerDocumentoParaVista(documentoId, user?.id);

    console.log('[CONTROLLER] Resultado a enviar:', {
      success: resultado.success,
      estado: resultado.data?.documento?.estado,
      numeroRadicado: resultado.data?.documento?.numeroRadicado,
      tieneDatos: !!resultado.data
    });

    return {
      ...resultado,
      estado: resultado.data?.documento?.estado || resultado.estado,
      estadoDocumento: resultado.data?.documento?.estado || resultado.estado
    };
  }

  @Get('mis-auditorias')
  async getMisAuditorias(@GetUser() user: any) {
    console.log('[MIS-AUDITORIAS] Usuario logueado ID:', user.id);
    console.log('[MIS-AUDITORIAS] Nombre:', user.fullName || user.username);
    return this.auditorService.obtenerMisAuditorias(user.id);
  }

  @Get('documentos/:documentoId/estado-archivos')
  async getEstadoArchivos(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any
  ) {
    return this.auditorService.obtenerEstadoArchivos(documentoId, user.id);
  }

  @Get('documentos/:documentoId/debug')
  async getDocumentoDebug(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: any
  ) {
    console.log('[CONTROLLER-DEBUG] Solicitud debug para documento:', documentoId);
    return this.auditorService.obtenerDocumentoDebug(documentoId, user.id);
  }

}