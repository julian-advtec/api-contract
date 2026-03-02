// src/supervisor/estadisticas/supervisor-estadisticas.controller.ts
import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';  // ← Cambia a import type

import { SupervisorEstadisticasService } from '../services/supervisor-estadisticas.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SupervisorGuard } from '../../common/guards/supervisor.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../users/enums/user-role.enum';
import { SupervisorEstadisticasQueryDto } from '../dto/supervisor-estadisticas-query.dto';

@Controller('supervisor/estadisticas')
@UseGuards(JwtAuthGuard, RolesGuard, SupervisorGuard)
@Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
export class SupervisorEstadisticasController {
  constructor(
    private readonly supervisorEstadisticasService: SupervisorEstadisticasService,
  ) {}

  private getUserIdFromRequest(req: Request): string {
    const user = (req as any).user;
    const userId = user?.id || user?.userId || user?.sub || user?.user?.id;

    if (!userId) {
      throw new ForbiddenException('Usuario no autenticado correctamente');
    }
    return userId;
  }

  @Get('historial')
  async obtenerHistorial(
    @Req() req: Request,
    @Query() query: SupervisorEstadisticasQueryDto,
  ) {
    const userId = this.getUserIdFromRequest(req);
    const limit = query.limit ? parseInt(query.limit, 10) : 50;

    try {
      const historial = await this.supervisorEstadisticasService.obtenerHistorialSupervisor(userId);
      return {
        success: true,
        count: historial.length,
        data: limit ? historial.slice(0, limit) : historial,
      };
    } catch (error) {
      console.error('[ERROR en historial]', error);
      throw new InternalServerErrorException('Error al obtener historial');
    }
  }

  @Get()
  async obtenerEstadisticas(@Req() req: Request) {
    const userId = this.getUserIdFromRequest(req);

    try {
      const estadisticas = await this.supervisorEstadisticasService.obtenerEstadisticasSupervisor(userId);
      return {
        success: true,
        data: estadisticas,
      };
    } catch (error) {
      console.error('[ERROR en estadisticas supervisor]', error);
      throw new InternalServerErrorException('Error al obtener estadísticas');
    }
  }

  @Get('diagnostico/inconsistencias')
  async verificarInconsistencias(@Req() req: Request) {
    const userId = this.getUserIdFromRequest(req);

    try {
      const resultado = await this.supervisorEstadisticasService.verificarInconsistencias();
      return {
        success: true,
        data: resultado,
      };
    } catch (error) {
      console.error('[ERROR en inconsistencias]', error);
      throw new InternalServerErrorException('Error al verificar inconsistencias');
    }
  }
}