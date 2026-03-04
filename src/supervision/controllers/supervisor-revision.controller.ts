// src/supervision/controllers/supervisor-revision.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  UploadedFile,
  UploadedFiles,  // ← AÑADIR ESTA IMPORTACIÓN
  UseInterceptors,
  Req,
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { FileFieldsInterceptor } from '@nestjs/platform-express';

import { SupervisorRevisionService } from '../services/supervisor-revision.service';
import { RevisarDocumentoDto } from '../dto/revisar-documento.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SupervisorGuard } from '../../common/guards/supervisor.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../users/enums/user-role.enum';

@Controller('supervisor/revision')
@UseGuards(JwtAuthGuard, RolesGuard, SupervisorGuard)
@Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
export class SupervisorRevisionController {
  private readonly logger = new Logger(SupervisorRevisionController.name);

  constructor(
    private readonly supervisorRevisionService: SupervisorRevisionService,
  ) { }

  private getUserIdFromRequest(req: Request): string {
    const user = (req as any).user;
    const userId = user?.id || user?.userId || user?.sub || user?.user?.id;

    this.logger.log(`👤 Usuario ID extraído: ${userId}`);
    this.logger.log(`👤 Usuario completo:`, user);

    if (!userId) {
      throw new HttpException(
        { success: false, message: 'No se pudo identificar al usuario' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return userId;
  }

  // ===============================
  // REVISAR DOCUMENTO (con archivos - paz y salvo)
  // ===============================

  @Post(':documentoId')
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
    this.logger.log(`📝 ===== INICIO REVISIÓN DOCUMENTO =====`);
    this.logger.log(`📝 Documento ID recibido: "${documentoId}" (tipo: ${typeof documentoId})`);
    this.logger.log(`📝 ¿DocumentoId es array?: ${Array.isArray(documentoId)}`);

    // Si es array, tomar el primer elemento
    let idReal = documentoId;
    if (Array.isArray(documentoId)) {
      idReal = documentoId[0];
      this.logger.warn(`⚠️ documentoId era un array, usando el primer elemento: ${idReal}`);
    }

    this.logger.log(`📝 DTO recibido:`, JSON.stringify(dto, null, 2));
    this.logger.log(`📝 Archivos:`, {
      archivoAprobacion: files?.archivoAprobacion?.length || 0,
      pazSalvo: files?.pazSalvo?.length || 0
    });

    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`👤 UserId: ${userId}`);

    const archivoAprobacion = files?.archivoAprobacion?.[0];
    const pazSalvo = files?.pazSalvo?.[0];

    try {
      const result = await this.supervisorRevisionService.revisarDocumento(
        idReal,
        userId,
        dto,
        archivoAprobacion,
        pazSalvo,
      );

      this.logger.log(`📝 ===== FIN REVISIÓN DOCUMENTO (ÉXITO) =====`);

      return {
        success: true,
        message: `Documento revisado (${dto.estado})`,
        data: result,
      };
    } catch (error) {
      this.logger.error(`❌ Error revisando documento: ${error.message}`);
      this.logger.error(error.stack);

      // Devolver el error con más detalles
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error al revisar',
          error: error.toString(),
          stack: error.stack
        },
        error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ===============================
  // DEVOLVER DOCUMENTO AL RADICADOR
  // ===============================
  @Post('devolver/:documentoId')
  async devolverDocumento(
    @Param('documentoId') documentoId: string,
    @Body() body: { motivo: string; instrucciones: string },
    @Req() req: Request
  ) {
    const user = (req as any).user;
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`↩️ ${user.role} ${user.username} devolviendo documento ${documentoId}`);

    try {
      if (!body.motivo || !body.instrucciones) {
        throw new BadRequestException('Motivo e instrucciones son requeridos');
      }

      const result = await this.supervisorRevisionService.devolverDocumento(
        documentoId,
        userId,
        body.motivo,
        body.instrucciones
      );

      return {
        success: true,
        message: 'Documento devuelto al radicador para correcciones',
        data: {
          documento: {
            id: result.documento.id,
            numeroRadicado: result.documento.numeroRadicado,
            estado: result.documento.estado,
            observacion: result.documento.observacion,
            comentarios: result.documento.comentarios,
            correcciones: result.documento.correcciones,
            usuarioAsignadoNombre: result.documento.usuarioAsignadoNombre
          },
          motivo: body.motivo,
          instrucciones: body.instrucciones
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error devolviendo documento: ${error.message}`);
      const status = error instanceof HttpException ? error.getStatus() : HttpStatus.BAD_REQUEST;
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error al devolver documento'
        },
        status
      );
    }
  }

  // ===============================
  // CORREGIR INCONSISTENCIAS (migración)
  // ===============================
  @Post('migracion/corregir-inconsistencias')
  @Roles(UserRole.ADMIN)
  async corregirInconsistencias(@Req() req: Request) {
    const user = (req as any).user;
    this.logger.log(`👑 Admin ${user.username} ejecutando corrección de inconsistencias`);

    try {
      const resultado = await this.supervisorRevisionService.corregirDatosInconsistentes();

      return {
        success: true,
        message: `Migración completada: ${resultado.corregidos} de ${resultado.total} documentos corregidos`,
        data: resultado
      };
    } catch (error) {
      this.logger.error(`❌ Error en migración: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error al corregir inconsistencias: ' + error.message
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}