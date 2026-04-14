import {
  Controller,
  Get,
  Param,
  UseGuards,
  Req,
  Res,
  Query,
  HttpException,
  HttpStatus,
  Logger,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

import { SupervisorArchivosService } from '../services/supervisor-archivos.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SupervisorGuard } from '../../common/guards/supervisor.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../users/enums/user-role.enum';

@Controller('supervisor')
@UseGuards(JwtAuthGuard, RolesGuard, SupervisorGuard)
@Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
export class SupervisorArchivosController {
  private readonly logger = new Logger(SupervisorArchivosController.name);

  constructor(
    private readonly supervisorArchivosService: SupervisorArchivosService,
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
  // DESCARGAR ARCHIVOS RADICADOS
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
      const { ruta, nombre } = await this.supervisorArchivosService.descargarArchivoRadicado(
        documentoId,
        numeroArchivo,
        userId,
      );

      // Verificar si el archivo existe
      if (!fs.existsSync(ruta)) {
        throw new HttpException(`Archivo ${nombre} no encontrado en ${ruta}`, HttpStatus.NOT_FOUND);
      }

      const isDownload = download === 'true';

      if (isDownload) {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
      } else {
        // Solo descarga, sin previsualización
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
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
  // DESCARGAR ARCHIVOS DEL SUPERVISOR (APROBACIÓN)
  // ===============================
  @Get('descargar-archivo/:nombreArchivo')
  async descargarArchivoSupervisor(
    @Param('nombreArchivo') nombreArchivo: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`📥 Usuario ${userId} descargando archivo supervisor: ${nombreArchivo}`);

    try {
      // Decodificar el nombre del archivo
      const nombreArchivoDecodificado = decodeURIComponent(nombreArchivo);

      const { ruta, nombre } = await this.supervisorArchivosService.obtenerArchivoSupervisor(
        userId,
        nombreArchivoDecodificado,
      );

      // Verificar si el archivo existe
      if (!fs.existsSync(ruta)) {
        throw new HttpException(`Archivo ${nombre} no encontrado`, HttpStatus.NOT_FOUND);
      }

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);

      const fileStream = fs.createReadStream(ruta);
      fileStream.pipe(res);
    } catch (error) {
      this.logger.error(`❌ Error descargando archivo supervisor: ${error.message}`);
      res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: error.message || 'Archivo no encontrado',
      });
    }
  }

  // ===============================
  // DESCARGAR PAZ Y SALVO
  // ===============================
  @Get('descargar-paz-salvo/:nombreArchivo')
  async descargarPazSalvo(
    @Param('nombreArchivo') nombreArchivo: string,
    @Req() req: Request,
    @Res() res: Response
  ) {
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`📥 Usuario ${userId} descargando paz y salvo: ${nombreArchivo}`);

    try {
      // Decodificar el nombre del archivo
      const nombreArchivoDecodificado = decodeURIComponent(nombreArchivo);

      const { ruta, nombre } = await this.supervisorArchivosService.obtenerArchivoPazSalvo(
        userId,
        nombreArchivoDecodificado
      );

      // Verificar si el archivo existe
      if (!fs.existsSync(ruta)) {
        throw new HttpException(`Archivo ${nombre} no encontrado`, HttpStatus.NOT_FOUND);
      }

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

  // ===============================
  // ENDPOINT PARA VERIFICAR DISPONIBILIDAD DE ARCHIVOS
  // ===============================
  @Get('verificar-archivo/:tipo/:nombreArchivo')
  async verificarArchivo(
    @Param('tipo') tipo: string,
    @Param('nombreArchivo') nombreArchivo: string,
    @Req() req: Request,
    @Res() res: Response
  ) {
    const userId = this.getUserIdFromRequest(req);
    const nombreArchivoDecodificado = decodeURIComponent(nombreArchivo);

    try {
      let ruta: string;

      if (tipo === 'supervisor') {
        const resultado = await this.supervisorArchivosService.obtenerArchivoSupervisor(
          userId,
          nombreArchivoDecodificado
        );
        ruta = resultado.ruta;
      } else if (tipo === 'paz-salvo') {
        const resultado = await this.supervisorArchivosService.obtenerArchivoPazSalvo(
          userId,
          nombreArchivoDecodificado
        );
        ruta = resultado.ruta;
      } else {
        throw new HttpException('Tipo de archivo no válido', HttpStatus.BAD_REQUEST);
      }

      const existe = fs.existsSync(ruta);

      res.json({
        success: true,
        data: {
          existe,
          ruta,
          nombre: nombreArchivoDecodificado,
          tipo
        }
      });
    } catch (error) {
      res.status(HttpStatus.NOT_FOUND).json({
        success: false,
        message: error.message || 'Error verificando archivo'
      });
    }
  }

  @Get('ver-archivo-auditor/:documentoId/:tipo')
  async verArchivoAuditor(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @Param('tipo') tipo: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`👁️ Supervisor ${userId} viendo archivo auditor ${tipo} del documento ${documentoId}`);

    try {
      const { ruta, nombre } = await this.supervisorArchivosService.obtenerArchivoAuditor(
        documentoId,
        tipo,
        userId,
      );

      if (!fs.existsSync(ruta)) {
        throw new HttpException(`Archivo ${nombre} no encontrado`, HttpStatus.NOT_FOUND);
      }

      // Forzar descarga en lugar de vista previa
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);

      const stream = fs.createReadStream(ruta);
      stream.pipe(res);
    } catch (error) {
      this.logger.error(`❌ Error descargando archivo auditor: ${error.message}`);
      if (!res.headersSent) {
        const status = error instanceof HttpException ? error.getStatus() : HttpStatus.NOT_FOUND;
        res.status(status).json({
          success: false,
          message: error.message || 'Error al descargar archivo'
        });
      }
    }
  }

  // ===============================
  // VER ARCHIVO DEL SUPERVISOR (APROBACIÓN) - Con autenticación
  // ===============================
  @Get('ver-archivo-supervisor/:nombreArchivo')
  async verArchivoSupervisor(
    @Param('nombreArchivo') nombreArchivo: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`👁️ Usuario ${userId} previsualizando archivo supervisor: ${nombreArchivo}`);

    try {
      const nombreArchivoDecodificado = decodeURIComponent(nombreArchivo);

      const { ruta, nombre } = await this.supervisorArchivosService.obtenerArchivoSupervisor(
        userId,
        nombreArchivoDecodificado,
      );

      if (!fs.existsSync(ruta)) {
        throw new HttpException(`Archivo ${nombre} no encontrado`, HttpStatus.NOT_FOUND);
      }

      const ext = path.extname(nombre).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };

      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

      const stream = fs.createReadStream(ruta);
      stream.pipe(res);

    } catch (error) {
      this.logger.error(`❌ Error previsualizando archivo supervisor: ${error.message}`);
      if (!res.headersSent) {
        res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          message: error.message || 'Archivo no encontrado',
        });
      }
    }
  }

  // ===============================
  // VER PAZ Y SALVO - Con autenticación
  // ===============================
  @Get('ver-paz-salvo/:nombreArchivo')
  async verPazSalvo(
    @Param('nombreArchivo') nombreArchivo: string,
    @Req() req: Request,
    @Res() res: Response
  ) {
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`👁️ Usuario ${userId} previsualizando paz y salvo: ${nombreArchivo}`);

    try {
      const nombreArchivoDecodificado = decodeURIComponent(nombreArchivo);

      const { ruta, nombre } = await this.supervisorArchivosService.obtenerArchivoPazSalvo(
        userId,
        nombreArchivoDecodificado
      );

      if (!fs.existsSync(ruta)) {
        this.logger.warn(`❌ Paz y salvo no encontrado en: ${ruta}`);
        throw new HttpException(`Archivo ${nombre} no encontrado`, HttpStatus.NOT_FOUND);
      }

      const ext = path.extname(nombre).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      };

      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

      const stream = fs.createReadStream(ruta);
      stream.pipe(res);

    } catch (error) {
      this.logger.error(`❌ Error previsualizando paz y salvo: ${error.message}`);
      if (!res.headersSent) {
        const status = error instanceof HttpException ? error.getStatus() : HttpStatus.NOT_FOUND;
        res.status(status).json({
          success: false,
          message: error.message || 'Error al ver archivo'
        });
      }
    }
  }
}