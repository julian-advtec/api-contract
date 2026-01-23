// src/auditor/entities/auditor-documento.entity.ts
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

  // Campos para los archivos del auditor
  @Column({ name: 'rp_path', type: 'varchar', length: 255, nullable: true })
  rpPath: string;

  @Column({ name: 'cdp_path', type: 'varchar', length: 255, nullable: true })
  cdpPath: string;

  @Column({ name: 'poliza_path', type: 'varchar', length: 255, nullable: true })
  polizaPath: string;

  @Column({ name: 'certificado_bancario_path', type: 'varchar', length: 255, nullable: true })
  certificadoBancarioPath: string;

  @Column({ name: 'minuta_path', type: 'varchar', length: 255, nullable: true })
  minutaPath: string;

  @Column({ name: 'acta_inicio_path', type: 'varchar', length: 255, nullable: true })
  actaInicioPath: string;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion' })
  fechaActualizacion: Date;

  // Método para verificar si tiene todos los documentos subidos
  tieneTodosDocumentos(): boolean {
    // Versión flexible: Considera que tiene documentos si al menos hay alguno
    return !!(
      this.rpPath ||
      this.cdpPath ||
      this.polizaPath ||
      this.certificadoBancarioPath ||
      this.minutaPath ||
      this.actaInicioPath
    );
  }

  // O mejor, agregar métodos más específicos:
  getDocumentosFaltantes(): string[] {
    const documentosRequeridos = ['rp', 'cdp', 'poliza', 'certificadoBancario', 'minuta', 'actaInicio'];
    const faltantes: string[] = [];

    if (!this.rpPath) faltantes.push('rp');
    if (!this.cdpPath) faltantes.push('cdp');
    if (!this.polizaPath) faltantes.push('poliza');
    if (!this.certificadoBancarioPath) faltantes.push('certificadoBancario');
    if (!this.minutaPath) faltantes.push('minuta');
    if (!this.actaInicioPath) faltantes.push('actaInicio');

    return faltantes;
  }

  getDocumentosSubidos(): string[] {
    const subidos: string[] = [];

    if (this.rpPath) subidos.push('rp');
    if (this.cdpPath) subidos.push('cdp');
    if (this.polizaPath) subidos.push('poliza');
    if (this.certificadoBancarioPath) subidos.push('certificadoBancario');
    if (this.minutaPath) subidos.push('minuta');
    if (this.actaInicioPath) subidos.push('actaInicio');

    return subidos;
  }
}