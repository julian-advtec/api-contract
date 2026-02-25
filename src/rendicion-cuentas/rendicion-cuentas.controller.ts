// src/rendicion-cuentas/rendicion-cuentas.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Res,
  Logger,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import archiver from 'archiver';
import * as fs from 'fs';
import * as path from 'path';

import { RendicionCuentasService } from './rendicion-cuentas.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { TomarDecisionDto } from './dto/rendicion-cuentas.dto';

interface JwtUser {
  id: string;
  username: string;
  role: UserRole;
  fullName?: string;
  email?: string;
}

@Controller('rendicion-cuentas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RendicionCuentasController {
  private readonly logger = new Logger(RendicionCuentasController.name);

  constructor(private readonly service: RendicionCuentasService) { }

  @Get('documentos/disponibles')
  @Roles(UserRole.ADMIN, UserRole.RENDICION_CUENTAS)
  async getDocumentosDisponibles(@GetUser() user: JwtUser) {
    const documentos = await this.service.obtenerDocumentosDisponibles(user.id);
    return {
      ok: true,
      data: documentos,
      total: documentos.length,
    };
  }

  @Post('documentos/:documentoId/tomar')
  @Roles(UserRole.ADMIN, UserRole.RENDICION_CUENTAS)
  async tomarDocumento(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: JwtUser,
  ) {
    const result = await this.service.tomarDocumento(documentoId, user.id);
    return {
      ok: true,
      message: result.message,
      rendicionId: result.rendicionId,
    };
  }

  @Get('todos-documentos')
  @Roles(UserRole.ADMIN, UserRole.RENDICION_CUENTAS, UserRole.SUPERVISOR)
  async getTodosDocumentos(@GetUser() user: JwtUser) {
    const documentos = await this.service.obtenerTodosDocumentos(user.id);
    return {
      ok: true,
      data: documentos,
      total: documentos.length,
    };
  }

  @Get('mis-documentos-en-revision')
  @Roles(UserRole.ADMIN, UserRole.RENDICION_CUENTAS)
  async getMisDocumentosEnRevision(@GetUser() user: JwtUser) {
    const documentos = await this.service.obtenerMisDocumentosEnRevision(user.id);
    return {
      ok: true,
      data: documentos,
      total: documentos.length,
    };
  }

  @Patch('documentos/:id/decision')
  @Roles(UserRole.ADMIN, UserRole.RENDICION_CUENTAS)
  async tomarDecision(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() decisionDto: TomarDecisionDto,
    @GetUser() user: JwtUser,
  ) {
    try {
      console.log('📥 ===== SOLICITUD DE DECISIÓN RECIBIDA =====');
      console.log('📥 id:', id);
      console.log('📥 decisionDto:', decisionDto);
      console.log('📥 usuario:', user.id, user.username);
      
      const result = await this.service.tomarDecision(id, decisionDto, user);
      
      const mensajes = {
        APROBADO: 'Documento aprobado correctamente',
        OBSERVADO: 'Observación registrada correctamente',
        RECHAZADO: 'Documento rechazado correctamente',
      };

      return {
        ok: true,
        message: mensajes[decisionDto.decision] || 'Decisión registrada',
        data: result,
      };
    } catch (error) {
      console.error('❌ Error en tomarDecision:', error);
      throw error;
    }
  }

  @Get('documentos/:documentoId/descargar')
  @Roles(UserRole.ADMIN, UserRole.RENDICION_CUENTAS, UserRole.SUPERVISOR)
  async descargarCarpeta(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @GetUser() user: JwtUser,
    @Res() res: Response,
  ) {
    console.log('📥 ===== SOLICITUD DE DESCARGA RECIBIDA =====');
    console.log('📥 documentoId:', documentoId);
    console.log('📥 usuario:', user.id, user.username);

    try {
      const { rutaCarpeta, documentoInfo } = await this.service.obtenerRutaCarpeta(documentoId, user.id);
      console.log('✅ Ruta obtenida:', rutaCarpeta);

      this.logger.log(`📂 Descargando carpeta: ${rutaCarpeta} para documento ${documentoId}`);

      if (!fs.existsSync(rutaCarpeta)) {
        throw new Error(`La carpeta no existe: ${rutaCarpeta}`);
      }

      const archive = archiver('zip', { zlib: { level: 6 } });

      const nombreSeguro = documentoInfo.numeroRadicado
        ? documentoInfo.numeroRadicado.replace(/[^a-zA-Z0-9-]/g, '_')
        : `documento-${documentoId}`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${nombreSeguro}.zip"`);

      archive.pipe(res);

      const agregarArchivosRecursivo = (dir: string, baseDir: string) => {
        const archivos = fs.readdirSync(dir);

        for (const archivo of archivos) {
          const rutaCompleta = path.join(dir, archivo);
          const stat = fs.statSync(rutaCompleta);
          const rutaRelativa = path.relative(baseDir, rutaCompleta);

          if (stat.isDirectory()) {
            agregarArchivosRecursivo(rutaCompleta, baseDir);
          } else {
            const ext = path.extname(archivo).toLowerCase();
            if (ext !== '.txt') {
              archive.file(rutaCompleta, { name: rutaRelativa });
              this.logger.debug(`➕ Agregando: ${rutaRelativa}`);
            } else {
              this.logger.debug(`⏭️ Excluyendo .txt: ${archivo}`);
            }
          }
        }
      };

      agregarArchivosRecursivo(rutaCarpeta, rutaCarpeta);

      this.logger.log(`📦 Finalizando ZIP...`);
      await archive.finalize();

    } catch (error) {
      console.error('❌ Error en descarga:', error);
      this.logger.error('❌ Error generando ZIP:', error);
      if (!res.headersSent) {
        res.status(500).json({
          ok: false,
          message: error.message || 'Error al generar el archivo ZIP'
        });
      }
    }
  }

  @Get('rendiciones/:rendicionId/detalle')
  @Roles(UserRole.ADMIN, UserRole.RENDICION_CUENTAS, UserRole.SUPERVISOR)
  async getDetalleRendicion(
    @Param('rendicionId', ParseUUIDPipe) rendicionId: string,
    @GetUser() user: JwtUser,
  ) {
    console.log('📥 ===== SOLICITUD DE DETALLE DE RENDICIÓN RECIBIDA =====');
    console.log('📥 rendicionId:', rendicionId);
    console.log('📥 usuario:', user.id, user.username);
    
    try {
      const detalle = await this.service.obtenerDetalleDocumento(rendicionId, user.id);
      console.log('✅ Detalle obtenido, ID:', detalle.id);
      
      return {
        ok: true,
        data: detalle,
      };
    } catch (error) {
      console.error('❌ Error obteniendo detalle:', error);
      throw error;
    }
  }

  @Get('historial')
  @Roles(UserRole.ADMIN, UserRole.RENDICION_CUENTAS)
  async getHistorial(@GetUser() user: JwtUser) {
    const historial = await this.service.obtenerHistorial(user.id);
    return historial;
  }
  
}