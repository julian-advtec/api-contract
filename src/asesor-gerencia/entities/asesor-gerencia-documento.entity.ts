// src/asesor-gerencia/entities/asesor-gerencia-documento.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Documento } from '../../radicacion/entities/documento.entity';
import { User } from '../../users/entities/user.entity';
import { AsesorGerenciaEstado } from './asesor-gerencia-estado.enum';

@Entity('asesor_gerencia_documentos')
export class AsesorGerenciaDocumento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Documento, { onDelete: 'CASCADE' })
  documento: Documento;

  @ManyToOne(() => User, { nullable: false })
  asesor: User;

  @Column({ type: 'enum', enum: AsesorGerenciaEstado, default: AsesorGerenciaEstado.DISPONIBLE })
  estado: AsesorGerenciaEstado;

  @Column({ type: 'text', nullable: true })
  observaciones: string;

  @Column({ nullable: true })
  aprobacionPath: string;

  @Column({ type: 'timestamp', nullable: true })
  fechaAprobacion: Date;

  @CreateDateColumn()
  fechaCreacion: Date;

  @UpdateDateColumn()
  fechaActualizacion: Date;

  @Column({ type: 'timestamp', nullable: true })
  fechaInicioRevision: Date;

  @Column({ type: 'timestamp', nullable: true })
  fechaFinRevision: Date;

  @Column({ name: 'firma_aplicada', default: false })
  firmaAplicada: boolean;

  @Column({ nullable: true })
  comprobanteFirmadoPath: string;


  puedeFinalizar(): { puede: boolean; razon?: string } {
    if (!this.aprobacionPath) {
      return { puede: false, razon: 'Debe subir el comprobante de aprobación o documento firmado' };
    }
    return { puede: true };
  }
}