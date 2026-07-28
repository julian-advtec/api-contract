// src/contratista/entities/formulario-publico.entity.ts
import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn,
    OneToMany,
} from 'typeorm';
import { Contratista } from './contratista.entity';
import { DocumentoFormularioPublico } from './documento-formulario-publico.entity';

export enum EstadoFormulario {
    PENDIENTE = 'PENDIENTE',
    COMPLETADO = 'COMPLETADO',
    EN_REVISION = 'EN_REVISION',
    RECHAZADO = 'RECHAZADO',
    APROBADO = 'APROBADO'
}

@Entity('formulario_publico') // ✅ Asegurar que el nombre de la tabla sea correcto
export class FormularioPublico {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'contratista_id' })
    contratistaId: string;

    @ManyToOne(() => Contratista)
    @JoinColumn({ name: 'contratista_id' })
    contratista: Contratista;

    // Campos del formulario
    @Column({ name: 'representante_legal', nullable: true, length: 200 })
    representanteLegal: string;

    @Column({ name: 'documento_representante', nullable: true, length: 20 })
    documentoRepresentante: string;

    @Column({ nullable: true, length: 15 })
    telefono: string;

    @Column({ nullable: true, length: 255 })
    direccion: string;

    @Column({ nullable: true, length: 100 })
    departamento: string;

    @Column({ nullable: true, length: 100 })
    ciudad: string;

    @Column({ name: 'tipo_contratista', nullable: true, length: 50 })
    tipoContratista: string;

    @Column({ nullable: true, length: 100 })
    cargo: string;

    @Column({ name: 'objetivo_contrato', nullable: true, type: 'text' })
    objetivoContrato: string;

    // Estado del formulario
    @Column({
        type: 'enum',
        enum: EstadoFormulario,
        default: EstadoFormulario.PENDIENTE
    })
    estado: EstadoFormulario;

    // Token usado para este formulario
    @Column({ name: 'token_usado', nullable: true })
    tokenUsado: string;

    // Fecha de envío
    @Column({ name: 'fecha_envio', nullable: true })
    fechaEnvio: Date;

    // IP y usuario que envió
    @Column({ name: 'ip_origen', nullable: true })
    ipOrigen: string;

    @Column({ name: 'user_agent', nullable: true, length: 500 })
    userAgent: string;

    // Metadatos
    @Column({ name: 'version_formulario', default: '1.0' })
    versionFormulario: string;

    @Column({ name: 'completado', default: false })
    completado: boolean;

    @Column({ name: 'fecha_completado', nullable: true })
    fechaCompletado: Date;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    // Relación con documentos
    @OneToMany(
        () => DocumentoFormularioPublico,
        documento => documento.formulario,
        { cascade: true }
    )
    documentos: DocumentoFormularioPublico[];
}