// src/app/core/models/auditor-estadisticas.model.ts
export enum PeriodoStats {
  HOY = 'hoy',
  SEMANA = 'semana',
  MES = 'mes',
  TRIMESTRE = 'trimestre',
  ANO = 'ano'
}

export interface FiltrosEstadisticasAuditor {
  periodo: PeriodoStats;
}

export interface DistribucionEstadoAuditor {
  estado: string;
  cantidad: number;
  porcentaje: number;
  color?: string;
}

export interface AuditorEstadisticas {
  totalDocumentosDisponibles: number;
  misDocumentos: {
    enRevision: number;
    aprobados: number;
    observados: number;
    rechazados: number;
    completados: number;
    primerRadicados: number;
    total: number;
  };
  rechazados: {
    total: number;
    rechazadosAuditor: number;
    rechazadosOtrasAreas: number;
    porPeriodo: number;
  };
  tiempoPromedioHoras: number;
  eficiencia: number;
  recientes: number;
  distribucion: DistribucionEstadoAuditor[];
  ultimosProcesados: Array<{
    id: string;
    numeroRadicado: string;
    contratista: string;
    fecha: string | Date;
    estado: string;
    primerRadicado: boolean;
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
}

export interface AuditorRechazadoResponse {
  id: string;
  documento: {
    id: string;
    numeroRadicado: string;
    nombreContratista: string;
    documentoContratista: string;
    numeroContrato: string;
    fechaRadicacion: Date | string;
    fechaInicio: Date | string;
    fechaFin: Date | string;
    estado: string;
    cuentaCobro: string;
    seguridadSocial: string;
    informeActividades: string;
    comentarios?: string;
    primerRadicadoDelAno?: boolean;
  };
  auditorRevisor: string;
  estado: string;
  observaciones: string;
  correcciones: string;
  fechaCreacion: Date | string;
  fechaActualizacion: Date | string;
  fechaRechazo?: Date | string;
  archivos?: {
    rp?: boolean;
    cdp?: boolean;
    poliza?: boolean;
    certificadoBancario?: boolean;
    minuta?: boolean;
    actaInicio?: boolean;
  };
}