import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  Req,
  Res,
  Query,
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { SupervisorService } from './supervisor.service';
import { RevisarDocumentoDto } from './dto/revisar-documento.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { SupervisorGuard } from '../common/guards/supervisor.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import * as fs from 'fs';
import * as path from 'path';

@Controller('supervisor')
@UseGuards(JwtAuthGuard, RolesGuard, SupervisorGuard)
@Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
export class SupervisorController {
  private readonly logger = new Logger(SupervisorController.name);

  constructor(private readonly supervisorService: SupervisorService) {}

  /**
   * OBTENER DOCUMENTOS ASIGNADOS
   */
  @Get('documentos-asignados')
  async obtenerDocumentosAsignados(@Req() req: any) {
    const user = req.user;
    this.logger.log(`📋 Supervisor ${user.username} solicitando documentos asignados`);

    try {
      const documentos = await this.supervisorService.obtenerDocumentosAsignados(user.id);
      
      return {
        success: true,
        count: documentos.length,
        data: documentos
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos asignados: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error al obtener documentos asignados'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * OBTENER DOCUMENTOS PENDIENTES (alias para frontend)
   */
  @Get('documentos/pendientes')
  async obtenerDocumentosPendientes(@Req() req: any) {
    const user = req.user;
    this.logger.log(`📋 Supervisor ${user.username} solicitando documentos pendientes`);

    try {
      const documentos = await this.supervisorService.obtenerDocumentosAsignados(user.id);
      
      return {
        success: true,
        count: documentos.length,
        data: documentos
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos pendientes: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error al obtener documentos pendientes'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * OBTENER DETALLE DE DOCUMENTO
   */
  @Get('documento/:id')
  async obtenerDetalleDocumento(@Param('id') id: string, @Req() req: any) {
    const user = req.user;
    this.logger.log(`🔍 Supervisor ${user.username} solicitando detalle de documento ${id}`);

    try {
      const detalle = await this.supervisorService.obtenerDetalleDocumento(id, user.id);
      
      return {
        success: true,
        data: detalle
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo detalle: ${error.message}`);
      
      const status = error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error al obtener detalle del documento'
        },
        status
      );
    }
  }

  /**
   * DESCARGAR ARCHIVO DEL RADICADOR
   */
  @Get('descargar/:documentoId/archivo/:numeroArchivo')
  async descargarArchivoRadicado(
    @Param('documentoId') documentoId: string,
    @Param('numeroArchivo') numeroArchivo: number,
    @Req() req: any,
    @Res() res: Response
  ) {
    const user = req.user;
    this.logger.log(`📥 Supervisor ${user.username} descargando archivo ${numeroArchivo} del documento ${documentoId}`);

    try {
      const { ruta, nombre } = await this.supervisorService.descargarArchivoRadicado(
        documentoId,
        numeroArchivo,
        user.id
      );

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);

      const fileStream = fs.createReadStream(ruta);
      fileStream.pipe(res);

    } catch (error) {
      this.logger.error(`❌ Error descargando archivo: ${error.message}`);
      
      if (!res.headersSent) {
        const status = error instanceof HttpException ? error.getStatus() : HttpStatus.NOT_FOUND;
        res.status(status).json({
          success: false,
          message: error.message || 'Error al descargar archivo'
        });
      }
    }
  }

  /**
   * VER ARCHIVO DEL RADICADOR (en navegador)
   */
  @Get('ver/:documentoId/archivo/:numeroArchivo')
  async verArchivoRadicado(
    @Param('documentoId') documentoId: string,
    @Param('numeroArchivo') numeroArchivo: number,
    @Req() req: any,
    @Res() res: Response
  ) {
    const user = req.user;
    this.logger.log(`👁️ Supervisor ${user.username} viendo archivo ${numeroArchivo} del documento ${documentoId}`);

    try {
      const { ruta, nombre } = await this.supervisorService.descargarArchivoRadicado(
        documentoId,
        numeroArchivo,
        user.id
      );

      const extension = path.extname(nombre).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      };

      res.setHeader('Content-Type', mimeTypes[extension] || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);

      const fileStream = fs.createReadStream(ruta);
      fileStream.pipe(res);

    } catch (error) {
      this.logger.error(`❌ Error viendo archivo: ${error.message}`);
      
      if (!res.headersSent) {
        const status = error instanceof HttpException ? error.getStatus() : HttpStatus.NOT_FOUND;
        res.status(status).json({
          success: false,
          message: error.message || 'Error al ver archivo'
        });
      }
    }
  }

  /**
   * REVISAR DOCUMENTO
   */
  @Post('revisar/:documentoId')
  @UseInterceptors(FileInterceptor('archivo'))
  async revisarDocumento(
    @Param('documentoId') documentoId: string,
    @Body() revisarDto: RevisarDocumentoDto,
    @UploadedFile() archivo?: Express.Multer.File,
    @Req() req?: any
  ) {
    const user = req.user;
    this.logger.log(`🔍 Supervisor ${user.username} revisando documento ${documentoId} - Estado: ${revisarDto.estado}`);

    try {
      if (revisarDto.estado === 'APROBADO' && !archivo) {
        throw new BadRequestException('Debe adjuntar un archivo de aprobación');
      }

      const result = await this.supervisorService.revisarDocumento(
        documentoId,
        user.id,
        revisarDto,
        archivo
      );

      return {
        success: true,
        message: `Documento ${revisarDto.estado.toLowerCase()} correctamente`,
        data: {
          documento: {
            id: result.documento.id,
            numeroRadicado: result.documento.numeroRadicado,
            estado: result.documento.estado,
            observacion: result.documento.observacion,
            comentarios: result.documento.comentarios,
            correcciones: result.documento.correcciones,
            fechaActualizacion: result.documento.fechaActualizacion,
            ultimoAcceso: result.documento.ultimoAcceso,
            ultimoUsuario: result.documento.ultimoUsuario
          },
          supervisor: {
            estado: result.supervisor.estado,
            observacion: result.supervisor.observacion,
            fechaAprobacion: result.supervisor.fechaAprobacion,
            nombreArchivoSupervisor: result.supervisor.nombreArchivoSupervisor
          }
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error revisando documento: ${error.message}`);
      
      const status = error instanceof HttpException ? error.getStatus() : HttpStatus.BAD_REQUEST;
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error al revisar documento'
        },
        status
      );
    }
  }

  /**
   * DEVOLVER DOCUMENTO AL RADICADOR
   */
  @Post('devolver/:documentoId')
  async devolverDocumento(
    @Param('documentoId') documentoId: string,
    @Body() body: { motivo: string; instrucciones: string },
    @Req() req: any
  ) {
    const user = req.user;
    this.logger.log(`↩️ Supervisor ${user.username} devolviendo documento ${documentoId}`);

    try {
      if (!body.motivo || !body.instrucciones) {
        throw new BadRequestException('Motivo e instrucciones son requeridos');
      }

      const result = await this.supervisorService.devolverDocumento(
        documentoId,
        user.id,
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

  /**
   * OBTENER HISTORIAL DEL SUPERVISOR
   */
  @Get('historial')
  async obtenerHistorial(@Req() req: any, @Query('limit') limit?: number) {
    const user = req.user;
    this.logger.log(`📊 Supervisor ${user.username} solicitando historial`);

    try {
      const historial = await this.supervisorService.obtenerHistorialSupervisor(user.id);
      
      return {
        success: true,
        count: historial.length,
        data: limit ? historial.slice(0, limit) : historial
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo historial: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error al obtener historial'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * OBTENER ESTADÍSTICAS DEL SUPERVISOR
   */
  @Get('estadisticas')
  async obtenerEstadisticas(@Req() req: any) {
    const user = req.user;
    this.logger.log(`📈 Supervisor ${user.username} solicitando estadísticas`);

    try {
      const estadisticas = await this.supervisorService.obtenerEstadisticasSupervisor(user.id);
      
      return {
        success: true,
        data: estadisticas
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo estadísticas: ${error.message}`);
      this.logger.error(`❌ Detalles del error: ${error.stack}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error al obtener estadísticas: ' + error.message
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * DESCARGAR ARCHIVO DEL SUPERVISOR
   */
  @Get('descargar-archivo/:nombreArchivo')
  async descargarArchivoSupervisor(
    @Param('nombreArchivo') nombreArchivo: string,
    @Req() req: any,
    @Res() res: Response
  ) {
    const user = req.user;
    this.logger.log(`📥 Supervisor ${user.username} descargando su archivo: ${nombreArchivo}`);

    try {
      const { ruta, nombre } = await this.supervisorService.obtenerArchivoSupervisor(user.id, nombreArchivo);

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);

      const fileStream = fs.createReadStream(ruta);
      fileStream.pipe(res);

    } catch (error) {
      this.logger.error(`❌ Error descargando archivo del supervisor: ${error.message}`);
      
      if (!res.headersSent) {
        const status = error instanceof HttpException ? error.getStatus() : HttpStatus.NOT_FOUND;
        res.status(status).json({
          success: false,
          message: error.message || 'Error al descargar archivo'
        });
      }
    }
  }

  /**
   * VER ARCHIVO DEL SUPERVISOR (en navegador)
   */
  @Get('ver-archivo-supervisor/:nombreArchivo')
  async verArchivoSupervisor(
    @Param('nombreArchivo') nombreArchivo: string,
    @Req() req: any,
    @Res() res: Response
  ) {
    const user = req.user;
    this.logger.log(`👁️ Supervisor ${user.username} viendo su archivo: ${nombreArchivo}`);

    try {
      const { ruta, nombre } = await this.supervisorService.obtenerArchivoSupervisor(user.id, nombreArchivo);

      const extension = path.extname(nombre).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      };

      res.setHeader('Content-Type', mimeTypes[extension] || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);

      const fileStream = fs.createReadStream(ruta);
      fileStream.pipe(res);

    } catch (error) {
      this.logger.error(`❌ Error viendo archivo del supervisor: ${error.message}`);
      
      if (!res.headersSent) {
        const status = error instanceof HttpException ? error.getStatus() : HttpStatus.NOT_FOUND;
        res.status(status).json({
          success: false,
          message: error.message || 'Error al ver archivo'
        });
      }
    }
  }

  /**
   * HEALTH CHECK
   */
  @Get('health')
  async healthCheck() {
    return {
      success: true,
      service: 'supervisor',
      status: 'operational',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * TEST CONEXIÓN
   */
  @Get('test/conexion')
  async testConexion() {
    return {
      success: true,
      message: 'Conexión exitosa con el servicio de supervisor',
      timestamp: new Date().toISOString()
    };
  }
}