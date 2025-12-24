import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn, JoinColumn } from 'typeorm';
import { Documento } from '../../radicacion/entities/documento.entity';
import { User } from '../../users/entities/user.entity';

export enum SupervisorEstado {
  PENDIENTE = 'PENDIENTE',
  APROBADO = 'APROBADO',
  OBSERVADO = 'OBSERVADO',
  RECHAZADO = 'RECHAZADO'
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
    type: 'varchar',
    length: 20,
    default: SupervisorEstado.PENDIENTE
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

  @Column({ name: 'fecha_aprobacion', nullable: true })
  fechaAprobacion: Date;
}