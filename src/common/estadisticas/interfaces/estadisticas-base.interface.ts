// src/common/interfaces/estadisticas-base.interface.ts

export interface DocumentoStatsBase {
  id: string;
  numeroRadicado: string;
  contratista: string;
  contrato: string;
  estado: string;  // Estado original del módulo
  fechaAsignacion: Date;
  fechaProcesamiento?: Date;
  fechaInicioRevision?: Date;
  fechaFinRevision?: Date;
  responsable?: {
    id: string;
    nombre: string;
  };
  observaciones?: string;
}

export interface ActividadStatsBase {
  id: string;
  tipo: 'ASIGNADO' | 'INICIADO' | 'APROBADO' | 'RECHAZADO' | 'OBSERVADO';
  numeroRadicado: string;
  contratista: string;
  fecha: Date;
  responsable: string;
  estadoOriginal: string;
}

export interface EstadisticasBase {
  desde: Date;
  hasta: Date;
  fechaCalculo: Date;
  
  // Lista completa de documentos (el frontend hará el conteo)
  documentos: DocumentoStatsBase[];
  
  // Conteo opcional (si el backend ya lo calcula)
  totales?: Record<string, number>;
  
  // Actividad reciente
  actividadReciente: ActividadStatsBase[];
}

export interface EstadisticasResponse {
  ok: boolean;
  data: EstadisticasBase;
  meta?: {
    periodo: string;
    calculadoEn: string;
  };
}