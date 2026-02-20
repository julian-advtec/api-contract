import { Controller, Get, Query, Req, Logger } from '@nestjs/common';
import { EstadisticasTesoreriaService } from './estadisticas-tesoreria.service';
import { EstadisticasQueryDto } from './dto/estadisticas-query.dto';

@Controller('tesoreria/estadisticas')
export class EstadisticasTesoreriaController {
  private readonly logger = new Logger(EstadisticasTesoreriaController.name);

  constructor(private readonly statsService: EstadisticasTesoreriaService) {}

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