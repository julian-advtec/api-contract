// src/rendicion-cuentas/entities/rendicion-cuentas-estado.enum.ts
export enum RendicionCuentasEstado {
  // Estados iniciales
  PENDIENTE = 'PENDIENTE',
  EN_REVISION = 'EN_REVISION',
  
  // Estados de decisión
  APROBADO = 'APROBADO',
  OBSERVADO = 'OBSERVADO',
  RECHAZADO = 'RECHAZADO',
  
  // Estado final
  COMPLETADO = 'COMPLETADO'
}