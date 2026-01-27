import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany
} from 'typeorm';
import { Documento } from '../../radicacion/entities/documento.entity';
import { User } from '../../users/entities/user.entity';

export enum AuditorEstado {
  DISPONIBLE = 'DISPONIBLE',
  EN_REVISION = 'EN_REVISION',
  APROBADO = 'APROBADO',
  OBSERVADO = 'OBSERVADO',
  RECHAZADO = 'RECHAZADO',
  COMPLETADO = 'COMPLETADO'
}

@Entity('auditor_documentos')
export class AuditorDocumento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Documento, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'documento_id' })
  documento: Documento;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'auditor_id' })
  auditor: User;

  @Column({
    type: 'enum',
    enum: AuditorEstado,
    default: AuditorEstado.DISPONIBLE
  })
  estado: AuditorEstado;

  @Column({ name: 'fecha_inicio_revision', type: 'timestamp', nullable: true })
  fechaInicioRevision: Date;

  @Column({ name: 'fecha_fin_revision', type: 'timestamp', nullable: true })
  fechaFinRevision: Date;

  @Column({ name: 'fecha_aprobacion', type: 'timestamp', nullable: true })
  fechaAprobacion: Date;

  @Column({ name: 'observaciones', type: 'text', nullable: true })
  observaciones: string;

  @Column({ name: 'correcciones', type: 'text', nullable: true })
  correcciones: string;

  // Campos para los archivos del auditor
  @Column({ name: 'rp_path', type: 'varchar', length: 500, nullable: true })
  rpPath: string;

  @Column({ name: 'cdp_path', type: 'varchar', length: 500, nullable: true })
  cdpPath: string;

  @Column({ name: 'poliza_path', type: 'varchar', length: 500, nullable: true })
  polizaPath: string;

  @Column({ name: 'certificado_bancario_path', type: 'varchar', length: 500, nullable: true })
  certificadoBancarioPath: string;

  @Column({ name: 'minuta_path', type: 'varchar', length: 500, nullable: true })
  minutaPath: string;

  @Column({ name: 'acta_inicio_path', type: 'varchar', length: 500, nullable: true })
  actaInicioPath: string;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion' })
  fechaActualizacion: Date;

  // ✅ MÉTODO CORREGIDO: Validación inteligente de documentos
  tieneTodosDocumentos(): boolean {
    // Si no hay documento asociado, no podemos validar
    if (!this.documento) {
      return false;
    }

    // ✅ CRÍTICO: Solo validar archivos completos si es PRIMER RADICADO
    if (!this.documento.primerRadicadoDelAno) {
      // Para documentos NO primer radicado, se considera OK si tiene al menos un archivo
      // o incluso si no tiene ninguno (dependiendo de la política)
      return true; // No se requieren los 6 documentos
    }

    // ✅ Para PRIMER RADICADO: Validar que tenga los 6 documentos
    const tieneTodos = !!this.rpPath &&
                      !!this.cdpPath &&
                      !!this.polizaPath &&
                      !!this.certificadoBancarioPath &&
                      !!this.minutaPath &&
                      !!this.actaInicioPath;

    console.log('[AUDITOR-ENTITY] Validando documentos:', {
      primerRadicado: this.documento?.primerRadicadoDelAno,
      tieneTodos,
      archivos: {
        rp: !!this.rpPath,
        cdp: !!this.cdpPath,
        poliza: !!this.polizaPath,
        certificadoBancario: !!this.certificadoBancarioPath,
        minuta: !!this.minutaPath,
        actaInicio: !!this.actaInicioPath
      }
    });

    return tieneTodos;
  }

  // ✅ Método mejorado para obtener documentos faltantes
  getDocumentosFaltantes(): string[] {
    // Si no es primer radicado, no hay documentos "faltantes" obligatorios
    if (this.documento && !this.documento.primerRadicadoDelAno) {
      return [];
    }

    const documentosRequeridos = [
      { clave: 'rp', nombre: 'Resolución de Pago' },
      { clave: 'cdp', nombre: 'Certificado de Disponibilidad Presupuestal' },
      { clave: 'poliza', nombre: 'Póliza de Cumplimiento' },
      { clave: 'certificadoBancario', nombre: 'Certificado Bancario' },
      { clave: 'minuta', nombre: 'Minuta de Contrato' },
      { clave: 'actaInicio', nombre: 'Acta de Inicio' }
    ];

    const faltantes: string[] = [];

    documentosRequeridos.forEach(doc => {
      const tieneArchivo = this[`${doc.clave}Path` as keyof AuditorDocumento];
      if (!tieneArchivo) {
        faltantes.push(doc.nombre);
      }
    });

    return faltantes;
  }

  // ✅ Método para obtener documentos subidos
  getDocumentosSubidos(): { tipo: string; nombre: string; ruta: string }[] {
    const subidos: { tipo: string; nombre: string; ruta: string }[] = [];

    const documentos = [
      { clave: 'rp', nombre: 'Resolución de Pago' },
      { clave: 'cdp', nombre: 'Certificado de Disponibilidad Presupuestal' },
      { clave: 'poliza', nombre: 'Póliza de Cumplimiento' },
      { clave: 'certificadoBancario', nombre: 'Certificado Bancario' },
      { clave: 'minuta', nombre: 'Minuta de Contrato' },
      { clave: 'actaInicio', nombre: 'Acta de Inicio' }
    ];

    documentos.forEach(doc => {
      const ruta = this[`${doc.clave}Path` as keyof AuditorDocumento] as string;
      if (ruta) {
        subidos.push({
          tipo: doc.clave,
          nombre: doc.nombre,
          ruta: ruta
        });
      }
    });

    return subidos;
  }

  // ✅ Nuevo método: Verificar si puede realizar revisión
  puedeRealizarRevision(): { puede: boolean; razon?: string } {
    // Verificar estado
    if (this.estado !== AuditorEstado.EN_REVISION) {
      return { 
        puede: false, 
        razon: `Documento no está en revisión. Estado actual: ${this.estado}` 
      };
    }

    // Verificar documentos solo para primer radicado
    if (this.documento?.primerRadicadoDelAno && !this.tieneTodosDocumentos()) {
      const faltantes = this.getDocumentosFaltantes();
      return { 
        puede: false, 
        razon: `Faltan documentos requeridos para primer radicado: ${faltantes.join(', ')}` 
      };
    }

    return { puede: true };
  }

  // ✅ Método para obtener resumen de documentos
  getResumenDocumentos(): {
    totalRequeridos: number;
    totalSubidos: number;
    completado: boolean;
    documentos: Array<{ tipo: string; nombre: string; subido: boolean; ruta?: string }>
  } {
    const documentos = [
      { clave: 'rp', nombre: 'Resolución de Pago' },
      { clave: 'cdp', nombre: 'Certificado de Disponibilidad Presupuestal' },
      { clave: 'poliza', nombre: 'Póliza de Cumplimiento' },
      { clave: 'certificadoBancario', nombre: 'Certificado Bancario' },
      { clave: 'minuta', nombre: 'Minuta de Contrato' },
      { clave: 'actaInicio', nombre: 'Acta de Inicio' }
    ];

    const documentosDetalle = documentos.map(doc => {
      const ruta = this[`${doc.clave}Path` as keyof AuditorDocumento] as string;
      return {
        tipo: doc.clave,
        nombre: doc.nombre,
        subido: !!ruta,
        ruta: ruta || undefined
      };
    });

    const totalSubidos = documentosDetalle.filter(d => d.subido).length;
    
    // Solo requerir todos los documentos si es primer radicado
    const totalRequeridos = (this.documento?.primerRadicadoDelAno) ? 6 : 0;
    const completado = totalRequeridos === 0 ? true : totalSubidos === totalRequeridos;

    return {
      totalRequeridos,
      totalSubidos,
      completado,
      documentos: documentosDetalle
    };
  }
}