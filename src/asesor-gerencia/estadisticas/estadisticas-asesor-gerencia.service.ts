// estadisticas-asesor-gerencia.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EstadisticasQueryDto, PeriodoStats } from './dto/estadisticas-query.dto';
import { AsesorGerenciaDocumento } from '../entities/asesor-gerencia-documento.entity';

@Injectable()
export class EstadisticasAsesorGerenciaService {
    private readonly logger = new Logger(EstadisticasAsesorGerenciaService.name);

    constructor(
        @InjectRepository(AsesorGerenciaDocumento)
        private documentoRepo: Repository<AsesorGerenciaDocumento>,
    ) { }

    async obtenerEstadisticas(query: EstadisticasQueryDto, usuario: any) {
        const { desde, hasta } = this.calcularRangoFechas(query);

        try {
            // Conteo agrupado
            const conteosRaw = await this.documentoRepo
                .createQueryBuilder('d')
                .select('d.estado', 'estado')
                .addSelect('COUNT(d.id)', 'cantidad')
                .where('d.fechaCreacion BETWEEN :desde AND :hasta', { desde, hasta })
                .groupBy('d.estado')
                .getRawMany();

            const conteos = conteosRaw.map(row => ({
                ...row,
                estado: row.estado ?? 'SIN_ESTADO',
                monto: 0,
            }));

            this.logger.debug(`Conteos obtenidos: ${conteos.length} grupos`);

            // Pendientes
            const pendientes = await this.documentoRepo
                .createQueryBuilder('d')
                .leftJoinAndSelect('d.documento', 'doc')
                .leftJoinAndSelect('d.asesor', 'a')
                .where("CAST(d.estado AS TEXT) LIKE :estado", { estado: '%PENDIENTE%' })
                .andWhere('d.fechaCreacion BETWEEN :desde AND :hasta', { desde, hasta })
                .orderBy('d.fechaCreacion', 'DESC')
                .limit(10)
                .getMany();

            // Procesados
            const procesados = await this.documentoRepo
                .createQueryBuilder('d')
                .leftJoinAndSelect('d.documento', 'doc')
                .leftJoinAndSelect('d.asesor', 'a')
                .where(
                    "CAST(d.estado AS TEXT) LIKE :aprobado OR CAST(d.estado AS TEXT) LIKE :observado OR CAST(d.estado AS TEXT) LIKE :rechazado",
                    {
                        aprobado: '%APROBADO%',
                        observado: '%OBSERVADO%',
                        rechazado: '%RECHAZADO%',
                    },
                )
                .andWhere('d.fechaCreacion BETWEEN :desde AND :hasta', { desde, hasta })
                .orderBy('d.fechaActualizacion', 'DESC')
                .limit(10)
                .getMany();

            return {
                documentos: {
                    pendientes: this.obtenerConteo(conteos, 'PENDIENTE'),
                    aprobados: this.obtenerConteo(conteos, 'APROBADO') + this.obtenerConteo(conteos, 'COMPLETADO'),
                    observados: this.obtenerConteo(conteos, 'OBSERVADO'),
                    rechazados: this.obtenerConteo(conteos, 'RECHAZADO'),
                    total: conteos.reduce((sum, c) => sum + Number(c.cantidad || 0), 0),
                },
                montos: {
                    pendiente: 0,
                    aprobado: 0,
                    observado: 0,
                    rechazado: 0,
                    total: 0,
                },
                distribucion: this.calcularDistribucion(conteos),
                actividadReciente: this.mapearActividad(procesados.slice(0, 5)),
                pendientes: this.mapearDocumentos(pendientes),
                procesados: this.mapearDocumentos(procesados),
                fechaCalculo: new Date(),
                desde,
                hasta,
            };
        } catch (error) {
            this.logger.error('Error al calcular estadísticas', error);
            throw new BadRequestException('No se pudieron calcular las estadísticas');
        }
    }

    private calcularRangoFechas(query: EstadisticasQueryDto) {
        const hasta = new Date();
        let desde = new Date();

        switch (query.periodo?.toLowerCase()) {
            case 'hoy':
            case PeriodoStats.HOY:
                desde.setHours(0, 0, 0, 0);
                break;
            case 'semana':
            case PeriodoStats.SEMANA:
                desde.setDate(desde.getDate() - 7);
                desde.setHours(0, 0, 0, 0);
                break;
            case 'mes':
            case PeriodoStats.MES:
                desde.setMonth(desde.getMonth() - 1);
                desde.setHours(0, 0, 0, 0);
                break;
            case 'trimestre':
            case PeriodoStats.TRIMESTRE:
                desde.setMonth(desde.getMonth() - 3);
                desde.setHours(0, 0, 0, 0);
                break;
            default:
                desde.setMonth(desde.getMonth() - 1);
        }
        return { desde, hasta };
    }

    private obtenerConteo(conteos: any[], estadoBuscado: string): number {
        const normalized = estadoBuscado.toUpperCase();
        const match = conteos.find((c) =>
            c.estado && String(c.estado).toUpperCase().includes(normalized)
        );
        return match ? Number(match.cantidad) || 0 : 0;
    }

    private calcularDistribucion(conteos: any[]) {
        const colores: Record<string, string> = {
            PENDIENTE: '#FFA726',
            APROBADO: '#66BB6A',
            OBSERVADO: '#FFB74D',
            RECHAZADO: '#EF5350',
            COMPLETADO: '#4CAF50',
            SIN_ESTADO: '#B0BEC5',
        };

        return conteos
            .filter((c) => c.estado || c.cantidad > 0)
            .map((c) => {
                const estadoNorm = String(c.estado || 'SIN_ESTADO').trim().toUpperCase();
                return {
                    estado: estadoNorm,
                    cantidad: Number(c.cantidad) || 0,
                    monto: 0,
                    color: colores[estadoNorm] || '#78909C',
                };
            });
    }

    private mapearDocumentos(docs: any[]) {
        return docs.map((d) => ({
            id: d.id,
            numeroRadicado: d.documento?.numeroRadicado || '—',
            contratista: d.documento?.nombreContratista || '—',
            contrato: d.documento?.numeroContrato || '—',
            monto: d.documento?.valorTotal || 0,
            estado: d.estado || 'SIN_ESTADO',
            fechaAsignacion: d.fechaCreacion,
            fechaProcesamiento: d.fechaActualizacion,
            asesorAsignado: d.asesor?.nombreCompleto || '—',
            tieneDocumento: !!d.documentoFirmadoPath,
            tieneFirma: !!d.firmaAplicada,
        }));
    }

    private mapearActividad(docs: any[]) {
        return docs.map((d) => ({
            id: d.id,
            tipo: this.normalizarTipo(d.estado),
            numeroRadicado: d.documento?.numeroRadicado || '—',
            contratista: d.documento?.nombreContratista || '—',
            monto: d.documento?.valorTotal || 0,
            fecha: d.fechaActualizacion || d.fechaCreacion,
            asesor: d.asesor?.nombreCompleto || 'Sistema',
        }));
    }

    private normalizarTipo(estado: string | null): string {
        if (!estado) return 'PENDIENTE';
        const upper = estado.toUpperCase();
        if (upper.includes('APROBADO') || upper.includes('COMPLETADO')) return 'APROBADO';
        if (upper.includes('OBSERVADO')) return 'OBSERVADO';
        if (upper.includes('RECHAZADO')) return 'RECHAZADO';
        return upper || 'PENDIENTE';
    }
}