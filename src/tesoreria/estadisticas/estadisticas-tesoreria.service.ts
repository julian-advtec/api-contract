// src/tesoreria/estadisticas/estadisticas-tesoreria.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { EstadisticasQueryDto, PeriodoStats } from './dto/estadisticas-query.dto';
import { TesoreriaDocumento, TesoreriaEstado } from '../entities/tesoreria-documento.entity';

@Injectable()
export class EstadisticasTesoreriaService {
    private readonly logger = new Logger(EstadisticasTesoreriaService.name);

    constructor(
        @InjectRepository(TesoreriaDocumento)
        private documentoRepo: Repository<TesoreriaDocumento>,
    ) { }

    async obtenerEstadisticas(query: EstadisticasQueryDto, usuario: any) {
        const { desde, hasta } = this.calcularRangoFechas(query);

        try {
            // Conteo agrupado usando los enums reales
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

            // Obtener pendientes (solo EN_REVISION)
            const pendientes = await this.documentoRepo
                .createQueryBuilder('d')
                .leftJoinAndSelect('d.documento', 'doc')
                .leftJoinAndSelect('d.tesorero', 't')
                .where('d.estado = :estado', { estado: TesoreriaEstado.EN_REVISION })
                .andWhere('d.fechaCreacion BETWEEN :desde AND :hasta', { desde, hasta })
                .orderBy('d.fechaCreacion', 'DESC')
                .getMany();

            // Obtener procesados (COMPLETADO_TESORERIA, OBSERVADO_TESORERIA, RECHAZADO_TESORERIA)
            const procesados = await this.documentoRepo
                .createQueryBuilder('d')
                .leftJoinAndSelect('d.documento', 'doc')
                .leftJoinAndSelect('d.tesorero', 't')
                .where('d.estado IN (:...estados)', { 
                    estados: [
                        TesoreriaEstado.COMPLETADO_TESORERIA,
                        TesoreriaEstado.OBSERVADO_TESORERIA,
                        TesoreriaEstado.RECHAZADO_TESORERIA
                    ] 
                })
                .andWhere('d.fechaCreacion BETWEEN :desde AND :hasta', { desde, hasta })
                .orderBy('d.fechaActualizacion', 'DESC')
                .getMany();

            this.logger.debug(`Pendientes encontrados: ${pendientes.length}`);
            this.logger.debug(`Procesados encontrados: ${procesados.length}`);

            // Crear actividad reciente combinando pendientes y procesados
            const todosLosProcesos = [...pendientes, ...procesados]
                .sort((a, b) => {
                    const fechaA = a.fechaActualizacion || a.fechaCreacion;
                    const fechaB = b.fechaActualizacion || b.fechaCreacion;
                    return new Date(fechaB).getTime() - new Date(fechaA).getTime();
                })
                .slice(0, 10);

            const actividadReciente = todosLosProcesos.map(p => ({
                id: p.id,
                tipo: this.normalizarTipo(p.estado),
                numeroRadicado: p.documento?.numeroRadicado || '—',
                contratista: p.documento?.nombreContratista || '—',
                monto: 0,
                fecha: p.fechaActualizacion || p.fechaCreacion,
                tesorero: p.tesorero?.fullName || p.tesorero?.username || 'Sistema',
            }));

            return {
                documentos: {
                    pendientes: this.obtenerConteo(conteos, TesoreriaEstado.EN_REVISION) || pendientes.length,
                    pagados: this.obtenerConteo(conteos, TesoreriaEstado.COMPLETADO_TESORERIA) || 
                             procesados.filter(p => p.estado === TesoreriaEstado.COMPLETADO_TESORERIA).length,
                    observados: this.obtenerConteo(conteos, TesoreriaEstado.OBSERVADO_TESORERIA) || 
                                procesados.filter(p => p.estado === TesoreriaEstado.OBSERVADO_TESORERIA).length,
                    rechazados: this.obtenerConteo(conteos, TesoreriaEstado.RECHAZADO_TESORERIA) || 
                                procesados.filter(p => p.estado === TesoreriaEstado.RECHAZADO_TESORERIA).length,
                    enProceso: 0, // No hay estado EN_PROCESO en el enum
                    total: conteos.reduce((sum, c) => sum + Number(c.cantidad || 0), 0) || 
                           (pendientes.length + procesados.length),
                },
                montos: {
                    pendiente: 0,
                    pagado: 0,
                    observado: 0,
                    rechazado: 0,
                    total: 0,
                },
                distribucion: this.calcularDistribucion(conteos),
                actividadReciente,
                pendientes: this.mapearDocumentos(pendientes),
                procesados: this.mapearDocumentos(procesados),
                fechaCalculo: new Date(),
                desde,
                hasta,
            };
        } catch (error) {
            this.logger.error('Error grave al calcular estadísticas', error);
            throw new BadRequestException('No se pudieron calcular las estadísticas. Contacte soporte.');
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

    private obtenerConteo(conteos: any[], estadoBuscado: TesoreriaEstado): number {
        const match = conteos.find((c) => c.estado === estadoBuscado);
        return match ? Number(match.cantidad) || 0 : 0;
    }

    private calcularDistribucion(conteos: any[]) {
        const colores: Record<string, string> = {
            [TesoreriaEstado.EN_REVISION]: '#FFA726',
            [TesoreriaEstado.COMPLETADO_TESORERIA]: '#4CAF50',
            [TesoreriaEstado.OBSERVADO_TESORERIA]: '#FFB74D',
            [TesoreriaEstado.RECHAZADO_TESORERIA]: '#EF5350',
            [TesoreriaEstado.DISPONIBLE]: '#42A5F5',
            'SIN_ESTADO': '#B0BEC5',
        };

        return conteos
            .filter((c) => c.estado && c.cantidad > 0)
            .map((c) => ({
                estado: c.estado,
                cantidad: Number(c.cantidad) || 0,
                monto: 0,
                color: colores[c.estado] || '#78909C',
            }));
    }

    private mapearDocumentos(docs: TesoreriaDocumento[]) {
        return docs.map((d) => ({
            id: d.id,
            numeroRadicado: d.documento?.numeroRadicado || '—',
            contratista: d.documento?.nombreContratista || '—',
            contrato: d.documento?.numeroContrato || '—',
            monto: 0,
            estado: d.estado,
            fechaAsignacion: d.fechaCreacion,
            fechaProcesamiento: d.fechaActualizacion,
            tesoreroAsignado: d.tesorero?.fullName || d.tesorero?.username || '—',
            tieneComprobante: !!d.pagoRealizadoPath,
            tieneFirma: !!d.firmaAplicada,
        }));
    }

    private normalizarTipo(estado: TesoreriaEstado | null): string {
        if (!estado) return 'PENDIENTE';
        
        switch (estado) {
            case TesoreriaEstado.COMPLETADO_TESORERIA:
                return 'COMPLETADO';
            case TesoreriaEstado.OBSERVADO_TESORERIA:
                return 'OBSERVADO';
            case TesoreriaEstado.RECHAZADO_TESORERIA:
                return 'RECHAZADO';
            case TesoreriaEstado.EN_REVISION:
                return 'EN_REVISION';
            default:
                return estado;
        }
    }
}