// src/modules/contabilidad/entities/contabilidad-documento.entity.ts

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Documento } from '../../radicacion/entities/documento.entity';
import { User } from '../../users/entities/user.entity';

// ENUMS
export enum ContabilidadEstado {
  DISPONIBLE            = 'DISPONIBLE',
  EN_REVISION           = 'EN_REVISION',
  OBSERVADO             = 'OBSERVADO',
  RECHAZADO             = 'RECHAZADO',
  GLOSADO               = 'GLOSADO',
  COMPLETADO            = 'COMPLETADO',
  PROCESADO             = 'PROCESADO',
}

export enum TipoCausacion {
  NOTA_DEBITO          = 'NOTA_DEBITO',
  NOTA_CREDITO         = 'NOTA_CREDITO',
  COMPROBANTE_EGRESO   = 'COMPROBANTE_EGRESO',
  OTRO                 = 'OTRO',
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
    default: ContabilidadEstado.DISPONIBLE,
  })
  estado: ContabilidadEstado;

  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    default: null,
  })
  tipoProceso: string;  // 'glosa' | 'causacion'

  @Column({ name: 'tiene_glosa', type: 'boolean', nullable: true })
  tieneGlosa: boolean;

  @Column({
    name: 'tipo_causacion',
    type: 'enum',
    enum: TipoCausacion,
    nullable: true,
  })
  tipoCausacion: TipoCausacion;

  @Column({ type: 'text', nullable: true })
  observaciones: string;

  @Column({ type: 'text', nullable: true })
  correcciones: string;

  // ── RUTAS DE ARCHIVOS (SOLO GLOSA Y CAUSACION) ──
  @Column({ name: 'glosa_path', type: 'varchar', length: 500, nullable: true })
  glosaPath?: string;

  @Column({ name: 'causacion_path', type: 'varchar', length: 500, nullable: true })
  causacionPath?: string;

  @Column({ name: 'comprobante_egreso_path', type: 'varchar', length: 500, nullable: true })
  comprobanteEgresoPath?: string;

  // ── FECHAS DE CARGA ──
  @Column({ name: 'fecha_glosa', type: 'timestamp', nullable: true })
  fechaGlosa?: Date;

  @Column({ name: 'fecha_causacion', type: 'timestamp', nullable: true })
  fechaCausacion?: Date;

  @Column({ name: 'fecha_comprobante_egreso', type: 'timestamp', nullable: true })
  fechaComprobanteEgreso?: Date;

  @Column({ name: 'fecha_inicio_revision', type: 'timestamp', nullable: true })
  fechaInicioRevision?: Date;

  @Column({ name: 'fecha_fin_revision', type: 'timestamp', nullable: true })
  fechaFinRevision?: Date;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion' })
  fechaActualizacion: Date;

  /**
   * Verifica si están subidos todos los documentos requeridos según tipoProceso
   * SOLO Glosa o Causación - SIN EXTRACTO
   */
  tieneDocumentosCompletos(): boolean {
    if (this.tipoProceso === 'glosa') {
      return !!this.glosaPath;
    }
    if (this.tipoProceso === 'causacion') {
      return !!this.causacionPath;
    }
    return false;
  }

  getDocumentosFaltantes(): string[] {
    const faltantes: string[] = [];
    if (this.tipoProceso === 'glosa') {
      if (!this.glosaPath) faltantes.push('Documento de Glosa');
    } else if (this.tipoProceso === 'causacion') {
      if (!this.causacionPath) faltantes.push('Documento de Causación');
    }
    return faltantes;
  }

  puedeFinalizar(): { puede: boolean; razon?: string } {
    if (this.estado !== ContabilidadEstado.EN_REVISION) {
      return { puede: false, razon: `No está en revisión (estado actual: ${this.estado})` };
    }
    if (!this.tipoProceso || this.tipoProceso === '') {
      return { puede: false, razon: 'Falta seleccionar el tipo de proceso contable (Glosa o Causación)' };
    }
    if (!this.tieneDocumentosCompletos()) {
      return { puede: false, razon: `Faltan documentos: ${this.getDocumentosFaltantes().join(', ')}` };
    }
    return { puede: true };
  }
}