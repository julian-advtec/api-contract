// src/radicacion/interfaces/primer-radicado-info.interface.ts
export interface PrimerRadicadoInfo {
  id: string;
  numeroRadicado: string;
  nombreContratista: string;
  fechaRadicacion: Date;
  radicador: string;
  primerRadicadoDelAno: boolean;
}