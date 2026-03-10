// src/juridica/entities/poliza.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Contrato } from './contrato.entity';

export enum TipoPoliza {
  CUMPLIMIENTO = 'CUMPLIMIENTO',
  ANTICIPO = 'ANTICIPO',
  CALIDAD = 'CALIDAD',
  RESPONSABILIDAD_CIVIL = 'RESPONSABILIDAD_CIVIL',
  SALARIOS_PRESTACIONES = 'SALARIOS_PRESTACIONES',
}

export enum EstadoPoliza {
  VIGENTE = 'VIGENTE',
  POR_VENCER = 'POR_VENCER',
  VENCIDA = 'VENCIDA',
  CANCELADA = 'CANCELADA',
}

@Entity('polizas')
export class Poliza {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'numero_poliza', length: 50 })
  numeroPoliza: string;

  @Column({
    name: 'tipo_poliza',
    type: 'enum',
    enum: TipoPoliza,
  })
  tipoPoliza: TipoPoliza;

  @Column({ name: 'aseguradora', length: 100 })
  aseguradora: string;

  @Column({ name: 'valor_asegurado', type: 'decimal', precision: 15, scale: 2 })
  valorAsegurado: number;

  @Column({ name: 'fecha_expedicion', type: 'date' })
  fechaExpedicion: Date;

  @Column({ name: 'fecha_vigencia_inicio', type: 'date' })
  fechaVigenciaInicio: Date;

  @Column({ name: 'fecha_vigencia_fin', type: 'date' })
  fechaVigenciaFin: Date;

  @Column({ name: 'aprobada', default: false })
  aprobada: boolean;

  @Column({ name: 'fecha_aprobacion', type: 'date', nullable: true })
  fechaAprobacion: Date;

  @Column({ name: 'aprobada_por', length: 100, nullable: true })
  aprobadaPor: string;

  @Column({
    name: 'estado',
    type: 'enum',
    enum: EstadoPoliza,
    default: EstadoPoliza.VIGENTE,
  })
  estado: EstadoPoliza;

  @Column({ name: 'observaciones', type: 'text', nullable: true })
  observaciones: string;

  @Column({ name: 'ruta_archivo', type: 'text', nullable: true })
  rutaArchivo: string;

  @ManyToOne(() => Contrato, (contrato) => contrato.polizas)
  @JoinColumn({ name: 'contrato_id' })
  contrato: Contrato;

  @Column({ name: 'contrato_id' })
  contratoId: string;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion' })
  fechaActualizacion: Date;
}