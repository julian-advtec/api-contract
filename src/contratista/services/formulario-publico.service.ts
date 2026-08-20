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

@Injectable()
export class FormularioPublicoService {
    private readonly logger = new Logger(FormularioPublicoService.name);

    // ✅ Grupos de documentos para combinar
    private readonly gruposDocumentos = {
        CERTIFICADO_ANTECEDENTES: {
            nombre: 'CERTIFICADO_ANTECEDENTES',
            label: 'Certificado de Antecedentes',
            tipos: [
                TipoDocumentoFormulario.CERTIFICADO_DISCIPLINARIOS,
                TipoDocumentoFormulario.CERTIFICADO_RESPONSABILIDAD_FISCAL,
                TipoDocumentoFormulario.CERTIFICADO_ANTECEDENTES_JUDICIALES,
                TipoDocumentoFormulario.CERTIFICADO_MEDIDAS_CORRECTIVAS,
            ]
        },
        SEGURIDAD_SOCIAL: {
            nombre: 'SEGURIDAD_SOCIAL',
            label: 'Seguridad Social',
            tipos: [
                TipoDocumentoFormulario.SEGURIDAD_SOCIAL_SALUD,
                TipoDocumentoFormulario.SEGURIDAD_SOCIAL_PENSION,
                TipoDocumentoFormulario.SEGURIDAD_SOCIAL_ARL,
            ]
        }
    };

    // ✅ Todos los tipos válidos (solo los 7 que existen en el enum)
    private readonly tiposValidos = [
        TipoDocumentoFormulario.CERTIFICADO_DISCIPLINARIOS,
        TipoDocumentoFormulario.CERTIFICADO_RESPONSABILIDAD_FISCAL,
        TipoDocumentoFormulario.CERTIFICADO_ANTECEDENTES_JUDICIALES,
        TipoDocumentoFormulario.CERTIFICADO_MEDIDAS_CORRECTIVAS,
        TipoDocumentoFormulario.SEGURIDAD_SOCIAL_SALUD,
        TipoDocumentoFormulario.SEGURIDAD_SOCIAL_PENSION,
        TipoDocumentoFormulario.SEGURIDAD_SOCIAL_ARL,
    ];

    constructor(
        @InjectRepository(FormularioPublico)
        private readonly formularioRepository: Repository<FormularioPublico>,
        @InjectRepository(DocumentoFormularioPublico)
        private readonly documentoRepository: Repository<DocumentoFormularioPublico>,
        private readonly storageService: StorageService,
        @Inject(forwardRef(() => ContratistaService))
        private readonly contratistaService: ContratistaService,
    ) { }

    /**
     * Crear un nuevo formulario público
     */
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

    /**
     * Actualizar un formulario existente
     */
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

    /**
     * Agregar un documento al formulario
     */
    async agregarDocumento(
        formularioId: string,
        tipo: TipoDocumentoFormulario,
        archivo: Express.Multer.File,
        subidoPor: string = 'contratista',
    ): Promise<DocumentoFormularioPublico> {
        try {
            const formulario = await this.buscarPorId(formularioId);

            const tiposValidos = Object.values(TipoDocumentoFormulario);
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

    /**
     * ✅ Guarda un documento individual con esCombinado = false
     */
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

        const documento = this.documentoRepository.create({
            formularioId,
            tipo,
            nombreArchivo: archivo.originalname,
            rutaArchivo: result.path,
            tipoMime: archivo.mimetype,
            tamanoBytes: archivo.size,
            subidoPor,
            hashArchivo: this.calcularHash(archivo.buffer),
            esCombinado: false, // ✅ IMPORTANTE: documento individual NO es combinado
        });

        const saved = await this.documentoRepository.save(documento);
        this.logger.log(`✅ Documento individual guardado: ${tipo} - esCombinado: false`);
        return saved;
    }

    /**
     * ✅ Verifica si el tipo pertenece a un grupo y lo combina
     * Guarda el combinado con esCombinado = true
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

        const documentosDelGrupo = await this.documentoRepository.find({
            where: {
                formularioId,
                tipo: In(grupoEncontrado.tipos),
            },
            order: { tipo: 'ASC' },
        });

        const tiposSubidos = documentosDelGrupo.map(d => d.tipo);
        const todosPresentes = grupoEncontrado.tipos.every(t => tiposSubidos.includes(t));

        if (!todosPresentes) {
            const faltantes = grupoEncontrado.tipos.filter(t => !tiposSubidos.includes(t));
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
                nombreArchivo: `${nombreGrupo}.pdf`,
                rutaArchivo: result.path,
                tipoMime: 'application/pdf',
                tamanoBytes: pdfCombinado.length,
                subidoPor: 'sistema',
                hashArchivo: this.calcularHash(pdfCombinado),
                esCombinado: true, // ✅ IMPORTANTE: documento combinado
            });

            await this.documentoRepository.save(documentoCombinado);
            this.logger.log(`✅ PDF combinado guardado: ${nombreGrupo} - esCombinado: true`);

        } catch (error) {
            this.logger.error(`❌ Error combinando PDFs del grupo ${nombreGrupo}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Combina múltiples PDFs en uno solo usando pdf-lib
     */
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

    /**
     * Obtener el documento combinado de un grupo
     */
    async obtenerDocumentoCombinado(
        formularioId: string,
        grupoNombre: string,
    ): Promise<DocumentoFormularioPublico | null> {
        return this.documentoRepository.findOne({
            where: {
                formularioId,
                tipo: grupoNombre as any,
                esCombinado: true, // ✅ Solo combinados
            },
        });
    }

    /**
     * Obtener estado de todos los grupos
     */
    async obtenerEstadoGrupos(formularioId: string): Promise<any> {
        const resultado = {};

        for (const [key, grupo] of Object.entries(this.gruposDocumentos)) {
            const documentos = await this.documentoRepository.find({
                where: {
                    formularioId,
                    tipo: In(grupo.tipos),
                },
            });

            const tiposSubidos = documentos.map(d => d.tipo);
            const completado = grupo.tipos.every(t => tiposSubidos.includes(t));
            const combinado = await this.obtenerDocumentoCombinado(formularioId, key);

            resultado[key] = {
                label: grupo.label,
                completado,
                documentosSubidos: documentos.length,
                totalRequeridos: grupo.tipos.length,
                combinadoExiste: !!combinado,
                combinadoId: combinado?.id || null,
                tipos: grupo.tipos,
            };
        }

        return resultado;
    }

    /**
     * Descargar documento combinado del formulario
     */
    async descargarDocumentoCombinado(
        formularioId: string,
        grupoNombre: string,
    ): Promise<{ buffer: Buffer; nombre: string; mimeType: string }> {
        const documento = await this.obtenerDocumentoCombinado(formularioId, grupoNombre);

        if (!documento) {
            throw new NotFoundException(`Documento combinado ${grupoNombre} no encontrado`);
        }

        const buffer = await this.storageService.getFile(documento.rutaArchivo);

        return {
            buffer,
            nombre: `${grupoNombre}.pdf`,
            mimeType: 'application/pdf',
        };
    }

    /**
     * Marcar formulario como completado
     */
    async completarFormulario(formularioId: string): Promise<FormularioPublico> {
        try {
            const formulario = await this.buscarPorId(formularioId);

            const documentos = await this.obtenerDocumentos(formularioId);
            const tiposSubidos = documentos.map(doc => doc.tipo);

            const faltantes = this.tiposValidos.filter(t => !tiposSubidos.includes(t));

            if (faltantes.length > 0) {
                throw new BadRequestException(
                    `Faltan documentos requeridos: ${faltantes.join(', ')}`
                );
            }

            const estadoGrupos = await this.obtenerEstadoGrupos(formularioId);
            const gruposIncompletos = Object.entries(estadoGrupos)
                .filter(([key, value]: [string, any]) => !value.combinadoExiste)
                .map(([key]) => key);

            if (gruposIncompletos.length > 0) {
                this.logger.warn(`⚠️ Grupos sin combinar: ${gruposIncompletos.join(', ')}`);
                for (const grupo of Object.keys(this.gruposDocumentos)) {
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
     * Forzar combinación de un grupo
     */
    async forzarCombinacionGrupo(formularioId: string, grupoNombre: string): Promise<void> {
        const grupo = this.gruposDocumentos[grupoNombre];
        if (!grupo) {
            throw new NotFoundException(`Grupo ${grupoNombre} no encontrado`);
        }

        const documentosDelGrupo = await this.documentoRepository.find({
            where: {
                formularioId,
                tipo: In(grupo.tipos),
            },
            order: { tipo: 'ASC' },
        });

        const tiposSubidos = documentosDelGrupo.map(d => d.tipo);
        const todosPresentes = grupo.tipos.every(t => tiposSubidos.includes(t));

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
            nombreArchivo: `${grupoNombre}.pdf`,
            rutaArchivo: result.path,
            tipoMime: 'application/pdf',
            tamanoBytes: pdfCombinado.length,
            subidoPor: 'sistema',
            hashArchivo: this.calcularHash(pdfCombinado),
            esCombinado: true, // ✅ IMPORTANTE
        });

        await this.documentoRepository.save(documentoCombinado);
        this.logger.log(`✅ PDF combinado forzado: ${grupoNombre}`);
    }

    /**
     * Buscar formulario por ID
     */
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

    /**
     * Buscar formulario por contratista
     */
    async buscarPorContratista(contratistaId: string): Promise<FormularioPublico[]> {
        return this.formularioRepository.find({
            where: { contratistaId },
            relations: ['documentos'],
            order: { createdAt: 'DESC' },
        });
    }

    /**
     * Buscar formulario activo (pendiente) por contratista
     */
    async buscarActivoPorContratista(contratistaId: string): Promise<FormularioPublico | null> {
        return this.formularioRepository.findOne({
            where: {
                contratistaId,
                estado: EstadoFormulario.PENDIENTE,
            },
            relations: ['documentos'],
        });
    }

    /**
     * Obtener documentos del formulario
     */
    async obtenerDocumentos(formularioId: string): Promise<DocumentoFormularioPublico[]> {
        return this.documentoRepository.find({
            where: { formularioId },
            order: { fechaSubida: 'DESC' },
        });
    }

    /**
     * Obtener un documento por ID
     */
    async obtenerDocumentoPorId(documentoId: string): Promise<DocumentoFormularioPublico> {
        const documento = await this.documentoRepository.findOne({
            where: { id: documentoId },
        });

        if (!documento) {
            throw new NotFoundException(`Documento ${documentoId} no encontrado`);
        }

        return documento;
    }

    /**
     * Eliminar un documento del formulario
     */
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

    /**
     * Verificar si un formulario está completo
     */
    async estaCompleto(formularioId: string): Promise<boolean> {
        const documentos = await this.obtenerDocumentos(formularioId);
        const tiposSubidos = documentos.map(doc => doc.tipo);
        return this.tiposValidos.every(t => tiposSubidos.includes(t));
    }

    /**
     * Calcular hash del archivo
     */
    private calcularHash(buffer: Buffer): string {
        return crypto.createHash('sha256').update(buffer).digest('hex');
    }

    /**
     * Listar formularios pendientes de aprobación
     */
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
                        contratistaTipo = contratista.tipoContratista || 'N/A';
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

    /**
     * ✅ Obtener detalle completo de un formulario para aprobación
     */
    async obtenerDetalleAprobacion(formularioId: string): Promise<any> {
        const formulario = await this.buscarPorId(formularioId);

        if (!formulario) {
            throw new NotFoundException(`Formulario ${formularioId} no encontrado`);
        }

        const documentos = await this.obtenerDocumentos(formularioId);
        const estadoGrupos = await this.obtenerEstadoGrupos(formularioId);

        const documentosPorTipo = {};
        for (const doc of documentos) {
            if (!documentosPorTipo[doc.tipo]) {
                documentosPorTipo[doc.tipo] = [];
            }
            documentosPorTipo[doc.tipo].push(doc);
        }

        let contratista = null;
        try {
            if (formulario.contratistaId) {
                contratista = await this.contratistaService.buscarPorId(formulario.contratistaId);
            }
        } catch (error) {
            this.logger.warn(`⚠️ No se pudo obtener el contratista: ${error.message}`);
            contratista = {
                razonSocial: formulario.representanteLegal || 'N/A',
                documentoIdentidad: formulario.documentoRepresentante || 'N/A',
                tipoContratista: formulario.tipoContratista || 'N/A',
            };
        }

        return {
            formulario,
            contratista,
            documentos,
            documentosPorTipo,
            estadoGrupos,
            totalDocumentos: documentos.length,
            fechaCompletado: formulario.fechaCompletado,
            fechaCreacion: formulario.createdAt,
        };
    }

/**
 * ✅ Aprobar un formulario - COPIA LOS COMBINADOS AL CONTRATISTA
 * Si el contratista ya existe, lo desactiva antes de crear el nuevo
 */
async aprobarFormulario(formularioId: string, observaciones?: string): Promise<FormularioPublico> {
  const formulario = await this.buscarPorId(formularioId);

  if (!formulario) {
    throw new NotFoundException(`Formulario ${formularioId} no encontrado`);
  }

  if (formulario.estado === EstadoFormulario.APROBADO) {
    throw new BadRequestException('Este formulario ya está aprobado');
  }

  // ✅ OBTENER EL CONTRATISTA EXISTENTE
  let contratista = null;
  let contratistaId = formulario.contratistaId;

  try {
    contratista = await this.contratistaService.buscarPorId(contratistaId);
  } catch (error) {
    this.logger.warn(`⚠️ Contratista ${contratistaId} no encontrado, se creará uno nuevo`);
  }

  // ✅ Si el contratista existe, verificamos si está activo
  if (contratista) {
    this.logger.log(`📋 Contratista encontrado: ${contratista.id} - ${contratista.razonSocial} - Estado: ${contratista.estado}`);

    // ✅ Si está ACTIVO, lo desactivamos
    if (contratista.estado === 'ACTIVO') {
      this.logger.log(`⚠️ Contratista está ACTIVO. Desactivando...`);
      await this.contratistaService.actualizar(contratista.id, {
        estado: 'INACTIVO'
      });
      this.logger.log(`✅ Contratista ${contratista.id} desactivado exitosamente`);
    } else {
      this.logger.log(`ℹ️ Contratista ya está ${contratista.estado}, no se requiere desactivar`);
    }
  }

  // ✅ CREAR UN NUEVO CONTRATISTA CON EL MISMO DOCUMENTO
  let datosContratista: any = {};

  if (contratista) {
    datosContratista = {
      tipoDocumento: contratista.tipoDocumento || 'CC',
      documentoIdentidad: contratista.documentoIdentidad,
      razonSocial: contratista.razonSocial,
      representanteLegal: contratista.representanteLegal || formulario.representanteLegal,
      documentoRepresentante: contratista.documentoRepresentante || formulario.documentoRepresentante,
      telefono: contratista.telefono || formulario.telefono,
      email: contratista.email || '',
      direccion: contratista.direccion || formulario.direccion,
      departamento: contratista.departamento || formulario.departamento,
      ciudad: contratista.ciudad || formulario.ciudad,
      tipoContratista: contratista.tipoContratista || formulario.tipoContratista,
      estado: 'ACTIVO',
      numeroContrato: contratista.numeroContrato || `PS-${Date.now().toString().slice(-4)}`,
      cargo: contratista.cargo || formulario.cargo,
      objetivoContrato: contratista.objetivoContrato || formulario.objetivoContrato
    };
  } else {
    datosContratista = {
      tipoDocumento: 'CC',
      documentoIdentidad: formulario.documentoRepresentante || '0000000000',
      razonSocial: formulario.representanteLegal || 'Contratista',
      representanteLegal: formulario.representanteLegal || '',
      documentoRepresentante: formulario.documentoRepresentante || '',
      telefono: formulario.telefono || '',
      email: '',
      direccion: formulario.direccion || '',
      departamento: formulario.departamento || '',
      ciudad: formulario.ciudad || '',
      tipoContratista: formulario.tipoContratista || '',
      estado: 'ACTIVO',
      numeroContrato: `PS-${Date.now().toString().slice(-4)}`,
      cargo: formulario.cargo || '',
      objetivoContrato: formulario.objetivoContrato || ''
    };
  }

  this.logger.log(`📝 Creando NUEVO contratista con documento: ${datosContratista.documentoIdentidad}`);

  // ✅ USAR EL MÉTODO QUE NO VALIDA DOCUMENTO ACTIVO
  const nuevoContratista = await this.contratistaService.crearSinValidacion(datosContratista);
  this.logger.log(`✅ Nuevo contratista creado: ${nuevoContratista.id} - ${nuevoContratista.razonSocial}`);

  // ✅ ACTUALIZAR EL FORMULARIO CON EL NUEVO CONTRATISTA ID
  formulario.contratistaId = nuevoContratista.id;

  // ✅ OBTENER LOS DOCUMENTOS COMBINADOS DEL FORMULARIO (esCombinado = true)
  const documentosFormulario = await this.obtenerDocumentos(formularioId);
  const combinados = documentosFormulario.filter(doc => doc.esCombinado === true);

  this.logger.log(`📋 Encontrados ${combinados.length} documentos combinados en el formulario`);

  // ✅ COPIAR CADA COMBINADO AL NUEVO CONTRATISTA
  for (const docCombinado of combinados) {
    try {
      this.logger.log(`📄 Copiando combinado ${docCombinado.tipo} al nuevo contratista...`);

      const buffer = await this.storageService.getFile(docCombinado.rutaArchivo);

      const extension = docCombinado.nombreArchivo.split('.').pop() || 'pdf';
      const timestamp = Date.now();
      const nombreUnico = `${docCombinado.tipo}_${timestamp}.${extension}`;

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
      nuevoDocumento.tipo = String(docCombinado.tipo) as any;
      nuevoDocumento.nombreArchivo = nombreUnico;
      nuevoDocumento.rutaArchivo = result.path;
      nuevoDocumento.tipoMime = 'application/pdf';
      nuevoDocumento.tamanoBytes = buffer.length;
      nuevoDocumento.subidoPor = 'sistema';
      nuevoDocumento.esCombinado = true;

      await this.contratistaService['documentoRepository'].save(nuevoDocumento);

      this.logger.log(`✅ Combinado ${docCombinado.tipo} copiado al nuevo contratista ${nuevoContratista.id}`);
    } catch (error) {
      this.logger.error(`❌ Error copiando combinado ${docCombinado.tipo}: ${error.message}`);
    }
  }

  // ✅ ACTUALIZAR ESTADO DEL FORMULARIO
  formulario.estado = EstadoFormulario.APROBADO;
  formulario.fechaEnvio = new Date();

  const updated = await this.formularioRepository.save(formulario);
  this.logger.log(`✅ Formulario ${formularioId} aprobado y nuevo contratista creado con los combinados copiados`);

  return updated;
}


    /**
     * ✅ Rechazar un formulario
     */
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