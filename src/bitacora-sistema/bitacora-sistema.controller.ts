// src/bitacora-sistema/controllers/bitacora-sistema.controller.ts
import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  HttpException,
  HttpStatus,
  Logger,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';  // ← CAMBIO IMPORTANTE: usar 'import type'
import { BitacoraSistemaService } from './bitacora-sistema.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { ModuloBitacora } from './entities/bitacora-sistema.entity';

@Controller('bitacora')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
export class BitacoraSistemaController {
  private readonly logger = new Logger(BitacoraSistemaController.name);

  constructor(private readonly bitacoraService: BitacoraSistemaService) {}

  @Get('documento/:documentoId')
  async getByDocumento(
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
    @Query('limite') limite?: number,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('modulo') modulo?: ModuloBitacora,
  ) {
    try {
      const registros = await this.bitacoraService.consultarPorDocumento(
        documentoId,
        {
          limite: limite ? Number(limite) : 100,
          desde: desde ? new Date(desde) : undefined,
          hasta: hasta ? new Date(hasta) : undefined,
          modulo,
        }
      );
      return { success: true, count: registros.length, data: registros };
    } catch (error) {
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('usuario/:usuarioId')
  async getByUsuario(
    @Param('usuarioId', ParseUUIDPipe) usuarioId: string,
    @Query('limite') limite?: number,
  ) {
    try {
      const registros = await this.bitacoraService.consultarPorUsuario(
        usuarioId,
        limite ? Number(limite) : 100,
      );
      return { success: true, count: registros.length, data: registros };
    } catch (error) {
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('rol/:rol')
  async getByRol(
    @Param('rol') rol: string,
    @Query('limite') limite?: number,
  ) {
    try {
      const registros = await this.bitacoraService.consultarPorRol(
        rol,
        limite ? Number(limite) : 100,
      );
      return { success: true, count: registros.length, data: registros };
    } catch (error) {
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('modulo/:modulo')
  async getByModulo(
    @Param('modulo') modulo: ModuloBitacora,
    @Query('limite') limite?: number,
  ) {
    try {
      const registros = await this.bitacoraService.consultarPorModulo(
        modulo,
        limite ? Number(limite) : 100,
      );
      return { success: true, count: registros.length, data: registros };
    } catch (error) {
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('estadisticas')
  async getEstadisticas(
    @Query('desde') desde: string,
    @Query('hasta') hasta?: string,
  ) {
    try {
      const desdeDate = new Date(desde);
      const hastaDate = hasta ? new Date(hasta) : new Date();
      const estadisticas = await this.bitacoraService.obtenerEstadisticas(
        desdeDate,
        hastaDate,
      );
      return { success: true, data: estadisticas };
    } catch (error) {
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('timeline/:documentoId')
  async getTimeline(@Param('documentoId', ParseUUIDPipe) documentoId: string) {
    try {
      const timeline = await this.bitacoraService.obtenerTimelineDocumento(documentoId);
      return { success: true, data: timeline };
    } catch (error) {
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Nuevos endpoints para obtener logs TXT
  @Get('logs/general')
  async getLogsGeneral(@Res() res: Response) {
    try {
      const logs = await this.bitacoraService.obtenerLogsTXT('general');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(logs);
    } catch (error) {
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('logs/rol/:rol')
  async getLogsPorRol(@Param('rol') rol: string, @Res() res: Response) {
    try {
      const logs = await this.bitacoraService.obtenerLogsTXT('roles', rol);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(logs);
    } catch (error) {
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('logs/modulo/:modulo')
  async getLogsPorModulo(@Param('modulo') modulo: string, @Res() res: Response) {
    try {
      const logs = await this.bitacoraService.obtenerLogsTXT('modulos', modulo);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(logs);
    } catch (error) {
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('logs/errores')
  async getLogsErrores(@Res() res: Response) {
    try {
      const logs = await this.bitacoraService.obtenerLogsTXT('errores');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(logs);
    } catch (error) {
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}