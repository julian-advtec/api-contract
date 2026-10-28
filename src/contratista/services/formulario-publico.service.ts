// src/contratista/services/formulario-publico.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { FormularioPublico, EstadoFormulario } from '../entities/formulario-publico.entity';
import { DocumentoFormularioPublico, TipoDocumentoFormulario } from '../entities/documento-formulario-publico.entity';
import { DocumentoContratista, TipoDocumento } from '../entities/documento-contratista.entity';
import { StorageService } from '../../common/storage/storage.service';
import * as crypto from 'crypto';
import { PDFDocument } from 'pdf-lib';
import { ContratistaService } from './contratista.service';

// ============================================================
// ✅ CONFIGURACIÓN DE DOCUMENTOS POR TIPO / SUBTIPO
// ============================================================
const DOCUMENTOS_PERSONA_NATURAL: TipoDocumentoFormulario[] = [
    TipoDocumentoFormulario.CEDULA,
    TipoDocumentoFormulario.RUT,
    TipoDocumentoFormulario.LIBRETA_MILITAR,
    TipoDocumentoFormulario.CERTIFICADO_DISCIPLINARIOS,
    TipoDocumentoFormulario.CERTIFICADO_RESPONSABILIDAD_FISCAL,
    TipoDocumentoFormulario.CERTIFICADO_ANTECEDENTES_JUDICIALES,
    TipoDocumentoFormulario.CERTIFICADO_MEDIDAS_CORRECTIVAS,
    TipoDocumentoFormulario.SEGURIDAD_SOCIAL_SALUD,
    TipoDocumentoFormulario.SEGURIDAD_SOCIAL_PENSION,
    TipoDocumentoFormulario.SEGURIDAD_SOCIAL_ARL,
    TipoDocumentoFormulario.CERTIFICADO_BANCARIO,
    TipoDocumentoFormulario.CERTIFICADO_EXPERIENCIA,
    TipoDocumentoFormulario.CERTIFICADO_NO_PLANTA,
    TipoDocumentoFormulario.CERTIFICADO_IDONEIDAD,
    TipoDocumentoFormulario.DECLARACION_BIENES,
    TipoDocumentoFormulario.DECLARACION_INHABILIDADES,
    TipoDocumentoFormulario.EXAMEN_INGRESO,
    TipoDocumentoFormulario.GARANTIA,
    TipoDocumentoFormulario.HOJA_VIDA_SIGEP,
    TipoDocumentoFormulario.PANTALLAZO_SECOP,
    TipoDocumentoFormulario.PROPUESTA,
    TipoDocumentoFormulario.PUBLICACION_GT,
    TipoDocumentoFormulario.REDAM,
    TipoDocumentoFormulario.SARLAFT,
    TipoDocumentoFormulario.TARJETA_PROFESIONAL,
    TipoDocumentoFormulario.CERTIFICADO_INHABILIDADES_E_INCOMPATIBILIDADES,
    TipoDocumentoFormulario.CERTIFICADO_CUENTA_BANCARIA,
];

// ============================================================
// ✅ PERSONA JURÍDICA - SINDICAL
// ============================================================
const DOCUMENTOS_JURIDICA_SINDICAL: TipoDocumentoFormulario[] = [
    TipoDocumentoFormulario.PROPUESTA_SINDICATO,
    TipoDocumentoFormulario.ACTA_INSCRIPCION_VIGENCIA,
    TipoDocumentoFormulario.CERTIFICADO_EXISTENCIA,
    TipoDocumentoFormulario.CERTIFICADO_REPRECENTACION_LEGAL,
    TipoDocumentoFormulario.CERTIFICADO_JUNTA_DIRECTIVA_SINDICAL,
    TipoDocumentoFormulario.CEDULA,
    TipoDocumentoFormulario.RUT,
    TipoDocumentoFormulario.CERTIFICADO_DISCIPLINARIOS_PROCURADORIA_GENERAL_REPRECENTANTE_LEGAL,
    TipoDocumentoFormulario.CERTIFICADO_DISCIPLINARIOS_PROCURADORIA_GENERAL_SINDICATO,
    TipoDocumentoFormulario.CERTIFICADO_NO_BOLETIN_RESPONSABLE_FISCALES_CONTRALORIA_REPRESENTANTE_LEGAL,
    TipoDocumentoFormulario.CERTIFICADO_NO_BOLETIN_RESPONSABLE_FISCALES_CONTRALORIA_SINDICAL,
    TipoDocumentoFormulario.CERTIFICADO_ANTECEDENTES_JUDICIALES,
    TipoDocumentoFormulario.CERTIFICADO_MEDIDAS_CORRECTIVAS,
    TipoDocumentoFormulario.REDAM,
    TipoDocumentoFormulario.SARLAFT,
    TipoDocumentoFormulario.HOJA_VIDA_PERSONA_JURIDICA,
    TipoDocumentoFormulario.FORMA_UNICA_DECLARACION_BIENES_Y_RENTA,
    TipoDocumentoFormulario.ACTIVIDADES_ECONOMCIAS_PRIVADAS,
    TipoDocumentoFormulario.PAZ_SALVO_SALUD,
    TipoDocumentoFormulario.PAZ_SALVO_PENSION,
    TipoDocumentoFormulario.PAZ_SALVO_PARAFISCALES,
    TipoDocumentoFormulario.CERTIFICADO_INHABILIDADES_E_INCOMPATIBILIDADES,
    TipoDocumentoFormulario.CERTIFICADO_CUENTA_BANCARIA,
];

const DOCUMENTOS_JURIDICA_MINIMA_CUANTIA: TipoDocumentoFormulario[] = [
    TipoDocumentoFormulario.RUT,
    TipoDocumentoFormulario.CEDULA,
    TipoDocumentoFormulario.CERTIFICADO_BANCARIO,
    TipoDocumentoFormulario.CERTIFICADO_EXPERIENCIA,
    TipoDocumentoFormulario.CERTIFICADO_DISCIPLINARIOS,
    TipoDocumentoFormulario.CERTIFICADO_RESPONSABILIDAD_FISCAL,
    TipoDocumentoFormulario.CERTIFICADO_ANTECEDENTES_JUDICIALES,
    TipoDocumentoFormulario.CERTIFICADO_MEDIDAS_CORRECTIVAS,
    TipoDocumentoFormulario.SEGURIDAD_SOCIAL_SALUD,
    TipoDocumentoFormulario.SEGURIDAD_SOCIAL_PENSION,
    TipoDocumentoFormulario.SEGURIDAD_SOCIAL_ARL,
    TipoDocumentoFormulario.PROPUESTA,
    TipoDocumentoFormulario.PANTALLAZO_SECOP,
];

@Injectable()
export class FormularioPublicoService {
    private readonly logger = new Logger(FormularioPublicoService.name);

    // ============================================================
    // ✅ GRUPOS DE DOCUMENTOS PARA COMBINAR
    // ============================================================
    private readonly gruposDocumentos = {

        CERTIFICADO_EXISTENCIA: {
            nombre: 'CERTIFICADO_EXISTENCIA',
            label: 'Certificado de Existencia y Representación',
            nombreArchivo: 'Certificado_de_Existencia_Representacion_Legal_y_Junta_Directiva_Sindical.pdf',
            tipos: [
                TipoDocumentoFormulario.CERTIFICADO_EXISTENCIA,
                TipoDocumentoFormulario.CERTIFICADO_REPRECENTACION_LEGAL,
                TipoDocumentoFormulario.CERTIFICADO_JUNTA_DIRECTIVA_SINDICAL,
            ]
        },

        // ✅ MODIFICADO: Ahora incluye los 4 certificados de Persona Natural
        //    ADEMÁS de los 6 de Persona Jurídica - Sindical
        CERTIFICADO_ANTECEDENTES: {
            nombre: 'CERTIFICADO_ANTECEDENTES',
            label: 'Certificado de Antecedentes',
            nombreArchivo: 'Antecedentes_Disciplinarios_Fiscales_Judiciales_y_Medidas_Correctivas.pdf',
            tipos: [
                // ✅ PERSONA NATURAL (4 documentos)
                TipoDocumentoFormulario.CERTIFICADO_DISCIPLINARIOS,
                TipoDocumentoFormulario.CERTIFICADO_RESPONSABILIDAD_FISCAL,
                TipoDocumentoFormulario.CERTIFICADO_ANTECEDENTES_JUDICIALES,
                TipoDocumentoFormulario.CERTIFICADO_MEDIDAS_CORRECTIVAS,

                // ✅ PERSONA JURÍDICA - SINDICAL (6 documentos)
                TipoDocumentoFormulario.CERTIFICADO_DISCIPLINARIOS_PROCURADORIA_GENERAL_REPRECENTANTE_LEGAL,
                TipoDocumentoFormulario.CERTIFICADO_DISCIPLINARIOS_PROCURADORIA_GENERAL_SINDICATO,
                TipoDocumentoFormulario.CERTIFICADO_NO_BOLETIN_RESPONSABLE_FISCALES_CONTRALORIA_REPRESENTANTE_LEGAL,
                TipoDocumentoFormulario.CERTIFICADO_NO_BOLETIN_RESPONSABLE_FISCALES_CONTRALORIA_SINDICAL,
                // Nota: CERTIFICADO_ANTECEDENTES_JUDICIALES y CERTIFICADO_MEDIDAS_CORRECTIVAS
                // ya están listados arriba (Persona Natural), no se duplican
            ]
        },

        DECLARACION_BIENES: {
            nombre: 'DECLARACION_BIENES',
            label: 'Declaración de Bienes y Rentas',
            nombreArchivo: 'Forma_Unica_Declaracion_Bienes_Renta_y_Actividades_Economicas_Privadas.pdf',
            tipos: [
                TipoDocumentoFormulario.FORMA_UNICA_DECLARACION_BIENES_Y_RENTA,
                TipoDocumentoFormulario.ACTIVIDADES_ECONOMCIAS_PRIVADAS,
            ]
        },

        PAZ_SALVO: {
            nombre: 'PAZ_SALVO',
            label: 'Paz y Salvo de Seguridad Social y Parafiscales',
            nombreArchivo: 'Paz_y_Salvo_Salud_Pension_y_Parafiscales.pdf',
            tipos: [
                TipoDocumentoFormulario.PAZ_SALVO_SALUD,
                TipoDocumentoFormulario.PAZ_SALVO_PENSION,
                TipoDocumentoFormulario.PAZ_SALVO_PARAFISCALES,
            ]
        },

        SEGURIDAD_SOCIAL: {
            nombre: 'SEGURIDAD_SOCIAL',
            label: 'Seguridad Social',
            nombreArchivo: 'Seguridad_Social_Salud_Pension_ARL.pdf',
            tipos: [
                TipoDocumentoFormulario.SEGURIDAD_SOCIAL_SALUD,
                TipoDocumentoFormulario.SEGURIDAD_SOCIAL_PENSION,
                TipoDocumentoFormulario.SEGURIDAD_SOCIAL_ARL,
            ]
        }
    };

    constructor(
        @InjectRepository(FormularioPublico)
        private readonly formularioRepository: Repository<FormularioPublico>,
        @InjectRepository(DocumentoFormularioPublico)
        private readonly documentoRepository: Repository<DocumentoFormularioPublico>,
        private readonly storageService: StorageService,
        @Inject(forwardRef(() => ContratistaService))
        private readonly contratistaService: ContratistaService,
    ) { }

    private esPersonaJuridica(tipoContratista: string): boolean {
        return (tipoContratista || '').toUpperCase().includes('JURIDICA');
    }

    private obtenerTiposValidos(
        tipoContratista: string,
        subtipo?: string | null,
    ): TipoDocumentoFormulario[] {
        const tipoUpper = (tipoContratista || '').toUpperCase();

        if (tipoUpper.includes('JURIDICA')) {
            if (subtipo === 'sindical') return DOCUMENTOS_JURIDICA_SINDICAL;
            if (subtipo === 'minima_cuantia') return DOCUMENTOS_JURIDICA_MINIMA_CUANTIA;
            return [];
        }

        return DOCUMENTOS_PERSONA_NATURAL;
    }

    async crearFormulario(
        contratistaId: string,
        datos: {
            representanteLegal?: string;
            documentoRepresentante?: string;
            telefono?: string;
            direccion?: string;
            departamento?: string;
            ciudad?: string;
            tipoContratista?: string;
            subtipoJuridica?: string;
            cargo?: string;
            objetivoContrato?: string;
        },
        tokenUsado: string,
        ipOrigen?: string,
        userAgent?: string,
    ): Promise<FormularioPublico> {
        try {
            const existente = await this.formularioRepository.findOne({
                where: {
                    contratistaId,
                    estado: EstadoFormulario.PENDIENTE,
                },
            });

            if (existente) {
                this.logger.log(`⚠️ Ya existe un formulario pendiente para el contratista ${contratistaId}`);
                return this.actualizarFormulario(existente.id, datos);
            }

            const formulario = this.formularioRepository.create({
                contratistaId,
                representanteLegal: datos.representanteLegal,
                documentoRepresentante: datos.documentoRepresentante,
                telefono: datos.telefono,
                direccion: datos.direccion,
                departamento: datos.departamento,
                ciudad: datos.ciudad,
                tipoContratista: datos.tipoContratista,
                subtipoJuridica: datos.subtipoJuridica || null,
                cargo: datos.cargo,
                objetivoContrato: datos.objetivoContrato,
                tokenUsado,
                ipOrigen,
                userAgent,
                estado: EstadoFormulario.PENDIENTE,
                versionFormulario: '1.0',
                completado: false,
            });

            const saved = await this.formularioRepository.save(formulario);
            this.logger.log(`✅ Formulario creado: ${saved.id} para contratista ${contratistaId}`);
            return saved;
        } catch (error) {
            this.logger.error(`❌ Error creando formulario: ${error.message}`);
            throw error;
        }
    }

    async actualizarFormulario(
        formularioId: string,
        datos: any,
    ): Promise<FormularioPublico> {
        try {
            const formulario = await this.buscarPorId(formularioId);

            const camposPermitidos = [
                'representanteLegal',
                'documentoRepresentante',
                'telefono',
                'direccion',
                'departamento',
                'ciudad',
                'tipoContratista',
                'subtipoJuridica',
                'cargo',
                'objetivoContrato',
            ];

            camposPermitidos.forEach(key => {
                if (datos[key] !== undefined && datos[key] !== null) {
                    formulario[key] = datos[key];
                }
            });

            const updated = await this.formularioRepository.save(formulario);
            this.logger.log(`✅ Formulario actualizado: ${updated.id}`);
            return updated;
        } catch (error) {
            this.logger.error(`❌ Error actualizando formulario: ${error.message}`);
            throw error;
        }
    }

    async agregarDocumento(
        formularioId: string,
        tipo: TipoDocumentoFormulario,
        archivo: Express.Multer.File,
        subidoPor: string = 'contratista',
    ): Promise<DocumentoFormularioPublico> {
        try {
            const formulario = await this.buscarPorId(formularioId);

            const tiposValidos = this.obtenerTiposValidos(
                formulario.tipoContratista,
                formulario.subtipoJuridica,
            );

            if (tiposValidos.length === 0) {
                throw new BadRequestException(
                    'Debe seleccionar el subtipo de persona jurídica antes de subir documentos',
                );
            }

            if (!tiposValidos.includes(tipo)) {
                throw new BadRequestException(`Tipo de documento inválido: ${tipo}`);
            }

            const existente = await this.documentoRepository.findOne({
                where: {
                    formularioId,
                    tipo,
                },
            });

            if (existente) {
                await this.eliminarDocumento(existente.id);
                this.logger.log(`🔄 Reemplazando documento existente: ${tipo}`);
            }

            const documento = await this.guardarDocumentoIndividual(
                formularioId,
                tipo,
                archivo,
                subidoPor
            );

            await this.verificarYCombinarGrupo(formularioId, tipo);

            return documento;
        } catch (error) {
            this.logger.error(`❌ Error agregando documento: ${error.message}`);
            throw error;
        }
    }

    private async guardarDocumentoIndividual(
        formularioId: string,
        tipo: TipoDocumentoFormulario,
        archivo: Express.Multer.File,
        subidoPor: string,
    ): Promise<DocumentoFormularioPublico> {
        const extension = archivo.originalname.split('.').pop() || 'pdf';
        const timestamp = Date.now();
        const hash = crypto.randomBytes(8).toString('hex');
        const nombreUnico = `${tipo}_${timestamp}_${hash}.${extension}`;

        const folder = `formularios/${formularioId}/individuales`;
        const result = await this.storageService.uploadFile(
            `${folder}/${nombreUnico}`,
            archivo.buffer,
            archivo.mimetype,
        );

        const nombreArchivo = `${tipo}.pdf`;

        const documento = this.documentoRepository.create({
            formularioId,
            tipo,
            nombreArchivo,
            rutaArchivo: result.path,
            tipoMime: archivo.mimetype,
            tamanoBytes: archivo.size,
            subidoPor,
            hashArchivo: this.calcularHash(archivo.buffer),
            esCombinado: false,
        });

        const saved = await this.documentoRepository.save(documento);
        this.logger.log(`✅ Documento individual guardado: ${tipo} - nombreArchivo: "${nombreArchivo}" - esCombinado: false`);
        return saved;
    }

    /**
     * ✅ MODIFICADO: Ahora filtra los tipos del grupo que aplican
     *    al tipo de contratista actual antes de validar completitud
     */
    private async verificarYCombinarGrupo(
        formularioId: string,
        tipo: TipoDocumentoFormulario,
    ): Promise<void> {
        let grupoEncontrado = null;
        let nombreGrupo = '';

        for (const [key, grupo] of Object.entries(this.gruposDocumentos)) {
            if (grupo.tipos.includes(tipo)) {
                grupoEncontrado = grupo;
                nombreGrupo = key;
                break;
            }
        }

        if (!grupoEncontrado) {
            this.logger.log(`📄 Tipo ${tipo} es individual, no se combina`);
            return;
        }

        // ✅ Obtener el formulario para saber el tipo de contratista
        const formulario = await this.buscarPorId(formularioId);

        // ✅ Obtener los tipos válidos para este tipo de contratista
        const tiposValidos = this.obtenerTiposValidos(
            formulario.tipoContratista,
            formulario.subtipoJuridica,
        );

        // ✅ Filtrar los tipos del grupo que aplican al tipo de contratista
        const tiposDelGrupoQueAplican = grupoEncontrado.tipos.filter(t =>
            tiposValidos.includes(t)
        );

        this.logger.log(`🔍 Grupo ${nombreGrupo} - Tipos del grupo: ${grupoEncontrado.tipos.length}, Tipos que aplican: ${tiposDelGrupoQueAplican.length}`);

        // ✅ Buscar solo los documentos que aplican
        const documentosDelGrupo = await this.documentoRepository.find({
            where: {
                formularioId,
                tipo: In(tiposDelGrupoQueAplican),
            },
            order: { tipo: 'ASC' },
        });

        const tiposSubidos = documentosDelGrupo.map(d => d.tipo);

        // ✅ Validar que TODOS los tipos que aplican estén subidos
        const todosPresentes = tiposDelGrupoQueAplican.every(t => tiposSubidos.includes(t));

        if (!todosPresentes) {
            const faltantes = tiposDelGrupoQueAplican.filter(t => !tiposSubidos.includes(t));
            this.logger.log(`⏳ Grupo ${nombreGrupo} incompleto. Faltan: ${faltantes.join(', ')}`);
            return;
        }

        this.logger.log(`📦 Combinando ${documentosDelGrupo.length} documentos del grupo ${nombreGrupo}...`);

        try {
            const pdfCombinado = await this.combinarPDFs(documentosDelGrupo);

            const folder = `formularios/${formularioId}/combinados`;
            const nombreCombinado = `${nombreGrupo}_${Date.now()}.pdf`;

            const result = await this.storageService.uploadFile(
                `${folder}/${nombreCombinado}`,
                pdfCombinado,
                'application/pdf',
            );

            const combinadoExistente = await this.documentoRepository.findOne({
                where: {
                    formularioId,
                    tipo: nombreGrupo as any,
                },
            });

            if (combinadoExistente) {
                await this.storageService.deleteFile(combinadoExistente.rutaArchivo);
                await this.documentoRepository.delete(combinadoExistente.id);
                this.logger.log(`🔄 Combinado anterior eliminado: ${nombreGrupo}`);
            }

            const documentoCombinado = this.documentoRepository.create({
                formularioId,
                tipo: nombreGrupo as any,
                nombreArchivo: grupoEncontrado.nombreArchivo,
                rutaArchivo: result.path,
                tipoMime: 'application/pdf',
                tamanoBytes: pdfCombinado.length,
                subidoPor: 'sistema',
                hashArchivo: this.calcularHash(pdfCombinado),
                esCombinado: true,
            });

            await this.documentoRepository.save(documentoCombinado);
            this.logger.log(`✅ PDF combinado guardado: ${nombreGrupo} - nombreArchivo: "${grupoEncontrado.nombreArchivo}" - esCombinado: true`);

        } catch (error) {
            this.logger.error(`❌ Error combinando PDFs del grupo ${nombreGrupo}: ${error.message}`);
            throw error;
        }
    }

    private async combinarPDFs(documentos: DocumentoFormularioPublico[]): Promise<Buffer> {
        const pdfDoc = await PDFDocument.create();

        for (const doc of documentos) {
            try {
                const buffer = await this.storageService.getFile(doc.rutaArchivo);
                const pdf = await PDFDocument.load(buffer);
                const indices = pdf.getPageIndices();
                const copias = await pdfDoc.copyPages(pdf, indices);
                copias.forEach(page => pdfDoc.addPage(page));
                this.logger.log(`✅ Páginas copiadas de: ${doc.tipo} (${indices.length} páginas)`);
            } catch (error) {
                this.logger.error(`❌ Error combinando documento ${doc.id}: ${error.message}`);
            }
        }

        const pdfBytes = await pdfDoc.save();
        return Buffer.from(pdfBytes);
    }

    async obtenerDocumentoCombinado(
        formularioId: string,
        grupoNombre: string,
    ): Promise<DocumentoFormularioPublico | null> {
        return this.documentoRepository.findOne({
            where: {
                formularioId,
                tipo: grupoNombre as any,
                esCombinado: true,
            },
        });
    }

    /**
     * ✅ MODIFICADO: Ahora filtra los tipos del grupo que aplican
     *    al tipo de contratista actual
     */
    async obtenerEstadoGrupos(formularioId: string): Promise<any> {
        const resultado = {};
        const formulario = await this.buscarPorId(formularioId);

        const tiposValidos = this.obtenerTiposValidos(
            formulario.tipoContratista,
            formulario.subtipoJuridica,
        );

        for (const [key, grupo] of Object.entries(this.gruposDocumentos)) {
            // ✅ Filtrar tipos que aplican a este contratista
            const tiposDelGrupoQueAplican = grupo.tipos.filter(t =>
                tiposValidos.includes(t)
            );

            // ✅ Si no aplica ningún tipo del grupo, saltarlo
            if (tiposDelGrupoQueAplican.length === 0) {
                continue;
            }

            const documentos = await this.documentoRepository.find({
                where: {
                    formularioId,
                    tipo: In(tiposDelGrupoQueAplican),
                },
            });

            const tiposSubidos = documentos.map(d => d.tipo);
            const completado = tiposDelGrupoQueAplican.every(t => tiposSubidos.includes(t));
            const combinado = await this.obtenerDocumentoCombinado(formularioId, key);

            resultado[key] = {
                label: grupo.label,
                nombreArchivo: grupo.nombreArchivo,
                completado,
                documentosSubidos: documentos.length,
                totalRequeridos: tiposDelGrupoQueAplican.length,
                combinadoExiste: !!combinado,
                combinadoId: combinado?.id || null,
                tipos: tiposDelGrupoQueAplican,
            };
        }

        return resultado;
    }

    async descargarDocumentoCombinado(
        formularioId: string,
        grupoNombre: string,
    ): Promise<{ buffer: Buffer; nombre: string; mimeType: string }> {
        const documento = await this.obtenerDocumentoCombinado(formularioId, grupoNombre);

        if (!documento) {
            throw new NotFoundException(`Documento combinado ${grupoNombre} no encontrado`);
        }

        const buffer = await this.storageService.getFile(documento.rutaArchivo);

        const grupo = this.gruposDocumentos[grupoNombre];

        return {
            buffer,
            nombre: grupo?.nombreArchivo || `${grupoNombre}.pdf`,
            mimeType: 'application/pdf',
        };
    }

    async completarFormulario(formularioId: string): Promise<FormularioPublico> {
        try {
            const formulario = await this.buscarPorId(formularioId);

            const documentos = await this.obtenerDocumentos(formularioId);
            const tiposSubidos = documentos.map(doc => doc.tipo);

            const tiposRequeridos = this.obtenerTiposValidos(
                formulario.tipoContratista,
                formulario.subtipoJuridica,
            );

            if (tiposRequeridos.length === 0) {
                throw new BadRequestException('Debe seleccionar el subtipo de persona jurídica');
            }

            const faltantes = tiposRequeridos.filter(t => !tiposSubidos.includes(t));

            if (faltantes.length > 0) {
                throw new BadRequestException(
                    `Faltan documentos requeridos: ${faltantes.join(', ')}`
                );
            }

            const estadoGrupos = await this.obtenerEstadoGrupos(formularioId);
            const gruposIncompletos = Object.entries(estadoGrupos)
                .filter(([key, value]: [string, any]) => value.completado && !value.combinadoExiste)
                .map(([key]) => key);

            if (gruposIncompletos.length > 0) {
                this.logger.warn(`⚠️ Grupos sin combinar: ${gruposIncompletos.join(', ')}`);
                for (const grupo of gruposIncompletos) {
                    await this.forzarCombinacionGrupo(formularioId, grupo);
                }
            }

            formulario.completado = true;
            formulario.fechaCompletado = new Date();
            formulario.estado = EstadoFormulario.COMPLETADO;

            const updated = await this.formularioRepository.save(formulario);
            this.logger.log(`✅ Formulario completado: ${updated.id}`);
            return updated;
        } catch (error) {
            this.logger.error(`❌ Error completando formulario: ${error.message}`);
            throw error;
        }
    }

    /**
     * ✅ MODIFICADO: Ahora filtra los tipos del grupo que aplican
     *    al tipo de contratista actual
     */
    async forzarCombinacionGrupo(formularioId: string, grupoNombre: string): Promise<void> {
        const grupo = this.gruposDocumentos[grupoNombre];
        if (!grupo) {
            throw new NotFoundException(`Grupo ${grupoNombre} no encontrado`);
        }

        // ✅ Obtener el formulario para saber el tipo de contratista
        const formulario = await this.buscarPorId(formularioId);

        // ✅ Obtener los tipos válidos para este tipo de contratista
        const tiposValidos = this.obtenerTiposValidos(
            formulario.tipoContratista,
            formulario.subtipoJuridica,
        );

        // ✅ Filtrar los tipos del grupo que aplican al tipo de contratista
        const tiposDelGrupoQueAplican = grupo.tipos.filter(t =>
            tiposValidos.includes(t)
        );

        const documentosDelGrupo = await this.documentoRepository.find({
            where: {
                formularioId,
                tipo: In(tiposDelGrupoQueAplican),
            },
            order: { tipo: 'ASC' },
        });

        const tiposSubidos = documentosDelGrupo.map(d => d.tipo);
        const todosPresentes = tiposDelGrupoQueAplican.every(t => tiposSubidos.includes(t));

        if (!todosPresentes) {
            throw new BadRequestException(
                `No todos los documentos del grupo ${grupoNombre} están subidos`
            );
        }

        const pdfCombinado = await this.combinarPDFs(documentosDelGrupo);

        const folder = `formularios/${formularioId}/combinados`;
        const nombreCombinado = `${grupoNombre}_${Date.now()}.pdf`;

        const result = await this.storageService.uploadFile(
            `${folder}/${nombreCombinado}`,
            pdfCombinado,
            'application/pdf',
        );

        const combinadoExistente = await this.documentoRepository.findOne({
            where: {
                formularioId,
                tipo: grupoNombre as any,
            },
        });

        if (combinadoExistente) {
            await this.storageService.deleteFile(combinadoExistente.rutaArchivo);
            await this.documentoRepository.delete(combinadoExistente.id);
        }

        const documentoCombinado = this.documentoRepository.create({
            formularioId,
            tipo: grupoNombre as any,
            nombreArchivo: grupo.nombreArchivo,
            rutaArchivo: result.path,
            tipoMime: 'application/pdf',
            tamanoBytes: pdfCombinado.length,
            subidoPor: 'sistema',
            hashArchivo: this.calcularHash(pdfCombinado),
            esCombinado: true,
        });

        await this.documentoRepository.save(documentoCombinado);
        this.logger.log(`✅ PDF combinado forzado: ${grupoNombre} - nombreArchivo: "${grupo.nombreArchivo}"`);
    }

    async buscarPorId(id: string): Promise<FormularioPublico> {
        const formulario = await this.formularioRepository.findOne({
            where: { id },
            relations: ['documentos'],
        });

        if (!formulario) {
            throw new NotFoundException(`Formulario con ID ${id} no encontrado`);
        }

        return formulario;
    }

    async buscarPorContratista(contratistaId: string): Promise<FormularioPublico[]> {
        return this.formularioRepository.find({
            where: { contratistaId },
            relations: ['documentos'],
            order: { createdAt: 'DESC' },
        });
    }

    async buscarActivoPorContratista(contratistaId: string): Promise<FormularioPublico | null> {
        return this.formularioRepository.findOne({
            where: {
                contratistaId,
                estado: EstadoFormulario.PENDIENTE,
            },
            relations: ['documentos'],
        });
    }

    async obtenerDocumentoPorId(documentoId: string): Promise<DocumentoFormularioPublico> {
        const documento = await this.documentoRepository.findOne({
            where: { id: documentoId },
        });

        if (!documento) {
            throw new NotFoundException(`Documento ${documentoId} no encontrado`);
        }

        return documento;
    }

    async eliminarDocumento(documentoId: string): Promise<void> {
        try {
            const documento = await this.documentoRepository.findOne({
                where: { id: documentoId },
            });

            if (!documento) {
                throw new NotFoundException(`Documento ${documentoId} no encontrado`);
            }

            await this.storageService.deleteFile(documento.rutaArchivo);
            await this.documentoRepository.delete(documentoId);
            this.logger.log(`✅ Documento eliminado: ${documentoId}`);
        } catch (error) {
            this.logger.error(`❌ Error eliminando documento: ${error.message}`);
            throw error;
        }
    }

    async estaCompleto(formularioId: string): Promise<boolean> {
        const formulario = await this.buscarPorId(formularioId);
        const documentos = await this.obtenerDocumentos(formularioId);
        const tiposSubidos = documentos.map(doc => doc.tipo);

        const tiposRequeridos = this.obtenerTiposValidos(
            formulario.tipoContratista,
            formulario.subtipoJuridica,
        );

        if (tiposRequeridos.length === 0) return false;

        return tiposRequeridos.every(t => tiposSubidos.includes(t));
    }

    private calcularHash(buffer: Buffer): string {
        return crypto.createHash('sha256').update(buffer).digest('hex');
    }

    async listarPendientesAprobacion(): Promise<any[]> {
        this.logger.log('🔍 Buscando formularios pendientes de aprobación...');

        const formularios = await this.formularioRepository.find({
            where: [
                { estado: EstadoFormulario.COMPLETADO },
                { estado: EstadoFormulario.EN_REVISION },
            ],
            relations: ['documentos'],
            order: { fechaCompletado: 'DESC' },
        });

        this.logger.log(`📊 Encontrados ${formularios.length} formularios en BD`);

        const resultado = [];
        for (const formulario of formularios) {
            this.logger.log(`📋 Procesando formulario: ${formulario.id} - Estado: ${formulario.estado}`);

            const estadoGrupos = await this.obtenerEstadoGrupos(formulario.id);
            const documentos = await this.obtenerDocumentos(formulario.id);

            let contratistaNombre = 'N/A';
            let contratistaDocumento = 'N/A';
            let contratistaTipo = 'N/A';

            try {
                if (formulario.contratistaId) {
                    this.logger.log(`🔍 Buscando contratista: ${formulario.contratistaId}`);
                    const contratista = await this.contratistaService.buscarPorId(formulario.contratistaId);
                    if (contratista) {
                        contratistaNombre = contratista.razonSocial || 'N/A';
                        contratistaDocumento = contratista.documentoIdentidad || 'N/A';

                        contratistaTipo =
                            formulario.tipoContratista ||
                            contratista.tipoContratista ||
                            'N/A';

                        this.logger.log(`✅ Contratista encontrado: ${contratistaNombre}`);
                    }
                }
            } catch (error) {
                this.logger.warn(`⚠️ Contratista ${formulario.contratistaId} no encontrado: ${error.message}`);
                contratistaNombre = formulario.representanteLegal || 'N/A';
                contratistaDocumento = formulario.documentoRepresentante || 'N/A';
                contratistaTipo = formulario.tipoContratista || 'N/A';
            }

            resultado.push({
                ...formulario,
                estadoGrupos,
                totalDocumentos: documentos.length,
                contratistaNombre,
                contratistaDocumento,
                contratistaTipo,
                representanteLegal: formulario.representanteLegal,
                documentoRepresentante: formulario.documentoRepresentante,
            });
        }

        this.logger.log(`✅ Retornando ${resultado.length} formularios enriquecidos`);
        return resultado;
    }

    async obtenerDocumentos(formularioId: string): Promise<DocumentoFormularioPublico[]> {
        return this.documentoRepository.find({
            where: { formularioId },
            order: { fechaSubida: 'DESC' },
        });
    }

    async obtenerDetalleAprobacion(formularioId: string): Promise<any> {
        this.logger.log(`🔍 Obteniendo detalle del formulario: ${formularioId}`);

        const formulario = await this.buscarPorId(formularioId);

        if (!formulario) {
            throw new NotFoundException(`Formulario ${formularioId} no encontrado`);
        }

        const documentos = await this.documentoRepository.find({
            where: { formularioId },
            order: { fechaSubida: 'DESC' },
        });

        this.logger.log(`📄 Total de documentos encontrados: ${documentos.length}`);

        const nombrePorTipo: Record<string, string> = {
            // ============================================================
            // ✅ DOCUMENTOS COMBINADOS (grupos) - SOLO UNA VEZ
            // ============================================================
            'CERTIFICADO_EXISTENCIA': 'Certificado de Existencia y Representación (Combinado)',
            'CERTIFICADO_ANTECEDENTES': 'Certificado de Antecedentes (Combinado)',
            'DECLARACION_BIENES': 'Declaración de Bienes y Rentas (Combinado)',
            'PAZ_SALVO': 'Paz y Salvo de Seguridad Social y Parafiscales (Combinado)',
            'SEGURIDAD_SOCIAL': 'Seguridad Social (Combinado)',

            // ============================================================
            // ✅ PERSONA NATURAL - Individuales
            // ============================================================
            'CEDULA': 'Cédula de Ciudadanía',
            'RUT': 'RUT',
            'LIBRETA_MILITAR': 'Libreta Militar',
            'CERTIFICADO_DISCIPLINARIOS': 'Certificado de Antecedentes Disciplinarios',
            'CERTIFICADO_RESPONSABILIDAD_FISCAL': 'Certificado de Responsabilidad Fiscal',
            'CERTIFICADO_ANTECEDENTES_JUDICIALES': 'Certificado de Antecedentes Judiciales',
            'CERTIFICADO_MEDIDAS_CORRECTIVAS': 'Certificado de Medidas Correctivas',
            'SEGURIDAD_SOCIAL_SALUD': 'Seguridad Social - Salud',
            'SEGURIDAD_SOCIAL_PENSION': 'Seguridad Social - Pensión',
            'SEGURIDAD_SOCIAL_ARL': 'Seguridad Social - ARL',
            'CERTIFICADO_BANCARIO': 'Certificado Bancario',
            'CERTIFICADO_EXPERIENCIA': 'Certificado de Experiencia',
            'CERTIFICADO_NO_PLANTA': 'Certificado No Planta',
            'CERTIFICADO_IDONEIDAD': 'Certificado de Idoneidad',
            'DECLARACION_INHABILIDADES': 'Declaración de Inhabilidades',
            'EXAMEN_INGRESO': 'Examen de Ingreso',
            'GARANTIA': 'Garantía',
            'HOJA_VIDA_SIGEP': 'Hoja de Vida SIGEP',
            'PANTALLAZO_SECOP': 'Pantallazo SECOP',
            'PROPUESTA': 'Propuesta',
            'PUBLICACION_GT': 'Publicación GT',
            'REDAM': 'REDAM',
            'SARLAFT': 'SARLAFT',
            'TARJETA_PROFESIONAL': 'Tarjeta Profesional',
            'CERTIFICADO_INHABILIDADES_E_INCOMPATIBILIDADES': 'Certificado de Inhabilidades e Incompatibilidades',
            'CERTIFICADO_CUENTA_BANCARIA': 'Certificado de Cuenta Bancaria',

            // ============================================================
            // ✅ PERSONA JURÍDICA - Individuales
            // ============================================================
            'COTIZACION_UNO': 'Cotización 1',
            'COTIZACION_DOS': 'Cotización 2',
            'COTIZACION_TRES': 'Cotización 3',
            'HOJA_VIDA_PERSONA_JURIDICA': 'Hoja de Vida Persona Jurídica',
            'CERTIFICADO_REPRECENTACION_LEGAL': 'Certificado de Representación Legal',
            'PROPUESTA_SINDICATO': 'Propuesta del Sindicato',
            'ACTA_INSCRIPCION_VIGENCIA': 'Acta de Inscripción y Vigencia',
            'CERTIFICADO_JUNTA_DIRECTIVA_SINDICAL': 'Certificado Junta Directiva Sindical',
            'CERTIFICADO_DISCIPLINARIOS_PROCURADORIA_GENERAL_REPRECENTANTE_LEGAL': 'Antecedentes Disciplinarios Procuraduría - Representante Legal',
            'CERTIFICADO_DISCIPLINARIOS_PROCURADORIA_GENERAL_SINDICATO': 'Antecedentes Disciplinarios Procuraduría - Sindicato',
            'CERTIFICADO_NO_BOLETIN_RESPONSABLE_FISCALES_CONTRALORIA_REPRESENTANTE_LEGAL': 'No Boletín Responsabilidad Fiscal - Representante Legal',
            'CERTIFICADO_NO_BOLETIN_RESPONSABLE_FISCALES_CONTRALORIA_SINDICAL': 'No Boletín Responsabilidad Fiscal - Sindical',
            'FORMA_UNICA_DECLARACION_BIENES_Y_RENTA': 'Formulario Único de Declaración de Bienes y Renta',
            'ACTIVIDADES_ECONOMCIAS_PRIVADAS': 'Actividades Económicas Privadas',
            'PAZ_SALVO_SALUD': 'Paz y Salvo de Salud',
            'PAZ_SALVO_PENSION': 'Paz y Salvo de Pensión',
            'PAZ_SALVO_PARAFISCALES': 'Paz y Salvo de Parafiscales',
            'CC_CONTADOR': 'Cédula del Contador',
            'TARJETA_PROFESIONAL_CONTADOR': 'Tarjeta Profesional del Contador',
            'CERTIFICADO_JUNTA_CENTRAL_CONTADORES': 'Certificado Junta Central de Contadores',
        };

        this.logger.log('📋 LISTA DE DOCUMENTOS CON NOMBRES REALES:');
        documentos.forEach((doc, index) => {
            this.logger.log(`   ${index + 1}. ${doc.tipo} -> nombreArchivo: "${doc.nombreArchivo}" | esCombinado: ${doc.esCombinado}`);
        });

        const estadoGrupos = await this.obtenerEstadoGrupos(formularioId);

        const documentosMapeados = documentos.map(doc => {
            let nombreArchivo = doc.nombreArchivo;

            const esNombreGenerico =
                nombreArchivo === 'Cuenta de cobro.pdf' ||
                nombreArchivo === 'fv08909051770002500601888.pdf';

            if (esNombreGenerico && !doc.esCombinado) {
                const nombreBase = nombrePorTipo[doc.tipo] || doc.tipo.replace(/_/g, ' ').toLowerCase();
                const extension = '.pdf';
                const nombreLimpio = nombreBase.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s-]/g, '').trim();
                const nombreFormateado = nombreLimpio.replace(/\s+/g, '_');
                nombreArchivo = `${nombreFormateado}${extension}`;

                this.logger.log(`🔄 Corrigiendo nombre para ${doc.tipo}: "${doc.nombreArchivo}" -> "${nombreArchivo}"`);
            }

            return {
                id: doc.id,
                tipo: doc.tipo,
                nombreArchivo: nombreArchivo,
                rutaArchivo: doc.rutaArchivo,
                tipoMime: doc.tipoMime,
                tamanoBytes: doc.tamanoBytes,
                subidoPor: doc.subidoPor,
                fechaSubida: doc.fechaSubida,
                esCombinado: doc.esCombinado || false,
                hashArchivo: doc.hashArchivo,
            };
        });

        this.logger.log('📋 DOCUMENTOS MAPEADOS PARA EL FRONTEND:');
        documentosMapeados.forEach((doc, index) => {
            this.logger.log(`   ${index + 1}. ${doc.tipo} -> nombreArchivo: "${doc.nombreArchivo}"`);
        });

        const documentosPorTipo = {};
        for (const doc of documentosMapeados) {
            if (!documentosPorTipo[doc.tipo]) {
                documentosPorTipo[doc.tipo] = [];
            }
            documentosPorTipo[doc.tipo].push(doc);
        }

        let contratista = null;
        let email = '';
        let telefono = '';

        try {
            if (formulario.contratistaId) {
                contratista = await this.contratistaService.buscarPorId(formulario.contratistaId);
                this.logger.log(`✅ Contratista encontrado: ${contratista.razonSocial}`);

                if (contratista) {
                    email = contratista.email || '';
                    telefono = contratista.telefono || formulario.telefono || '';
                }
            }
        } catch (error) {
            this.logger.warn(`⚠️ No se pudo obtener el contratista: ${error.message}`);
            contratista = {
                razonSocial: formulario.representanteLegal || 'N/A',
                documentoIdentidad: formulario.documentoRepresentante || 'N/A',
                tipoContratista: formulario.tipoContratista || 'N/A',
            };
            email = '';
            telefono = formulario.telefono || '';
        }

        const resultado = {
            formulario,
            contratista,
            documentos: documentosMapeados,
            documentosPorTipo,
            estadoGrupos,
            totalDocumentos: documentos.length,
            fechaCompletado: formulario.fechaCompletado,
            fechaCreacion: formulario.createdAt,
            email: email,
            telefono: telefono,
            _debug: {
                totalDocumentos: documentos.length,
                nombresCorregidos: documentosMapeados.map(d => ({
                    tipo: d.tipo,
                    nombreArchivo: d.nombreArchivo,
                    esCombinado: d.esCombinado
                }))
            }
        };

        this.logger.log(`✅ Detalle del formulario ${formularioId} preparado con ${documentosMapeados.length} documentos`);

        return resultado;
    }

    async aprobarFormulario(
        formularioId: string,
        observaciones?: string,
        numeroContrato?: string
    ): Promise<FormularioPublico> {
        const formulario = await this.buscarPorId(formularioId);

        if (!formulario) {
            throw new NotFoundException(`Formulario ${formularioId} no encontrado`);
        }

        if (formulario.estado === EstadoFormulario.APROBADO) {
            throw new BadRequestException('Este formulario ya está aprobado');
        }

        let contratistaExistente = null;
        const contratistaId = formulario.contratistaId;

        try {
            contratistaExistente = await this.contratistaService.buscarPorId(contratistaId);
        } catch (error) {
            this.logger.warn(`⚠️ Contratista ${contratistaId} no encontrado, se creará uno nuevo`);
        }

        let documentoIdentidad = '0000000000';
        if (contratistaExistente) {
            documentoIdentidad = contratistaExistente.documentoIdentidad;
        } else if (formulario.documentoRepresentante) {
            documentoIdentidad = formulario.documentoRepresentante;
        }

        this.logger.log(`📋 Documento del contratista: ${documentoIdentidad}`);

        const contratistasActivos = await this.contratistaService.buscarPorDocumentoExacto(documentoIdentidad);

        if (contratistasActivos && contratistasActivos.length > 0) {
            this.logger.log(`🔍 Encontrados ${contratistasActivos.length} contratistas ACTIVOS con documento ${documentoIdentidad}`);

            for (const contratista of contratistasActivos) {
                if (contratista.estado === 'ACTIVO') {
                    this.logger.log(`⚠️ Desactivando contratista: ${contratista.id} - ${contratista.razonSocial} (Contrato: ${contratista.numeroContrato})`);
                    await this.contratistaService.actualizar(contratista.id, {
                        estado: 'INACTIVO'
                    });
                    this.logger.log(`✅ Contratista ${contratista.id} desactivado`);
                }
            }
        }

        let contratoFinal = numeroContrato;

        if (!contratoFinal) {
            contratoFinal = `PS-${Date.now().toString().slice(-4)}-${Math.floor(Math.random() * 1000)}`;
            this.logger.log(`⚠️ No se proporcionó número de contrato, generando: ${contratoFinal}`);
        } else {
            const contratoExistente = await this.contratistaService.buscarPorNumeroContratoExacto(contratoFinal);
            if (contratoExistente && contratoExistente.estado === 'ACTIVO') {
                throw new BadRequestException(`El número de contrato "${contratoFinal}" ya está en uso por un contratista activo.`);
            }
        }

        this.logger.log(`📋 Número de contrato a usar: ${contratoFinal}`);

        let datosContratista: any = {};

        if (contratistaExistente) {
            datosContratista = {
                tipoDocumento: contratistaExistente.tipoDocumento || 'CC',
                documentoIdentidad: contratistaExistente.documentoIdentidad,
                razonSocial: contratistaExistente.razonSocial,
                representanteLegal: contratistaExistente.representanteLegal || formulario.representanteLegal,
                documentoRepresentante: contratistaExistente.documentoRepresentante || formulario.documentoRepresentante,
                telefono: contratistaExistente.telefono || formulario.telefono,
                email: contratistaExistente.email || '',
                direccion: contratistaExistente.direccion || formulario.direccion,
                departamento: contratistaExistente.departamento || formulario.departamento,
                ciudad: contratistaExistente.ciudad || formulario.ciudad,
                tipoContratista: formulario.tipoContratista || contratistaExistente.tipoContratista,
                subtipoJuridica: formulario.subtipoJuridica,
                estado: 'ACTIVO',
                numeroContrato: contratoFinal,
                cargo: contratistaExistente.cargo || formulario.cargo,
                objetivoContrato: contratistaExistente.objetivoContrato || formulario.objetivoContrato
            };
        } else {
            datosContratista = {
                tipoDocumento: 'CC',
                documentoIdentidad: documentoIdentidad,
                razonSocial: formulario.representanteLegal || 'Contratista',
                representanteLegal: formulario.representanteLegal || '',
                documentoRepresentante: formulario.documentoRepresentante || '',
                telefono: formulario.telefono || '',
                email: '',
                direccion: formulario.direccion || '',
                departamento: formulario.departamento || '',
                ciudad: formulario.ciudad || '',
                tipoContratista: formulario.tipoContratista || '',
                subtipoJuridica: formulario.subtipoJuridica,
                estado: 'ACTIVO',
                numeroContrato: contratoFinal,
                cargo: formulario.cargo || '',
                objetivoContrato: formulario.objetivoContrato || ''
            };
        }

        this.logger.log(`📝 Creando NUEVO contratista con documento: ${datosContratista.documentoIdentidad} y contrato: ${contratoFinal}`);

        const nuevoContratista = await this.contratistaService.crearSinValidacion(datosContratista);
        this.logger.log(`✅ Nuevo contratista creado: ${nuevoContratista.id} - ${nuevoContratista.razonSocial} (Contrato: ${contratoFinal})`);

        formulario.contratistaId = nuevoContratista.id;

        const documentosFormulario = await this.obtenerDocumentos(formularioId);

        this.logger.log(`📋 Encontrados ${documentosFormulario.length} documentos para copiar al nuevo contratista`);

        for (const doc of documentosFormulario) {
            try {
                this.logger.log(`📄 Copiando ${doc.tipo} (esCombinado: ${doc.esCombinado}) al nuevo contratista...`);

                const buffer = await this.storageService.getFile(doc.rutaArchivo);

                const extension = doc.nombreArchivo.split('.').pop() || 'pdf';
                const timestamp = Date.now();

                const nombreBase = doc.esCombinado && doc.nombreArchivo
                    ? doc.nombreArchivo.replace('.pdf', '')
                    : doc.tipo;

                const nombreUnico = `${nombreBase}_${timestamp}.${extension}`;

                const folderName = nuevoContratista.numeroContrato
                    ? `${nuevoContratista.numeroContrato}_${nuevoContratista.razonSocial.replace(/[^a-zA-Z0-9]/g, '_')}`
                    : `${nuevoContratista.id}`;
                const folder = `contratistas/${folderName}`;
                const filePath = `${folder}/${nombreUnico}`;

                const result = await this.storageService.uploadFile(
                    filePath,
                    buffer,
                    'application/pdf'
                );

                const nuevoDocumento = new DocumentoContratista();
                nuevoDocumento.contratistaId = nuevoContratista.id;
                nuevoDocumento.tipo = String(doc.tipo) as any;
                nuevoDocumento.nombreArchivo = doc.nombreArchivo || nombreUnico;
                nuevoDocumento.rutaArchivo = result.path;
                nuevoDocumento.tipoMime = 'application/pdf';
                nuevoDocumento.tamanoBytes = buffer.length;
                nuevoDocumento.subidoPor = 'sistema';
                nuevoDocumento.esCombinado = doc.esCombinado === true;

                await this.contratistaService['documentoRepository'].save(nuevoDocumento);

                this.logger.log(`✅ ${doc.tipo} copiado al nuevo contratista ${nuevoContratista.id} como "${nuevoDocumento.nombreArchivo}"`);
            } catch (error) {
                this.logger.error(`❌ Error copiando ${doc.tipo}: ${error.message}`);
            }
        }

        formulario.estado = EstadoFormulario.APROBADO;
        formulario.fechaEnvio = new Date();

        const updated = await this.formularioRepository.save(formulario);
        this.logger.log(`✅ Formulario ${formularioId} aprobado con contrato ${contratoFinal}`);

        return updated;
    }

    async obtenerBufferDocumento(documentoId: string): Promise<Buffer> {
        const documento = await this.obtenerDocumentoPorId(documentoId);
        return this.storageService.getFile(documento.rutaArchivo);
    }

    async rechazarFormulario(formularioId: string, motivo: string): Promise<FormularioPublico> {
        const formulario = await this.buscarPorId(formularioId);

        if (!formulario) {
            throw new NotFoundException(`Formulario ${formularioId} no encontrado`);
        }

        if (formulario.estado === EstadoFormulario.RECHAZADO) {
            throw new BadRequestException('Este formulario ya está rechazado');
        }

        formulario.estado = EstadoFormulario.RECHAZADO;

        const updated = await this.formularioRepository.save(formulario);
        this.logger.log(`❌ Formulario ${formularioId} rechazado: ${motivo}`);
        return updated;
    }
}