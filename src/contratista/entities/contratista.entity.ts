// src/contratista/entities/contratista.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { DocumentoContratista } from './documento-contratista.entity';

@Entity('contratistas')
export class Contratista {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'documento_identidad', unique: true })
  documentoIdentidad: string;

  @Column({ name: 'nombre_completo' })
  nombreCompleto: string;

  @Column({ name: 'numero_contrato', nullable: true, type: 'varchar' })
  numeroContrato: string | null;

  @Column({ nullable: true, type: 'varchar' })
  email: string | null;

  @Column({ nullable: true, type: 'varchar' })
  telefono: string | null;

  @Column({ nullable: true, type: 'text' })
  direccion: string | null;

  @Column({ nullable: true, type: 'varchar' })
  cargo: string | null;

  @Column({ nullable: true, type: 'varchar' })
  tipoContratista: string | null;

  @Column({ nullable: true, type: 'varchar', default: 'ACTIVO' })
  estado: string;

  @Column({ nullable: true, type: 'text' })
  observaciones: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => DocumentoContratista, (documento) => documento.contratista, { cascade: true })
  documentos: DocumentoContratista[];
}