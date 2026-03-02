// src/estadisticas-radicador/estadisticas-radicador.controller.ts
import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../users/enums/user-role.enum';
import { EstadisticasRadicadorService } from './estadisticas-radicador.service';
import { EstadisticasRadicadorQueryDto, PeriodoEstadisticas } from './dto/estadisticas-radicador-query.dto';

@Controller('estadisticas/radicador')
export class EstadisticasRadicadorController {
  constructor(
    private readonly estadisticasRadicadorService: EstadisticasRadicadorService,
  ) {}

  @Get('mis-estadisticas')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.RADICADOR, UserRole.ADMIN)
  async obtenerMisEstadisticas(
    @Req() req: any,
    @Query() query: EstadisticasRadicadorQueryDto,
  ) {
    const user = req.user;

    if (!user || !user.id) {
      throw new ForbiddenException('Usuario no autenticado correctamente');
    }

    const rol = (user.role || '').toLowerCase();
    if (!['radicador', 'admin'].includes(rol)) {
      throw new ForbiddenException('Acceso restringido a este módulo de estadísticas');
    }

    try {
      const resultado = await this.estadisticasRadicadorService.obtenerMisEstadisticas(
        user,
        query.periodo || PeriodoEstadisticas.ANO,
      );

      return {
        success: true,
        data: resultado,
        meta: {
          periodo: query.periodo || 'ano',
          calculadoEn: new Date().toISOString(),
        },
      };
    } catch (error) {
      console.error('[ERROR en controlador mis-estadisticas]', error);
      throw new InternalServerErrorException('Error al calcular estadísticas');
    }
  }
}