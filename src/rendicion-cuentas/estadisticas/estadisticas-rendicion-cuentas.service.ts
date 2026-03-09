// src/rendicion-cuentas/services/estadisticas-rendicion-cuentas.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { EstadisticasQueryDto, PeriodoStats } from './dto/estadisticas-query.dto';
import { RendicionCuentasDocumento } from '../entities/rendicion-cuentas-documento.entity';
import { RendicionCuentasEstado } from '../entities/rendicion-cuentas-estado.enum';

@Injectable()
export class EstadisticasRendicionCuentasService {
    private readonly logger = new Logger(EstadisticasRendicionCuentasService.name);
    
    private readonly coloresPorEstado: Record<string, string> = {
        [RendicionCuentasEstado.PENDIENTE]: '#FFC107',
        [RendicionCuentasEstado.EN_REVISION]: '#2196F3',
        [RendicionCuentasEstado.APROBADO]: '#4CAF50',
        [RendicionCuentasEstado.OBSERVADO]: '#FF9800',
        [RendicionCuentasEstado.RECHAZADO]: '#F44336',
        [RendicionCuentasEstado.COMPLETADO]: '#9E9E9E',
        [RendicionCuentasEstado.ESPERA_APROBACION_GERENCIA]: '#9C27B0',
        [RendicionCuentasEstado.APROBADO_POR_GERENCIA]: '#673AB7',
    };

    constructor(
        @InjectRepository(RendicionCuentasDocumento)
        private documentoRepo: Repository<RendicionCuentasDocumento>,
    ) { }

    async obtenerEstadisticas(query: EstadisticasQueryDto, usuario: any) {
        const { desde, hasta } = this.calcularRangoFechas(query);

        try {
            this.logger.log(`Calculando estadísticas desde ${desde} hasta ${hasta} para usuario ${usuario?.id || 'N/A'}`);

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
            }));

            this.logger.debug(`Conteos obtenidos: ${conteos.length} grupos`);

            // Obtener pendientes (PENDIENTE y EN_REVISION)
            const pendientes = await this.documentoRepo
                .createQueryBuilder('d')
                .leftJoinAndSelect('d.documento', 'doc')
                .leftJoinAndSelect('d.responsable', 'r')
                .where('d.estado IN (:...estados)', {
                    estados: [RendicionCuentasEstado.PENDIENTE, RendicionCuentasEstado.EN_REVISION]
                })
                .andWhere('d.fechaCreacion BETWEEN :desde AND :hasta', { desde, hasta })
                .orderBy('d.fechaCreacion', 'DESC')
                .getMany();

            // Obtener procesados (APROBADO, OBSERVADO, RECHAZADO, COMPLETADO, APROBADO_POR_GERENCIA)
            const procesados = await this.documentoRepo
                .createQueryBuilder('d')
                .leftJoinAndSelect('d.documento', 'doc')
                .leftJoinAndSelect('d.responsable', 'r')
                .where('d.estado IN (:...estados)', {
                    estados: [
                        RendicionCuentasEstado.APROBADO,
                        RendicionCuentasEstado.OBSERVADO,
                        RendicionCuentasEstado.RECHAZADO,
                        RendicionCuentasEstado.COMPLETADO,
                        RendicionCuentasEstado.APROBADO_POR_GERENCIA
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
                fecha: p.fechaActualizacion || p.fechaCreacion,
                responsable: p.responsable?.fullName || p.responsable?.username || 'Sistema',
            }));

            // Calcular resumen
            const resumen = {
                pendientes: this.obtenerConteo(conteos, RendicionCuentasEstado.PENDIENTE) || 
                            pendientes.filter(p => p.estado === RendicionCuentasEstado.PENDIENTE).length,
                enRevision: this.obtenerConteo(conteos, RendicionCuentasEstado.EN_REVISION) || 
                            pendientes.filter(p => p.estado === RendicionCuentasEstado.EN_REVISION).length,
                aprobados: this.obtenerConteo(conteos, RendicionCuentasEstado.APROBADO) || 
                           procesados.filter(p => p.estado === RendicionCuentasEstado.APROBADO).length,
                observados: this.obtenerConteo(conteos, RendicionCuentasEstado.OBSERVADO) || 
                            procesados.filter(p => p.estado === RendicionCuentasEstado.OBSERVADO).length,
                rechazados: this.obtenerConteo(conteos, RendicionCuentasEstado.RECHAZADO) || 
                            procesados.filter(p => p.estado === RendicionCuentasEstado.RECHAZADO).length,
                completados: this.obtenerConteo(conteos, RendicionCuentasEstado.COMPLETADO) || 
                             procesados.filter(p => p.estado === RendicionCuentasEstado.COMPLETADO).length,
                esperaAprobacionGerencia: this.obtenerConteo(conteos, RendicionCuentasEstado.ESPERA_APROBACION_GERENCIA) || 
                                          procesados.filter(p => p.estado === RendicionCuentasEstado.ESPERA_APROBACION_GERENCIA).length,
                aprobadoPorGerencia: this.obtenerConteo(conteos, RendicionCuentasEstado.APROBADO_POR_GERENCIA) || 
                                     procesados.filter(p => p.estado === RendicionCuentasEstado.APROBADO_POR_GERENCIA).length,
                total: pendientes.length + procesados.length,
            };

            // Calcular tiempos de respuesta
            const tiempos = this.calcularTiemposPromedio([...pendientes, ...procesados]);

            // Calcular rendimiento
            const totalDocumentos = resumen.total;
            const rendimiento = {
                tiempoPromedioHoras: tiempos.promedioHoras,
                tasaAprobacion: totalDocumentos > 0 ? 
                    Math.round((resumen.aprobados / totalDocumentos) * 100) : 0,
                tasaObservacion: totalDocumentos > 0 ? 
                    Math.round((resumen.observados / totalDocumentos) * 100) : 0,
                tasaRechazo: totalDocumentos > 0 ? 
                    Math.round((resumen.rechazados / totalDocumentos) * 100) : 0,
            };

            // Calcular métricas
            const metricas = {
                documentosProcesados: resumen.aprobados + resumen.observados + resumen.rechazados + resumen.completados + resumen.aprobadoPorGerencia,
                tiempoPromedioRespuesta: tiempos.promedioHoras,
                tasaAprobacion: rendimiento.tasaAprobacion,
                tasaObservacion: rendimiento.tasaObservacion,
                tasaRechazo: rendimiento.tasaRechazo,
                documentosPendientes: resumen.pendientes + resumen.enRevision,
            };

            // Calcular mis métricas si el usuario está autenticado
            let misMetricas = null;
            if (usuario?.id) {
                const misDocs = [...pendientes, ...procesados].filter(d => d.responsable?.id === usuario.id);
                const hoy = new Date();
                const hace7Dias = new Date(hoy.getTime() - 7 * 24 * 60 * 60 * 1000);

                misMetricas = {
                    pendientes: misDocs.filter(d => 
                        d.estado === RendicionCuentasEstado.PENDIENTE || 
                        d.estado === RendicionCuentasEstado.EN_REVISION
                    ).length,
                    procesadosHoy: misDocs.filter(d => 
                        d.fechaActualizacion && 
                        d.fechaActualizacion.toDateString() === hoy.toDateString() &&
                        d.estado !== RendicionCuentasEstado.PENDIENTE && 
                        d.estado !== RendicionCuentasEstado.EN_REVISION
                    ).length,
                    procesadosSemana: misDocs.filter(d => 
                        d.fechaActualizacion && 
                        d.fechaActualizacion >= hace7Dias &&
                        d.estado !== RendicionCuentasEstado.PENDIENTE && 
                        d.estado !== RendicionCuentasEstado.EN_REVISION
                    ).length,
                    promedioRespuesta: this.calcularPromedioRespuestaUsuario(misDocs),
                };
            }

            return {
                desde,
                hasta,
                fechaCalculo: new Date(),
                resumen,
                rendimiento,
                metricas,
                distribucion: this.calcularDistribucion(conteos),
                documentosPendientes: this.mapearDocumentos(pendientes),
                documentosProcesados: this.mapearDocumentos(procesados),
                actividadReciente,
                tiempos,
                misMetricas,
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

    private obtenerConteo(conteos: any[], estadoBuscado: RendicionCuentasEstado): number {
        const match = conteos.find((c) => c.estado === estadoBuscado);
        return match ? Number(match.cantidad) || 0 : 0;
    }

    private calcularDistribucion(conteos: any[]) {
        return conteos
            .filter((c) => c.estado && c.cantidad > 0)
            .map((c) => ({
                estado: c.estado,
                cantidad: Number(c.cantidad) || 0,
                porcentaje: 0, // Se calculará en el frontend o después
                color: this.coloresPorEstado[c.estado] || '#9E9E9E',
            }));
    }

    private mapearDocumentos(docs: any[]) {
        return docs.map((d) => ({
            id: d.id,
            numeroRadicado: d.documento?.numeroRadicado || '—',
            contratista: d.documento?.nombreContratista || '—',
            contrato: d.documento?.numeroContrato || '—',
            estado: d.estado,
            fechaAsignacion: d.fechaCreacion,
            fechaDecision: d.fechaDecision || d.fechaActualizacion,
            responsableAsignado: d.responsable?.fullName || d.responsable?.username || '—',
            observaciones: d.observaciones,
        }));
    }

    private calcularTiemposPromedio(documentos: any[]) {
        const documentosConTiempo = documentos.filter(d =>
            d.fechaInicioRevision && d.fechaDecision
        );

        if (documentosConTiempo.length === 0) {
            return { promedioHoras: 0, minimoHoras: 0, maximoHoras: 0, promedioDias: 0 };
        }

        const tiempos = documentosConTiempo.map(d => {
            const diffMs = new Date(d.fechaDecision).getTime() - new Date(d.fechaInicioRevision).getTime();
            return diffMs / (1000 * 60 * 60);
        });

        const suma = tiempos.reduce((a, b) => a + b, 0);
        const promedioHoras = suma / tiempos.length;

        return {
            promedioHoras: Math.round(promedioHoras * 10) / 10,
            minimoHoras: Math.round(Math.min(...tiempos) * 10) / 10,
            maximoHoras: Math.round(Math.max(...tiempos) * 10) / 10,
            promedioDias: Math.round((promedioHoras / 24) * 10) / 10,
        };
    }

    private calcularPromedioRespuestaUsuario(documentos: any[]): number {
        const documentosConTiempo = documentos.filter(d =>
            d.fechaInicioRevision && d.fechaDecision
        );

        if (documentosConTiempo.length === 0) return 0;

        const tiempos = documentosConTiempo.map(d => {
            const diffMs = new Date(d.fechaDecision).getTime() - new Date(d.fechaInicioRevision).getTime();
            return diffMs / (1000 * 60 * 60);
        });

        const suma = tiempos.reduce((a, b) => a + b, 0);
        return Math.round((suma / tiempos.length) * 10) / 10;
    }

    private normalizarTipo(estado: RendicionCuentasEstado | null): string {
        if (!estado) return 'PENDIENTE';
        
        switch (estado) {
            case RendicionCuentasEstado.APROBADO:
            case RendicionCuentasEstado.APROBADO_POR_GERENCIA:
                return 'APROBADO';
            case RendicionCuentasEstado.OBSERVADO:
                return 'OBSERVADO';
            case RendicionCuentasEstado.RECHAZADO:
                return 'RECHAZADO';
            case RendicionCuentasEstado.EN_REVISION:
                return 'EN_REVISION';
            case RendicionCuentasEstado.PENDIENTE:
                return 'PENDIENTE';
            case RendicionCuentasEstado.COMPLETADO:
                return 'COMPLETADO';
            default:
                return estado;
        }
    }
}