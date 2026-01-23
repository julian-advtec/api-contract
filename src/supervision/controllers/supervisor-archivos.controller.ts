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
  // DESCARGAR / VER ARCHIVOS RADICADOS
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
        // Para previsualización inline
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
  // VER ARCHIVO RADICADO (visualización inline)
  // ===============================
  @Get('ver/:documentoId/archivo/:numeroArchivo')
  async verArchivoRadicado(
    @Param('documentoId') documentoId: string,
    @Param('numeroArchivo') numeroArchivo: number,
    @Req() req: Request,
    @Res() res: Response
  ) {
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`👁️ Usuario ${userId} viendo archivo ${numeroArchivo} del documento ${documentoId}`);

    
    try {
      const { ruta, nombre } = await this.supervisorArchivosService.descargarArchivoRadicado(
        documentoId,
        numeroArchivo,
        userId
      );

      // Verificar si el archivo existe
      if (!fs.existsSync(ruta)) {
        throw new HttpException(`Archivo ${nombre} no encontrado`, HttpStatus.NOT_FOUND);
      }

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

  // ===============================
  // VER ARCHIVO DEL SUPERVISOR (APROBACIÓN)
  // ===============================
  @Get('ver-archivo-supervisor/:nombreArchivo')
  async verArchivoSupervisor(
    @Param('nombreArchivo') nombreArchivo: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`👁️ Usuario ${userId} viendo archivo supervisor: ${nombreArchivo}`);

    try {
      // Decodificar el nombre del archivo (puede venir codificado en URL)
      const nombreArchivoDecodificado = decodeURIComponent(nombreArchivo);

      const { ruta, nombre } = await this.supervisorArchivosService.obtenerArchivoSupervisor(
        userId,
        nombreArchivoDecodificado,
      );

      // Verificar si el archivo existe
      if (!fs.existsSync(ruta)) {
        this.logger.warn(`❌ Archivo no encontrado en ruta: ${ruta}`);
        throw new HttpException(`Archivo ${nombre} no encontrado`, HttpStatus.NOT_FOUND);
      }

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

      const fileStream = fs.createReadStream(ruta);
      fileStream.pipe(res);
    } catch (error) {
      this.logger.error(`❌ Error viendo archivo supervisor: ${error.message}`);
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
  // VER PAZ Y SALVO
  // ===============================
  @Get('ver-paz-salvo/:nombreArchivo')
  async verPazSalvo(
    @Param('nombreArchivo') nombreArchivo: string,
    @Req() req: Request,
    @Res() res: Response
  ) {
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`👁️ Usuario ${userId} viendo paz y salvo: ${nombreArchivo}`);

    try {
      // Decodificar el nombre del archivo
      const nombreArchivoDecodificado = decodeURIComponent(nombreArchivo);

      const { ruta, nombre } = await this.supervisorArchivosService.obtenerArchivoPazSalvo(
        userId,
        nombreArchivoDecodificado
      );

      // Verificar si el archivo existe
      if (!fs.existsSync(ruta)) {
        this.logger.warn(`❌ Archivo de paz y salvo no encontrado en ruta: ${ruta}`);
        throw new HttpException(`Archivo ${nombre} no encontrado`, HttpStatus.NOT_FOUND);
      }

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
}