// src/contratistas/entities/contratista.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('contratistas')
export class Contratista {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'documento_identidad' })
  documentoIdentidad: string;

  @Column({ name: 'nombre_completo' })
  nombreCompleto: string;

  // ✅ CAMBIO: Hacer que acepte string o null
  @Column({ name: 'numero_contrato', nullable: true, type: 'varchar' })
  numeroContrato: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}