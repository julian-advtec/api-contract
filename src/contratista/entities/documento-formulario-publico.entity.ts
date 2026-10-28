// src/contratista/entities/documento-formulario-publico.entity.ts
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
    // ============================================================
    // DOCUMENTOS PERSONALES
    // ============================================================
    CEDULA = 'CEDULA',
    RUT = 'RUT',
    LIBRETA_MILITAR = 'LIBRETA_MILITAR',

    // ============================================================
    // CERTIFICADOS (Persona Natural)
    // ============================================================
    CERTIFICADO_DISCIPLINARIOS = 'CERTIFICADO_DISCIPLINARIOS',
    CERTIFICADO_RESPONSABILIDAD_FISCAL = 'CERTIFICADO_RESPONSABILIDAD_FISCAL',
    CERTIFICADO_ANTECEDENTES_JUDICIALES = 'CERTIFICADO_ANTECEDENTES_JUDICIALES',
    CERTIFICADO_MEDIDAS_CORRECTIVAS = 'CERTIFICADO_MEDIDAS_CORRECTIVAS',
    CERTIFICADO_BANCARIO = 'CERTIFICADO_BANCARIO',
    CERTIFICADO_EXPERIENCIA = 'CERTIFICADO_EXPERIENCIA',
    CERTIFICADO_NO_PLANTA = 'CERTIFICADO_NO_PLANTA',
    CERTIFICADO_IDONEIDAD = 'CERTIFICADO_IDONEIDAD',

    // ============================================================
    // SEGURIDAD SOCIAL
    // ============================================================
    SEGURIDAD_SOCIAL_SALUD = 'SEGURIDAD_SOCIAL_SALUD',
    SEGURIDAD_SOCIAL_PENSION = 'SEGURIDAD_SOCIAL_PENSION',
    SEGURIDAD_SOCIAL_ARL = 'SEGURIDAD_SOCIAL_ARL',

    // ============================================================
    // DECLARACIONES
    // ============================================================
    DECLARACION_BIENES = 'DECLARACION_BIENES',
    DECLARACION_INHABILIDADES = 'DECLARACION_INHABILIDADES',

    // ============================================================
    // EXÁMENES Y OTROS
    // ============================================================
    EXAMEN_INGRESO = 'EXAMEN_INGRESO',
    GARANTIA = 'GARANTIA',
    HOJA_VIDA_SIGEP = 'HOJA_VIDA_SIGEP',
    PANTALLAZO_SECOP = 'PANTALLAZO_SECOP',
    PROPUESTA = 'PROPUESTA',
    PUBLICACION_GT = 'PUBLICACION_GT',
    REDAM = 'REDAM',
    SARLAFT = 'SARLAFT',
    TARJETA_PROFESIONAL = 'TARJETA_PROFESIONAL',

    // ============================================================
    // PERSONA JURÍDICA (COMÚN)
    // ============================================================
    CERTIFICADO_EXISTENCIA = 'CERTIFICADO_EXISTENCIA',
    CERTIFICADO_REPRECENTACION_LEGAL = 'CERTIFICADO_REPRECENTACION_LEGAL',
    HOJA_VIDA_PERSONA_JURIDICA = 'HOJA_VIDA_PERSONA_JURIDICA',
    CERTIFICADO_CUENTA_BANCARIA = 'CERTIFICADO_CUENTA_BANCARIA',
    CERTIFICADO_INHABILIDADES_E_INCOMPATIBILIDADES = 'CERTIFICADO_INHABILIDADES_E_INCOMPATIBILIDADES',

    // Paz y Salvo (Jurídica)
    PAZ_SALVO_SALUD = 'PAZ_SALVO_SALUD',
    PAZ_SALVO_PENSION = 'PAZ_SALVO_PENSION',
    PAZ_SALVO_PARAFISCALES = 'PAZ_SALVO_PARAFISCALES',

    // ============================================================
    // PERSONA JURÍDICA - SINDICAL
    // ============================================================
    PROPUESTA_SINDICATO = 'PROPUESTA_SINDICATO',
    ACTA_INSCRIPCION_VIGENCIA = 'ACTA_INSCRIPCION_VIGENCIA',
    CERTIFICADO_JUNTA_DIRECTIVA_SINDICAL = 'CERTIFICADO_JUNTA_DIRECTIVA_SINDICAL',
    CERTIFICADO_DISCIPLINARIOS_PROCURADORIA_GENERAL_REPRECENTANTE_LEGAL = 'CERTIFICADO_DISCIPLINARIOS_PROCURADORIA_GENERAL_REPRECENTANTE_LEGAL',
    CERTIFICADO_DISCIPLINARIOS_PROCURADORIA_GENERAL_SINDICATO = 'CERTIFICADO_DISCIPLINARIOS_PROCURADORIA_GENERAL_SINDICATO',
    CERTIFICADO_NO_BOLETIN_RESPONSABLE_FISCALES_CONTRALORIA_REPRESENTANTE_LEGAL = 'CERTIFICADO_NO_BOLETIN_RESPONSABLE_FISCALES_CONTRALORIA_REPRESENTANTE_LEGAL',
    CERTIFICADO_NO_BOLETIN_RESPONSABLE_FISCALES_CONTRALORIA_SINDICAL = 'CERTIFICADO_NO_BOLETIN_RESPONSABLE_FISCALES_CONTRALORIA_SINDICAL',
    FORMA_UNICA_DECLARACION_BIENES_Y_RENTA = 'FORMA_UNICA_DECLARACION_BIENES_Y_RENTA',
    ACTIVIDADES_ECONOMCIAS_PRIVADAS = 'ACTIVIDADES_ECONOMCIAS_PRIVADAS',

    // ============================================================
    // PERSONA JURÍDICA - MÍNIMA CUANTÍA
    // ============================================================
    COTIZACION_UNO = 'COTIZACION_UNO',
    COTIZACION_DOS = 'COTIZACION_DOS',
    COTIZACION_TRES = 'COTIZACION_TRES',
    CC_CONTADOR = 'CC_CONTADOR',
    TARJETA_PROFESIONAL_CONTADOR = 'TARJETA_PROFESIONAL_CONTADOR',
    CERTIFICADO_JUNTA_CENTRAL_CONTADORES = 'CERTIFICADO_JUNTA_CENTRAL_CONTADORES',

    // ============================================================
    // GRUPOS COMBINADOS (nombres de grupo)
    // ============================================================
    CERTIFICADO_ANTECEDENTES = 'CERTIFICADO_ANTECEDENTES',
    PAZ_SALVO = 'PAZ_SALVO',
    SEGURIDAD_SOCIAL = 'SEGURIDAD_SOCIAL',
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

    @Column({ name: 'es_combinado', default: false })
    esCombinado: boolean;
}