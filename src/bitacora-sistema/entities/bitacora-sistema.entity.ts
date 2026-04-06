// src/bitacora-sistema/entities/bitacora-sistema.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Documento } from '../../radicacion/entities/documento.entity';

export enum ModuloBitacora {
  RADICACION = 'radicacion',
  SUPERVISION = 'supervision',
  AUDITORIA = 'auditoria',
  CONTABILIDAD = 'contabilidad',
  TESORERIA = 'tesoreria',
  JURIDICA = 'juridica',
  ASESOR_GERENCIA = 'asesor_gerencia',
  RENDICION_CUENTAS = 'rendicion_cuentas',
  ADMINISTRACION = 'administracion',
  SISTEMA = 'sistema',
  AUTENTICACION = 'autenticacion'
}

export enum AccionBitacora {
  RADICAR_DOCUMENTO = 'RADICAR_DOCUMENTO',
  EDITAR_DOCUMENTO = 'EDITAR_DOCUMENTO',
  ELIMINAR_DOCUMENTO = 'ELIMINAR_DOCUMENTO',
  VER_DOCUMENTO = 'VER_DOCUMENTO',
  DESCARGAR_ARCHIVO = 'DESCARGAR_ARCHIVO',
  PREVISUALIZAR_ARCHIVO = 'PREVISUALIZAR_ARCHIVO',
  CAMBIAR_ESTADO = 'CAMBIAR_ESTADO',
  SUPERVISOR_TOMAR = 'SUPERVISOR_TOMAR',
  SUPERVISOR_APROBAR = 'SUPERVISOR_APROBAR',
  SUPERVISOR_RECHAZAR = 'SUPERVISOR_RECHAZAR',
  SUPERVISOR_OBSERVAR = 'SUPERVISOR_OBSERVAR',
  SUPERVISOR_LIBERAR = 'SUPERVISOR_LIBERAR',
  SUPERVISOR_ASIGNAR = 'SUPERVISOR_ASIGNAR',
  AUDITOR_TOMAR = 'AUDITOR_TOMAR',
  AUDITOR_SUBIR_DOCUMENTOS = 'AUDITOR_SUBIR_DOCUMENTOS',
  AUDITOR_APROBAR = 'AUDITOR_APROBAR',
  AUDITOR_RECHAZAR = 'AUDITOR_RECHAZAR',
  AUDITOR_OBSERVAR = 'AUDITOR_OBSERVAR',
  AUDITOR_COMPLETAR = 'AUDITOR_COMPLETAR',
  AUDITOR_LIBERAR = 'AUDITOR_LIBERAR',
  CONTABILIDAD_TOMAR = 'CONTABILIDAD_TOMAR',
  CONTABILIDAD_SUBIR_DOCUMENTOS = 'CONTABILIDAD_SUBIR_DOCUMENTOS',
  CONTABILIDAD_COMPLETAR = 'CONTABILIDAD_COMPLETAR',
  CONTABILIDAD_GLOSAR = 'CONTABILIDAD_GLOSAR',
  CONTABILIDAD_OBSERVAR = 'CONTABILIDAD_OBSERVAR',
  CONTABILIDAD_RECHAZAR = 'CONTABILIDAD_RECHAZAR',
  CONTABILIDAD_LIBERAR = 'CONTABILIDAD_LIBERAR',
  TESORERIA_TOMAR = 'TESORERIA_TOMAR',
  TESORERIA_SUBIR_PAGO = 'TESORERIA_SUBIR_PAGO',
  TESORERIA_APROBAR_PAGO = 'TESORERIA_APROBAR_PAGO',
  TESORERIA_COMPLETAR = 'TESORERIA_COMPLETAR',
  TESORERIA_RECHAZAR = 'TESORERIA_RECHAZAR',
  TESORERIA_OBSERVAR = 'TESORERIA_OBSERVAR',
  TESORERIA_LIBERAR = 'TESORERIA_LIBERAR',
  JURIDICA_TOMAR = 'JURIDICA_TOMAR',
  JURIDICA_REVISAR = 'JURIDICA_REVISAR',
  JURIDICA_APROBAR = 'JURIDICA_APROBAR',
  JURIDICA_RECHAZAR = 'JURIDICA_RECHAZAR',
  JURIDICA_OBSERVAR = 'JURIDICA_OBSERVAR',
  JURIDICA_LIBERAR = 'JURIDICA_LIBERAR',
  ASESOR_TOMAR = 'ASESOR_TOMAR',
  ASESOR_REVISAR = 'ASESOR_REVISAR',
  ASESOR_APROBAR = 'ASESOR_APROBAR',
  ASESOR_RECHAZAR = 'ASESOR_RECHAZAR',
  ASESOR_OBSERVAR = 'ASESOR_OBSERVAR',
  ASESOR_LIBERAR = 'ASESOR_LIBERAR',
  RENDICION_TOMAR = 'RENDICION_TOMAR',
  RENDICION_REVISAR = 'RENDICION_REVISAR',
  RENDICION_APROBAR = 'RENDICION_APROBAR',
  RENDICION_RECHAZAR = 'RENDICION_RECHAZAR',
  RENDICION_OBSERVAR = 'RENDICION_OBSERVAR',
  RENDICION_LIBERAR = 'RENDICION_LIBERAR',
  ADMIN_CREAR_USUARIO = 'ADMIN_CREAR_USUARIO',
  ADMIN_EDITAR_USUARIO = 'ADMIN_EDITAR_USUARIO',
  ADMIN_ELIMINAR_USUARIO = 'ADMIN_ELIMINAR_USUARIO',
  ADMIN_CAMBIAR_ROL = 'ADMIN_CAMBIAR_ROL',
  ADMIN_CONFIGURAR_SISTEMA = 'ADMIN_CONFIGURAR_SISTEMA',
  SISTEMA_LOGIN = 'SISTEMA_LOGIN',
  SISTEMA_LOGOUT = 'SISTEMA_LOGOUT',
  SISTEMA_ERROR = 'SISTEMA_ERROR',
  SISTEMA_ACCESO_DENEGADO = 'SISTEMA_ACCESO_DENEGADO',
  SISTEMA_TOKEN_EXPIRADO = 'SISTEMA_TOKEN_EXPIRADO'
}

@Entity('bitacora_sistema')
@Index(['documento_id', 'created_at'])
@Index(['usuario_id', 'created_at'])
@Index(['modulo', 'created_at'])
@Index(['accion', 'created_at'])
export class BitacoraSistema {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  modulo: string;

  @Column({ type: 'varchar', length: 100 })
  accion: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string;

  @Column({ type: 'varchar', length: 50, name: 'rol_usuario' })
  rol_usuario: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  @CreateDateColumn({ type: 'timestamp with time zone', name: 'created_at' })
  created_at: Date;

  // Relaciones con nombres snake_case en BD
  @Column({ name: 'usuario_id', nullable: true })
  @Index()
  usuario_id: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'usuario_id' })
  usuario: User;

  @Column({ name: 'documento_id', nullable: true })
  @Index()
  documento_id: string;

  @ManyToOne(() => Documento, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'documento_id' })
  documento: Documento;

  @Column({ type: 'varchar', length: 255, name: 'nombre_usuario', nullable: true })
  nombre_usuario: string;

  @Column({ type: 'varchar', length: 255, name: 'numero_radicado', nullable: true })
  numero_radicado: string;

  @Column({ type: 'varchar', length: 100, name: 'numero_contrato', nullable: true })
  numero_contrato: string;

  @Column({ type: 'varchar', length: 100, name: 'documento_contratista', nullable: true })
  documento_contratista: string;

  @Column({ type: 'varchar', length: 255, name: 'nombre_contratista', nullable: true })
  nombre_contratista: string;
}