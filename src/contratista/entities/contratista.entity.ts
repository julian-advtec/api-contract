// src/contratista/entities/contratista.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { DocumentoContratista } from './documento-contratista.entity';

@Entity('contratistas')
export class Contratista {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tipo_documento', type: 'varchar', length: 10, default: 'CC' })
  tipoDocumento: string;

  @Column({ name: 'documento_identidad', type: 'varchar', length: 20, unique: true })
  documentoIdentidad: string;

  @Column({ name: 'razon_social', type: 'varchar', length: 200 })
  razonSocial: string;

  @Column({ name: 'representante_legal', type: 'varchar', length: 200, nullable: true })
  representanteLegal: string | null;

  @Column({ name: 'documento_representante', type: 'varchar', length: 20, nullable: true })
  documentoRepresentante: string | null;

  @Column({ name: 'telefono', type: 'varchar', length: 15, nullable: true })
  telefono: string | null;

  @Column({ name: 'email', type: 'varchar', length: 100, nullable: true })
  email: string | null;

  @Column({ name: 'direccion', type: 'text', nullable: true })
  direccion: string | null;

  @Column({ name: 'departamento', type: 'varchar', length: 50, nullable: true })
  departamento: string | null;

  @Column({ name: 'ciudad', type: 'varchar', length: 50, nullable: true })
  ciudad: string | null;

  @Column({ name: 'tipo_contratista', type: 'varchar', length: 50, nullable: true })
  tipoContratista: string | null;

  @Column({ name: 'estado', type: 'varchar', length: 20, default: 'ACTIVO' })
  estado: string;

  @Column({ name: 'numero_contrato', type: 'varchar', length: 50, nullable: true })
  numeroContrato: string | null;

  @Column({ name: 'cargo', type: 'varchar', length: 100, nullable: true })
  cargo: string | null;

  @Column({ name: 'objetivo_contrato', type: 'text', nullable: true })  // ✅ CAMBIADO DE observaciones A objetivo_contrato
  objetivoContrato: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  @OneToMany(() => DocumentoContratista, (documento) => documento.contratista, { cascade: true })
  documentos: DocumentoContratista[];
}