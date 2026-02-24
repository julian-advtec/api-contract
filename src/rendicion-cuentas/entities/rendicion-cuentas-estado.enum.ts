// entities/rendicion-cuentas-estado.enum.ts
export enum RendicionCuentasEstado {
  PENDIENTE = 'PENDIENTE',
  EN_REVISION = 'EN_REVISION',
  APROBADO = 'APROBADO',
  OBSERVADO = 'OBSERVADO',
  RECHAZADO = 'RECHAZADO',
  COMPLETADO = 'COMPLETADO',

  // ← Agrega estos nuevos estados
  ESPERA_APROBACION_GERENCIA = 'ESPERA_APROBACION_GERENCIA',
  APROBADO_POR_GERENCIA = 'APROBADO_POR_GERENCIA',   // ← este sería el que buscas
}