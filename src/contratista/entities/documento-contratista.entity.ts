// src/contratista/entities/documento-contratista.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Contratista } from './contratista.entity';

export enum TipoDocumento {
  CEDULA = 'CEDULA',
  CERTIFICADO_BANCARIO = 'CERTIFICADO_BANCARIO',
  CERTIFICADO_EXPERIENCIA = 'CERTIFICADO_EXPERIENCIA',
  CERTIFICADO_NO_PLANTA = 'CERTIFICADO_NO_PLANTA',
  CERTIFICADO_ANTECEDENTES = 'CERTIFICADO_ANTECEDENTES',
  CERTIFICADO_IDONEIDAD = 'CERTIFICADO_IDONEIDAD',
  DECLARACION_BIENES = 'DECLARACION_BIENES',
  DECLARACION_INHABILIDADES = 'DECLARACION_INHABILIDADES',
  EXAMEN_INGRESO = 'EXAMEN_INGRESO',
  GARANTIA = 'GARANTIA',
  HOJA_VIDA_SIGEP = 'HOJA_VIDA_SIGEP',
  LIBRETA_MILITAR = 'LIBRETA_MILITAR',
  PANTALLAZO_SECOP = 'PANTALLAZO_SECOP',
  PROPUESTA = 'PROPUESTA',
  PUBLICACION_GT = 'PUBLICACION_GT',
  REDAM = 'REDAM',
  RUT = 'RUT',
  SARLAFT = 'SARLAFT',
  SEGURIDAD_SOCIAL = 'SEGURIDAD_SOCIAL',
  TARJETA_PROFESIONAL = 'TARJETA_PROFESIONAL'
}

@Entity('documentos_contratista')
export class DocumentoContratista {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contratista_id' })
  contratistaId: string;

  @ManyToOne(() => Contratista, (contratista) => contratista.documentos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contratista_id' })
  contratista: Contratista;

  @Column({
    type: 'enum',
    enum: TipoDocumento
  })
  tipo: TipoDocumento;

  @Column({ name: 'nombre_archivo' })
  nombreArchivo: string;

  @Column({ name: 'ruta_archivo' })
  rutaArchivo: string;

  @Column({ name: 'tipo_mime', nullable: true })
  tipoMime: string;

  @Column({ name: 'tamano_bytes', nullable: true })
  tamanoBytes: number;

  @CreateDateColumn({ name: 'fecha_subida' })
  fechaSubida: Date;

  @Column({ name: 'subido_por', nullable: true })
  subidoPor: string;
}