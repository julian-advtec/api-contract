// src/radicacion/estadisticas/estadisticas-radicador.service.ts
import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Documento } from '../entities/documento.entity';
import { PeriodoEstadisticas } from './dto/estadisticas-radicador-query.dto';

@Injectable()
export class EstadisticasRadicadorService {
  private readonly logger = new Logger(EstadisticasRadicadorService.name);

  constructor(
    @InjectRepository(Documento)
    private readonly documentoRepository: Repository<Documento>,
  ) {}

  async obtenerMisEstadisticas(user: any, periodo: PeriodoEstadisticas): Promise<any> {
    if (!user?.id) {
      throw new InternalServerErrorException('Usuario sin ID válido');
    }

    const userId = user.id;
    this.logger.debug(`Calculando estadísticas para userId: ${userId}, periodo: ${periodo}`);

    const ahora = new Date();

    // Cálculo corregido de 'desde' sin mutar la fecha base de forma peligrosa
    let desde: Date;
    switch (periodo) {
      case PeriodoEstadisticas.HOY:
        desde = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 0, 0, 0, 0);
        break;

      case PeriodoEstadisticas.SEMANA:
        desde = new Date(ahora);
        desde.setDate(ahora.getDate() - 7);
        desde.setHours(0, 0, 0, 0); // ← CORREGIDO: solo 4 argumentos (hora, min, seg, ms)
        break;

      case PeriodoEstadisticas.MES:
        desde = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1, 0, 0, 0, 0);
        break;

      case PeriodoEstadisticas.TRIMESTRE:
        desde = new Date(ahora.getFullYear(), ahora.getMonth() - 3, 1, 0, 0, 0, 0);
        break;

      case PeriodoEstadisticas.ANO:
      default:
        desde = new Date(ahora.getFullYear(), 0, 1, 0, 0, 0, 0);
        break;
    }

    const hasta = new Date(ahora);

    this.logger.debug(`Rango calculado: ${desde.toISOString()} → ${hasta.toISOString()}`);
    this.logger.debug(`Usuario ID: ${userId}`);

    try {
      // 1. Total en el período
      const totalEnPeriodo = await this.documentoRepository.count({
        where: {
          radicador: { id: userId },
          fechaRadicacion: Between(desde, hasta),
        },
      });
      this.logger.debug(`Total en período: ${totalEnPeriodo}`);

      // 2. Distribución por estado
      const porEstadoRaw = await this.documentoRepository
        .createQueryBuilder('doc')
        .select('doc.estado', 'estado')
        .addSelect('COUNT(*)', 'cantidad')
        .where('doc.radicador_id = :userId', { userId })
        .andWhere('doc.fecha_radicacion BETWEEN :desde AND :hasta', { desde, hasta })
        .andWhere('doc.fecha_radicacion IS NOT NULL')
        .groupBy('doc.estado')
        .getRawMany();

      const distribucionEstados = porEstadoRaw.reduce((acc, row) => {
        const estado = row.estado || 'SIN_ESTADO';
        acc[estado] = Number(row.cantidad) || 0;
        return acc;
      }, {} as Record<string, number>);

      this.logger.debug(`Distribución por estado:`, distribucionEstados);

      // 3. Últimos 10 (sin filtro de fecha)
      const ultimos = await this.documentoRepository.find({
        where: { radicador: { id: userId } },
        order: { fechaRadicacion: 'DESC' },
        take: 10,
        select: ['id', 'numeroRadicado', 'nombreContratista', 'fechaRadicacion', 'estado'],
      });

      this.logger.debug(`Últimos encontrados: ${ultimos.length} documentos`);

      const ultimosMapeados = ultimos.map((doc) => ({
        id: doc.id,
        numeroRadicado: doc.numeroRadicado || '—',
        contratista: doc.nombreContratista || 'No especificado',
        fecha: doc.fechaRadicacion ? doc.fechaRadicacion.toISOString() : null,
        estado: doc.estado || 'SIN_ESTADO',
      }));

      return {
        documentos: {
          totalRadicados: totalEnPeriodo,
        },
        distribucion: Object.entries(distribucionEstados).map(([estado, cantidad]) => {
          const cant = Number(cantidad) || 0;
          return {
            estado,
            cantidad: cant,
            porcentaje: totalEnPeriodo > 0 ? Math.round((cant / totalEnPeriodo) * 100) : 0,
          };
        }),
        ultimosRadicados: ultimosMapeados,
        fechaCalculo: new Date().toISOString(),
        desde: desde.toISOString(),
        hasta: hasta.toISOString(),
      };
    } catch (error) {
      this.logger.error(`Error al calcular estadísticas para ${userId}:`, error);
      this.logger.error(error.stack);
      throw new InternalServerErrorException('Error interno al procesar estadísticas');
    }
  }
}