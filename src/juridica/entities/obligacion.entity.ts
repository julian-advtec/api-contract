// src/juridica/entities/obligacion.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Contrato } from './contrato.entity';

export enum EstadoObligacion {
  PENDIENTE = 'PENDIENTE',
  EN_EJECUCION = 'EN_EJECUCION',
  CUMPLIDA = 'CUMPLIDA',
  VENCIDA = 'VENCIDA',
}

@Entity('obligaciones')
export class Obligacion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'descripcion', type: 'text' })
  descripcion: string;

  @Column({ name: 'fecha_limite', type: 'date' })
  fechaLimite: Date;

  @Column({ name: 'fecha_cumplimiento', type: 'date', nullable: true })
  fechaCumplimiento: Date;

  @Column({ name: 'responsable', length: 100, nullable: true })
  responsable: string;

  @Column({
    name: 'estado',
    type: 'enum',
    enum: EstadoObligacion,
    default: EstadoObligacion.PENDIENTE,
  })
  estado: EstadoObligacion;

  @Column({ name: 'observaciones', type: 'text', nullable: true })
  observaciones: string;

  @Column({ name: 'evidencia', type: 'text', nullable: true })
  evidencia: string;

  @ManyToOne(() => Contrato, (contrato) => contrato.obligaciones, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contrato_id' })
  contrato: Contrato;

  @Column({ name: 'contrato_id' })
  contratoId: string;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion' })
  fechaActualizacion: Date;
}