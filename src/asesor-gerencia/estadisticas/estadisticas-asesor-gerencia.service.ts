// src/asesor-gerencia/services/estadisticas-asesor-gerencia.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EstadisticasQueryDto, PeriodoStats } from './dto/estadisticas-query.dto';
import { AsesorGerenciaDocumento } from '../entities/asesor-gerencia-documento.entity';
import { AsesorGerenciaEstado } from '../entities/asesor-gerencia-estado.enum';

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

            // Obtener pendientes (EN_REVISION)
            const pendientes = await this.documentoRepo
                .createQueryBuilder('d')
                .leftJoinAndSelect('d.documento', 'doc')
                .leftJoinAndSelect('d.asesor', 'a')
                .where('d.estado = :estado', { estado: AsesorGerenciaEstado.EN_REVISION })
                .andWhere('d.fechaCreacion BETWEEN :desde AND :hasta', { desde, hasta })
                .orderBy('d.fechaCreacion', 'DESC')
                .getMany();

            // Obtener procesados (COMPLETADO_ASESOR_GERENCIA, OBSERVADO_ASESOR_GERENCIA, RECHAZADO_ASESOR_GERENCIA)
            const procesados = await this.documentoRepo
                .createQueryBuilder('d')
                .leftJoinAndSelect('d.documento', 'doc')
                .leftJoinAndSelect('d.asesor', 'a')
                .where('d.estado IN (:...estados)', { 
                    estados: [
                        AsesorGerenciaEstado.COMPLETADO_ASESOR_GERENCIA,
                        AsesorGerenciaEstado.OBSERVADO_ASESOR_GERENCIA,
                        AsesorGerenciaEstado.RECHAZADO_ASESOR_GERENCIA
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
                asesor: p.asesor?.fullName || p.asesor?.username || 'Sistema',
            }));

            return {
                documentos: {
                    pendientes: this.obtenerConteo(conteos, AsesorGerenciaEstado.EN_REVISION) || pendientes.length,
                    aprobados: this.obtenerConteo(conteos, AsesorGerenciaEstado.COMPLETADO_ASESOR_GERENCIA) || 
                               procesados.filter(p => p.estado === AsesorGerenciaEstado.COMPLETADO_ASESOR_GERENCIA).length,
                    observados: this.obtenerConteo(conteos, AsesorGerenciaEstado.OBSERVADO_ASESOR_GERENCIA) || 
                                procesados.filter(p => p.estado === AsesorGerenciaEstado.OBSERVADO_ASESOR_GERENCIA).length,
                    rechazados: this.obtenerConteo(conteos, AsesorGerenciaEstado.RECHAZADO_ASESOR_GERENCIA) || 
                                procesados.filter(p => p.estado === AsesorGerenciaEstado.RECHAZADO_ASESOR_GERENCIA).length,
                    total: conteos.reduce((sum, c) => sum + Number(c.cantidad || 0), 0) || 
                           (pendientes.length + procesados.length),
                },
                montos: {
                    pendiente: 0,
                    aprobado: 0,
                    observado: 0,
                    rechazado: 0,
                    completado: 0,
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

    private obtenerConteo(conteos: any[], estadoBuscado: AsesorGerenciaEstado): number {
        const match = conteos.find((c) => c.estado === estadoBuscado);
        return match ? Number(match.cantidad) || 0 : 0;
    }

    private calcularDistribucion(conteos: any[]) {
        const colores: Record<string, string> = {
            [AsesorGerenciaEstado.EN_REVISION]: '#FFA726',
            [AsesorGerenciaEstado.COMPLETADO_ASESOR_GERENCIA]: '#4CAF50',
            [AsesorGerenciaEstado.OBSERVADO_ASESOR_GERENCIA]: '#FFB74D',
            [AsesorGerenciaEstado.RECHAZADO_ASESOR_GERENCIA]: '#EF5350',
            [AsesorGerenciaEstado.DISPONIBLE]: '#9C27B0',
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

    private mapearDocumentos(docs: AsesorGerenciaDocumento[]) {
        return docs.map((d) => ({
            id: d.id,
            numeroRadicado: d.documento?.numeroRadicado || '—',
            contratista: d.documento?.nombreContratista || '—',
            contrato: d.documento?.numeroContrato || '—',
            monto: 0,
            estado: d.estado,
            fechaAsignacion: d.fechaCreacion,
            fechaProcesamiento: d.fechaActualizacion,
            asesorAsignado: d.asesor?.fullName || d.asesor?.username || '—',
            tieneComprobante: !!d.comprobanteFirmadoPath,
            tieneFirma: !!d.firmaAplicada,
        }));
    }

    private normalizarTipo(estado: AsesorGerenciaEstado | null): string {
        if (!estado) return 'PENDIENTE';
        
        switch (estado) {
            case AsesorGerenciaEstado.COMPLETADO_ASESOR_GERENCIA:
                return 'COMPLETADO';
            case AsesorGerenciaEstado.OBSERVADO_ASESOR_GERENCIA:
                return 'OBSERVADO';
            case AsesorGerenciaEstado.RECHAZADO_ASESOR_GERENCIA:
                return 'RECHAZADO';
            case AsesorGerenciaEstado.EN_REVISION:
                return 'EN_REVISION';
            default:
                return estado;
        }
    }
}