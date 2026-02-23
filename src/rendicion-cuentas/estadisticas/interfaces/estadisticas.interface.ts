// src/rendicion-cuentas/estadisticas/interfaces/estadisticas.interface.ts
import { RendicionCuentasEstado } from '../../entities/rendicion-cuentas-estado.enum';

export interface DocumentosPorEstado {
  pendientes: number;
  enRevision: number;
  aprobados: number;
  observados: number;
  rechazados: number;
  completados: number;
  total: number;
}

export interface TiemposRespuesta {
  promedioHoras: number;
  minimoHoras: number;
  maximoHoras: number;
  promedioDias: number;
}

export interface ActividadReciente {
  id: string;
  tipo: 'APROBADO' | 'OBSERVADO' | 'RECHAZADO' | 'INICIADO' | 'ASIGNADO';
  numeroRadicado: string;
  contratista: string;
  fecha: Date;
  responsable: string;
  estado: string;
}

export interface DocumentoItem {
  id: string;
  numeroRadicado: string;
  contratista: string;
  contrato: string;
  estado: RendicionCuentasEstado;
  fechaAsignacion: Date;
  fechaDecision?: Date | null; // ← CORREGIDO: acepta null
  responsableAsignado?: string;
  observaciones?: string | null; // ← CORREGIDO: acepta null
}

export interface DistribucionEstado {
  estado: string;
  cantidad: number;
  porcentaje: number;
  color: string;
}

export interface MetricasDesempeno {
  documentosProcesados: number;
  tiempoPromedioRespuesta: number;
  tasaAprobacion: number;
  tasaObservacion: number;
  tasaRechazo: number;
  documentosPendientes: number;
}

export interface CumplimientoObjetivos {
  periodo: {
    inicio: Date;
    fin: Date;
  };
  documentos: {
    objetivo: number;
    actual: number;
    cumplimiento: number;
    tendencia: 'positive' | 'negative' | 'neutral';
  };
  tiempoRespuesta: {
    objetivo: number;
    actual: number;
    cumplimiento: number;
    tendencia: 'positive' | 'negative' | 'neutral';
  };
  calidad: {
    objetivo: number;
    actual: number;
    cumplimiento: number;
    tendencia: 'positive' | 'negative' | 'neutral';
  };
}

export interface TendenciaPeriodo {
  fecha: Date;
  documentosProcesados: number;
  tiempoPromedio: number;
  tasaAprobacion: number;
}

export interface EstadisticasRendicionCuentas {
  desde: Date;
  hasta: Date;
  fechaCalculo: Date;
  resumen: DocumentosPorEstado;
  metricas: MetricasDesempeno;
  distribucion: DistribucionEstado[];
  documentosPendientes: DocumentoItem[];
  documentosProcesados: DocumentoItem[];
  actividadReciente: ActividadReciente[];
  tiempos: TiemposRespuesta;
  cumplimiento?: CumplimientoObjetivos;
  tendencias?: TendenciaPeriodo[];
  misMetricas?: {
    pendientes: number;
    procesadosHoy: number;
    procesadosSemana: number;
    promedioRespuesta: number;
  };
}