import { RevisarAuditorDocumentoDto } from './dto/revisar-auditor-documento.dto';
import { AuditorEstado } from './entities/auditor-documento.entity';

export class AuditorValidationHelper {
  
  static validateRevisarDto(dto: RevisarAuditorDocumentoDto): string[] {
    const errors: string[] = [];

    // Normalizar estado a mayúsculas
    const estadoNormalizado = dto.estado?.toString().toUpperCase();

    // Validar que el estado sea válido
    const estadosValidos = Object.values(AuditorEstado);
    if (!estadosValidos.includes(estadoNormalizado as AuditorEstado)) {
      errors.push(`Estado "${dto.estado}" no válido. Estados permitidos: ${estadosValidos.join(', ')}`);
    }

    // Validaciones específicas por estado
    if (estadoNormalizado === AuditorEstado.OBSERVADO || estadoNormalizado === AuditorEstado.RECHAZADO) {
      if (!dto.observaciones || dto.observaciones.trim().length < 10) {
        errors.push(`Para el estado "${estadoNormalizado}" se requieren observaciones detalladas (mínimo 10 caracteres)`);
      }
    }

    return errors;
  }

  static getEstadoDescripcion(estado: AuditorEstado): string {
    const descripciones: Record<AuditorEstado, string> = {
      [AuditorEstado.APROBADO]: 'Documento aprobado por auditoría',
      [AuditorEstado.OBSERVADO]: 'Documento observado, requiere correcciones',
      [AuditorEstado.RECHAZADO]: 'Documento rechazado por auditoría',
      [AuditorEstado.COMPLETADO]: 'Auditoría completada exitosamente',
      [AuditorEstado.DISPONIBLE]: 'Disponible para revisión',
      [AuditorEstado.EN_REVISION]: 'En revisión por auditor'
    };

    return descripciones[estado] || `Estado: ${estado}`;
  }

  static crearDto(data: any): RevisarAuditorDocumentoDto {
    const dto = new RevisarAuditorDocumentoDto();
    dto.estado = data.estado || AuditorEstado.APROBADO;
    dto.observaciones = data.observaciones || '';
    dto.correcciones = data.correcciones || '';
    return dto;
  }
}