import {
  Controller,
  Get,
  UseGuards,
  Req,
  Query,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';

import { SupervisorEstadisticasService } from '../services/supervisor-estadisticas.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SupervisorGuard } from '../../common/guards/supervisor.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../users/enums/user-role.enum';

@Controller('supervisor/estadisticas')
@UseGuards(JwtAuthGuard, RolesGuard, SupervisorGuard)
@Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
export class SupervisorEstadisticasController {
  private readonly logger = new Logger(SupervisorEstadisticasController.name);

  constructor(
    private readonly supervisorEstadisticasService: SupervisorEstadisticasService,
  ) {}

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
  // OBTENER HISTORIAL
  // ===============================
  @Get('historial')
  async obtenerHistorial(@Req() req: Request, @Query('limit') limit?: number) {
    const userId = this.getUserIdFromRequest(req);
    try {
      const historial = await this.supervisorEstadisticasService.obtenerHistorialSupervisor(userId);
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

  // ===============================
  // OBTENER ESTADÍSTICAS
  // ===============================
  @Get()
  async obtenerEstadisticas(@Req() req: Request) {
    const user = (req as any).user;
    const userId = this.getUserIdFromRequest(req);
    this.logger.log(`📈 ${user.role} ${user.username} solicitando estadísticas`);

    try {
      const estadisticas = await this.supervisorEstadisticasService.obtenerEstadisticasSupervisor(userId);

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
  // VERIFICAR INCONSISTENCIAS (diagnóstico)
  // ===============================
  @Get('diagnostico/inconsistencias')
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR)
  async verificarInconsistencias(@Req() req: Request) {
    const user = (req as any).user;
    this.logger.log(`🔍 ${user.role} ${user.username} verificando inconsistencias`);

    try {
      const resultado = await this.supervisorEstadisticasService.verificarInconsistencias();

      return {
        success: true,
        data: resultado
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