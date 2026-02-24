// src/rendicion-cuentas/entities/rendicion-cuentas-documento.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn, JoinColumn } from 'typeorm';
import { Documento } from '../../radicacion/entities/documento.entity';
import { User } from '../../users/entities/user.entity';
import { RendicionCuentasEstado } from './rendicion-cuentas-estado.enum';

@Entity('rendicion_cuentas_documentos')
export class RendicionCuentasDocumento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Documento, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'documentoId' })
  documento: Documento;

  @Column()
  documentoId: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'responsableId' })
  responsable: User | null;

  @Column({ nullable: true })
  responsableId: string | null;

  @Column({ 
    type: 'enum', 
    enum: RendicionCuentasEstado, 
    default: RendicionCuentasEstado.PENDIENTE 
  })
  estado: RendicionCuentasEstado;

  @Column({ type: 'text', nullable: true })
  observaciones: string | null;

  @Column({ type: 'timestamp', nullable: true })
  fechaAsignacion: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  fechaInicioRevision: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  fechaDecision: Date | null;

  @CreateDateColumn()
  fechaCreacion: Date;

  @UpdateDateColumn()
  fechaActualizacion: Date;

  // Campos adicionales para el proceso
  @Column({ type: 'text', nullable: true })
  informeRendicionPath: string | null;

  @Column({ type: 'text', nullable: true })
  documentosAdjuntosPath: string | null;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  montoRendido: number | null;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  montoAprobado: number | null;

  @Column({ type: 'jsonb', nullable: true, default: [] })
  informesPresentados: any[];

  @Column({ type: 'jsonb', nullable: true, default: [] })
  documentosAdjuntos: any[];

  puedeIniciarRevision(): boolean {
    return [RendicionCuentasEstado.PENDIENTE].includes(this.estado);
  }

  puedeTomarDecision(): boolean {
    return [RendicionCuentasEstado.EN_REVISION].includes(this.estado);
  }
}