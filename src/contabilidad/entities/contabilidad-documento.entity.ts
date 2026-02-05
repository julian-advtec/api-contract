import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn
} from 'typeorm';
import { Documento } from '../../radicacion/entities/documento.entity';
import { User } from '../../users/entities/user.entity';

export enum ContabilidadEstado {
  EN_REVISION = 'EN_REVISION',
  DISPONIBLE = 'DISPONIBLE',

  // Estados finales / procesados (ya los tenías)
  PROCESADO_CONTABILIDAD = 'PROCESADO_CONTABILIDAD',
  COMPLETADO_CONTABILIDAD = 'COMPLETADO_CONTABILIDAD',
  GLOSADO_CONTABILIDAD = 'GLOSADO_CONTABILIDAD',
  OBSERVADO_CONTABILIDAD = 'OBSERVADO_CONTABILIDAD',
  RECHAZADO_CONTABILIDAD = 'RECHAZADO_CONTABILIDAD',

  // NUEVOS: estados que vienen del frontend en "estadoFinal"
  APROBADO = 'APROBADO',
  OBSERVADO = 'OBSERVADO',          // ← duplicado con OBSERVADO_CONTABILIDAD, pero lo dejamos por compatibilidad
  RECHAZADO = 'RECHAZADO',          // ← duplicado con RECHAZADO_CONTABILIDAD
}

export enum TipoCausacion {
  NOTA_DEBITO = 'NOTA_DEBITO',
  NOTA_CREDITO = 'NOTA_CREDITO',
  COMPROBANTE_EGRESO = 'COMPROBANTE_EGRESO'
}

@Entity('contabilidad_documentos')
export class ContabilidadDocumento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Documento, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'documento_id' })
  documento: Documento;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'contador_id' })
  contador: User;

  @Column({
    type: 'enum',
    enum: ContabilidadEstado,
    default: ContabilidadEstado.DISPONIBLE
  })
  estado: ContabilidadEstado;

  @Column({ name: 'tiene_glosa', type: 'boolean', nullable: true })
  tieneGlosa: boolean;

  @Column({
    name: 'tipo_causacion',
    type: 'enum',
    enum: TipoCausacion,
    nullable: true
  })
  tipoCausacion: TipoCausacion;

  @Column({ name: 'fecha_inicio_revision', type: 'timestamp', nullable: true })
  fechaInicioRevision: Date;

  @Column({ name: 'fecha_fin_revision', type: 'timestamp', nullable: true })
  fechaFinRevision: Date;

  // Campos para archivos de contabilidad
  @Column({ name: 'glosa_path', type: 'varchar', length: 500, nullable: true })
  glosaPath: string;

  @Column({ name: 'causacion_path', type: 'varchar', length: 500, nullable: true })
  causacionPath: string;

  @Column({ name: 'extracto_path', type: 'varchar', length: 500, nullable: true })
  extractoPath: string;

  @Column({ name: 'fecha_extracto', type: 'timestamp', nullable: true })
  fechaExtracto: Date;

  @Column({ name: 'comprobante_egreso_path', type: 'varchar', length: 500, nullable: true })
  comprobanteEgresoPath: string;

  @Column({ name: 'fecha_comprobante_egreso', type: 'timestamp', nullable: true })
  fechaComprobanteEgreso: Date;

  @Column({ name: 'observaciones', type: 'text', nullable: true })
  observaciones: string;

  @Column({ name: 'correcciones', type: 'text', nullable: true })
  correcciones: string;

  @Column({ name: 'fecha_glosa', type: 'timestamp', nullable: true })
  fechaGlosa: Date;

  @Column({ name: 'fecha_causacion', type: 'timestamp', nullable: true })
  fechaCausacion: Date;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion' })
  fechaActualizacion: Date;

  tieneDocumentosCompletos(): boolean {
    if (this.tieneGlosa === true) {
      return !!this.causacionPath && !!this.extractoPath;
    } else if (this.tieneGlosa === false) {
      return !!this.comprobanteEgresoPath;
    }
    return false;
  }

  getDocumentosFaltantes(): string[] {
    const faltantes: string[] = [];

    if (this.tieneGlosa === true) {
      if (!this.causacionPath) faltantes.push('Documento de causación');
      if (!this.extractoPath) faltantes.push('Extracto');
    } else if (this.tieneGlosa === false) {
      if (!this.comprobanteEgresoPath) faltantes.push('Comprobante de egreso');
    }

    return faltantes;
  }

  puedeFinalizar(): { puede: boolean; razon?: string } {
    if (this.estado !== ContabilidadEstado.EN_REVISION) {
      return { 
        puede: false, 
        razon: `Documento no está en revisión. Estado actual: ${this.estado}` 
      };
    }

    if (this.tieneGlosa === undefined) {
      return { 
        puede: false, 
        razon: 'Debe definir si hay glosa antes de finalizar' 
      };
    }

    if (!this.tieneDocumentosCompletos()) {
      const faltantes = this.getDocumentosFaltantes();
      return { 
        puede: false, 
        razon: `Faltan documentos: ${faltantes.join(', ')}` 
      };
    }

    return { puede: true };
  }
}