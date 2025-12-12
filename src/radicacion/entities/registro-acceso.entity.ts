import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('registros_acceso')
export class RegistroAcceso {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'documento_id' })
  documentoId: string;

  @Column({ name: 'usuario_id' })
  usuarioId: string;

  @Column({ name: 'nombre_usuario', length: 100 })
  nombreUsuario: string;

  @Column({ name: 'rol_usuario', length: 50 })
  rolUsuario: string;

  @Column({ name: 'accion', length: 50 })
  accion: string;

  @Column({ name: 'detalles', type: 'text', nullable: true })
  detalles: string;

  @CreateDateColumn({ name: 'fecha_acceso' })
  fechaAcceso: Date;
}