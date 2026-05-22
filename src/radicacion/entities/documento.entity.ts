// src/radicacion/entities/documento.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
  OneToMany
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { SupervisorDocumento } from '../../supervision/entities/supervisor.entity';
import { AsesorGerenciaDocumento } from '../../asesor-gerencia/entities/asesor-gerencia-documento.entity';

@Entity('documentos')
export class Documento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'numero_radicado', length: 50, unique: true })
  numeroRadicado: string;

  @Column({ 
    name: 'primer_radicado_ano', 
    type: 'boolean', 
    default: false 
  })
  primerRadicadoDelAno: boolean;

  @Column({ 
    name: 'es_ultimo_radicado', 
    type: 'boolean', 
    default: false,
    nullable: true 
  })
  esUltimoRadicado: boolean;

  @Column({ name: 'numero_contrato', length: 50 })
  numeroContrato: string;

  @Column({ name: 'nombre_contratista', length: 200 })
  nombreContratista: string;

  @Column({ name: 'documento_contratista', length: 50 })
  documentoContratista: string;

  @Column({ name: 'email_contratista', length: 100, nullable: true })
  emailContratista: string;

  @Column({ name: 'telefono_contratista', length: 50, nullable: true })
  telefonoContratista: string;

  @Column({ name: 'fecha_inicio' })
  fechaInicio: Date;

  @Column({ name: 'fecha_fin' })
  fechaFin: Date;

  @Column({
    name: 'estado',
    default: 'RADICADO',
    type: 'varchar',
    length: 50
  })
  estado: string;

  @Column({ name: 'cuenta_cobro', nullable: true })
  cuentaCobro: string;

  @Column({ name: 'seguridad_social', nullable: true })
  seguridadSocial: string;

  @Column({ name: 'informe_actividades', nullable: true })
  informeActividades: string;

  @Column({ name: 'descripcion_cuenta_cobro', length: 200, default: 'Cuenta de Cobro', nullable: true })
  descripcionCuentaCobro: string;

  @Column({ name: 'descripcion_seguridad_social', length: 200, default: 'Seguridad Social', nullable: true })
  descripcionSeguridadSocial: string;

  @Column({ name: 'descripcion_informe_actividades', length: 200, default: 'Informe de Actividades', nullable: true })
  descripcionInformeActividades: string;

  // ✅ NUEVOS CAMPOS PARA ACTA DE SUPERVISIÓN
  @Column({ name: 'acta_supervision_path', type: 'text', nullable: true })
  actaSupervisionPath: string;

  @Column({ name: 'acta_supervision_nombre', length: 255, nullable: true })
  actaSupervisionNombre: string;

  @Column({ name: 'acta_supervision_subida_por', length: 100, nullable: true })
  actaSupervisionSubidaPor: string;

  @Column({ name: 'acta_supervision_fecha', type: 'timestamp', nullable: true })
  actaSupervisionFecha: Date;

  @Column({ name: 'observacion', type: 'text', nullable: true })
  observacion: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'radicador_id' })
  radicador: User;

  @Column({ name: 'nombre_radicador', length: 100 })
  nombreRadicador: string;

  @Column({ name: 'usuario_radicador', length: 50 })
  usuarioRadicador: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'usuario_asignado_id' })
  usuarioAsignado: User | null;

  @Column({ name: 'usuario_asignado_nombre', length: 100, nullable: true })
  usuarioAsignadoNombre: string;

  @OneToMany(() => SupervisorDocumento, supervisorDocumento => supervisorDocumento.documento)
  supervisorDocumentos: SupervisorDocumento[];

  @OneToMany(() => AsesorGerenciaDocumento, asesorGerenciaDocumento => asesorGerenciaDocumento.documento)
  asesorGerenciaDocumentos: AsesorGerenciaDocumento[];

  @CreateDateColumn({ name: 'fecha_radicacion' })
  fechaRadicacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion' })
  fechaActualizacion: Date;

  @Column({ name: 'ruta_carpeta_radicado', type: 'text' })
  rutaCarpetaRadicado: string;

  @Column({ name: 'ultimo_acceso', nullable: true })
  ultimoAcceso: Date;

  @Column({ name: 'ultimo_usuario', length: 100, nullable: true })
  ultimoUsuario: string;

  @Column({ name: 'comentarios', type: 'text', nullable: true })
  comentarios: string;

  @Column({ name: 'correcciones', type: 'text', nullable: true })
  correcciones: string;

  @Column({ name: 'fecha_limite_revision', nullable: true })
  fechaLimiteRevision: Date;

  @Column({ name: 'token_publico', nullable: true, unique: true })
  tokenPublico: string;

  @Column({ name: 'token_activo', default: false })
  tokenActivo: boolean;

  @Column({ name: 'token_expira_en', type: 'timestamp', nullable: true })
  tokenExpiraEn: Date;

  @Column({ name: 'contratista_id', nullable: true })
  contratistaId?: string;

  @Column({ name: 'historial_estados', type: 'json', nullable: true })
  historialEstados: Array<{
    fecha: Date;
    estado: string;
    usuarioId: string;
    usuarioNombre: string;
    rolUsuario: string;
    observacion?: string;
  }>;
}