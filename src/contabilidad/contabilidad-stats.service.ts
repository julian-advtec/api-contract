// src/modules/contabilidad/services/contabilidad-stats.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In, MoreThan, LessThan } from 'typeorm';
import { ContabilidadDocumento, ContabilidadEstado, TipoCausacion } from './entities/contabilidad-documento.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';

export interface EstadisticasContabilidad {
    // Resumen general
    resumen: {
        totalDocumentos: number;
        documentosEnRevision: number;
        documentosCompletados: number;
        documentosObservados: number;
        documentosRechazados: number;
        documentosGlosados: number;
    };

    // Distribución por estados
    distribucionEstados: Array<{
        estado: ContabilidadEstado;
        cantidad: number;
        porcentaje: number;
    }>;

    // Por tipo de causación
    tipoCausacion: Array<{
        tipo: TipoCausacion;
        cantidad: number;
        porcentaje: number;
    }>;

    // Estadísticas de glosas
    glosas: {
        conGlosa: number;
        sinGlosa: number;
        porcentajeConGlosa: number;
        totalGlosado: number;
    };

    // Tiempos promedio
    tiempos: {
        promedioRevision: number; // en horas
        maximoRevision: number;
        minimoRevision: number;
    };

    // Tendencia mensual (últimos 6 meses)
    tendenciaMensual: Array<{
        mes: string;
        nombreMes: string;
        completados: number;
        observados: number;
        rechazados: number;
        glosados: number;
        total: number;
    }>;

    // Top contadores (solo para admin)
    topContadores?: Array<{
        contadorId: string;
        contadorNombre: string;
        documentosProcesados: number;
        eficiencia: number; // documentos por día
        promedioTiempo: number; // horas por documento
    }>;

    // Documentos recientes
    documentosRecientes: Array<{
        id: string;
        numeroRadicado: string;
        nombreContratista: string;
        estado: ContabilidadEstado;
        fechaInicioRevision: Date;
        fechaFinRevision: Date;
        tieneGlosa: boolean;
        tipoCausacion: TipoCausacion;
        tiempoRevision: number; // en horas
    }>;
}

export interface FiltrosEstadisticas {
    fechaInicio?: Date;
    fechaFin?: Date;
    contadorId?: string;
    estado?: ContabilidadEstado;
    tipoCausacion?: TipoCausacion;
    tieneGlosa?: boolean;
}

@Injectable()
export class ContabilidadStatsService {
    constructor(
        @InjectRepository(ContabilidadDocumento)
        private contabilidadRepo: Repository<ContabilidadDocumento>,
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

        const whereClause: any = {};

        // 🔐 Restricción por rol
        if (userRole !== UserRole.ADMIN) {
            whereClause.contador = { id: userId };
        }

        // 🎯 Filtros
        if (filtros?.contadorId && userRole === UserRole.ADMIN) {
            whereClause.contador = { id: filtros.contadorId };
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

        // 📅 Filtro por fechas
        if (filtros?.fechaInicio || filtros?.fechaFin) {
            whereClause.fechaCreacion = filtros.fechaInicio && filtros.fechaFin
                ? Between(filtros.fechaInicio, filtros.fechaFin)
                : filtros.fechaInicio
                    ? MoreThan(filtros.fechaInicio)
                    : LessThan(filtros.fechaFin!);
        }

        const documentos = await this.contabilidadRepo.find({
            where: whereClause,
            relations: ['contador', 'documento'],
            order: { fechaActualizacion: 'DESC' }
        });

        // 📊 Resumen
        const resumen = {
            totalDocumentos: documentos.length,
            documentosEnRevision: documentos.filter(d => d.estado === ContabilidadEstado.EN_REVISION).length,
            documentosCompletados: documentos.filter(d => d.estado === ContabilidadEstado.COMPLETADO_CONTABILIDAD).length,
            documentosObservados: documentos.filter(d => d.estado === ContabilidadEstado.OBSERVADO_CONTABILIDAD).length,
            documentosRechazados: documentos.filter(d => d.estado === ContabilidadEstado.RECHAZADO_CONTABILIDAD).length,
            documentosGlosados: documentos.filter(d => d.estado === ContabilidadEstado.GLOSADO_CONTABILIDAD).length,
        };

        // 📌 Distribución por estado
        const distribucionEstados = Object.values(ContabilidadEstado)
            .map(estado => {
                const cantidad = documentos.filter(d => d.estado === estado).length;
                return {
                    estado,
                    cantidad,
                    porcentaje: documentos.length ? (cantidad / documentos.length) * 100 : 0
                };
            })
            .filter(e => e.cantidad > 0);

        // 📌 Tipo de causación
        const tipoCausacion = Object.values(TipoCausacion)
            .map(tipo => {
                const cantidad = documentos.filter(d => d.tipoCausacion === tipo).length;
                return {
                    tipo,
                    cantidad,
                    porcentaje: documentos.length ? (cantidad / documentos.length) * 100 : 0
                };
            })
            .filter(t => t.cantidad > 0);

        // 🧾 Glosas
        const conGlosa = documentos.filter(d => d.tieneGlosa).length;

        const glosas = {
            conGlosa,
            sinGlosa: documentos.length - conGlosa,
            porcentajeConGlosa: documentos.length ? (conGlosa / documentos.length) * 100 : 0,
            totalGlosado: documentos.filter(d => d.estado === ContabilidadEstado.GLOSADO_CONTABILIDAD).length
        };

        // ⏱️ Tiempos
        const documentosCompletados = documentos.filter(d =>
            d.estado === ContabilidadEstado.COMPLETADO_CONTABILIDAD &&
            d.fechaInicioRevision &&
            d.fechaFinRevision
        );

        const tiempos = this.calcularTiemposPromedio(documentosCompletados);

        // 📈 Tendencia
        const tendenciaMensual = this.calcularTendenciaMensual(documentos);

        // 🏆 Top contadores (solo admin)
        let topContadores: EstadisticasContabilidad['topContadores'];

        if (userRole === UserRole.ADMIN) {
            topContadores = await this.calcularTopContadores(
                filtros?.fechaInicio,
                filtros?.fechaFin
            );
        }

        // 🕒 Recientes
        const documentosRecientes = documentos.slice(0, 10).map(doc => ({
            id: doc.id,
            numeroRadicado: doc.documento?.numeroRadicado || 'N/A',
            nombreContratista: doc.documento?.nombreContratista || 'N/A',
            estado: doc.estado,
            fechaInicioRevision: doc.fechaInicioRevision,
            fechaFinRevision: doc.fechaFinRevision,
            tieneGlosa: doc.tieneGlosa,
            tipoCausacion: doc.tipoCausacion,
            tiempoRevision: this.calcularTiempoRevisionHoras(
                doc.fechaInicioRevision,
                doc.fechaFinRevision
            )
        }));

        return {
            resumen,
            distribucionEstados,
            tipoCausacion,
            glosas,
            tiempos,
            tendenciaMensual,
            topContadores,
            documentosRecientes
        };
    }


    /**
     * Obtener estadísticas específicas por contador
     */
    async getEstadisticasPorContador(contadorId: string, filtros?: FiltrosEstadisticas) {
        const logPrefix = `[STATS-CONTADOR] contador=${contadorId}`;
        console.log(`${logPrefix} Solicitando estadísticas`);

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

        // Aplicar filtros
        if (filtros?.estado) {
            whereClause.estado = filtros.estado;
        }
        if (filtros?.fechaInicio && filtros?.fechaFin) {
            whereClause.fechaCreacion = Between(filtros.fechaInicio, filtros.fechaFin);
        }

        const documentos = await this.contabilidadRepo.find({
            where: whereClause,
            relations: ['documento'],
            order: { fechaActualizacion: 'DESC' }
        });

        // Documentos completados con tiempos válidos
        const documentosCompletados = documentos.filter(d =>
            d.estado === ContabilidadEstado.COMPLETADO_CONTABILIDAD &&
            d.fechaInicioRevision &&
            d.fechaFinRevision
        );

        // Calcular métricas
        const tiempos = this.calcularTiemposPromedio(documentosCompletados);

        // Eficiencia (documentos completados por día de trabajo)
        const eficiencia = this.calcularEficiencia(documentosCompletados);

        // Distribución por día de la semana
        const distribucionDias = this.calcularDistribucionPorDia(documentosCompletados);

        return {
            contador: {
                id: contador.id,
                nombre: contador.fullName || contador.username,
                username: contador.username,
                email: contador.email
            },
            resumen: {
                totalDocumentos: documentos.length,
                completados: documentos.filter(d => d.estado === ContabilidadEstado.COMPLETADO_CONTABILIDAD).length,
                observados: documentos.filter(d => d.estado === ContabilidadEstado.OBSERVADO_CONTABILIDAD).length,
                rechazados: documentos.filter(d => d.estado === ContabilidadEstado.RECHAZADO_CONTABILIDAD).length,
                glosados: documentos.filter(d => d.estado === ContabilidadEstado.GLOSADO_CONTABILIDAD).length,
                enRevision: documentos.filter(d => d.estado === ContabilidadEstado.EN_REVISION).length,
            },
            tiempos,
            eficiencia,
            distribucionDias,
            documentosRecientes: documentos.slice(0, 5).map(doc => ({
                numeroRadicado: doc.documento?.numeroRadicado || 'N/A',
                estado: doc.estado,
                fechaFinRevision: doc.fechaFinRevision,
                tiempoRevision: this.calcularTiempoRevisionHoras(doc.fechaInicioRevision, doc.fechaFinRevision)
            }))
        };
    }

    /**
     * Obtener documentos por estado específico
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
     * Métricas de tiempo de revisión
     */
    async getMetricasTiempo(userId: string, userRole: string) {
        const whereClause: any = {
            estado: ContabilidadEstado.COMPLETADO_CONTABILIDAD,
            fechaInicioRevision: MoreThan(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) // últimos 30 días
        };

        if (userRole !== UserRole.ADMIN && userRole) {
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

        // Calcular tiempos
        const tiempos = documentosConTiempo.map(doc =>
            this.calcularTiempoRevisionHoras(doc.fechaInicioRevision!, doc.fechaFinRevision!)
        );

        const promedio = tiempos.reduce((a, b) => a + b, 0) / tiempos.length;

        // Tendencia por día
        const tendencia = this.calcularTendenciaTiempos(documentosConTiempo);

        // Mejores y peores tiempos
        const documentosConTiempoCalculado = documentosConTiempo.map(doc => ({
            ...doc,
            tiempo: this.calcularTiempoRevisionHoras(doc.fechaInicioRevision!, doc.fechaFinRevision!)
        }));

        const mejoresTiempos = [...documentosConTiempoCalculado]
            .sort((a, b) => a.tiempo - b.tiempo)
            .slice(0, 5);

        const peoresTiempos = [...documentosConTiempoCalculado]
            .sort((a, b) => b.tiempo - a.tiempo)
            .slice(0, 5);

        return {
            promedio,
            tendencia,
            mejoresTiempos: mejoresTiempos.map(doc => ({
                numeroRadicado: doc.documento?.numeroRadicado,
                tiempo: doc.tiempo,
                fecha: doc.fechaFinRevision
            })),
            peoresTiempos: peoresTiempos.map(doc => ({
                numeroRadicado: doc.documento?.numeroRadicado,
                tiempo: doc.tiempo,
                fecha: doc.fechaFinRevision
            }))
        };
    }

    // ========== MÉTODOS PRIVADOS DE CÁLCULO ==========

    private calcularTiemposPromedio(documentos: ContabilidadDocumento[]) {
        if (!documentos.length) {
            return { promedioRevision: 0, maximoRevision: 0, minimoRevision: 0 };
        }

        const tiempos = documentos.map(d =>
            this.calcularTiempoRevisionHoras(d.fechaInicioRevision!, d.fechaFinRevision!)
        );

        return {
            promedioRevision: tiempos.reduce((a, b) => a + b, 0) / tiempos.length,
            maximoRevision: Math.max(...tiempos),
            minimoRevision: Math.min(...tiempos)
        };
    }


    private calcularTiempoRevisionHoras(
        inicio?: Date,
        fin?: Date
    ): number {
        if (!inicio || !fin) return 0;
        return (fin.getTime() - inicio.getTime()) / 36e5;
    }

    private calcularTendenciaMensual(documentos: ContabilidadDocumento[]) {
        const hoy = new Date();
        const meses = [];

        for (let i = 5; i >= 0; i--) {
            const fecha = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);

            const docsMes = documentos.filter(d =>
                d.fechaCreacion.getMonth() === fecha.getMonth() &&
                d.fechaCreacion.getFullYear() === fecha.getFullYear()
            );

            meses.push({
                mes: `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`,
                nombreMes: fecha.toLocaleString('es-ES', { month: 'long', year: 'numeric' }),
                completados: docsMes.filter(d => d.estado === ContabilidadEstado.COMPLETADO_CONTABILIDAD).length,
                observados: docsMes.filter(d => d.estado === ContabilidadEstado.OBSERVADO_CONTABILIDAD).length,
                rechazados: docsMes.filter(d => d.estado === ContabilidadEstado.RECHAZADO_CONTABILIDAD).length,
                glosados: docsMes.filter(d => d.estado === ContabilidadEstado.GLOSADO_CONTABILIDAD).length,
                total: docsMes.length
            });
        }

        return meses;
    }

    private async calcularTopContadores(
        fechaInicio?: Date,
        fechaFin?: Date
    ) {
        const where: any = {
            estado: ContabilidadEstado.COMPLETADO_CONTABILIDAD
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
            acc[id] ??= {
                contadorId: id,
                contadorNombre: doc.contador.fullName || doc.contador.username,
                documentosProcesados: 0,
                totalTiempo: 0,
                fechas: []
            };

            acc[id].documentosProcesados++;

            if (doc.fechaInicioRevision && doc.fechaFinRevision) {
                acc[id].totalTiempo += this.calcularTiempoRevisionHoras(
                    doc.fechaInicioRevision,
                    doc.fechaFinRevision
                );
                acc[id].fechas.push(doc.fechaCreacion.toDateString());
            }

            return acc;
        }, {} as Record<string, any>);

        return Object.values(agrupados)
            .map((c: any) => {
                const dias = new Set(c.fechas).size || 1;
                return {
                    contadorId: c.contadorId,
                    contadorNombre: c.contadorNombre,
                    documentosProcesados: c.documentosProcesados,
                    eficiencia: +(c.documentosProcesados / dias).toFixed(2),
                    promedioTiempo: +(c.totalTiempo / c.documentosProcesados).toFixed(2)
                };
            })
            .sort((a, b) => b.documentosProcesados - a.documentosProcesados)
            .slice(0, 10);
    }


    private calcularEficiencia(documentos: ContabilidadDocumento[]) {
        if (documentos.length === 0) {
            return {
                documentosPorDia: 0,
                documentosPorSemana: 0,
                documentosPorMes: 0
            };
        }

        // Obtener fechas únicas de trabajo
        const fechasUnicas = [...new Set(
            documentos.map(d => d.fechaCreacion.toDateString())
        )];

        const diasTrabajados = fechasUnicas.length;
        const semanasTrabajadas = Math.ceil(diasTrabajados / 7);
        const mesesTrabajados = Math.ceil(diasTrabajados / 30);

        return {
            documentosPorDia: parseFloat((documentos.length / diasTrabajados).toFixed(2)),
            documentosPorSemana: parseFloat((documentos.length / semanasTrabajadas).toFixed(2)),
            documentosPorMes: parseFloat((documentos.length / mesesTrabajados).toFixed(2))
        };
    }

    private calcularDistribucionPorDia(documentos: ContabilidadDocumento[]) {
        const dias = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
        const distribucion = dias.map(dia => ({ dia, cantidad: 0 }));

        documentos.forEach(doc => {
            const diaSemana = doc.fechaCreacion.getDay(); // 0: Domingo, 1: Lunes, etc.
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

        // Últimos 7 días
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
                    promedio: parseFloat(promedio.toFixed(2)),
                    cantidad: documentosDia.length
                });
            }
        }

        return tendencia;
    }
}