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

export enum SupervisorEstado {
  DISPONIBLE = 'DISPONIBLE',
  EN_REVISION = 'EN_REVISION',
  APROBADO = 'APROBADO',
  OBSERVADO = 'OBSERVADO',
  RECHAZADO = 'RECHAZADO',
  DEVUELTO = 'DEVUELTO'
}

@Entity('supervisor_documentos')
@Unique(['documento', 'supervisor'])
@Index(['documento', 'estado'])
@Index(['supervisor', 'estado'])
@Index(['fechaCreacion'])
@Index(['fechaAprobacion'])
export class SupervisorDocumento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Documento, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'documento_id' })
  documento: Documento;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'supervisor_id' })
  supervisor: User;

  @Column({
    type: 'varchar',
    length: 50,
    default: SupervisorEstado.DISPONIBLE
  })
  estado: SupervisorEstado;

  @Column({ type: 'text', nullable: true })
  observacion: string;

  @Column({ type: 'text', nullable: true })
  correcciones: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nombreArchivoSupervisor: string; // Solo el nombre del archivo

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

  // Métodos auxiliares
  public getRutaArchivoSupervisor(): string | null {
    if (!this.nombreArchivoSupervisor || !this.documento) {
      return null;
    }
    return `${this.documento.rutaCarpetaRadicado}/supervisor/${this.nombreArchivoSupervisor}`;
  }

  public iniciarRevision(ip?: string, dispositivo?: string): void {
    this.estado = SupervisorEstado.EN_REVISION;
    this.fechaInicioRevision = new Date();
    this.fechaActualizacion = new Date();
    this.intentosRevision += 1;
    
    if (ip) this.ipUltimoAcceso = ip;
    if (dispositivo) this.dispositivoUltimoAcceso = dispositivo;
  }

  public finalizarRevision(estado: SupervisorEstado, observacion?: string): void {
    this.estado = estado;
    this.fechaFinRevision = new Date();
    this.fechaActualizacion = new Date();
    this.observacion = observacion || this.observacion;
    
    if (estado === SupervisorEstado.APROBADO) {
      this.fechaAprobacion = new Date();
    }
  }
}