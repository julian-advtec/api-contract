// src/juridica/entities/documento-contrato.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Contrato } from './contrato.entity';

export enum TipoDocumento {
  MINUTA = 'MINUTA',
  ACTA_INICIO = 'ACTA_INICIO',
  POLIZA = 'POLIZA',
  INFORME_SUPERVISION = 'INFORME_SUPERVISION',
  FACTURA = 'FACTURA',
  MODIFICACION = 'MODIFICACION',
  ACTA_LIQUIDACION = 'ACTA_LIQUIDACION',
  OTRO = 'OTRO',
}

@Entity('documentos_contrato')
export class DocumentoContrato {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'nombre_archivo', length: 255 })
  nombreArchivo: string;

  @Column({ name: 'ruta_archivo', type: 'text' })
  rutaArchivo: string;

  
  @Column({
    name: 'tipo_documento',
    type: 'enum',
    enum: TipoDocumento,
  })
  tipoDocumento: TipoDocumento;

  @Column({ name: 'descripcion', length: 500, nullable: true })
  descripcion: string;

  @Column({ name: 'version', type: 'int', default: 1 })
  version: number;

  @Column({ name: 'es_version_actual', default: true })
  esVersionActual: boolean;

  @Column({ name: 'documento_anterior_id', nullable: true })
  documentoAnteriorId: string;

  @Column({ name: 'tamano_bytes', type: 'bigint', nullable: true })
  tamanoBytes: number;

  @Column({ name: 'mime_type', length: 100 })
  mimeType: string;

  @ManyToOne(() => Contrato, (contrato) => contrato.documentos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contrato_id' })
  contrato: Contrato;

  @Column({ name: 'contrato_id' })
  contratoId: string;

  @Column({ name: 'cargado_por', length: 100 })
  cargadoPor: string;

  @CreateDateColumn({ name: 'fecha_carga' })
  fechaCarga: Date;
}