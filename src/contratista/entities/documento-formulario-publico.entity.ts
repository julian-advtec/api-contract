import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
} from 'typeorm';
import { FormularioPublico } from './formulario-publico.entity';

export enum TipoDocumentoFormulario {
    // Documentos personales
    CEDULA = 'CEDULA',
    RUT = 'RUT',
    LIBRETA_MILITAR = 'LIBRETA_MILITAR',
    
    // Certificados
    CERTIFICADO_DISCIPLINARIOS = 'CERTIFICADO_DISCIPLINARIOS',
    CERTIFICADO_RESPONSABILIDAD_FISCAL = 'CERTIFICADO_RESPONSABILIDAD_FISCAL',
    CERTIFICADO_ANTECEDENTES_JUDICIALES = 'CERTIFICADO_ANTECEDENTES_JUDICIALES',
    CERTIFICADO_MEDIDAS_CORRECTIVAS = 'CERTIFICADO_MEDIDAS_CORRECTIVAS',
    
    // Seguridad Social
    SEGURIDAD_SOCIAL_SALUD = 'SEGURIDAD_SOCIAL_SALUD',
    SEGURIDAD_SOCIAL_PENSION = 'SEGURIDAD_SOCIAL_PENSION',
    SEGURIDAD_SOCIAL_ARL = 'SEGURIDAD_SOCIAL_ARL',
    
    // Otros certificados
    CERTIFICADO_BANCARIO = 'CERTIFICADO_BANCARIO',
    CERTIFICADO_EXPERIENCIA = 'CERTIFICADO_EXPERIENCIA',
    CERTIFICADO_NO_PLANTA = 'CERTIFICADO_NO_PLANTA',
    CERTIFICADO_IDONEIDAD = 'CERTIFICADO_IDONEIDAD',
    
    // Declaraciones
    DECLARACION_BIENES = 'DECLARACION_BIENES',
    DECLARACION_INHABILIDADES = 'DECLARACION_INHABILIDADES',
    
    // Exámenes y otros
    EXAMEN_INGRESO = 'EXAMEN_INGRESO',
    GARANTIA = 'GARANTIA',
    HOJA_VIDA_SIGEP = 'HOJA_VIDA_SIGEP',
    PANTALLAZO_SECOP = 'PANTALLAZO_SECOP',
    PROPUESTA = 'PROPUESTA',
    PUBLICACION_GT = 'PUBLICACION_GT',
    REDAM = 'REDAM',
    SARLAFT = 'SARLAFT',
    TARJETA_PROFESIONAL = 'TARJETA_PROFESIONAL'
}

@Entity('documento_formulario_publico')
export class DocumentoFormularioPublico {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'formulario_id' })
    formularioId: string;

    @ManyToOne(() => FormularioPublico, formulario => formulario.documentos)
    @JoinColumn({ name: 'formulario_id' })
    formulario: FormularioPublico;

    @Column({
        type: 'enum',
        enum: TipoDocumentoFormulario
    })
    tipo: TipoDocumentoFormulario;

    @Column({ name: 'nombre_archivo' })
    nombreArchivo: string;

    @Column({ name: 'ruta_archivo' })
    rutaArchivo: string;

    @Column({ name: 'tipo_mime', nullable: true })
    tipoMime: string;

    @Column({ name: 'tamano_bytes', nullable: true })
    tamanoBytes: number;

    @Column({ name: 'subido_por', nullable: true })
    subidoPor: string;

    @CreateDateColumn({ name: 'fecha_subida' })
    fechaSubida: Date;

    @Column({ name: 'hash_archivo', nullable: true })
    hashArchivo: string;

    // ✅ Campo para identificar documentos combinados
    @Column({ name: 'es_combinado', default: false })
    esCombinado: boolean;
}