// src/juridica/entities/modificacion-contrato.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Contrato } from './contrato.entity';

export enum TipoModificacion {
  ADICION = 'ADICION',
  PRORROGA = 'PRORROGA',
  SUSPENSION = 'SUSPENSION',
  TERMINACION = 'TERMINACION',
  OTROSI = 'OTROSI',
  LIQUIDACION = 'LIQUIDACION',
}

@Entity('modificaciones_contrato')
export class ModificacionContrato {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'tipo_modificacion',
    type: 'enum',
    enum: TipoModificacion,
  })
  tipoModificacion: TipoModificacion;

  @Column({ name: 'numero_modificacion', length: 50 })
  numeroModificacion: string;

  @Column({ name: 'fecha_modificacion', type: 'date' })
  fechaModificacion: Date;

  @Column({ name: 'descripcion', type: 'text' })
  descripcion: string;

  @Column({ name: 'valor_modificacion', type: 'decimal', precision: 15, scale: 2, nullable: true })
  valorModificacion: number;

  @Column({ name: 'dias_modificacion', type: 'int', nullable: true })
  diasModificacion: number;

  @Column({ name: 'nueva_fecha_terminacion', type: 'date', nullable: true })
  nuevaFechaTerminacion: Date;

  @Column({ name: 'aprobada', default: false })
  aprobada: boolean;

  @Column({ name: 'fecha_aprobacion', type: 'date', nullable: true })
  fechaAprobacion: Date;

  @Column({ name: 'aprobada_por', length: 100, nullable: true })
  aprobadaPor: string;

  @Column({ name: 'ruta_documento', type: 'text', nullable: true })
  rutaDocumento: string;

  @ManyToOne(() => Contrato, (contrato) => contrato.modificaciones, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contrato_id' })
  contrato: Contrato;

  @Column({ name: 'contrato_id' })
  contratoId: string;

  @Column({ name: 'solicitada_por', length: 100 })
  solicitadaPor: string;

  @CreateDateColumn({ name: 'fecha_solicitud' })
  fechaSolicitud: Date;
}