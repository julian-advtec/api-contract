// src/rendicion-cuentas/entities/rendicion-cuentas-historial.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, JoinColumn } from 'typeorm';
import { RendicionCuentasDocumento } from './rendicion-cuentas-documento.entity';
import { User } from '../../users/entities/user.entity';
import { RendicionCuentasEstado } from './rendicion-cuentas-estado.enum';

@Entity('rendicion_cuentas_historial')
export class RendicionCuentasHistorial {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => RendicionCuentasDocumento, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'documentoId' })
  documento: RendicionCuentasDocumento;

  @Column()
  documentoId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'usuarioId' })
  usuario: User;

  @Column()
  usuarioId: string;

  @Column({ type: 'enum', enum: RendicionCuentasEstado, nullable: true })
  estadoAnterior: RendicionCuentasEstado | null; // ← CORREGIDO: tipo explícito con null

  @Column({ type: 'enum', enum: RendicionCuentasEstado })
  estadoNuevo: RendicionCuentasEstado;

  @Column({ type: 'text', nullable: true })
  observacion: string | null; // ← CORREGIDO: tipo explícito con null

  @Column({ type: 'varchar', length: 50 })
  accion: string;

  @CreateDateColumn()
  fechaCreacion: Date;
}