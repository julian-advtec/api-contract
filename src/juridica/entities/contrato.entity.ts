// src/juridica/entities/contrato.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Proveedor } from './proveedor.entity';
import { Poliza } from './poliza.entity';
import { ModificacionContrato } from './modificacion-contrato.entity';
import { DocumentoContrato } from './documento-contrato.entity';
import { Obligacion } from './obligacion.entity';

export enum EstadoContrato {
  BORRADOR = 'BORRADOR',
  EN_APROBACION = 'EN_APROBACION',
  FIRMADO = 'FIRMADO',
  EN_EJECUCION = 'EN_EJECUCION',
  TERMINADO = 'TERMINADO',
  LIQUIDADO = 'LIQUIDADO',
  SUSPENDIDO = 'SUSPENDIDO',
}

export enum TipoContrato {
  PRESTACION_SERVICIOS = 'PRESTACION_SERVICIOS',
  SUMINISTRO = 'SUMINISTRO',
  OBRA = 'OBRA',
  CONSULTORIA = 'CONSULTORIA',
  COMPRAVENTA = 'COMPRAVENTA',
  ARRENDAMIENTO = 'ARRENDAMIENTO',
  OTRO = 'OTRO',
}

@Entity('contratos')
export class Contrato {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vigencia', length: 4 })
  vigencia: string;

  @Column({ name: 'numero_contrato', length: 50, unique: true })
  numeroContrato: string;

  @Column({
    name: 'tipo_contrato',
    type: 'enum',
    enum: TipoContrato,
    default: TipoContrato.PRESTACION_SERVICIOS,
  })
  tipoContrato: TipoContrato;

  @ManyToOne(() => Proveedor, { eager: true })
  @JoinColumn({ name: 'proveedor_id' })
  proveedor: Proveedor;

  @Column({ name: 'objeto', type: 'text' })
  objeto: string;

  @Column({ name: 'valor', type: 'decimal', precision: 15, scale: 2 })
  valor: number;

  @Column({ name: 'plazo_dias', type: 'int' })
  plazoDias: number;

  @Column({ name: 'cdp', length: 50, nullable: true })
  cdp: string;

  @Column({ name: 'rp', length: 50, nullable: true })
  rp: string;

  @Column({ name: 'fecha_firma', type: 'date' })
  fechaFirma: Date;

  @Column({ name: 'fecha_inicio', type: 'date' })
  fechaInicio: Date;

  @Column({ name: 'fecha_terminacion', type: 'date' })
  fechaTerminacion: Date;

  @Column({ name: 'se_desembolsa_anticipo', default: false })
  seDesembolsaAnticipo: boolean;

  @Column({ name: 'porcentaje_anticipo', type: 'decimal', precision: 5, scale: 2, nullable: true })
  porcentajeAnticipo: number;

  @Column({ name: 'valor_anticipo', type: 'decimal', precision: 15, scale: 2, nullable: true })
  valorAnticipo: number;

  @Column({ name: 'fecha_desembolso_anticipo', type: 'date', nullable: true })
  fechaDesembolsoAnticipo: Date;

  @Column({ name: 'adiciones', type: 'decimal', precision: 15, scale: 2, default: 0 })
  adiciones: number;

  @Column({ name: 'valor_total', type: 'decimal', precision: 15, scale: 2 })
  valorTotal: number;

  @Column({ name: 'supervisor', length: 100, nullable: true })
  supervisor: string;

  @Column({
    name: 'estado',
    type: 'enum',
    enum: EstadoContrato,
    default: EstadoContrato.BORRADOR,
  })
  estado: EstadoContrato;

  @OneToMany(() => Poliza, (poliza: Poliza) => poliza.contrato, { cascade: true })
  polizas: Poliza[];

  @OneToMany(() => ModificacionContrato, (modificacion: ModificacionContrato) => modificacion.contrato, { cascade: true })
  modificaciones: ModificacionContrato[];

  @OneToMany(() => DocumentoContrato, (documento: DocumentoContrato) => documento.contrato, { cascade: true })
  documentos: DocumentoContrato[];

  @OneToMany(() => Obligacion, (obligacion: Obligacion) => obligacion.contrato, { cascade: true })
  obligaciones: Obligacion[];

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion' })
  fechaActualizacion: Date;

  @Column({ name: 'creado_por', length: 100, nullable: true })
  creadoPor: string;

  @Column({ name: 'ultimo_usuario', length: 100, nullable: true })
  ultimoUsuario: string;

  @Column({ name: 'pagado_acumulado', type: 'decimal', precision: 15, scale: 2, default: 0 })
  pagadoAcumulado: number;

  @Column({ name: 'comprometido', type: 'decimal', precision: 15, scale: 2, default: 0 })
  comprometido: number;

  @Column({ name: 'saldo_disponible', type: 'decimal', precision: 15, scale: 2, default: 0 })
  saldoDisponible: number;

  @Column({ name: 'anticipo_pendiente_amortizar', type: 'decimal', precision: 15, scale: 2, default: 0 })
  anticipoPendienteAmortizar: number;

  @Column({ name: 'historial_cambios', type: 'json', nullable: true })
  historialCambios: Array<{
    fecha: Date;
    usuario: string;
    accion: string;
    detalles: any;
  }>;
}