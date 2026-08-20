// src/contratista/controllers/contratista-documento.controller.ts
import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  Res,
  Req,
  Logger,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UserRole } from '../../users/enums/user-role.enum';
import { ContratistaDocumentoService } from '../services/contratista-documento.service';
import { ContratistaService } from '../services/contratista.service';
import { TipoDocumento } from '../entities/documento-contratista.entity';
import { BitacoraSistemaService } from '../../bitacora-sistema/bitacora-sistema.service';
import { ModuloBitacora, AccionBitacora } from '../../bitacora-sistema/entities/bitacora-sistema.entity';

@Controller('contratistas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContratistaDocumentoController {
  private readonly logger = new Logger(ContratistaDocumentoController.name);

  constructor(
    private readonly documentoService: ContratistaDocumentoService,
    private readonly bitacoraService: BitacoraSistemaService,
    private readonly contratistaService: ContratistaService,
  ) {}

  /**
   * Obtener documentos de un contratista
   * GET /contratistas/:id/documentos
   */
  @Get(':id/documentos')
  @Public()
  async obtenerDocumentos(@Param('id') id: string, @Req() req?: any) {
    try {
      this.logger.log(`📋 Obteniendo documentos de contratista ${id}`);

      const documentos = await this.documentoService.obtenerDocumentos(id);

      return {
        ok: true,
        data: {
          success: true,
          count: documentos.length,
          data: documentos
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: error.message,
          data: []
        }
      };
    }
  }

  /**
   * Subir documento a un contratista
   * POST /contratistas/:id/documentos
   */
  @Post(':id/documentos')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
  @UseInterceptors(FileInterceptor('documento'))
  async subirDocumento(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('tipo') tipo: string,
    @Req() req: any
  ) {
    try {
      this.logger.log(`📄 Subiendo documento para contratista ${id}: ${tipo}`);

      if (!file) {
        throw new BadRequestException('No se recibió ningún archivo');
      }

      if (!tipo || !Object.values(TipoDocumento).includes(tipo as TipoDocumento)) {
        throw new BadRequestException('Tipo de documento inválido');
      }

      const documento = await this.documentoService.subirDocumento(
        id,
        tipo as TipoDocumento,
        file,
        req.user?.email || 'sistema'
      );

      await this.bitacoraService.registrar(
        AccionBitacora.ADMIN_EDITAR_USUARIO,
        ModuloBitacora.ADMINISTRACION,
        req.user,
        undefined,
        {
          detalles: `Documento subido para contratista ${id}: ${tipo} - ${file.originalname}`,
        },
        req,
      );

      return {
        ok: true,
        data: {
          success: true,
          message: 'Documento subido exitosamente',
          data: documento
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error subiendo documento: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: error.message,
          data: null
        }
      };
    }
  }

  /**
   * Descargar documento
   * GET /contratistas/:id/documentos/:documentoId/descargar
   */
  @Get(':id/documentos/:documentoId/descargar')
  @Public()
  async descargarDocumento(
    @Param('id') contratistaId: string,
    @Param('documentoId') documentoId: string,
    @Res() res: Response,
  ) {
    try {
      this.logger.log(`📥 Descargando documento ${documentoId}`);

      const { buffer, nombre, mimeType } = await this.documentoService.descargarDocumento(
        documentoId,
        contratistaId
      );

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nombre)}"`);
      res.setHeader('Content-Length', buffer.length);

      res.send(buffer);
    } catch (error) {
      this.logger.error(`❌ Error descargando documento: ${error.message}`);
      if (!res.headersSent) {
        const status = error instanceof NotFoundException ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_SERVER_ERROR;
        return res.status(status).json({
          ok: true,
          data: {
            success: false,
            message: error.message
          }
        });
      }
    }
  }

  /**
   * Descargar todos los documentos en ZIP
   * GET /contratistas/:id/documentos/descargar-todos
   */
  @Get(':id/documentos/descargar-todos')
  @Public()
  async descargarTodosDocumentos(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    try {
      this.logger.log(`📦 Descargando TODOS los documentos del contratista ${id} como ZIP`);

      const { zipBuffer, nombreZip, totalDocumentos } = await this.documentoService.descargarTodosDocumentos(id);

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nombreZip)}"`);
      res.setHeader('Content-Length', zipBuffer.length);

      res.send(zipBuffer);
    } catch (error) {
      this.logger.error(`❌ Error descargando todos los documentos: ${error.message}`);
      if (!res.headersSent) {
        const status = error instanceof NotFoundException ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_SERVER_ERROR;
        return res.status(status).json({
          ok: true,
          data: {
            success: false,
            message: error.message
          }
        });
      }
    }
  }

  /**
   * Eliminar documento
   * DELETE /contratistas/:id/documentos/:documentoId
   */
  @Delete(':id/documentos/:documentoId')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
  async eliminarDocumento(
    @Param('id') contratistaId: string,
    @Param('documentoId') documentoId: string,
    @Req() req: any
  ) {
    try {
      this.logger.log(`🗑️ Eliminando documento ${documentoId}`);

      await this.documentoService.eliminarDocumento(documentoId, contratistaId);

      await this.bitacoraService.registrar(
        AccionBitacora.ADMIN_EDITAR_USUARIO,
        ModuloBitacora.ADMINISTRACION,
        req.user,
        undefined,
        {
          detalles: `Documento eliminado del contratista ${contratistaId}`,
        },
        req,
      );

      return {
        ok: true,
        data: {
          success: true,
          message: 'Documento eliminado exitosamente'
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error eliminando documento: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: error.message
        }
      };
    }
  }

  /**
   * Verificar si un contratista tiene email
   * GET /contratistas/:id/tiene-email
   */
  @Get(':id/tiene-email')
  @Roles(UserRole.ADMIN, UserRole.JURIDICA)
  async tieneEmail(@Param('id') id: string, @Req() req?: any) {
    try {
      this.logger.log(`📧 Verificando email del contratista: ${id}`);

      const contratista = await this.contratistaService.buscarPorId(id);

      return {
        ok: true,
        data: {
          success: true,
          data: {
            tieneEmail: !!contratista.email,
            email: contratista.email || null,
          },
        },
      };
    } catch (error) {
      this.logger.error(`❌ Error verificando email: ${error.message}`);
      return {
        ok: true,
        data: {
          success: false,
          message: error.message,
          data: { tieneEmail: false, email: null },
        },
      };
    }
  }

  // ===============================
  // ✅ NUEVOS ENDPOINTS PARA DOCUMENTOS COMBINADOS
  // ===============================

  /**
   * ✅ Obtener documento combinado de SEGURIDAD SOCIAL
   * GET /contratistas/:id/documentos/combinado/SEGURIDAD_SOCIAL
   */
  @Get(':id/documentos/combinado/SEGURIDAD_SOCIAL')
  @Public()
  async descargarCombinadoSeguridadSocial(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    try {
      this.logger.log(`📥 Descargando combinado SEGURIDAD SOCIAL del contratista ${id}`);

      const { buffer, nombre, mimeType } = await this.documentoService.obtenerCombinadoPorTipo(
        id,
        'SEGURIDAD_SOCIAL'
      );

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nombre)}"`);
      res.setHeader('Content-Length', buffer.length);

      res.send(buffer);
    } catch (error) {
      this.logger.error(`❌ Error descargando combinado SEGURIDAD SOCIAL: ${error.message}`);
      if (!res.headersSent) {
        const status = error instanceof NotFoundException ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_SERVER_ERROR;
        return res.status(status).json({
          ok: true,
          data: {
            success: false,
            message: error.message
          }
        });
      }
    }
  }

  /**
   * ✅ Obtener documento combinado de CERTIFICADO_ANTECEDENTES
   * GET /contratistas/:id/documentos/combinado/CERTIFICADO_ANTECEDENTES
   */
  @Get(':id/documentos/combinado/CERTIFICADO_ANTECEDENTES')
  @Public()
  async descargarCombinadoAntecedentes(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    try {
      this.logger.log(`📥 Descargando combinado CERTIFICADO_ANTECEDENTES del contratista ${id}`);

      const { buffer, nombre, mimeType } = await this.documentoService.obtenerCombinadoPorTipo(
        id,
        'CERTIFICADO_ANTECEDENTES'
      );

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nombre)}"`);
      res.setHeader('Content-Length', buffer.length);

      res.send(buffer);
    } catch (error) {
      this.logger.error(`❌ Error descargando combinado CERTIFICADO_ANTECEDENTES: ${error.message}`);
      if (!res.headersSent) {
        const status = error instanceof NotFoundException ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_SERVER_ERROR;
        return res.status(status).json({
          ok: true,
          data: {
            success: false,
            message: error.message
          }
        });
      }
    }
  }
}