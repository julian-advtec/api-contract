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
  responsable: User | null; // ← AÑADIDO: tipo explícito con null

  @Column({ nullable: true })
  responsableId: string | null; // ← CORREGIDO: tipo explícito con null

  @Column({ 
    type: 'enum', 
    enum: RendicionCuentasEstado, 
    default: RendicionCuentasEstado.PENDIENTE 
  })
  estado: RendicionCuentasEstado;

  @Column({ type: 'text', nullable: true })
  observaciones: string | null; // ← CORREGIDO: tipo explícito con null

  @Column({ type: 'timestamp', nullable: true })
  fechaAsignacion: Date | null; // ← CORREGIDO: tipo explícito con null

  @Column({ type: 'timestamp', nullable: true })
  fechaInicioRevision: Date | null; // ← CORREGIDO: tipo explícito con null

  @Column({ type: 'timestamp', nullable: true })
  fechaDecision: Date | null; // ← CORREGIDO: tipo explícito con null

  @CreateDateColumn()
  fechaCreacion: Date;

  @UpdateDateColumn()
  fechaActualizacion: Date;

  puedeIniciarRevision(): boolean {
    return [RendicionCuentasEstado.PENDIENTE].includes(this.estado);
  }

  puedeTomarDecision(): boolean {
    return [RendicionCuentasEstado.EN_REVISION].includes(this.estado);
  }
}