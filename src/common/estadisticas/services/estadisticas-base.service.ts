// src/common/services/estadisticas-base.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Repository, Between, FindOptionsWhere } from 'typeorm';
import { EstadisticasQueryDto, PeriodoStats } from '../dto/estadisticas-query.dto';
import { EstadisticasBase, DocumentoStatsBase } from '../interfaces/estadisticas-base.interface';

export interface EntityWithDocumento {
  id: string;
  documento?: any;
  estado: string;
  fechaCreacion: Date;
  fechaActualizacion?: Date;
  fechaInicioRevision?: Date;
  fechaFinRevision?: Date;
  observaciones?: string;
  [key: string]: any; // Para propiedades específicas de cada módulo
}

@Injectable()
export class EstadisticasBaseService {
  protected logger: Logger;

  constructor(context: string) {
    this.logger = new Logger(context);
  }

  /**
   * Calcula el rango de fechas según el período
   */
  protected calcularRangoFechas(query: EstadisticasQueryDto): { desde: Date; hasta: Date } {
    const hasta = query.fechaFin ? new Date(query.fechaFin) : new Date();
    let desde: Date;

    if (query.fechaInicio) {
      desde = new Date(query.fechaInicio);
    } else {
      desde = new Date();
      
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
        case PeriodoStats.ANO:
          desde.setFullYear(desde.getFullYear() - 1);
          desde.setHours(0, 0, 0, 0);
          break;
        default:
          desde.setMonth(desde.getMonth() - 1);
      }
    }

    // Asegurar que hasta sea el final del día
    hasta.setHours(23, 59, 59, 999);

    return { desde, hasta };
  }

  /**
   * Construye el where para filtrar por fecha
   */
  protected getFechaWhere(query: EstadisticasQueryDto): FindOptionsWhere<any> {
    const { desde, hasta } = this.calcularRangoFechas(query);
    return {
      fechaCreacion: Between(desde, hasta)
    };
  }

  /**
   * Extrae información del documento relacionado
   */
  protected extraerInfoDocumento(entity: any): {
    numeroRadicado: string;
    contratista: string;
    contrato: string;
  } {
    const documento = entity.documento || entity;
    
    return {
      numeroRadicado: documento.numeroRadicado || '—',
      contratista: documento.nombreContratista || documento.contratista || '—',
      contrato: documento.numeroContrato || documento.contrato || '—'
    };
  }

  /**
   * Extrae el nombre del responsable según el módulo
   * Cada módulo debe implementar su propia lógica
   */
  protected extraerResponsable(entity: any): { id: string; nombre: string } | undefined {
    // Cada módulo sobrescribe este método
    return undefined;
  }

  /**
   * Mapea una entidad a DocumentoStatsBase
   */
  protected mapearADocumentoBase(entity: any, modulo: string): DocumentoStatsBase {
    const infoDoc = this.extraerInfoDocumento(entity);
    const responsable = this.extraerResponsable(entity);
    
    return {
      id: entity.id,
      numeroRadicado: infoDoc.numeroRadicado,
      contratista: infoDoc.contratista,
      contrato: infoDoc.contrato,
      estado: entity.estado,
      fechaAsignacion: entity.fechaCreacion,
      fechaProcesamiento: entity.fechaFinRevision || entity.fechaActualizacion,
      fechaInicioRevision: entity.fechaInicioRevision,
      fechaFinRevision: entity.fechaFinRevision,
      responsable,
      observaciones: entity.observaciones || entity.observacion
    };
  }

  /**
   * Genera actividad reciente a partir de documentos
   */
  protected generarActividadReciente(documentos: any[], limite: number = 20): any[] {
    return documentos
      .filter(doc => doc.fechaActualizacion || doc.fechaFinRevision)
      .sort((a, b) => {
        const fa = a.fechaActualizacion || a.fechaFinRevision || 0;
        const fb = b.fechaActualizacion || b.fechaFinRevision || 0;
        return new Date(fb).getTime() - new Date(fa).getTime();
      })
      .slice(0, limite)
      .map(doc => {
        const responsable = this.extraerResponsable(doc);
        const infoDoc = this.extraerInfoDocumento(doc);
        
        let tipo: 'ASIGNADO' | 'INICIADO' | 'APROBADO' | 'RECHAZADO' | 'OBSERVADO' = 'ASIGNADO';
        const estado = doc.estado?.toUpperCase() || '';
        
        if (estado.includes('APROB') || estado.includes('COMPLET') || estado.includes('PAG')) {
          tipo = 'APROBADO';
        } else if (estado.includes('OBSERV')) {
          tipo = 'OBSERVADO';
        } else if (estado.includes('RECHAZ')) {
          tipo = 'RECHAZADO';
        } else if (estado.includes('REVISION')) {
          tipo = 'INICIADO';
        }
        
        return {
          id: doc.id,
          tipo,
          numeroRadicado: infoDoc.numeroRadicado,
          contratista: infoDoc.contratista,
          fecha: doc.fechaActualizacion || doc.fechaFinRevision || doc.fechaCreacion,
          responsable: responsable?.nombre || 'Sistema',
          estadoOriginal: doc.estado
        };
      });
  }

  /**
   * Calcula totales agrupados por estado
   */
  protected calcularTotales(documentos: any[]): Record<string, number> {
    const totales: Record<string, number> = {};
    
    documentos.forEach(doc => {
      const estado = doc.estado || 'SIN_ESTADO';
      totales[estado] = (totales[estado] || 0) + 1;
    });
    
    return totales;
  }

  /**
   * Crea la respuesta de error
   */
  protected crearErrorResponse(error: any): any {
    this.logger.error(`Error en estadísticas: ${error.message}`, error.stack);
    
    return {
      ok: false,
      error: 'No se pudieron obtener las estadísticas',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    };
  }
}