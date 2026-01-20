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
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';

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
  // ENDPOINT REVISAR DOCUMENTO CON PAZ Y SALVO
  // ===============================

  // ===============================
  // REVISAR DOCUMENTO (con archivos)
  // ===============================
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
      const result = await this.supervisorService.revisarDocumento(
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

  // ===============================
  // DESCARGAR / VER ARCHIVOS RADICADOS (CORREGIDO: sin restricción estricta)
  // ===============================
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

  // ===============================
  // DESCARGAR / VER ARCHIVOS DEL SUPERVISOR (PAZ Y SALVO, APROBACIÓN)
  // ===============================
  @Get('descargar-archivo/:nombreArchivo')
  async descargarArchivoSupervisor(
    @Param('nombreArchivo') nombreArchivo: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = this.getUserIdFromRequest(req);
    try {
      const { ruta, nombre } = await this.supervisorService.obtenerArchivoSupervisor(
        userId,
        nombreArchivo,
      );

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
      fs.createReadStream(ruta).pipe(res);
    } catch (error) {
      res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: error.message || 'Archivo no encontrado',
      });
    }
  }

  @Get('ver-archivo-supervisor/:nombreArchivo')
  async verArchivoSupervisor(
    @Param('nombreArchivo') nombreArchivo: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = this.getUserIdFromRequest(req);
    try {
      const { ruta, nombre } = await this.supervisorService.obtenerArchivoSupervisor(
        userId,
        nombreArchivo,
      );

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
      fs.createReadStream(ruta).pipe(res);
    } catch (error) {
      res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: error.message || 'Archivo no encontrado',
      });
    }
  }

  // ===============================
  // OTROS ENDPOINTS (sin cambios importantes)
  // ===============================
  @Get('documentos-disponibles')
  async obtenerDocumentosDisponibles(@Req() req: Request) {
    const userId = this.getUserIdFromRequest(req);
    const docs = await this.supervisorService.obtenerDocumentosDisponibles(userId);
    return { success: true, data: docs };
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
    const userId = this.getUserIdFromRequest(req);
    try {
      const detalle = await this.supervisorService.obtenerDetalleDocumento(id, userId);
      return { success: true, data: detalle };
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
      throw new HttpException({ success: false, message: error.message }, status);
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
    @Body() body: { motivo: string; instrucciones: string }, // ✅ Esto está bien
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
    const userId = this.getUserIdFromRequest(req);
    try {
      const historial = await this.supervisorService.obtenerHistorialSupervisor(userId);
      return {
        success: true,
        count: historial.length,
        data: limit ? historial.slice(0, limit) : historial
      };
    } catch (error) {
      throw new HttpException(
        { success: false, message: 'Error al obtener historial' },
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

  @Post('migracion/corregir-inconsistencias')
  @Roles(UserRole.ADMIN)
  async corregirInconsistencias(@Req() req: any) {
    const user = req.user;
    this.logger.log(`👑 Admin ${user.username} ejecutando corrección de inconsistencias`);

    try {
      const resultado = await this.supervisorService.corregirDatosInconsistentes();

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

  // ✅ ENDPOINT PARA VERIFICAR INCONSISTENCIAS (diagnóstico)
  @Get('diagnostico/inconsistencias')
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  async verificarInconsistencias(@Req() req: any) {
    const user = req.user;
    this.logger.log(`🔍 ${user.role} ${user.username} verificando inconsistencias`);

    try {
      // Consultar SQL para encontrar inconsistencias
      const inconsistencias = await this.documentoRepository
        .createQueryBuilder('documento')
        .innerJoin('supervisor_documentos', 'supervisor', 'supervisor.documento_id = documento.id')
        .where('supervisor.paz_salvo IS NOT NULL')
        .andWhere('supervisor.paz_salvo != :empty', { empty: '' })
        .andWhere('(documento.es_ultimo_radicado = :false OR documento.es_ultimo_radicado IS NULL)', { false: false })
        .select([
          'documento.id as documento_id',
          'documento.numero_radicado',
          'documento.es_ultimo_radicado',
          'supervisor.paz_salvo',
          'supervisor.estado as estado_supervision'
        ])
        .getRawMany();

      const totalDocumentos = await this.documentoRepository.count();
      const totalConPazSalvo = await this.supervisorRepository
        .createQueryBuilder('supervisor')
        .where('supervisor.paz_salvo IS NOT NULL')
        .andWhere('supervisor.paz_salvo != :empty', { empty: '' })
        .getCount();

      return {
        success: true,
        data: {
          totalDocumentos,
          totalConPazSalvo,
          inconsistenciasEncontradas: inconsistencias.length,
          detalles: inconsistencias,
          fechaVerificacion: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error verificando inconsistencias: ${error.message}`);
      throw new HttpException(
        {
          success: false,
          message: 'Error al verificar inconsistencias'
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}