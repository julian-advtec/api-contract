import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('documentos')
export class Documento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'numero_radicado', length: 50, unique: true })
  numeroRadicado: string;

  @Column({ name: 'numero_contrato', length: 50 })
  numeroContrato: string;

  @Column({ name: 'nombre_contratista', length: 200 })
  nombreContratista: string;

  @Column({ name: 'documento_contratista', length: 50 })
  documentoContratista: string;

  @Column({ name: 'fecha_inicio' })
  fechaInicio: Date;

  @Column({ name: 'fecha_fin' })
  fechaFin: Date;

  @Column({ name: 'estado', default: 'RADICADO' })
  estado: string;

  @Column({ name: 'nombre_documento1' })
  nombreDocumento1: string;

  @Column({ name: 'nombre_documento2' })
  nombreDocumento2: string;

  @Column({ name: 'nombre_documento3' })
  nombreDocumento3: string;

  @Column({ name: 'descripcion_doc1', length: 200, default: 'Documento 1' })
  descripcionDoc1: string;

  @Column({ name: 'descripcion_doc2', length: 200, default: 'Documento 2' })
  descripcionDoc2: string;

  @Column({ name: 'descripcion_doc3', length: 200, default: 'Documento 3' })
  descripcionDoc3: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'radicador_id' })
  radicador: User;

  @Column({ name: 'nombre_radicador', length: 100 })
  nombreRadicador: string;

  @Column({ name: 'usuario_radicador', length: 50 })
  usuarioRadicador: string;

  @Column({ name: 'contratista_id', nullable: true })
  contratistaId?: string;

  @CreateDateColumn({ name: 'fecha_radicacion' })
  fechaRadicacion: Date;

  @Column({ name: 'ruta_carpeta_radicado', type: 'text' })
  rutaCarpetaRadicado: string;

  @Column({ name: 'ultimo_acceso', nullable: true })
  ultimoAcceso: Date;

  @Column({ name: 'ultimo_usuario', length: 100, nullable: true })
  ultimoUsuario: string;
  
  @Column({ name: 'token_publico', nullable: true, unique: true })
  tokenPublico: string;

  @Column({ name: 'token_activo', default: false })
  tokenActivo: boolean;

  @Column({ name: 'token_expira_en', type: 'timestamp', nullable: true })
  tokenExpiraEn: Date;
}