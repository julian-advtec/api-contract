// src/bitacora-sistema/entities/bitacora-sistema.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  UpdateDateColumn
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
  // ========== RADICACIÓN ==========
  RADICAR_DOCUMENTO = 'RADICAR_DOCUMENTO',
  EDITAR_DOCUMENTO = 'EDITAR_DOCUMENTO',
  ELIMINAR_DOCUMENTO = 'ELIMINAR_DOCUMENTO',
  VER_DOCUMENTO = 'VER_DOCUMENTO',
  DESCARGAR_ARCHIVO = 'DESCARGAR_ARCHIVO',
  PREVISUALIZAR_ARCHIVO = 'PREVISUALIZAR_ARCHIVO',
  CAMBIAR_ESTADO = 'CAMBIAR_ESTADO',
  
  // ========== SUPERVISIÓN ==========
  SUPERVISOR_TOMAR = 'SUPERVISOR_TOMAR',
  SUPERVISOR_APROBAR = 'SUPERVISOR_APROBAR',
  SUPERVISOR_RECHAZAR = 'SUPERVISOR_RECHAZAR',
  SUPERVISOR_OBSERVAR = 'SUPERVISOR_OBSERVAR',
  SUPERVISOR_LIBERAR = 'SUPERVISOR_LIBERAR',
  SUPERVISOR_ASIGNAR = 'SUPERVISOR_ASIGNAR',
  
  // ========== AUDITORÍA ==========
  AUDITOR_TOMAR = 'AUDITOR_TOMAR',
  AUDITOR_SUBIR_DOCUMENTOS = 'AUDITOR_SUBIR_DOCUMENTOS',
  AUDITOR_APROBAR = 'AUDITOR_APROBAR',
  AUDITOR_RECHAZAR = 'AUDITOR_RECHAZAR',
  AUDITOR_OBSERVAR = 'AUDITOR_OBSERVAR',
  AUDITOR_COMPLETAR = 'AUDITOR_COMPLETAR',
  AUDITOR_LIBERAR = 'AUDITOR_LIBERAR',
  
  // ========== CONTABILIDAD ==========
  CONTABILIDAD_TOMAR = 'CONTABILIDAD_TOMAR',
  CONTABILIDAD_SUBIR_DOCUMENTOS = 'CONTABILIDAD_SUBIR_DOCUMENTOS',
  CONTABILIDAD_COMPLETAR = 'CONTABILIDAD_COMPLETAR',
  CONTABILIDAD_GLOSAR = 'CONTABILIDAD_GLOSAR',
  CONTABILIDAD_OBSERVAR = 'CONTABILIDAD_OBSERVAR',
  CONTABILIDAD_RECHAZAR = 'CONTABILIDAD_RECHAZAR',
  CONTABILIDAD_LIBERAR = 'CONTABILIDAD_LIBERAR',
  
  // ========== TESORERÍA ==========
  TESORERIA_TOMAR = 'TESORERIA_TOMAR',
  TESORERIA_SUBIR_PAGO = 'TESORERIA_SUBIR_PAGO',
  TESORERIA_APROBAR_PAGO = 'TESORERIA_APROBAR_PAGO',
  TESORERIA_COMPLETAR = 'TESORERIA_COMPLETAR',
  TESORERIA_RECHAZAR = 'TESORERIA_RECHAZAR',
  TESORERIA_OBSERVAR = 'TESORERIA_OBSERVAR',
  TESORERIA_LIBERAR = 'TESORERIA_LIBERAR',
  
  // ========== JURÍDICA ==========
  JURIDICA_TOMAR = 'JURIDICA_TOMAR',
  JURIDICA_REVISAR = 'JURIDICA_REVISAR',
  JURIDICA_APROBAR = 'JURIDICA_APROBAR',
  JURIDICA_RECHAZAR = 'JURIDICA_RECHAZAR',
  JURIDICA_OBSERVAR = 'JURIDICA_OBSERVAR',
  JURIDICA_LIBERAR = 'JURIDICA_LIBERAR',
  
  // ========== ASESOR GERENCIA ==========
  ASESOR_TOMAR = 'ASESOR_TOMAR',
  ASESOR_REVISAR = 'ASESOR_REVISAR',
  ASESOR_APROBAR = 'ASESOR_APROBAR',
  ASESOR_RECHAZAR = 'ASESOR_RECHAZAR',
  ASESOR_OBSERVAR = 'ASESOR_OBSERVAR',
  ASESOR_LIBERAR = 'ASESOR_LIBERAR',
  
  // ========== RENDICIÓN CUENTAS ==========
  RENDICION_TOMAR = 'RENDICION_TOMAR',
  RENDICION_REVISAR = 'RENDICION_REVISAR',
  RENDICION_APROBAR = 'RENDICION_APROBAR',
  RENDICION_RECHAZAR = 'RENDICION_RECHAZAR',
  RENDICION_OBSERVAR = 'RENDICION_OBSERVAR',
  RENDICION_LIBERAR = 'RENDICION_LIBERAR',
  
  // ========== ADMINISTRACIÓN ==========
  ADMIN_CREAR_USUARIO = 'ADMIN_CREAR_USUARIO',
  ADMIN_EDITAR_USUARIO = 'ADMIN_EDITAR_USUARIO',
  ADMIN_ELIMINAR_USUARIO = 'ADMIN_ELIMINAR_USUARIO',
  ADMIN_CAMBIAR_ROL = 'ADMIN_CAMBIAR_ROL',
  ADMIN_CONFIGURAR_SISTEMA = 'ADMIN_CONFIGURAR_SISTEMA',
  
  // ========== SISTEMA ==========
  SISTEMA_LOGIN = 'SISTEMA_LOGIN',
  SISTEMA_LOGOUT = 'SISTEMA_LOGOUT',
  SISTEMA_ERROR = 'SISTEMA_ERROR',
  SISTEMA_ACCESO_DENEGADO = 'SISTEMA_ACCESO_DENEGADO',
  SISTEMA_TOKEN_EXPIRADO = 'SISTEMA_TOKEN_EXPIRADO'
}

@Entity('bitacora_sistema')
@Index(['documentoId', 'fecha'])
@Index(['usuarioId', 'fecha'])
@Index(['modulo', 'fecha'])
@Index(['accion', 'fecha'])
export class BitacoraSistema {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ModuloBitacora })
  modulo: ModuloBitacora;

  @Column({ type: 'enum', enum: AccionBitacora })
  accion: AccionBitacora;

  @Column({ type: 'text', nullable: true })
  descripcion: string;

  @Column({ type: 'varchar', length: 50 })
  rolUsuario: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: {
    ip?: string;
    userAgent?: string;
    numeroArchivo?: number;
    nombreArchivo?: string;
    tipoArchivo?: string;
    estadoAnterior?: string;
    estadoNuevo?: string;
    detalles?: any;
    duracion?: number;
    error?: string;
    cambios?: Record<string, any>;
    archivosSubidos?: string[];
    documentosFaltantes?: string[];
    observaciones?: string;
  };

  @CreateDateColumn({ type: 'timestamp with time zone' })
  fecha: Date;

  // Relaciones
  @Column({ nullable: true })
  @Index()
  usuarioId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'usuarioId' })
  usuario: User;

  @Column({ nullable: true })
  @Index()
  documentoId: string;

  @ManyToOne(() => Documento, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'documentoId' })
  documento: Documento;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nombreUsuario: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  numeroRadicado: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  numeroContrato: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  documentoContratista: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nombreContratista: string;
}