// src/auditor/controllers/auditor-estadisticas.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UseGuards,
  ForbiddenException,
  InternalServerErrorException,
  Query,
} from '@nestjs/common';
import type { Request } from 'express';

import { AuditorEstadisticasService } from '../services/auditor-estadisticas.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditorGuard } from '../../common/guards/auditor.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../users/enums/user-role.enum';

@Controller('auditor/estadisticas')
@UseGuards(JwtAuthGuard, RolesGuard, AuditorGuard)
@Roles(UserRole.AUDITOR_CUENTAS, UserRole.ADMIN)
export class AuditorEstadisticasController {
  constructor(
    private readonly auditorEstadisticasService: AuditorEstadisticasService,
  ) {}

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
      const resultado = await this.auditorEstadisticasService.obtenerEstadisticasAuditor(
        userId,
        periodoFinal
      );

      return {
        ok: true,
        timestamp: new Date().toISOString(),
        data: resultado,
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
      const historial = await this.auditorEstadisticasService.obtenerHistorialAuditor(userId);
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

  @Get('rechazados')
  async obtenerRechazados(
    @Req() req: Request,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('soloMios') soloMios?: string,
  ) {
    const userId = this.getUserIdFromRequest(req);

    try {
      const filtros: any = {
        soloMios: soloMios === 'true',
      };

      if (desde && hasta) {
        filtros.desde = new Date(desde);
        filtros.hasta = new Date(hasta);
      }

      const rechazados = await this.auditorEstadisticasService.obtenerDocumentosRechazados(
        userId,
        filtros
      );

      return {
        success: true,
        count: rechazados.length,
        data: rechazados,
      };
    } catch (error) {
      console.error('[ERROR en rechazados]', error);
      throw new InternalServerErrorException('Error al obtener documentos rechazados');
    }
  }
}

