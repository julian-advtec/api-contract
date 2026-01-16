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
import { Documento } from '../radicacion/entities/documento.entity';
import { SupervisorDocumento } from './entities/supervisor.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';

@Controller('supervisor')
@UseGuards(JwtAuthGuard, RolesGuard, SupervisorGuard)
@Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
export class SupervisorController {
  private readonly logger = new Logger(SupervisorController.name);
  
  constructor(
    private readonly supervisorService: SupervisorService,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Documento)
    private documentoRepository: Repository<Documento>,
    @InjectRepository(SupervisorDocumento)
    private supervisorRepository: Repository<SupervisorDocumento>,
  ) { }

  private getUserIdFromRequest(req: any): string {
    const user = req.user;
    const userId = user?.id || user?.userId || user?.sub || user?.user?.id;

    if (!userId) {
      this.logger.error('❌ No se pudo obtener el ID del usuario');
      throw new HttpException(
        {
          success: false,
          message: 'No se pudo identificar al usuario'
        },
        HttpStatus.UNAUTHORIZED
      );
    }

    return userId;
  }

  // ===============================
  // ENDPOINT REVISAR DOCUMENTO CON PAZ Y SALVO
  // ===============================

  @Post('revisar/:documentoId')
  @UseInterceptors(FileInterceptor('archivo'))
  @UseInterceptors(FileInterceptor('pazSalvo'))
  async revisarDocumento(
    @Param('documentoId') documentoId: string,
    @Body() revisarDto: RevisarDocumentoDto,
    @UploadedFile() archivo?: Express.Multer.File,
    @UploadedFile() pazSalvo?: Express.Multer.File,
    @Req() req?: any
  ) {
    const user = req.user;
    const userId = this.getUserIdFromRequest(req);
    
    this.logger.log(`🔍 ${user.role} ${user.username} revisando documento ${documentoId}`);
    this.logger.log(`📝 Datos DTO recibidos: ${JSON.stringify(revisarDto)}`);
    this.logger.log(`📝 Body completo: ${JSON.stringify(req.body)}`);
    this.logger.log(`📝 ¿Tiene archivo de aprobación?: ${!!archivo}`);
    this.logger.log(`📝 ¿Tiene archivo de paz y salvo?: ${!!pazSalvo}`);

    try {
      // Validación adicional
      if (revisarDto.estado === 'APROBADO' && !archivo) {
        this.logger.error('❌ APROBADO requiere archivo de aprobación');
        throw new BadRequestException('Debe adjuntar un archivo de aprobación');
      }

      // Validar que si requiere paz y salvo, se adjunte
      if (revisarDto.estado === 'APROBADO' && revisarDto.requierePazSalvo && !pazSalvo) {
        this.logger.error('❌ Requiere archivo de paz y salvo');
        throw new BadRequestException('Debe adjuntar el archivo de paz y salvo');
      }

      // Validar que no tenga propiedades extrañas
      const propiedadesPermitidas = ['estado', 'observacion', 'correcciones', 'requierePazSalvo'];
      const propiedadesRecibidas = Object.keys(revisarDto);
      const propiedadesExtra = propiedadesRecibidas.filter(prop => !propiedadesPermitidas.includes(prop));
      
      if (propiedadesExtra.length > 0) {
        this.logger.error(`❌ Propiedades no permitidas: ${propiedadesExtra.join(', ')}`);
        throw new BadRequestException(`Propiedades no permitidas: ${propiedadesExtra.join(', ')}`);
      }

      const result = await this.supervisorService.revisarDocumento(
        documentoId,
        userId,
        revisarDto,
        archivo,
        pazSalvo
      );

      this.logger.log(`✅ Documento ${documentoId} revisado exitosamente. Estado: ${revisarDto.estado}`);

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
            nombreArchivoSupervisor: result.supervisor.nombreArchivoSupervisor,
            pazSalvo: result.supervisor.pazSalvo
          }
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error revisando documento: ${error.message}`);
      this.logger.error(`❌ Stack: ${error.stack}`);
      const status = error instanceof HttpException ? error.getStatus() : HttpStatus.BAD_REQUEST;
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error al revisar documento',
          detalles: error.response?.message || error.message
        },
        status
      );
    }
  }

  // ===============================
  // ENDPOINTS PARA PAZ Y SALVO
  // ===============================

  @Get('descargar-paz-salvo/:nombreArchivo')
  async descargarPazSalvo(
    @Param('nombreArchivo') nombreArchivo: string,
    @Req() req: any,
    @Res() res: Response
  ) {
    const user = req.user;
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`📥 ${user.role} ${user.username} descargando paz y salvo: ${nombreArchivo}`);

    try {
      const { ruta, nombre } = await this.supervisorService.obtenerArchivoPazSalvo(userId, nombreArchivo);

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);

      const fileStream = fs.createReadStream(ruta);
      fileStream.pipe(res);

    } catch (error) {
      this.logger.error(`❌ Error descargando paz y salvo: ${error.message}`);

      if (!res.headersSent) {
        const status = error instanceof HttpException ? error.getStatus() : HttpStatus.NOT_FOUND;
        res.status(status).json({
          success: false,
          message: error.message || 'Error al descargar archivo'
        });
      }
    }
  }

  @Get('ver-paz-salvo/:nombreArchivo')
  async verPazSalvo(
    @Param('nombreArchivo') nombreArchivo: string,
    @Req() req: any,
    @Res() res: Response
  ) {
    const user = req.user;
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`👁️ ${user.role} ${user.username} viendo paz y salvo: ${nombreArchivo}`);

    try {
      const { ruta, nombre } = await this.supervisorService.obtenerArchivoPazSalvo(userId, nombreArchivo);

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
      this.logger.error(`❌ Error viendo paz y salvo: ${error.message}`);

      if (!res.headersSent) {
        const status = error instanceof HttpException ? error.getStatus() : HttpStatus.NOT_FOUND;
        res.status(status).json({
          success: false,
          message: error.message || 'Error al ver archivo'
        });
      }
    }
  }

  // ===============================
  // EL RESTO DEL CÓDIGO PERMANECE IGUAL
  // ===============================

  @Get('documentos-disponibles')
  async obtenerDocumentosDisponibles(@Req() req: any) {
    const user = req.user;
    this.logger.log(`📋 ${user.role} ${user.username} solicitando documentos disponibles`);
    
    try {
      const userId = this.getUserIdFromRequest(req);
      const documentos = await this.supervisorService.obtenerDocumentosDisponibles(userId);

      return {
        success: true,
        count: documentos.length,
        data: documentos
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos disponibles: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error al obtener documentos disponibles: ' + error.message
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('tomar-documento/:documentoId')
  async tomarDocumento(@Param('documentoId') documentoId: string, @Req() req: any) {
    const user = req.user;
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`🤝 ${user.role} ${user.username} tomando documento ${documentoId}`);

    try {
      const resultado = await this.supervisorService.tomarDocumentoParaRevision(documentoId, userId);
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

  @Post('liberar-documento/:documentoId')
  async liberarDocumento(@Param('documentoId') documentoId: string, @Req() req: any) {
    const user = req.user;
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`🔄 ${user.role} ${user.username} liberando documento ${documentoId}`);

    try {
      const resultado = await this.supervisorService.liberarDocumento(documentoId, userId);
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

  @Get('mis-revisiones')
  async obtenerMisRevisiones(@Req() req: any) {
    const user = req.user;
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`📋 ${user.role} ${user.username} solicitando sus revisiones activas`);

    try {
      const documentos = await this.supervisorService.obtenerDocumentosEnRevision(userId);

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

  @Get('documento/:id')
  async obtenerDetalleDocumento(@Param('id') id: string, @Req() req: any) {
    const user = req.user;
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`🔍 ${user.role} ${user.username} solicitando detalle de documento ${id}`);

    try {
      const detalle = await this.supervisorService.obtenerDetalleDocumento(id, userId);

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

  @Get('descargar/:documentoId/archivo/:numeroArchivo')
  async descargarArchivoRadicado(
    @Param('documentoId') documentoId: string,
    @Param('numeroArchivo') numeroArchivo: number,
    @Req() req: any,
    @Res() res: Response
  ) {
    const user = req.user;
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`📥 ${user.role} ${user.username} descargando archivo ${numeroArchivo} del documento ${documentoId}`);

    try {
      const { ruta, nombre } = await this.supervisorService.descargarArchivoRadicado(
        documentoId,
        numeroArchivo,
        userId
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

  @Get('ver/:documentoId/archivo/:numeroArchivo')
  async verArchivoRadicado(
    @Param('documentoId') documentoId: string,
    @Param('numeroArchivo') numeroArchivo: number,
    @Req() req: any,
    @Res() res: Response
  ) {
    const user = req.user;
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`👁️ ${user.role} ${user.username} viendo archivo ${numeroArchivo} del documento ${documentoId}`);

    try {
      const { ruta, nombre } = await this.supervisorService.descargarArchivoRadicado(
        documentoId,
        numeroArchivo,
        userId
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

  @Post('devolver/:documentoId')
  async devolverDocumento(
    @Param('documentoId') documentoId: string,
    @Body() body: { motivo: string; instrucciones: string },
    @Req() req: any
  ) {
    const user = req.user;
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`↩️ ${user.role} ${user.username} devolviendo documento ${documentoId}`);

    try {
      if (!body.motivo || !body.instrucciones) {
        throw new BadRequestException('Motivo e instrucciones son requeridos');
      }

      const result = await this.supervisorService.devolverDocumento(
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

  @Get('historial')
  async obtenerHistorial(@Req() req: any, @Query('limit') limit?: number) {
    const user = req.user;
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`📊 ${user.role} ${user.username} solicitando historial`);

    try {
      const historial = await this.supervisorService.obtenerHistorialSupervisor(userId);

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

  @Get('estadisticas')
  async obtenerEstadisticas(@Req() req: any) {
    const user = req.user;
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`📈 ${user.role} ${user.username} solicitando estadísticas`);

    try {
      const estadisticas = await this.supervisorService.obtenerEstadisticasSupervisor(userId);

      return {
        success: true,
        data: estadisticas
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo estadísticas: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error al obtener estadísticas: ' + error.message
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('descargar-archivo/:nombreArchivo')
  async descargarArchivoSupervisor(
    @Param('nombreArchivo') nombreArchivo: string,
    @Req() req: any,
    @Res() res: Response
  ) {
    const user = req.user;
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`📥 ${user.role} ${user.username} descargando su archivo: ${nombreArchivo}`);

    try {
      const { ruta, nombre } = await this.supervisorService.obtenerArchivoSupervisor(userId, nombreArchivo);

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

  @Get('ver-archivo-supervisor/:nombreArchivo')
  async verArchivoSupervisor(
    @Param('nombreArchivo') nombreArchivo: string,
    @Req() req: any,
    @Res() res: Response
  ) {
    const user = req.user;
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`👁️ ${user.role} ${user.username} viendo su archivo: ${nombreArchivo}`);

    try {
      const { ruta, nombre } = await this.supervisorService.obtenerArchivoSupervisor(userId, nombreArchivo);

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

  // ===============================
  // ENDPOINTS ADMINISTRATIVOS
  // ===============================

  @Post('asignar-todos')
  @Roles(UserRole.ADMIN)
  async asignarTodosDocumentos(@Req() req: any) {
    const user = req.user;
    this.logger.log(`👑 Admin ${user.username} forzando asignación de TODOS los documentos a supervisores`);

    try {
      const resultado = await this.supervisorService.asignarTodosDocumentosASupervisores();

      return {
        success: true,
        message: `Asignación completada: ${resultado.asignados} de ${resultado.total} documentos asignados`,
        data: resultado
      };
    } catch (error) {
      this.logger.error(`❌ Error asignando todos los documentos: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error al asignar documentos a supervisores'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('webhook/cambio-estado')
  async webhookCambioEstado(
    @Body() body: { documentoId: string; estadoAnterior: string; nuevoEstado: string; usuarioId: string }
  ) {
    this.logger.log(`🔄 Webhook: Documento ${body.documentoId} cambió de ${body.estadoAnterior} a ${body.nuevoEstado}`);

    try {
      if (body.nuevoEstado === 'RADICADO') {
        await this.supervisorService.onDocumentoCambiaEstado(body.documentoId, body.nuevoEstado);
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

  @Get('conteo-radicados')
  async obtenerConteoRadicados(@Req() req: any) {
    const user = req.user;
    this.logger.log(`📊 ${user.role} ${user.username} solicitando conteo de radicados`);

    try {
      const totalRadicados = await this.supervisorService.obtenerConteoDocumentosRadicados();

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

  @Get('documentos-radicados')
  @Roles(UserRole.ADMIN)
  async obtenerDocumentosRadicados(@Req() req: any) {
    const user = req.user;
    this.logger.log(`📋 Admin ${user.username} solicitando documentos radicados`);

    try {
      const documentos = await this.documentoRepository.find({
        where: { estado: 'RADICADO' },
        relations: ['radicador'],
        order: { fechaRadicacion: 'ASC' },
      });

      return {
        success: true,
        count: documentos.length,
        data: documentos.map(doc => ({
          id: doc.id,
          numeroRadicado: doc.numeroRadicado,
          numeroContrato: doc.numeroContrato,
          nombreContratista: doc.nombreContratista,
          documentoContratista: doc.documentoContratista,
          fechaInicio: doc.fechaInicio,
          fechaFin: doc.fechaFin,
          estado: doc.estado,
          fechaRadicacion: doc.fechaRadicacion,
          radicador: doc.nombreRadicador,
          observacion: doc.observacion,
          disponible: true
        }))
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos radicados: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error al obtener documentos radicados'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // ===============================
  // HEALTH & DIAGNÓSTICO
  // ===============================

  @Get('health')
  async healthCheck() {
    return {
      success: true,
      service: 'supervisor',
      status: 'operational',
      timestamp: new Date().toISOString()
    };
  }

  @Get('diagnostico')
  @UseGuards(JwtAuthGuard)
  async diagnostico(@Req() req: any) {
    try {
      const user = req.user;

      const usuario = await this.userRepository.findOne({
        where: { id: user.id }
      });

      if (!usuario) {
        return {
          error: 'Usuario no encontrado en BD',
          userId: user.id,
          fecha: new Date().toISOString()
        };
      }

      const totalDocumentos = await this.documentoRepository.count();

      const conteos = {
        totalDocumentos,
        radicadoExacto: await this.documentoRepository.count({
          where: { estado: 'RADICADO' }
        }),
        radicadoLike: await this.documentoRepository.createQueryBuilder('doc')
          .where("doc.estado ILIKE :estado", { estado: '%RADICADO%' })
          .getCount(),
        estadosDistintos: await this.documentoRepository
          .createQueryBuilder('doc')
          .select('doc.estado', 'estado')
          .addSelect('COUNT(*)', 'cantidad')
          .groupBy('doc.estado')
          .orderBy('cantidad', 'DESC')
          .getRawMany()
      };

      const documentosEjemplo = await this.documentoRepository.find({
        where: { estado: 'RADICADO' },
        take: 5,
        relations: ['radicador']
      });

      const supervisores = await this.userRepository.find({
        where: { role: UserRole.SUPERVISOR }
      });

      const asignaciones = await this.supervisorRepository.find({
        relations: ['documento', 'supervisor']
      });

      return {
        timestamp: new Date().toISOString(),
        usuario: {
          id: usuario.id,
          username: usuario.username,
          role: usuario.role,
          esAdmin: usuario.role === UserRole.ADMIN,
          esSupervisor: usuario.role === UserRole.SUPERVISOR
        },
        conteos,
        estadosEnBD: conteos.estadosDistintos,
        documentosEjemplo: documentosEjemplo.map((doc: any) => ({
          id: doc.id,
          numeroRadicado: doc.numeroRadicado,
          estado: doc.estado,
          fechaRadicacion: doc.fechaRadicacion,
          radicador: doc.radicador?.username
        })),
        supervisores: {
          total: supervisores.length,
          lista: supervisores.map((s: any) => ({
            id: s.id,
            username: s.username,
            role: s.role,
            isActive: s.isActive
          }))
        },
        asignaciones: {
          total: asignaciones.length,
          lista: asignaciones.map((a: any) => ({
            id: a.id,
            documento: a.documento?.numeroRadicado,
            supervisor: a.supervisor?.username,
            estado: a.estado,
            pazSalvo: a.pazSalvo
          }))
        }
      };

    } catch (error) {
      this.logger.error(`❌ Error en diagnóstico: ${error.message}`, error.stack);
      return {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Get('verificar-supervisores')
  @UseGuards(JwtAuthGuard)
  async verificarSupervisores() {
    try {
      const supervisores = await this.userRepository.find({
        where: {
          role: UserRole.SUPERVISOR,
          isActive: true
        }
      });

      return {
        success: true,
        timestamp: new Date().toISOString(),
        data: {
          total: supervisores.length,
          supervisores: supervisores.map((s: any) => ({
            id: s.id,
            username: s.username,
            fullName: s.fullName,
            role: s.role,
            email: s.email,
            isActive: s.isActive
          }))
        }
      };
    } catch (error) {
      this.logger.error(`Error verificando supervisores: ${error.message}`);
      return {
        success: false,
        message: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Get('documentos-radicados-test')
  async obtenerDocumentosRadicadosTest(@Req() req: any) {
    const user = req.user;
    this.logger.log(`📋 ${user.role} ${user.username} solicitando documentos radicados (TEST)`);

    try {
      const documentos = await this.documentoRepository.find({
        where: { estado: 'RADICADO' },
        relations: ['radicador'],
        order: { fechaRadicacion: 'ASC' },
      });

      this.logger.log(`🔍 Encontrados ${documentos.length} documentos con estado exacto 'RADICADO'`);

      const documentosConEstado = documentos.map(documento => {
        return {
          id: documento.id,
          numeroRadicado: documento.numeroRadicado,
          numeroContrato: documento.numeroContrato,
          nombreContratista: documento.nombreContratista,
          documentoContratista: documento.documentoContratista,
          fechaInicio: documento.fechaInicio,
          fechaFin: documento.fechaFin,
          estado: documento.estado,
          fechaRadicacion: documento.fechaRadicacion,
          radicador: documento.nombreRadicador,
          observacion: documento.observacion || '',
          disponible: true,
          asignacion: {
            enRevision: false,
            puedoTomar: true
          }
        };
      });

      return {
        success: true,
        count: documentosConEstado.length,
        data: documentosConEstado,
        debug: {
          totalEnBD: documentos.length,
          queryUsed: "where: { estado: 'RADICADO' }"
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error en test: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error al obtener documentos radicados: ' + error.message
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}