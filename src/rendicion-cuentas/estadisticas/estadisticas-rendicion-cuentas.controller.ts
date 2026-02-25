import { Controller, Get, Query, UseGuards, Logger } from '@nestjs/common';
import { EstadisticasRendicionCuentasService } from './estadisticas-rendicion-cuentas.service';
import { EstadisticasQueryDto } from './dto/estadisticas-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { GetUser } from '../../auth/decorators/get-user.decorator';
import { UserRole } from '../../users/enums/user-role.enum';
import { EstadisticasRendicionCuentas } from './interfaces/estadisticas.interface';

// ✅ IGUAL QUE EN ASESOR-GERENCIA - tipo inline
interface JwtUser {
  id: string;
  username: string;
  role: UserRole;
  fullName?: string;
  email?: string;
}

@Controller('rendicion-cuentas/estadisticas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EstadisticasRendicionCuentasController {
  private readonly logger = new Logger(EstadisticasRendicionCuentasController.name);

  constructor(private readonly statsService: EstadisticasRendicionCuentasService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.RENDICION_CUENTAS, UserRole.AUDITOR_CUENTAS)
  async obtenerEstadisticas(@Query() query: EstadisticasQueryDto, @GetUser() user: JwtUser) {
    try {
      const resultado: EstadisticasRendicionCuentas = await this.statsService.obtenerEstadisticas(query, user);

      return {
        ok: true,
        data: resultado,
        meta: {
          periodo: query.periodo,
          calculadoEn: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error(`Error en endpoint estadisticas: ${error.message}`, error.stack);
      return {
        ok: false,
        error: 'No se pudieron obtener las estadísticas',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      };
    }
  }

  @Get('resumen')
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.RENDICION_CUENTAS)
  async obtenerResumenRapido(@GetUser() user: JwtUser) {
    try {
      const resultado: EstadisticasRendicionCuentas = await this.statsService.obtenerEstadisticas(
        { periodo: 'semana' as any },
        user
      );

      return {
        ok: true,
        data: {
          totalPendientes: resultado.resumen.pendientes + (resultado.resumen.enRevision || 0),
          misPendientes: resultado.misMetricas?.pendientes || 0,
          procesadosSemana: resultado.misMetricas?.procesadosSemana || 0,
          tasaAprobacion: resultado.rendimiento.tasaAprobacion || 0,
        },
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }


  
  
}