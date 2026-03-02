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
  ) {}

  private getUserIdFromRequest(req: Request): string {
    const user = (req as any).user;
    const userId = user?.id || user?.userId || user?.sub || user?.user?.id;
    if (!userId) throw new ForbiddenException('Usuario no autenticado correctamente');
    return userId;
  }

 @Get()
async obtenerEstadisticas(
  @Req() req: Request,
  @Query('periodo') periodo?: string,
) {
  const userId = this.getUserIdFromRequest(req);
  
  console.log('========== DEBUG CONTROLLER ==========');
  console.log('Período recibido (raw):', periodo);
  console.log('URL completa:', req.url);
  
  let periodoValido: PeriodoEstadisticasSupervisor;
  
  if (periodo && Object.values(PeriodoEstadisticasSupervisor).includes(periodo as PeriodoEstadisticasSupervisor)) {
    periodoValido = periodo as PeriodoEstadisticasSupervisor;
    console.log(`✅ Período válido: "${periodoValido}"`);
  } else {
    periodoValido = PeriodoEstadisticasSupervisor.ANO;
    console.log(`⚠️ Período inválido o no proporcionado, usando default: "${periodoValido}"`);
  }
  console.log('======================================');

  try {
    const resultado = await this.supervisorEstadisticasService.obtenerEstadisticasSupervisor(userId, periodoValido);

    return {
      success: true,
      data: resultado,
      meta: {
        periodo: periodoValido,
        calculadoEn: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error('[ERROR en estadisticas supervisor]', error);
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