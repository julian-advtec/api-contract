// src/asesor-gerencia/asesor-gerencia.controller.ts
import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Body,
  ParseUUIDPipe,
  Res,
  Req,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { AsesorGerenciaService } from './asesor-gerencia.service';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express'; // ← CORRECCIÓN: import type
import { multerAsesorGerenciaConfig } from '../config/multer-asesor-gerencia.config';
import { AsesorGerenciaEstado } from './entities/asesor-gerencia-estado.enum';
import * as path from 'path';
// Tipo del usuario del JWT
interface JwtUser {
  id: string;
  username: string;
  role: UserRole;
  fullName?: string;
}


@Controller('asesor-gerencia')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AsesorGerenciaController {
  private readonly logger = new Logger(AsesorGerenciaController.name);

  constructor(private readonly service: AsesorGerenciaService) { }

  @Get('documentos/disponibles')
  @Roles(UserRole.ADMIN, UserRole.ASESOR_GERENCIA)
  async getDocumentosDisponibles(@GetUser() user: JwtUser) {
    this.logger.log(`[Disponibles] Solicitado por ${user.username} (${user.role})`);
    return this.service.obtenerDocumentosDisponibles(user.id);
  }

  @Post('documentos/:documentoId/tomar')
  @Roles(UserRole.ADMIN, UserRole.ASESOR_GERENCIA)
  async tomarDocumento(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: JwtUser,
  ) {
    return this.service.tomarDocumentoParaRevision(documentoId, user.id);
  }

  @Get('mis-documentos')
  @Roles(UserRole.ADMIN, UserRole.ASESOR_GERENCIA)
  async getMisDocumentos(@GetUser() user: JwtUser) {
    return this.service.obtenerMisDocumentosEnRevision(user.id);
  }

  @Post('documentos/:documentoId/subir-aprobacion')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'aprobacion', maxCount: 1 }], multerAsesorGerenciaConfig),
  )
  @Roles(UserRole.ADMIN, UserRole.ASESOR_GERENCIA)
  async subirAprobacion(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: JwtUser,
    @Body() body: any,
    @UploadedFiles() files: { aprobacion?: Express.Multer.File[] },
  ) {
    return this.

      service.subirDocumentoAprobacion(documentoId, user.id, body, files || {});
  }

  @Post('documentos/:documentoId/finalizar')
  @Roles(UserRole.ADMIN, UserRole.ASESOR_GERENCIA)
  async finalizar(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: JwtUser,
    @Body() body: {
      estadoFinal: string;
      observaciones?: string;
      signatureId?: string;
      signaturePosition?: any;
    },
  ) {
    this.logger.log(`Finalizar revisión - doc: ${documentoId}, usuario: ${user.username}, estado: ${body.estadoFinal}`);

    if (!body.estadoFinal) {
      throw new BadRequestException('Debe especificar estadoFinal');
    }

    let estado: AsesorGerenciaEstado;
    const ef = (body.estadoFinal || '').toUpperCase();

    if (ef.includes('APROBADO') || ef.includes('COMPLETADO')) {
      estado = AsesorGerenciaEstado.COMPLETADO_ASESOR_GERENCIA;

      // Firma OBLIGATORIA para APROBADO
      if (!body.signatureId || !body.signaturePosition) {
        throw new BadRequestException('Para aprobar es obligatorio proporcionar signatureId y signaturePosition');
      }
    } else if (ef.includes('OBSERVADO')) {
      estado = AsesorGerenciaEstado.OBSERVADO_ASESOR_GERENCIA;
    } else if (ef.includes('RECHAZADO')) {
      estado = AsesorGerenciaEstado.RECHAZADO_ASESOR_GERENCIA;
    } else {
      throw new BadRequestException('Estado inválido. Valores permitidos: APROBADO, OBSERVADO, RECHAZADO');
    }

    return this.service.finalizarRevision(
      documentoId,
      user.id,
      estado,
      body.observaciones,
      body.signatureId,
      body.signaturePosition
    );
  }

  @Delete('documentos/:documentoId/liberar')
  @Roles(UserRole.ADMIN, UserRole.ASESOR_GERENCIA)
  async liberar(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: JwtUser,
  ) {
    return this.service.liberarDocumento(documentoId, user.id);
  }



  // Historial (ya agregado anteriormente)
  @Get('historial')
  @Roles(UserRole.ADMIN, UserRole.ASESOR_GERENCIA)
  async getHistorial(@GetUser() user: JwtUser) {
    this.logger.log(`[Historial] Solicitado por ${user.username} (${user.role})`);
    const historial = await this.service.obtenerHistorial(user.id);
    return { success: true, data: historial };
  }

  @Get('documentos/:documentoId/detalle')
  @Roles(UserRole.ADMIN, UserRole.ASESOR_GERENCIA)
  async getDetalleRevision(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: JwtUser,
  ) {
    this.logger.log(`[DETALLE-GERENCIA] Solicitado por ${user.username} (${user.role}) para ${documentoId}`);
    const detalle = await this.service.obtenerDetalleRevision(documentoId, user.id);
    return detalle;
  }

  @Get('rechazados-visibles')
  @Roles(UserRole.ADMIN, UserRole.ASESOR_GERENCIA)
  async obtenerRechazadosVisibles(@GetUser() user: JwtUser) {
    this.logger.log(`[RECHAZADOS-VISIBLES] Solicitado por ${user.username} (${user.role})`);

    const docs = await this.service.obtenerRechazadosVisibles(user.id);

    return {
      success: true,
      count: docs.length,
      data: docs
    };
  }

  @Get('documentos/:documentoId/archivo/:tipo')
  @Roles(UserRole.ADMIN, UserRole.ASESOR_GERENCIA)
  async verArchivo(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @Param('tipo') tipo: string,
    @Res() res: Response,
  ) {
    try {
      // ✅ Normalizar el tipo a minúsculas para evitar problemas de mayúsculas/minúsculas
      const tipoNormalizado = tipo.toLowerCase();

      this.logger.log(`📄 Solicitando archivo - doc: ${documentoId}, tipo original: ${tipo}, normalizado: ${tipoNormalizado}`);

      const { rutaAbsoluta, nombreArchivo } = await this.service.obtenerRutaArchivo(documentoId, tipoNormalizado);

      this.logger.log(`✅ Archivo encontrado: ${rutaAbsoluta}`);

      // Determinar Content-Type basado en la extensión
      const ext = path.extname(rutaAbsoluta).toLowerCase();
      let contentType = 'application/octet-stream';

      if (ext === '.pdf') {
        contentType = 'application/pdf';
      } else if (ext === '.jpg' || ext === '.jpeg') {
        contentType = 'image/jpeg';
      } else if (ext === '.png') {
        contentType = 'image/png';
      } else if (ext === '.doc') {
        contentType = 'application/msword';
      } else if (ext === '.docx') {
        contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}"`);
      res.sendFile(rutaAbsoluta);
    } catch (error) {
      this.logger.error(`❌ Error al servir archivo ${tipo} para ${documentoId}: ${error.message}`);

      if (error instanceof NotFoundException) {
        res.status(404).json({
          success: false,
          message: error.message || `Archivo tipo ${tipo} no encontrado`
        });
      } else {
        res.status(500).json({
          success: false,
          message: error.message || 'Error interno al obtener el archivo'
        });
      }
    }
  }

  @Get('documentos/:documentoId/comprobante-firmado')
  @Roles(UserRole.ADMIN, UserRole.ASESOR_GERENCIA)
  async verComprobanteFirmado(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @Res() res: Response,
  ) {
    try {
      const { rutaAbsoluta, nombreArchivo } = await this.service.obtenerRutaComprobanteFirmado(documentoId);
      this.logger.log(`Sirviendo comprobante firmado: ${rutaAbsoluta}`);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}"`);
      res.sendFile(rutaAbsoluta);
    } catch (error) {
      this.logger.error(`Error sirviendo comprobante firmado ${documentoId}: ${error.message}`);
      res.status(error instanceof NotFoundException ? 404 : 500).json({
        message: error.message || 'Comprobante firmado no encontrado'
      });
    }
  }

  @Get('todos-documentos')
  @Roles(UserRole.ADMIN, UserRole.ASESOR_GERENCIA)
  async getTodosDocumentos(@GetUser() user: JwtUser) {
    this.logger.log(`[TODOS-DOCUMENTOS] Solicitado por ${user.username} (${user.role})`);
    const documentos = await this.service.obtenerTodosDocumentos(user.id);
    return { success: true, data: documentos };
  }

}