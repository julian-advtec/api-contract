// src/contratista/dto/update-contratista.dto.ts
export class UpdateContratistaDto {
  documentoIdentidad?: string;
  nombreCompleto?: string;
  numeroContrato?: string;
  email?: string;
  telefono?: string;
  direccion?: string;
  cargo?: string;
}