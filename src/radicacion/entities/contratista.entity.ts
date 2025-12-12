import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('contratistas')
export class Contratista {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'documento_identidad', unique: true, length: 20 })
  documentoIdentidad: string;

  @Column({ name: 'nombre_completo', length: 200 })
  nombreCompleto: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

}