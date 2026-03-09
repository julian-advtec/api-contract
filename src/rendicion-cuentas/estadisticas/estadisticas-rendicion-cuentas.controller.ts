// src/rendicion-cuentas/controllers/estadisticas-rendicion-cuentas.controller.ts
import { Controller, Get, Query, Req, Logger } from '@nestjs/common';
import { EstadisticasRendicionCuentasService } from './estadisticas-rendicion-cuentas.service';
import { EstadisticasQueryDto } from './dto/estadisticas-query.dto';

@Controller('rendicion-cuentas/estadisticas')
export class EstadisticasRendicionCuentasController {
  private readonly logger = new Logger(EstadisticasRendicionCuentasController.name);

  constructor(private readonly statsService: EstadisticasRendicionCuentasService) {}

  @Get()
  async obtenerEstadisticas(@Query() query: EstadisticasQueryDto, @Req() req: any) {
    try {
      const usuario = req.user || { id: '0', role: 'ANON', nombre: 'Usuario sin autenticar' };

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
}