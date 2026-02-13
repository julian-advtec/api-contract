import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Documento } from '../../radicacion/entities/documento.entity';
import { User } from '../../users/entities/user.entity';

export enum TesoreriaEstado {
  DISPONIBLE = 'DISPONIBLE',
  EN_REVISION = 'EN_REVISION',
  COMPLETADO_TESORERIA = 'COMPLETADO_TESORERIA',
  OBSERVADO_TESORERIA = 'OBSERVADO_TESORERIA',
  RECHAZADO_TESORERIA = 'RECHAZADO_TESORERIA',
}

@Entity('tesoreria_documentos')
export class TesoreriaDocumento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Documento, { onDelete: 'CASCADE' })
  documento: Documento;

  @ManyToOne(() => User, { nullable: false })
  tesorero: User;

  @Column({ type: 'enum', enum: TesoreriaEstado, default: TesoreriaEstado.DISPONIBLE })
  estado: TesoreriaEstado;

  @Column({ type: 'text', nullable: true })
  observaciones: string;

  @Column({ nullable: true })
  pagoRealizadoPath: string;

  @Column({ type: 'timestamp', nullable: true })
  fechaPago: Date;

  @CreateDateColumn()
  fechaCreacion: Date;

  @UpdateDateColumn()
  fechaActualizacion: Date;

  @Column({ type: 'timestamp', nullable: true })
  fechaInicioRevision: Date;

  @Column({ type: 'timestamp', nullable: true })
  fechaFinRevision: Date;

  puedeFinalizar(): { puede: boolean; razon?: string } {
    if (!this.pagoRealizadoPath) {
      return { puede: false, razon: 'Debe subir el comprobante de pago realizado' };
    }
    return { puede: true };
  }
}