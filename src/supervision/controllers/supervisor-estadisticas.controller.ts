import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Body, Post,   } from '@nestjs/common';

import { SupervisorEstadisticasService } from '../services/supervisor-estadisticas.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SupervisorGuard } from '../../common/guards/supervisor.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../users/enums/user-role.enum';
import { PeriodoEstadisticasSupervisor } from '../dto/supervisor-estadisticas-query.dto';

@Controller('supervisor/estadisticas')
@UseGuards(JwtAuthGuard, RolesGuard, SupervisorGuard)
@Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
export class SupervisorEstadisticasController {
  constructor(
    private readonly supervisorEstadisticasService: SupervisorEstadisticasService,
  ) { }

private getUserIdFromRequest(req: Request): string {
    const user = (req as any).user;
    const userId = user?.id || user?.userId || user?.sub || user?.user?.id;
    if (!userId) throw new ForbiddenException('Usuario no autenticado correctamente');
    return userId;
  }

 @Post()
async obtenerEstadisticas(
  @Req() req: Request,
  @Body() body: { periodo?: string },
) {
  const userId = this.getUserIdFromRequest(req);

  let periodoFinal = 'ano';

  if (body?.periodo) {
    const normalized = body.periodo.trim().toLowerCase();
    const validos = ['hoy', 'semana', 'mes', 'trimestre', 'ano'];
    if (validos.includes(normalized)) {
      periodoFinal = normalized;
    }
  }

  try {
    const resultado = await this.supervisorEstadisticasService.obtenerEstadisticasSupervisor(
      userId,
      periodoFinal
    );

    return {
      ok: true,
      timestamp: new Date().toISOString(),
      data: {
        success: true,
        data: resultado,
      },
    };
  } catch (error) {
    console.error('[ERROR en controlador POST estadisticas]', error);
    throw new InternalServerErrorException('Error al calcular estadísticas');
  }
}



  @Get('historial')
  async obtenerHistorial(
    @Req() req: Request,
    @Query('limit') limit?: string,
  ) {
    const userId = this.getUserIdFromRequest(req);
    const limitValue = limit ? parseInt(limit, 10) : 50;

    try {
      const historial = await this.supervisorEstadisticasService.obtenerHistorialSupervisor(userId);
      return {
        success: true,
        count: historial.length,
        data: limitValue ? historial.slice(0, limitValue) : historial,
      };
    } catch (error) {
      console.error('[ERROR en historial]', error);
      throw new InternalServerErrorException('Error al obtener historial');
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