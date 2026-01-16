// src/auditor/entities/auditor-documento.entity.ts
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  ManyToOne, 
  JoinColumn, 
  Index,
  Unique 
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
@Unique(['documento', 'auditor'])
@Index(['documento', 'estado'])
@Index(['auditor', 'estado'])
@Index(['fechaCreacion'])
@Index(['fechaAprobacion'])
export class AuditorDocumento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Documento, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'documento_id' })
  documento: Documento;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'auditor_id' })
  auditor: User;

  @Column({
    type: 'varchar',
    length: 50,
    default: AuditorEstado.DISPONIBLE
  })
  estado: AuditorEstado;

  @Column({ type: 'text', nullable: true })
  observaciones: string;

  // Campos para los archivos específicos del auditor
  @Column({ type: 'varchar', length: 255, nullable: true })
  rpPath: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cdpPath: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  polizaPath: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  certificadoBancarioPath: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  minutaPath: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  actaInicioPath: string;

  @CreateDateColumn({ type: 'timestamp' })
  fechaCreacion: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  fechaActualizacion: Date;

  @Column({ type: 'timestamp', nullable: true })
  fechaInicioRevision: Date;

  @Column({ type: 'timestamp', nullable: true })
  fechaFinRevision: Date;

  @Column({ type: 'timestamp', nullable: true })
  fechaAprobacion: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  @Column({ type: 'boolean', default: false })
  notificado: boolean;

  @Column({ type: 'timestamp', nullable: true })
  fechaNotificacion: Date;

  @Column({ type: 'integer', default: 0 })
  intentosRevision: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  ipUltimoAcceso: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  dispositivoUltimoAcceso: string;

  // Métodos auxiliares - CORREGIDO
  public getRutaArchivo(tipo: string): string | null {
    // Usar un switch para evitar el error de tipo
    let archivoPath: string;
    switch (tipo) {
      case 'rp':
        archivoPath = this.rpPath;
        break;
      case 'cdp':
        archivoPath = this.cdpPath;
        break;
      case 'poliza':
        archivoPath = this.polizaPath;
        break;
      case 'certificadoBancario':
        archivoPath = this.certificadoBancarioPath;
        break;
      case 'minuta':
        archivoPath = this.minutaPath;
        break;
      case 'actaInicio':
        archivoPath = this.actaInicioPath;
        break;
      default:
        return null;
    }
    
    if (!archivoPath || !this.documento) {
      return null;
    }
    return `${this.documento.rutaCarpetaRadicado}/auditor/${this.auditor.id}/${archivoPath}`;
  }

  public iniciarRevision(ip?: string, dispositivo?: string): void {
    this.estado = AuditorEstado.EN_REVISION;
    this.fechaInicioRevision = new Date();
    this.fechaActualizacion = new Date();
    this.intentosRevision += 1;
    
    if (ip) this.ipUltimoAcceso = ip;
    if (dispositivo) this.dispositivoUltimoAcceso = dispositivo;
  }

  public finalizarRevision(estado: AuditorEstado, observaciones?: string): void {
    this.estado = estado;
    this.fechaFinRevision = new Date();
    this.fechaActualizacion = new Date();
    this.observaciones = observaciones || this.observaciones;
    
    if (estado === AuditorEstado.APROBADO || estado === AuditorEstado.COMPLETADO) {
      this.fechaAprobacion = new Date();
    }
  }

  public tieneTodosDocumentos(): boolean {
    return !!(
      this.rpPath &&
      this.cdpPath &&
      this.polizaPath &&
      this.certificadoBancarioPath &&
      this.minutaPath &&
      this.actaInicioPath
    );
  }
}