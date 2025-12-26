import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn, JoinColumn } from 'typeorm';
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
export class SupervisorDocumento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Documento, { nullable: false })
  @JoinColumn({ name: 'documento_id' })
  documento: Documento;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'supervisor_id' })
  supervisor: User;

  @Column({
    type: 'enum',
    enum: SupervisorEstado,
    default: SupervisorEstado.DISPONIBLE
  })
  estado: SupervisorEstado;

  @Column({ type: 'text', nullable: true })
  observacion: string;

  @Column({ name: 'nombre_archivo_supervisor', nullable: true })
  nombreArchivoSupervisor: string;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion' })
  fechaActualizacion: Date;

  @Column({ name: 'fecha_inicio_revision', nullable: true })
  fechaInicioRevision: Date;

  @Column({ name: 'fecha_aprobacion', nullable: true })
  fechaAprobacion: Date;

  @Column({ name: 'fecha_fin_revision', nullable: true })
  fechaFinRevision: Date;
}