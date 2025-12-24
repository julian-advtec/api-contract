// src/radicacion/estados/interfaces/flujo-config.interface.ts
import { UserRole } from '../../users/enums/user-role.enum';

export interface FlujoConfig {
  estadoActual: string;
  estadoSiguiente: string;
  rolPermitido: UserRole[];
  mensaje: string;
  requiereObservacion?: boolean;
}

export interface EstadoDocumento {
  codigo: string;
  nombre: string;
  descripcion: string;
  rolesPermitidos: UserRole[];
  puedeDevolver?: boolean;
  tiempoEstimado: number; // en horas
}