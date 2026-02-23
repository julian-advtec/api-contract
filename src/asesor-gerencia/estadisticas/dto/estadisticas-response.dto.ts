// dto/estadisticas-response.dto.ts
export class DistribucionEstadoDto {
  estado: string;
  cantidad: number;
  color: string;
  porcentaje?: number;
}

export class DocumentoItemDto {
  id: string;
  tipo: string;
  numero: string;
  fecha: Date;
  monto?: number;
  moneda?: string;
  estado: string;
  cliente?: string;
  proveedor?: string;
  observaciones?: string;
  creador?: string;
  fechaProcesado?: Date;
}

export class IndicadoresDesempenoDto {
  tiempoPromedioRespuesta: number;
  tasaAprobacion: number;
  tasaObservacion: number;
  documentosProcesados: number;
  documentosPendientes: number;
  montoTotalAprobado: number;
}

export class AlertaDocumentoDto {
  tipo: 'info' | 'warning' | 'danger';
  mensaje: string;
  documentoId: string;
  fecha: Date;
  prioridad: number;
  leido: boolean;
}

export class CumplimientoObjetivosDto {
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

export class TendenciaPeriodoDto {
  fecha: Date;
  documentosProcesados: number;
  tiempoPromedio: number;
  tasaAprobacion: number;
}

export class EstadisticasAsesorGerenciaDto {
  desde: Date;
  hasta: Date;
  totalDocumentos: number;
  
  resumen: {
    procesados: number;
    pendientes: number;
    observados: number;
    aprobados: number;
    rechazados: number;
    montoTotal: number;
  };
  
  indicadores: IndicadoresDesempenoDto;
  distribucion: DistribucionEstadoDto[];
  documentosPendientes: DocumentoItemDto[];
  documentosProcesados: DocumentoItemDto[];
  alertas: AlertaDocumentoDto[];
  cumplimiento: CumplimientoObjetivosDto;
  tendencias: TendenciaPeriodoDto[];
  
  metricasAdicionales?: {
    documentosPorTipo: Array<{
      tipo: string;
      cantidad: number;
      monto?: number;
    }>;
    tiemposProcesamiento: {
      minimo: number;
      maximo: number;
      promedio: number;
    };
    usuariosActivos?: number;
  };
}

export class ApiResponseDto<T> {
  ok: boolean;
  msg?: string;
  data: T;
}