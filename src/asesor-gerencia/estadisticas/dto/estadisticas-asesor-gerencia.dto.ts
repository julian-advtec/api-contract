export interface DocumentosPorEstado {
  pendientes: number;
  pagados: number;
  observados: number;
  rechazados: number;
  total: number;
}

export interface MontosPorEstado {
  pendiente: number;
  pagado: number;
  observado: number;
  rechazado: number;
  total: number;
}

export interface ActividadTesoreria {
  id: string;
  tipo: 'PAGADO' | 'OBSERVADO' | 'RECHAZADO';
  numeroRadicado: string;
  contratista: string;
  monto: number;
  fecha: Date;
  tesorero: string;
  tieneComprobante: boolean;
  tieneFirma: boolean;
}

export interface DocumentoAsesorGerencia {
  id: string;
  numeroRadicado: string;
  contratista: string;
  contrato: string;
  monto: number;
  estado: 'PENDIENTE' | 'PAGADO' | 'OBSERVADO' | 'RECHAZADO';
  fechaAsignacion: Date;
  fechaProcesamiento?: Date;
  tesoreroAsignado?: string;
  tesoreroProceso?: string;
  tieneComprobante: boolean;
  tieneFirma: boolean;
}

export interface EstadisticasAsesorGerenciaResumen {
  // Conteos
  documentos: DocumentosPorEstado;
  montos: MontosPorEstado;
  
  // Distribución para gráfico
  distribucion: Array<{
    estado: string;
    cantidad: number;
    monto: number;
    porcentaje: number;
    color: string;
  }>;
  
  // Actividad reciente (últimas acciones)
  actividadReciente: ActividadTesoreria[];
  
  // Documentos pendientes (los que están en bandeja)
  pendientes: DocumentoAsesorGerencia[];
  
  // Documentos procesados en el período
  procesados: DocumentoAsesorGerencia[];
  
  // Métricas del tesorero actual (si aplica)
  misMetricas?: {
    procesadosHoy: number;
    montoHoy: number;
    pendientesAsignados: number;
  };
  
  // Metadatos
  fechaCalculo: Date;
  desde: Date;
  hasta: Date;
}