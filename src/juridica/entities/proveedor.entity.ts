// src/juridica/entities/proveedor.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Contrato } from './contrato.entity';

@Entity('proveedores')
export class Proveedor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tipo_identificacion', length: 3 })
  tipoIdentificacion: string;

  @Column({ name: 'numero_identificacion', length: 20, unique: true })
  numeroIdentificacion: string;

  @Column({ name: 'nombre_razon_social', length: 200 })
  nombreRazonSocial: string;

  @Column({ name: 'direccion', length: 200, nullable: true })
  direccion: string;

  @Column({ name: 'telefono', length: 50, nullable: true })
  telefono: string;

  @Column({ name: 'email', length: 100, nullable: true })
  email: string;

  @Column({ name: 'contacto_nombre', length: 100, nullable: true })
  contactoNombre: string;

  @Column({ name: 'contacto_telefono', length: 50, nullable: true })
  contactoTeléfono: string;

  @Column({ name: 'contacto_email', length: 100, nullable: true })
  contactoEmail: string;

  @Column({ name: 'activo', default: true })
  activo: boolean;

  @OneToMany(() => Contrato, (contrato) => contrato.proveedor)
  contratos: Contrato[];

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion' })
  fechaActualizacion: Date;
}