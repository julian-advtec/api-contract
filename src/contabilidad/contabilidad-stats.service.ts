// src/modules/contabilidad/services/contabilidad-stats.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In, MoreThan, LessThan } from 'typeorm';
import { ContabilidadDocumento, ContabilidadEstado, TipoCausacion } from './entities/contabilidad-documento.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';


export interface EstadisticasContabilidad {
    totalDocumentosDisponibles: number;
    misDocumentos: {
        enRevision: number;
        aprobados: number;
        observados: number;
        rechazados: number;
        completados: number;
        glosados: number;
        total: number;
    };
    rechazados: {
        total: number;
        rechazadosContador: number;
        rechazadosOtrasAreas: number;
        porPeriodo: number;
    };
    tiempoPromedioHoras: number;
    eficiencia: number;
    recientes: number;
    distribucion: Array<{
        estado: string;
        cantidad: number;
        porcentaje: number;
        color: string;
    }>;
    ultimosProcesados: Array<{
        id: string;
        numeroRadicado: string;
        contratista: string;
        fecha: string | Date;
        estado: string;
        glosado: boolean;
    }>;
    totales: {
        enRevision: number;
        aprobados: number;
        observados: number;
        rechazados: number;
        completados: number;
        total: number;
    };
    fechaConsulta: string;
    desde: string;
    hasta: string;
    // Datos adicionales
    resumen?: {
        totalDocumentos: number;
        documentosEnRevision: number;
        documentosCompletados: number;
        documentosObservados: number;
        documentosRechazados: number;
        documentosGlosados: number;
    };
    tipoCausacion?: Array<{
        tipo: TipoCausacion;
        cantidad: number;
        porcentaje: number;
    }>;
    glosas?: {
        conGlosa: number;
        sinGlosa: number;
        porcentajeConGlosa: number;
        totalGlosado: number;
    };
    tiempos?: {
        promedioRevision: number;
        maximoRevision: number;
        minimoRevision: number;
    };
    tendenciaMensual?: Array<{
        mes: string;
        nombreMes: string;
        completados: number;
        observados: number;
        rechazados: number;
        glosados: number;
        total: number;
    }>;
    topContadores?: Array<{
        contadorId: string;
        contadorNombre: string;
        documentosProcesados: number;
        eficiencia: number;
        promedioTiempo: number;
    }>;
}

export interface FiltrosEstadisticas {
    fechaInicio?: Date;
    fechaFin?: Date;
    contadorId?: string;
    estado?: ContabilidadEstado;
    tipoCausacion?: TipoCausacion;
    tieneGlosa?: boolean;
    periodo?: string;
}

@Injectable()
export class ContabilidadStatsService {
    private readonly logger = new Logger(ContabilidadStatsService.name);

    constructor(
        @InjectRepository(ContabilidadDocumento)
        private contabilidadRepo: Repository<ContabilidadDocumento>,
        @InjectRepository(Documento)
        private documentoRepo: Repository<Documento>,
        @InjectRepository(User)
        private userRepo: Repository<User>,
    ) { }

    /**
     * Obtener estadísticas generales de contabilidad
     */
    async getEstadisticasGenerales(
        userId: string,
        userRole: string,
        filtros?: FiltrosEstadisticas
    ): Promise<EstadisticasContabilidad> {
        this.logger.log(`📊 Estadísticas generales - Usuario: ${userId}, Rol: ${userRole}`);
        this.logger.debug('Filtros:', filtros);

        try {
            // Aplicar filtro de período si existe
            const fechas = this.aplicarFiltroPeriodo(filtros?.periodo);
            if (fechas) {
                filtros = { ...filtros, ...fechas };
            }

            // Construir where clause base
            const whereClause: any = {};

            // Restricción por rol
            if (userRole !== UserRole.ADMIN) {
                whereClause.contador = { id: userId };
                this.logger.debug(`Restricción aplicada: solo documentos del contador ${userId}`);
            }

            // Aplicar filtros adicionales
            if (filtros?.contadorId && userRole === UserRole.ADMIN) {
                whereClause.contador = { id: filtros.contadorId };
                this.logger.debug(`Filtrando por contador específico: ${filtros.contadorId}`);
            }

            if (filtros?.estado) {
                whereClause.estado = filtros.estado;
            }

            if (filtros?.tipoCausacion) {
                whereClause.tipoCausacion = filtros.tipoCausacion;
            }

            if (filtros?.tieneGlosa !== undefined) {
                whereClause.tieneGlosa = filtros.tieneGlosa;
            }

            // Filtro por fechas
            if (filtros?.fechaInicio || filtros?.fechaFin) {
                if (filtros.fechaInicio && filtros.fechaFin) {
                    whereClause.fechaCreacion = Between(filtros.fechaInicio, filtros.fechaFin);
                } else if (filtros.fechaInicio) {
                    whereClause.fechaCreacion = MoreThan(filtros.fechaInicio);
                } else if (filtros.fechaFin) {
                    whereClause.fechaCreacion = LessThan(filtros.fechaFin);
                }
            }

            this.logger.debug('Ejecutando consulta a BD...');
            const documentos = await this.contabilidadRepo.find({
                where: whereClause,
                relations: ['contador', 'documento'],
                order: { fechaActualizacion: 'DESC' }
            });

            this.logger.log(`Documentos encontrados: ${documentos.length}`);

            // Si no hay documentos, devolver estructura vacía
            if (documentos.length === 0) {
                this.logger.warn('No se encontraron documentos para los filtros aplicados');
                return this.crearEstructuraVacia(filtros);
            }

            // Calcular todas las estadísticas
            const estadisticas = await this.calcularEstadisticasCompletas(documentos, userRole, filtros);
            
            this.logger.log('✅ Estadísticas calculadas exitosamente');
            return estadisticas;

        } catch (error) {
            this.logger.error(`❌ Error en getEstadisticasGenerales: ${error.message}`, error.stack);
            throw error;
        }
    }

    /**
     * Aplicar filtro por período
     */
    private aplicarFiltroPeriodo(periodo?: string): { fechaInicio: Date; fechaFin: Date } | null {
        if (!periodo) return null;

        const ahora = new Date();
        const fechaFin = new Date(ahora);
        let fechaInicio = new Date(ahora);

        switch (periodo) {
            case 'hoy':
                fechaInicio.setHours(0, 0, 0, 0);
                break;
            case 'semana':
                fechaInicio.setDate(ahora.getDate() - 7);
                fechaInicio.setHours(0, 0, 0, 0);
                break;
            case 'mes':
                fechaInicio.setMonth(ahora.getMonth() - 1);
                fechaInicio.setHours(0, 0, 0, 0);
                break;
            case 'trimestre':
                fechaInicio.setMonth(ahora.getMonth() - 3);
                fechaInicio.setHours(0, 0, 0, 0);
                break;
            case 'ano':
                fechaInicio = new Date(ahora.getFullYear(), 0, 1, 0, 0, 0, 0);
                break;
            default:
                return null;
        }

        return { fechaInicio, fechaFin };
    }

    /**
     * Crear estructura vacía para cuando no hay datos
     */
    private crearEstructuraVacia(filtros?: FiltrosEstadisticas): EstadisticasContabilidad {
        return {
            totalDocumentosDisponibles: 0,
            misDocumentos: {
                enRevision: 0,
                aprobados: 0,
                observados: 0,
                rechazados: 0,
                completados: 0,
                glosados: 0,
                total: 0
            },
            rechazados: {
                total: 0,
                rechazadosContador: 0,
                rechazadosOtrasAreas: 0,
                porPeriodo: 0
            },
            tiempoPromedioHoras: 0,
            eficiencia: 0,
            recientes: 0,
            distribucion: [],
            ultimosProcesados: [],
            totales: {
                enRevision: 0,
                aprobados: 0,
                observados: 0,
                rechazados: 0,
                completados: 0,
                total: 0
            },
            fechaConsulta: new Date().toISOString(),
            desde: filtros?.fechaInicio?.toISOString() || '',
            hasta: filtros?.fechaFin?.toISOString() || '',
            resumen: {
                totalDocumentos: 0,
                documentosEnRevision: 0,
                documentosCompletados: 0,
                documentosObservados: 0,
                documentosRechazados: 0,
                documentosGlosados: 0,
            },
            tipoCausacion: [],
            glosas: {
                conGlosa: 0,
                sinGlosa: 0,
                porcentajeConGlosa: 0,
                totalGlosado: 0
            },
            tiempos: {
                promedioRevision: 0,
                maximoRevision: 0,
                minimoRevision: 0
            },
            tendenciaMensual: []
        };
    }

    /**
     * Calcular todas las estadísticas a partir de los documentos
     */
    private async calcularEstadisticasCompletas(
        documentos: ContabilidadDocumento[],
        userRole: string,
        filtros?: FiltrosEstadisticas
    ): Promise<EstadisticasContabilidad> {
        // 1. Resumen por estado (SIEMPRE existe porque documentos.length > 0)
        const resumen = this.calcularResumen(documentos);

        // 2. Distribución por estados
        const distribucionEstados = this.calcularDistribucionEstados(documentos);

        // 3. Distribución por tipo de causación
        const tipoCausacion = this.calcularDistribucionTipoCausacion(documentos);

        // 4. Estadísticas de glosas
        const glosas = this.calcularEstadisticasGlosas(documentos);

        // 5. Tiempos de revisión
        const tiempos = this.calcularTiemposPromedio(documentos);

        // 6. Tendencia mensual
        const tendenciaMensual = this.calcularTendenciaMensual(documentos);

        // 7. Documentos recientes (mapeados como ultimosProcesados)
        const ultimosProcesados = this.mapearUltimosProcesados(documentos.slice(0, 10));

        // 8. Documentos recientes (últimos 7 días)
        const hace7Dias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const recientes = documentos.filter(d => 
            new Date(d.fechaCreacion) > hace7Dias
        ).length;

        // Calcular métricas adicionales para el frontend (usando valores por defecto)
        const totalDocumentos = documentos.length;
        
        // Asegurar que resumen tiene valores (siempre los tiene)
        const resumenValues = resumen || {
            documentosEnRevision: 0,
            documentosCompletados: 0,
            documentosObservados: 0,
            documentosRechazados: 0,
            documentosGlosados: 0
        };

        const misDocumentos = {
            enRevision: resumenValues.documentosEnRevision,
            aprobados: resumenValues.documentosCompletados,
            observados: resumenValues.documentosObservados,
            rechazados: resumenValues.documentosRechazados,
            completados: resumenValues.documentosCompletados,
            glosados: resumenValues.documentosGlosados,
            total: totalDocumentos
        };

        const rechazados = {
            total: resumenValues.documentosRechazados + resumenValues.documentosObservados,
            rechazadosContador: resumenValues.documentosRechazados,
            rechazadosOtrasAreas: 0, // Esto se calcularía aparte
            porPeriodo: resumenValues.documentosRechazados
        };

        const eficiencia = totalDocumentos > 0 
            ? Math.round(((resumenValues.documentosCompletados + resumenValues.documentosObservados) / totalDocumentos) * 100) 
            : 0;

        const totales = {
            enRevision: resumenValues.documentosEnRevision,
            aprobados: resumenValues.documentosCompletados,
            observados: resumenValues.documentosObservados,
            rechazados: resumenValues.documentosRechazados,
            completados: resumenValues.documentosCompletados,
            total: totalDocumentos
        };

        // Asegurar que tiempos tiene valores
        const tiemposValues = tiempos || {
            promedioRevision: 0,
            maximoRevision: 0,
            minimoRevision: 0
        };

        // 9. Top contadores (solo para admin)
        let topContadores;
        if (userRole === UserRole.ADMIN) {
            topContadores = await this.calcularTopContadores(
                filtros?.fechaInicio,
                filtros?.fechaFin
            );
        }

        // Devolver estructura que espera el frontend
        return {
            totalDocumentosDisponibles: totalDocumentos,
            misDocumentos,
            rechazados,
            tiempoPromedioHoras: tiemposValues.promedioRevision,
            eficiencia,
            recientes,
            distribucion: distribucionEstados.map(d => ({
                estado: d.estado,
                cantidad: d.cantidad,
                porcentaje: d.porcentaje,
                color: this.getColorForEstado(d.estado)
            })),
            ultimosProcesados,
            totales,
            fechaConsulta: new Date().toISOString(),
            desde: filtros?.fechaInicio?.toISOString() || '',
            hasta: filtros?.fechaFin?.toISOString() || '',
            // Datos adicionales para otros componentes
            resumen,
            tipoCausacion,
            glosas,
            tiempos: tiemposValues,
            tendenciaMensual,
            topContadores
        };
    }

    /**
     * Mapear últimos procesados para el frontend
     */
    private mapearUltimosProcesados(documentos: ContabilidadDocumento[]): Array<{
        id: string;
        numeroRadicado: string;
        contratista: string;
        fecha: string | Date;
        estado: string;
        glosado: boolean;
    }> {
        return documentos.map(doc => ({
            id: doc.id,
            numeroRadicado: doc.documento?.numeroRadicado || 'N/A',
            contratista: doc.documento?.nombreContratista || 'N/A',
            fecha: doc.fechaActualizacion || doc.fechaCreacion,
            estado: doc.estado,
            glosado: doc.tieneGlosa || false
        }));
    }

    /**
     * Obtener color para cada estado
     */
    private getColorForEstado(estado: ContabilidadEstado): string {
        const colores: Record<ContabilidadEstado, string> = {
            [ContabilidadEstado.EN_REVISION]: '#2196F3',
            [ContabilidadEstado.COMPLETADO]: '#4CAF50',
            [ContabilidadEstado.OBSERVADO]: '#FF9800',
            [ContabilidadEstado.RECHAZADO]: '#F44336',
            [ContabilidadEstado.GLOSADO]: '#9C27B0',
            [ContabilidadEstado.PROCESADO]: '#00BCD4',
            [ContabilidadEstado.DISPONIBLE]: '#607D8B'
        };
        return colores[estado] || '#6c757d';
    }

    /**
     * Calcular resumen por estado
     */
    private calcularResumen(documentos: ContabilidadDocumento[]): EstadisticasContabilidad['resumen'] {
        return {
            totalDocumentos: documentos.length,
            documentosEnRevision: documentos.filter(d => d.estado === ContabilidadEstado.EN_REVISION).length,
            documentosCompletados: documentos.filter(d => d.estado === ContabilidadEstado.COMPLETADO).length,
            documentosObservados: documentos.filter(d => d.estado === ContabilidadEstado.OBSERVADO).length,
            documentosRechazados: documentos.filter(d => d.estado === ContabilidadEstado.RECHAZADO).length,
            documentosGlosados: documentos.filter(d => d.estado === ContabilidadEstado.GLOSADO).length,
        };
    }

    /**
     * Calcular distribución por estados
     */
    private calcularDistribucionEstados(documentos: ContabilidadDocumento[]): Array<{ estado: ContabilidadEstado; cantidad: number; porcentaje: number }> {
        const total = documentos.length;
        if (total === 0) return [];

        const estados = Object.values(ContabilidadEstado);
        
        return estados.map(estado => {
            const cantidad = documentos.filter(d => d.estado === estado).length;
            return {
                estado,
                cantidad,
                porcentaje: Math.round((cantidad / total) * 100)
            };
        }).filter(e => e.cantidad > 0);
    }

    /**
     * Calcular distribución por tipo de causación
     */
    private calcularDistribucionTipoCausacion(documentos: ContabilidadDocumento[]): Array<{ tipo: TipoCausacion; cantidad: number; porcentaje: number }> {
        const documentosConCausacion = documentos.filter(d => d.tipoCausacion);
        const total = documentosConCausacion.length;
        
        if (total === 0) return [];

        const tipos = Object.values(TipoCausacion);
        
        return tipos.map(tipo => {
            const cantidad = documentosConCausacion.filter(d => d.tipoCausacion === tipo).length;
            return {
                tipo,
                cantidad,
                porcentaje: Math.round((cantidad / total) * 100)
            };
        }).filter(t => t.cantidad > 0);
    }

    /**
     * Calcular estadísticas de glosas
     */
    private calcularEstadisticasGlosas(documentos: ContabilidadDocumento[]): EstadisticasContabilidad['glosas'] {
        const conGlosa = documentos.filter(d => d.tieneGlosa === true).length;
        const sinGlosa = documentos.filter(d => d.tieneGlosa === false).length;
        const total = conGlosa + sinGlosa;

        return {
            conGlosa,
            sinGlosa,
            porcentajeConGlosa: total > 0 ? Math.round((conGlosa / total) * 100) : 0,
            totalGlosado: documentos.filter(d => d.estado === ContabilidadEstado.GLOSADO).length
        };
    }

    /**
     * Calcular tiempos promedio de revisión
     */
    private calcularTiemposPromedio(documentos: ContabilidadDocumento[]): EstadisticasContabilidad['tiempos'] {
        const documentosCompletados = documentos.filter(d =>
            d.estado === ContabilidadEstado.COMPLETADO &&
            d.fechaInicioRevision &&
            d.fechaFinRevision
        );

        if (documentosCompletados.length === 0) {
            return { promedioRevision: 0, maximoRevision: 0, minimoRevision: 0 };
        }

        const tiempos = documentosCompletados.map(d =>
            this.calcularTiempoRevisionHoras(d.fechaInicioRevision!, d.fechaFinRevision!)
        );

        return {
            promedioRevision: Math.round((tiempos.reduce((a, b) => a + b, 0) / tiempos.length) * 10) / 10,
            maximoRevision: Math.round(Math.max(...tiempos) * 10) / 10,
            minimoRevision: Math.round(Math.min(...tiempos) * 10) / 10
        };
    }

    /**
     * Calcular tendencia mensual (últimos 6 meses)
     */
    private calcularTendenciaMensual(documentos: ContabilidadDocumento[]): EstadisticasContabilidad['tendenciaMensual'] {
        const hoy = new Date();
        const meses = [];

        for (let i = 5; i >= 0; i--) {
            const fecha = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
            const siguienteMes = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0);

            const docsMes = documentos.filter(d => {
                const fechaDoc = new Date(d.fechaCreacion);
                return fechaDoc >= fecha && fechaDoc <= siguienteMes;
            });

            meses.push({
                mes: `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`,
                nombreMes: fecha.toLocaleString('es-ES', { month: 'long', year: 'numeric' }),
                completados: docsMes.filter(d => d.estado === ContabilidadEstado.COMPLETADO).length,
                observados: docsMes.filter(d => d.estado === ContabilidadEstado.OBSERVADO).length,
                rechazados: docsMes.filter(d => d.estado === ContabilidadEstado.RECHAZADO).length,
                glosados: docsMes.filter(d => d.estado === ContabilidadEstado.GLOSADO).length,
                total: docsMes.length
            });
        }

        return meses;
    }

    /**
     * Calcular top contadores
     */
    private async calcularTopContadores(
        fechaInicio?: Date,
        fechaFin?: Date
    ): Promise<EstadisticasContabilidad['topContadores']> {
        const where: any = {
            estado: In([ContabilidadEstado.COMPLETADO, ContabilidadEstado.PROCESADO])
        };

        if (fechaInicio && fechaFin) {
            where.fechaCreacion = Between(fechaInicio, fechaFin);
        }

        const documentos = await this.contabilidadRepo.find({
            where,
            relations: ['contador']
        });

        const agrupados = documentos.reduce((acc, doc) => {
            if (!doc.contador) return acc;

            const id = doc.contador.id;
            
            if (!acc[id]) {
                acc[id] = {
                    contadorId: id,
                    contadorNombre: doc.contador.fullName || doc.contador.username || 'Sin nombre',
                    documentosProcesados: 0,
                    totalTiempo: 0,
                    fechas: new Set<string>()
                };
            }

            acc[id].documentosProcesados++;
            
            if (doc.fechaInicioRevision && doc.fechaFinRevision) {
                acc[id].totalTiempo += this.calcularTiempoRevisionHoras(
                    doc.fechaInicioRevision,
                    doc.fechaFinRevision
                );
            }
            
            acc[id].fechas.add(doc.fechaCreacion.toDateString());

            return acc;
        }, {} as Record<string, any>);

        return Object.values(agrupados)
            .map((c: any) => {
                const diasTrabajados = c.fechas.size || 1;
                return {
                    contadorId: c.contadorId,
                    contadorNombre: c.contadorNombre,
                    documentosProcesados: c.documentosProcesados,
                    eficiencia: Math.round((c.documentosProcesados / diasTrabajados) * 10) / 10,
                    promedioTiempo: c.documentosProcesados > 0 
                        ? Math.round((c.totalTiempo / c.documentosProcesados) * 10) / 10 
                        : 0
                };
            })
            .sort((a, b) => b.documentosProcesados - a.documentosProcesados)
            .slice(0, 10);
    }

    /**
     * Obtener estadísticas por contador
     */
    async getEstadisticasPorContador(contadorId: string, filtros?: FiltrosEstadisticas) {
        this.logger.log(`📊 Estadísticas por contador: ${contadorId}`);

        try {
            const contador = await this.userRepo.findOne({
                where: { id: contadorId },
                select: ['id', 'username', 'fullName', 'email', 'role']
            });

            if (!contador) {
                throw new Error('Contador no encontrado');
            }

            const whereClause: any = {
                contador: { id: contadorId }
            };

            if (filtros?.fechaInicio && filtros?.fechaFin) {
                whereClause.fechaCreacion = Between(filtros.fechaInicio, filtros.fechaFin);
            }

            const documentos = await this.contabilidadRepo.find({
                where: whereClause,
                relations: ['documento'],
                order: { fechaActualizacion: 'DESC' }
            });

            if (documentos.length === 0) {
                return this.crearEstadisticasContadorVacias(contador);
            }

            const completados = documentos.filter(d => 
                d.estado === ContabilidadEstado.COMPLETADO || 
                d.estado === ContabilidadEstado.PROCESADO
            ).length;

            const observados = documentos.filter(d => d.estado === ContabilidadEstado.OBSERVADO).length;
            const rechazados = documentos.filter(d => d.estado === ContabilidadEstado.RECHAZADO).length;
            const glosados = documentos.filter(d => d.estado === ContabilidadEstado.GLOSADO).length;
            const enRevision = documentos.filter(d => d.estado === ContabilidadEstado.EN_REVISION).length;

            const documentosCompletados = documentos.filter(d =>
                (d.estado === ContabilidadEstado.COMPLETADO || d.estado === ContabilidadEstado.PROCESADO) &&
                d.fechaInicioRevision &&
                d.fechaFinRevision
            );

            const tiempos = this.calcularTiemposPromedio(documentosCompletados);
            const eficiencia = this.calcularEficiencia(documentosCompletados);
            const distribucionDias = this.calcularDistribucionPorDia(documentosCompletados);

            const documentosRecientes = documentos.slice(0, 5).map(doc => ({
                numeroRadicado: doc.documento?.numeroRadicado || 'N/A',
                estado: doc.estado,
                fechaFinRevision: doc.fechaFinRevision,
                tiempoRevision: this.calcularTiempoRevisionHoras(
                    doc.fechaInicioRevision, 
                    doc.fechaFinRevision
                )
            }));

            return {
                contador: {
                    id: contador.id,
                    nombre: contador.fullName || contador.username,
                    username: contador.username,
                    email: contador.email
                },
                resumen: {
                    totalDocumentos: documentos.length,
                    completados,
                    observados,
                    rechazados,
                    glosados,
                    enRevision,
                },
                tiempos,
                eficiencia,
                distribucionDias,
                documentosRecientes
            };

        } catch (error) {
            this.logger.error(`❌ Error en getEstadisticasPorContador: ${error.message}`, error.stack);
            throw error;
        }
    }

    /**
     * Crear estadísticas vacías para contador
     */
    private crearEstadisticasContadorVacias(contador: User) {
        return {
            contador: {
                id: contador.id,
                nombre: contador.fullName || contador.username,
                username: contador.username,
                email: contador.email
            },
            resumen: {
                totalDocumentos: 0,
                completados: 0,
                observados: 0,
                rechazados: 0,
                glosados: 0,
                enRevision: 0,
            },
            tiempos: { promedioRevision: 0, maximoRevision: 0, minimoRevision: 0 },
            eficiencia: { documentosPorDia: 0, documentosPorSemana: 0, documentosPorMes: 0 },
            distribucionDias: [
                { dia: 'Lunes', cantidad: 0 },
                { dia: 'Martes', cantidad: 0 },
                { dia: 'Miércoles', cantidad: 0 },
                { dia: 'Jueves', cantidad: 0 },
                { dia: 'Viernes', cantidad: 0 },
                { dia: 'Sábado', cantidad: 0 },
                { dia: 'Domingo', cantidad: 0 }
            ],
            documentosRecientes: []
        };
    }

    /**
     * Obtener documentos por estado
     */
    async getDocumentosPorEstado(
        estado: ContabilidadEstado,
        userId: string,
        userRole: string
    ) {
        const whereClause: any = { estado };

        if (userRole !== UserRole.ADMIN) {
            whereClause.contador = { id: userId };
        }

        const documentos = await this.contabilidadRepo.find({
            where: whereClause,
            relations: ['documento', 'contador'],
            order: { fechaActualizacion: 'DESC' }
        });

        return documentos.map(doc => ({
            id: doc.id,
            numeroRadicado: doc.documento?.numeroRadicado,
            nombreContratista: doc.documento?.nombreContratista,
            fechaInicioRevision: doc.fechaInicioRevision,
            fechaFinRevision: doc.fechaFinRevision,
            tieneGlosa: doc.tieneGlosa,
            tipoCausacion: doc.tipoCausacion,
            observaciones: doc.observaciones,
            contador: doc.contador?.fullName || doc.contador?.username,
            tiempoRevision: this.calcularTiempoRevisionHoras(
                doc.fechaInicioRevision,
                doc.fechaFinRevision
            )
        }));
    }

    /**
     * Obtener métricas de tiempo
     */
    async getMetricasTiempo(userId: string, userRole: string) {
        const whereClause: any = {
            estado: In([ContabilidadEstado.COMPLETADO, ContabilidadEstado.PROCESADO]),
            fechaInicioRevision: MoreThan(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
        };

        if (userRole !== UserRole.ADMIN) {
            whereClause.contador = { id: userId };
        }

        const documentos = await this.contabilidadRepo.find({
            where: whereClause,
            relations: ['documento'],
            order: { fechaFinRevision: 'DESC' }
        });

        const documentosConTiempo = documentos.filter(d =>
            d.fechaInicioRevision && d.fechaFinRevision
        );

        if (documentosConTiempo.length === 0) {
            return {
                promedio: 0,
                tendencia: [],
                mejoresTiempos: [],
                peoresTiempos: []
            };
        }

        const tiempos = documentosConTiempo.map(doc =>
            this.calcularTiempoRevisionHoras(doc.fechaInicioRevision!, doc.fechaFinRevision!)
        );

        const promedio = Math.round((tiempos.reduce((a, b) => a + b, 0) / tiempos.length) * 10) / 10;
        const tendencia = this.calcularTendenciaTiempos(documentosConTiempo);

        const documentosConTiempoCalculado = documentosConTiempo.map(doc => ({
            ...doc,
            tiempo: this.calcularTiempoRevisionHoras(doc.fechaInicioRevision!, doc.fechaFinRevision!)
        }));

        const mejoresTiempos = [...documentosConTiempoCalculado]
            .sort((a, b) => a.tiempo - b.tiempo)
            .slice(0, 5)
            .map(doc => ({
                numeroRadicado: doc.documento?.numeroRadicado,
                tiempo: doc.tiempo,
                fecha: doc.fechaFinRevision
            }));

        const peoresTiempos = [...documentosConTiempoCalculado]
            .sort((a, b) => b.tiempo - a.tiempo)
            .slice(0, 5)
            .map(doc => ({
                numeroRadicado: doc.documento?.numeroRadicado,
                tiempo: doc.tiempo,
                fecha: doc.fechaFinRevision
            }));

        return {
            promedio,
            tendencia,
            mejoresTiempos,
            peoresTiempos
        };
    }

    /**
     * Obtener resumen rápido para dashboard
     */
    async getResumenRapido(userId: string, userRole: string) {
        const estadisticas = await this.getEstadisticasGenerales(userId, userRole, {
            fechaInicio: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        });

        return {
            totalDocumentos: estadisticas.resumen?.totalDocumentos || 0,
            completados: estadisticas.resumen?.documentosCompletados || 0,
            enRevision: estadisticas.resumen?.documentosEnRevision || 0,
            tasaCompletitud: estadisticas.resumen?.totalDocumentos ? 
                Math.round((estadisticas.resumen.documentosCompletados / estadisticas.resumen.totalDocumentos) * 100) : 0,
            tiempoPromedio: estadisticas.tiempos?.promedioRevision || 0,
            conGlosa: estadisticas.glosas?.conGlosa || 0,
            documentosRecientes: estadisticas.ultimosProcesados.slice(0, 5)
        };
    }

    // ========== MÉTODOS AUXILIARES ==========

    private calcularTiempoRevisionHoras(inicio?: Date, fin?: Date): number {
        if (!inicio || !fin) return 0;
        const diffMs = fin.getTime() - inicio.getTime();
        return Math.round((diffMs / (1000 * 60 * 60)) * 10) / 10;
    }

    private calcularEficiencia(documentos: ContabilidadDocumento[]) {
        if (documentos.length === 0) {
            return { documentosPorDia: 0, documentosPorSemana: 0, documentosPorMes: 0 };
        }

        const fechasUnicas = new Set(
            documentos.map(d => d.fechaCreacion.toDateString())
        ).size;

        const diasTrabajados = fechasUnicas || 1;
        const semanasTrabajadas = Math.ceil(diasTrabajados / 7) || 1;
        const mesesTrabajados = Math.ceil(diasTrabajados / 30) || 1;

        return {
            documentosPorDia: Math.round((documentos.length / diasTrabajados) * 10) / 10,
            documentosPorSemana: Math.round((documentos.length / semanasTrabajadas) * 10) / 10,
            documentosPorMes: Math.round((documentos.length / mesesTrabajados) * 10) / 10
        };
    }

    private calcularDistribucionPorDia(documentos: ContabilidadDocumento[]) {
        const dias = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
        const distribucion = dias.map(dia => ({ dia, cantidad: 0 }));

        documentos.forEach(doc => {
            const diaSemana = doc.fechaCreacion.getDay(); // 0: Domingo, 1: Lunes
            const index = diaSemana === 0 ? 6 : diaSemana - 1; // Ajustar para empezar en Lunes
            if (index >= 0 && index < 7) {
                distribucion[index].cantidad++;
            }
        });

        return distribucion;
    }

    private calcularTendenciaTiempos(documentos: ContabilidadDocumento[]) {
        const tendencia = [];
        const hoy = new Date();

        for (let i = 6; i >= 0; i--) {
            const fecha = new Date(hoy);
            fecha.setDate(fecha.getDate() - i);
            const fechaStr = fecha.toISOString().split('T')[0];

            const documentosDia = documentos.filter(d =>
                d.fechaFinRevision?.toISOString().split('T')[0] === fechaStr
            );

            if (documentosDia.length > 0) {
                const tiemposDia = documentosDia.map(doc =>
                    this.calcularTiempoRevisionHoras(doc.fechaInicioRevision!, doc.fechaFinRevision!)
                );

                const promedio = tiemposDia.reduce((a, b) => a + b, 0) / tiemposDia.length;

                tendencia.push({
                    fecha: fechaStr,
                    dia: fecha.toLocaleDateString('es-ES', { weekday: 'short' }),
                    promedio: Math.round(promedio * 10) / 10,
                    cantidad: documentosDia.length
                });
            }
        }

        return tendencia;
    }
}