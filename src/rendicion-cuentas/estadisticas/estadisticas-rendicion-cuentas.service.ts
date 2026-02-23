// src/rendicion-cuentas/estadisticas/estadisticas-rendicion-cuentas.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { EstadisticasQueryDto, PeriodoStats } from './dto/estadisticas-query.dto';
import { RendicionCuentasDocumento } from '../entities/rendicion-cuentas-documento.entity';
import { RendicionCuentasHistorial } from '../entities/rendicion-cuentas-historial.entity';
import { RendicionCuentasEstado } from '../entities/rendicion-cuentas-estado.enum';
import { User } from '../../users/entities/user.entity';
import { EstadisticasRendicionCuentas, DistribucionEstado, DocumentoItem, ActividadReciente } from './interfaces/estadisticas.interface';

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
  };

  constructor(
    @InjectRepository(RendicionCuentasDocumento)
    private documentoRepo: Repository<RendicionCuentasDocumento>,
    @InjectRepository(RendicionCuentasHistorial)
    private historialRepo: Repository<RendicionCuentasHistorial>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async obtenerEstadisticas(
    query: EstadisticasQueryDto,
    usuario: any
  ): Promise<EstadisticasRendicionCuentas> {
    const { desde, hasta } = this.calcularRangoFechas(query);

    try {
      this.logger.log(`Calculando estadísticas desde ${desde} hasta ${hasta}`);

      const documentos = await this.documentoRepo.find({
        where: {
          fechaCreacion: Between(desde, hasta),
        },
        relations: ['documento', 'responsable'],
      });

      const resumen = this.calcularResumen(documentos);
      const distribucion = this.calcularDistribucion(documentos);
      const documentosPendientes = await this.obtenerDocumentosPendientes(desde, hasta);
      const documentosProcesados = await this.obtenerDocumentosProcesados(desde, hasta);
      const actividadReciente = await this.obtenerActividadReciente(desde, hasta);
      const tiempos = await this.calcularTiemposRespuesta(desde, hasta);
      const metricas = this.calcularMetricasDesempeno(documentos, tiempos);
      const cumplimiento = await this.calcularCumplimientoObjetivos(desde, hasta, usuario);
      const tendencias = await this.obtenerTendencias(query.periodo || PeriodoStats.MES);
      const misMetricas = await this.calcularMisMetricas(usuario.id, desde, hasta);

      return {
        desde,
        hasta,
        fechaCalculo: new Date(),
        resumen,
        metricas,
        distribucion,
        documentosPendientes,
        documentosProcesados,
        actividadReciente,
        tiempos,
        cumplimiento,
        tendencias,
        misMetricas,
      };
    } catch (error) {
      this.logger.error(`Error al calcular estadísticas: ${error.message}`, error.stack);
      throw new BadRequestException('No se pudieron calcular las estadísticas');
    }
  }

  private calcularRangoFechas(query: EstadisticasQueryDto): { desde: Date; hasta: Date } {
    const hasta = new Date();
    let desde = new Date();

    if (query.fechaInicio && query.fechaFin) {
      return {
        desde: new Date(query.fechaInicio),
        hasta: new Date(query.fechaFin),
      };
    }

    switch (query.periodo) {
      case PeriodoStats.HOY:
        desde.setHours(0, 0, 0, 0);
        break;
      case PeriodoStats.SEMANA:
        desde.setDate(desde.getDate() - 7);
        desde.setHours(0, 0, 0, 0);
        break;
      case PeriodoStats.MES:
        desde.setMonth(desde.getMonth() - 1);
        desde.setHours(0, 0, 0, 0);
        break;
      case PeriodoStats.TRIMESTRE:
        desde.setMonth(desde.getMonth() - 3);
        desde.setHours(0, 0, 0, 0);
        break;
      default:
        desde.setMonth(desde.getMonth() - 1);
    }

    return { desde, hasta };
  }

  private calcularResumen(documentos: RendicionCuentasDocumento[]): any {
    const conteo = {
      [RendicionCuentasEstado.PENDIENTE]: 0,
      [RendicionCuentasEstado.EN_REVISION]: 0,
      [RendicionCuentasEstado.APROBADO]: 0,
      [RendicionCuentasEstado.OBSERVADO]: 0,
      [RendicionCuentasEstado.RECHAZADO]: 0,
      [RendicionCuentasEstado.COMPLETADO]: 0,
    };

    documentos.forEach(doc => {
      if (conteo.hasOwnProperty(doc.estado)) {
        conteo[doc.estado]++;
      }
    });

    const total = documentos.length;

    return {
      pendientes: conteo[RendicionCuentasEstado.PENDIENTE],
      enRevision: conteo[RendicionCuentasEstado.EN_REVISION],
      aprobados: conteo[RendicionCuentasEstado.APROBADO],
      observados: conteo[RendicionCuentasEstado.OBSERVADO],
      rechazados: conteo[RendicionCuentasEstado.RECHAZADO],
      completados: conteo[RendicionCuentasEstado.COMPLETADO],
      total,
    };
  }

  private calcularDistribucion(documentos: RendicionCuentasDocumento[]): DistribucionEstado[] {
    const conteo = new Map<string, number>();
    
    documentos.forEach(doc => {
      const estado = doc.estado;
      conteo.set(estado, (conteo.get(estado) || 0) + 1);
    });

    const total = documentos.length;
    const distribucion: DistribucionEstado[] = [];

    conteo.forEach((cantidad, estado) => {
      distribucion.push({
        estado,
        cantidad,
        porcentaje: total > 0 ? Math.round((cantidad / total) * 1000) / 10 : 0,
        color: this.coloresPorEstado[estado] || '#9E9E9E',
      });
    });

    return distribucion.sort((a, b) => b.cantidad - a.cantidad);
  }

  private async obtenerDocumentosPendientes(desde: Date, hasta: Date): Promise<DocumentoItem[]> {
    const documentos = await this.documentoRepo.find({
      where: {
        estado: In([RendicionCuentasEstado.PENDIENTE, RendicionCuentasEstado.EN_REVISION]),
        fechaCreacion: Between(desde, hasta),
      },
      relations: ['documento', 'responsable'],
      order: {
        fechaCreacion: 'DESC',
      },
      take: 20,
    });

    return documentos.map(d => this.mapearADocumentoItem(d));
  }

  private async obtenerDocumentosProcesados(desde: Date, hasta: Date): Promise<DocumentoItem[]> {
    const documentos = await this.documentoRepo.find({
      where: {
        estado: In([RendicionCuentasEstado.APROBADO, RendicionCuentasEstado.OBSERVADO, RendicionCuentasEstado.RECHAZADO]),
        fechaDecision: Between(desde, hasta),
      },
      relations: ['documento', 'responsable'],
      order: {
        fechaDecision: 'DESC',
      },
      take: 20,
    });

    return documentos.map(d => this.mapearADocumentoItem(d));
  }

  private mapearADocumentoItem(doc: RendicionCuentasDocumento): DocumentoItem {
    const getNombreResponsable = (user: any): string => {
      if (!user) return '—';
      
      if (typeof user === 'object') {
        const posibleNombres = [
          user.nombreCompleto,
          user.fullName,
          user.nombre,
          user.name,
          user.username,
          user.email
        ].filter(Boolean);
        
        if (posibleNombres.length > 0) {
          return String(posibleNombres[0]);
        }
      }
      
      return 'Usuario';
    };

    return {
      id: doc.id,
      numeroRadicado: doc.documento?.numeroRadicado || '—',
      contratista: doc.documento?.nombreContratista || '—',
      contrato: doc.documento?.numeroContrato || '—',
      estado: doc.estado,
      fechaAsignacion: doc.fechaAsignacion || doc.fechaCreacion,
      fechaDecision: doc.fechaDecision,
      responsableAsignado: getNombreResponsable(doc.responsable),
      observaciones: doc.observaciones,
    };
  }

  private async obtenerActividadReciente(desde: Date, hasta: Date): Promise<ActividadReciente[]> {
    const historial = await this.historialRepo.find({
      where: {
        fechaCreacion: Between(desde, hasta),
      },
      relations: ['documento', 'documento.documento', 'usuario'],
      order: {
        fechaCreacion: 'DESC',
      },
      take: 15,
    });

    const getNombreUsuario = (user: any): string => {
      if (!user) return 'Sistema';
      
      if (typeof user === 'object') {
        const posibleNombres = [
          user.nombreCompleto,
          user.fullName,
          user.nombre,
          user.name,
          user.username,
          user.email
        ].filter(Boolean);
        
        if (posibleNombres.length > 0) {
          return String(posibleNombres[0]);
        }
      }
      
      return 'Usuario';
    };

    return historial.map(h => ({
      id: h.id,
      tipo: this.mapearAccionATipo(h.accion),
      numeroRadicado: h.documento?.documento?.numeroRadicado || '—',
      contratista: h.documento?.documento?.nombreContratista || '—',
      fecha: h.fechaCreacion,
      responsable: getNombreUsuario(h.usuario),
      estado: h.estadoNuevo,
    }));
  }

  private mapearAccionATipo(accion: string): 'APROBADO' | 'OBSERVADO' | 'RECHAZADO' | 'INICIADO' | 'ASIGNADO' {
    if (accion === 'APROBAR' || accion === 'APROBADO') return 'APROBADO';
    if (accion === 'OBSERVAR' || accion === 'OBSERVADO') return 'OBSERVADO';
    if (accion === 'RECHAZAR' || accion === 'RECHAZADO') return 'RECHAZADO';
    if (accion === 'INICIAR_REVISION') return 'INICIADO';
    if (accion === 'ASIGNAR') return 'ASIGNADO';
    return 'INICIADO';
  }

  private async calcularTiemposRespuesta(desde: Date, hasta: Date): Promise<any> {
    const documentosConDecision = await this.documentoRepo.find({
      where: {
        estado: In([RendicionCuentasEstado.APROBADO, RendicionCuentasEstado.OBSERVADO, RendicionCuentasEstado.RECHAZADO]),
        fechaDecision: Between(desde, hasta),
        fechaInicioRevision: Between(desde, hasta),
      },
    });

    if (documentosConDecision.length === 0) {
      return {
        promedioHoras: 0,
        minimoHoras: 0,
        maximoHoras: 0,
        promedioDias: 0,
      };
    }

    const tiempos: number[] = [];

    documentosConDecision.forEach(doc => {
      if (doc.fechaInicioRevision && doc.fechaDecision) {
        const tiempoHoras = (doc.fechaDecision.getTime() - doc.fechaInicioRevision.getTime()) / (1000 * 60 * 60);
        if (tiempoHoras > 0) {
          tiempos.push(tiempoHoras);
        }
      }
    });

    if (tiempos.length === 0) {
      return {
        promedioHoras: 0,
        minimoHoras: 0,
        maximoHoras: 0,
        promedioDias: 0,
      };
    }

    const suma = tiempos.reduce((a, b) => a + b, 0);
    const promedioHoras = suma / tiempos.length;
    const minimoHoras = Math.min(...tiempos);
    const maximoHoras = Math.max(...tiempos);

    return {
      promedioHoras: Math.round(promedioHoras * 10) / 10,
      minimoHoras: Math.round(minimoHoras * 10) / 10,
      maximoHoras: Math.round(maximoHoras * 10) / 10,
      promedioDias: Math.round((promedioHoras / 24) * 10) / 10,
    };
  }

  private calcularMetricasDesempeno(documentos: RendicionCuentasDocumento[], tiempos: any): any {
    const totalDocumentos = documentos.length;
    const procesados = documentos.filter(d => 
      [RendicionCuentasEstado.APROBADO, RendicionCuentasEstado.OBSERVADO, RendicionCuentasEstado.RECHAZADO].includes(d.estado)
    ).length;
    
    const aprobados = documentos.filter(d => d.estado === RendicionCuentasEstado.APROBADO).length;
    const observados = documentos.filter(d => d.estado === RendicionCuentasEstado.OBSERVADO).length;
    const rechazados = documentos.filter(d => d.estado === RendicionCuentasEstado.RECHAZADO).length;
    
    const pendientes = documentos.filter(d => 
      [RendicionCuentasEstado.PENDIENTE, RendicionCuentasEstado.EN_REVISION].includes(d.estado)
    ).length;

    return {
      documentosProcesados: procesados,
      tiempoPromedioRespuesta: tiempos.promedioHoras,
      tasaAprobacion: totalDocumentos > 0 ? Math.round((aprobados / totalDocumentos) * 1000) / 10 : 0,
      tasaObservacion: totalDocumentos > 0 ? Math.round((observados / totalDocumentos) * 1000) / 10 : 0,
      tasaRechazo: totalDocumentos > 0 ? Math.round((rechazados / totalDocumentos) * 1000) / 10 : 0,
      documentosPendientes: pendientes,
    };
  }

  private async calcularCumplimientoObjetivos(desde: Date, hasta: Date, usuario: any): Promise<any> {
    const documentos = await this.documentoRepo.find({
      where: {
        fechaCreacion: Between(desde, hasta),
      },
    });

    const procesados = documentos.filter(d => 
      [RendicionCuentasEstado.APROBADO, RendicionCuentasEstado.OBSERVADO, RendicionCuentasEstado.RECHAZADO].includes(d.estado)
    ).length;

    const aprobados = documentos.filter(d => d.estado === RendicionCuentasEstado.APROBADO).length;

    const objetivoDocumentos = 100;
    const objetivotiempo = 24;
    const objetivoCalidad = 80;

    const cumplimientoDocumentos = procesados;
    const tiempoActual = await this.calcularTiempoPromedio(desde, hasta);
    const calidadActual = procesados > 0 ? (aprobados / procesados) * 100 : 0;

    return {
      periodo: { inicio: desde, fin: hasta },
      documentos: {
        objetivo: objetivoDocumentos,
        actual: cumplimientoDocumentos,
        cumplimiento: Math.min(100, Math.round((cumplimientoDocumentos / objetivoDocumentos) * 1000) / 10),
        tendencia: this.calcularTendencia(cumplimientoDocumentos, objetivoDocumentos),
      },
      tiempoRespuesta: {
        objetivo: objetivotiempo,
        actual: tiempoActual,
        cumplimiento: tiempoActual > 0 ? Math.min(100, Math.round((objetivotiempo / tiempoActual) * 1000) / 10) : 0,
        tendencia: this.calcularTendencia(objetivotiempo, tiempoActual, true),
      },
      calidad: {
        objetivo: objetivoCalidad,
        actual: Math.round(calidadActual * 10) / 10,
        cumplimiento: Math.min(100, Math.round((calidadActual / objetivoCalidad) * 1000) / 10),
        tendencia: this.calcularTendencia(calidadActual, objetivoCalidad),
      },
    };
  }

  private calcularTendencia(actual: number, objetivo: number, inverso: boolean = false): 'positive' | 'negative' | 'neutral' {
    const margen = objetivo * 0.1;
    
    if (inverso) {
      if (actual < objetivo - margen) return 'positive';
      if (actual > objetivo + margen) return 'negative';
      return 'neutral';
    } else {
      if (actual > objetivo + margen) return 'positive';
      if (actual < objetivo - margen) return 'negative';
      return 'neutral';
    }
  }

  private async calcularTiempoPromedio(desde: Date, hasta: Date): Promise<number> {
    const documentos = await this.documentoRepo.find({
      where: {
        estado: In([RendicionCuentasEstado.APROBADO, RendicionCuentasEstado.OBSERVADO, RendicionCuentasEstado.RECHAZADO]),
        fechaDecision: Between(desde, hasta),
        fechaInicioRevision: Between(desde, hasta),
      },
    });

    if (documentos.length === 0) return 0;

    // Usamos un array y forEach para tener control explícito de null
    const tiempos: number[] = [];
    
    for (const doc of documentos) {
      if (doc.fechaInicioRevision && doc.fechaDecision) {
        const tiempo = (doc.fechaDecision.getTime() - doc.fechaInicioRevision.getTime()) / (1000 * 60 * 60);
        if (tiempo > 0) {
          tiempos.push(tiempo);
        }
      }
    }

    if (tiempos.length === 0) return 0;

    const suma = tiempos.reduce((a, b) => a + b, 0);
    return Math.round((suma / tiempos.length) * 10) / 10;
  }

  private async obtenerTendencias(periodo: PeriodoStats): Promise<any[]> {
    const tendencias = [];
    const fechaFin = new Date();
    const meses = periodo === PeriodoStats.TRIMESTRE ? 3 : 6;
    
    for (let i = 0; i < meses; i++) {
      const fin = new Date(fechaFin);
      fin.setMonth(fin.getMonth() - i);
      
      const inicio = new Date(fin);
      inicio.setMonth(inicio.getMonth() - 1);
      
      const documentos = await this.documentoRepo.find({
        where: {
          fechaCreacion: Between(inicio, fin),
        },
      });

      const procesados = documentos.filter(d => 
        [RendicionCuentasEstado.APROBADO, RendicionCuentasEstado.OBSERVADO, RendicionCuentasEstado.RECHAZADO].includes(d.estado)
      ).length;

      const aprobados = documentos.filter(d => d.estado === RendicionCuentasEstado.APROBADO).length;
      
      const tiempoPromedio = await this.calcularTiempoPromedio(inicio, fin);

      tendencias.unshift({
        fecha: inicio,
        documentosProcesados: procesados,
        tiempoPromedio,
        tasaAprobacion: documentos.length > 0 ? Math.round((aprobados / documentos.length) * 1000) / 10 : 0,
      });
    }

    return tendencias;
  }

  private async calcularMisMetricas(userId: string, desde: Date, hasta: Date): Promise<any> {
  const misDocumentos = await this.documentoRepo.find({
    where: {
      responsableId: userId,
      fechaCreacion: Between(desde, hasta),
    },
  });

  const pendientes = misDocumentos.filter(d => 
    [RendicionCuentasEstado.PENDIENTE, RendicionCuentasEstado.EN_REVISION].includes(d.estado)
  ).length;

  const procesadosHoy = misDocumentos.filter(d => {
    const hoy = new Date();
    return d.fechaDecision && 
           d.fechaDecision.toDateString() === hoy.toDateString() &&
           [RendicionCuentasEstado.APROBADO, RendicionCuentasEstado.OBSERVADO, RendicionCuentasEstado.RECHAZADO].includes(d.estado);
  }).length;

  const haceUnaSemana = new Date();
  haceUnaSemana.setDate(haceUnaSemana.getDate() - 7);
  
  const procesadosSemana = misDocumentos.filter(d => 
    d.fechaDecision && 
    d.fechaDecision >= haceUnaSemana &&
    [RendicionCuentasEstado.APROBADO, RendicionCuentasEstado.OBSERVADO, RendicionCuentasEstado.RECHAZADO].includes(d.estado)
  ).length;

  // CORREGIDO: Usar forEach en lugar de filter().map()
  const tiempos: number[] = [];
  
  for (const doc of misDocumentos) {
    if (doc.fechaInicioRevision && doc.fechaDecision) {
      const tiempo = (doc.fechaDecision.getTime() - doc.fechaInicioRevision.getTime()) / (1000 * 60 * 60);
      if (tiempo > 0) {
        tiempos.push(tiempo);
      }
    }
  }

  const promedioRespuesta = tiempos.length > 0 
    ? Math.round((tiempos.reduce((a, b) => a + b, 0) / tiempos.length) * 10) / 10
    : 0;

  return {
    pendientes,
    procesadosHoy,
    procesadosSemana,
    promedioRespuesta,
  };
}
}