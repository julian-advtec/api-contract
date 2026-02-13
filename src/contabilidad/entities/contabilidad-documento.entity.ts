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

// ───────────────────────────────────────────────────────────────
// ENUMS (versión simplificada y limpia)
// ───────────────────────────────────────────────────────────────
export enum ContabilidadEstado {
  DISPONIBLE            = 'DISPONIBLE',
  EN_REVISION           = 'EN_REVISION',              // ← clave para que funcione el servicio
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

// ───────────────────────────────────────────────────────────────
// ENTIDAD PRINCIPAL
// ───────────────────────────────────────────────────────────────
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

  // Estado actual del proceso contable
  @Column({
    type: 'enum',
    enum: ContabilidadEstado,
    default: ContabilidadEstado.DISPONIBLE,
  })
  estado: ContabilidadEstado;

  // Tipo de proceso seleccionado en el frontend
  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    default: 'nada',
  })
  tipoProceso: string;  // 'nada' | 'glosa' | 'causacion'

  // ¿Tiene glosa o no?
  @Column({ name: 'tiene_glosa', type: 'boolean', nullable: true })
  tieneGlosa: boolean;

  // Tipo de causación (si aplica)
  @Column({
    name: 'tipo_causacion',
    type: 'enum',
    enum: TipoCausacion,
    nullable: true,
  })
  tipoCausacion: TipoCausacion;

  // Observaciones del contador
  @Column({ type: 'text', nullable: true })
  observaciones: string;

  // Correcciones (si está observado)
  @Column({ type: 'text', nullable: true })
  correcciones: string;

  // ── RUTAS DE ARCHIVOS ────────────────────────────────────────
  @Column({ name: 'glosa_path', type: 'varchar', length: 500, nullable: true })
  glosaPath?: string;

  @Column({ name: 'causacion_path', type: 'varchar', length: 500, nullable: true })
  causacionPath?: string;

  @Column({ name: 'extracto_path', type: 'varchar', length: 500, nullable: true })
  extractoPath?: string;

  @Column({ name: 'comprobante_egreso_path', type: 'varchar', length: 500, nullable: true })
  comprobanteEgresoPath?: string;

  // ── FECHAS DE CARGA ──────────────────────────────────────────
  @Column({ name: 'fecha_glosa', type: 'timestamp', nullable: true })
  fechaGlosa?: Date;

  @Column({ name: 'fecha_causacion', type: 'timestamp', nullable: true })
  fechaCausacion?: Date;

  @Column({ name: 'fecha_extracto', type: 'timestamp', nullable: true })
  fechaExtracto?: Date;

  @Column({ name: 'fecha_comprobante_egreso', type: 'timestamp', nullable: true })
  fechaComprobanteEgreso?: Date;

  // ── CONTROL DE REVISIÓN ──────────────────────────────────────
  @Column({ name: 'fecha_inicio_revision', type: 'timestamp', nullable: true })
  fechaInicioRevision?: Date;

  @Column({ name: 'fecha_fin_revision', type: 'timestamp', nullable: true })
  fechaFinRevision?: Date;

  // ── AUDITORÍA ────────────────────────────────────────────────
  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion' })
  fechaActualizacion: Date;

  // ───────────────────────────────────────────────────────────────
  // MÉTODOS ÚTILES (negocio)
  // ───────────────────────────────────────────────────────────────

  /**
   * Verifica si están subidos todos los documentos requeridos según tipoProceso
   */
  tieneDocumentosCompletos(): boolean {
    // Caso glosa
    if (this.tipoProceso === 'glosa') {
      return !!this.glosaPath && !!this.extractoPath;
    }

    // Caso causación
    if (this.tipoProceso === 'causacion') {
      return !!this.causacionPath && !!this.extractoPath;
    }

    // Caso nada → solo requiere comprobante de egreso para aprobar
    if (this.tipoProceso === 'nada' || !this.tipoProceso) {
      return !!this.comprobanteEgresoPath;
    }

    return false;
  }

  /**
   * Lista clara de qué falta subir
   */
  getDocumentosFaltantes(): string[] {
    const faltantes: string[] = [];

    if (this.tipoProceso === 'glosa') {
      if (!this.glosaPath) faltantes.push('Glosa');
      if (!this.extractoPath) faltantes.push('Extracto Bancario');
    } else if (this.tipoProceso === 'causacion') {
      if (!this.causacionPath) faltantes.push('Causación');
      if (!this.extractoPath) faltantes.push('Extracto Bancario');
    }

    // Siempre se valida el comprobante de egreso para aprobar
    if (!this.comprobanteEgresoPath) {
      faltantes.push('Comprobante de Egreso');
    }

    return faltantes;
  }

  /**
   * ¿Puede finalizar la revisión ahora mismo?
   */
  puedeFinalizar(): { puede: boolean; razon?: string } {
    if (this.estado !== ContabilidadEstado.EN_REVISION) {
      return {
        puede: false,
        razon: `No está en revisión (estado actual: ${this.estado})`,
      };
    }

    if (!this.tipoProceso || this.tipoProceso === '') {
      return {
        puede: false,
        razon: 'Falta seleccionar el tipo de proceso contable',
      };
    }

    if (!this.tieneDocumentosCompletos()) {
      const faltantes = this.getDocumentosFaltantes();
      return {
        puede: false,
        razon: `Faltan documentos: ${faltantes.join(', ')}`,
      };
    }

    return { puede: true };
  }
  
}
