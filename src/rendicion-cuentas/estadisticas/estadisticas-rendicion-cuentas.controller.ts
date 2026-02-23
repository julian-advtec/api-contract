// src/rendicion-cuentas/estadisticas/estadisticas-rendicion-cuentas.controller.ts
import { Controller, Get, Query, Req, Logger, UseGuards } from '@nestjs/common';
import { EstadisticasRendicionCuentasService } from './estadisticas-rendicion-cuentas.service';
import { EstadisticasQueryDto } from './dto/estadisticas-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../users/enums/user-role.enum'; // ← CAMBIO CRÍTICO

@Controller('rendicion-cuentas/estadisticas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EstadisticasRendicionCuentasController {
  private readonly logger = new Logger(EstadisticasRendicionCuentasController.name);

  constructor(
    private readonly statsService: EstadisticasRendicionCuentasService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.RENDICION_CUENTAS, UserRole.AUDITOR_CUENTAS)
  async obtenerEstadisticas(
    @Query() query: EstadisticasQueryDto,
    @Req() req: any,
  ) {
    try {
      const usuario = req.user || { 
        id: '0', 
        role: 'anon', 
        nombre: 'Usuario sin autenticar' 
      };

      this.logger.log(`Obteniendo estadísticas para usuario: ${usuario.id}, periodo: ${query.periodo}`);

      const resultado = await this.statsService.obtenerEstadisticas(query, usuario);

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
        error: 'No se pudieron obtener las estadísticas en este momento',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      };
    }
  }

  @Get('resumen')
  @Roles(UserRole.ADMIN, UserRole.SUPERVISOR, UserRole.RENDICION_CUENTAS)
  async obtenerResumenRapido(@Req() req: any) { // ← TIPADO CORREGIDO
    try {
      const resultado = await this.statsService.obtenerEstadisticas(
        { periodo: 'semana' as any },
        req.user
      );

      return {
        ok: true,
        data: {
          totalPendientes: resultado.resumen.pendientes + resultado.resumen.enRevision,
          misPendientes: resultado.misMetricas?.pendientes || 0,
          procesadosSemana: resultado.misMetricas?.procesadosSemana || 0,
          tasaAprobacion: resultado.metricas.tasaAprobacion,
        },
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
}