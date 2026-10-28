// src/contratista/controllers/contratista-publico.controller.ts
import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Logger,
    HttpCode,
    HttpStatus,
    UseInterceptors,
    UploadedFiles,
    BadRequestException,
    Req,
    Res,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ContratistaTokenService } from '../services/contratista-token.service';
import { ContratistaService } from '../services/contratista.service';
import { FormularioPublicoService } from '../services/formulario-publico.service';
import { TipoDocumentoFormulario } from '../entities/documento-formulario-publico.entity';
import { EstadoFormulario } from '../entities/formulario-publico.entity';
import { TokenUsado } from '../entities/token-usado.entity';

@Controller('contratistas/publico')
@Public()
export class ContratistaPublicoController {
    private readonly logger = new Logger(ContratistaPublicoController.name);

    constructor(
        private readonly tokenService: ContratistaTokenService,
        private readonly contratistaService: ContratistaService,
        private readonly formularioService: FormularioPublicoService,
    ) {
        this.logger.log('🚀 ContratistaPublicoController inicializado');
    }

    @Get('verificar/:token')
    @HttpCode(HttpStatus.OK)
    async verificarToken(@Param('token') token: string) {
        this.logger.log(`🔍 Verificando token...`);

        try {
            const resultado = await this.tokenService.verificarTokenAcceso(token);

            // ✅ Si el token ya fue usado, devolverlo en la respuesta
            if (resultado.tokenUsado) {
                return {
                    ok: true,
                    data: {
                        success: false,
                        message: 'Este enlace ya ha sido utilizado.',
                        tokenUsado: true,
                        data: null,
                    },
                };
            }

            if (!resultado.valido) {
                return {
                    ok: true,
                    data: {
                        success: false,
                        message: resultado.error || 'Token inválido',
                        tokenUsado: false,
                        data: null,
                    },
                };
            }

            return {
                ok: true,
                data: {
                    success: true,
                    message: 'Token válido',
                    tokenUsado: false,
                    data: resultado.contratista,
                },
            };
        } catch (error) {
            this.logger.error(`❌ Error: ${error.message}`);
            return {
                ok: true,
                data: {
                    success: false,
                    message: 'Error al verificar el token',
                    tokenUsado: false,
                    data: null,
                },
            };
        }
    }

    @Post('guardar/:token')
    @HttpCode(HttpStatus.OK)
    @UseInterceptors(FilesInterceptor('documentos', 50))
    async guardarDatos(
        @Param('token') token: string,
        @Body() body: any,
        @UploadedFiles() files?: Express.Multer.File[],
        @Req() req?: any,
    ) {
        // ✅ LOGS DE DIAGNÓSTICO - ANTES DEL TRY
        this.logger.log('════════════════════════════════════════');
        this.logger.log('📝 ========== GUARDANDO DATOS ==========');
        this.logger.log(`📎 Archivos recibidos: ${files?.length || 0}`);
        this.logger.log(`📦 Body keys: ${Object.keys(body).join(', ')}`);
        this.logger.log(`📦 Content-Type: ${req?.headers?.['content-type']}`);
        this.logger.log(`📦 Content-Length: ${req?.headers?.['content-length']}`);
        this.logger.log(`📦 Body: ${JSON.stringify(body).substring(0, 300)}`);

        if (files && files.length > 0) {
            this.logger.log(`📎 Detalle de archivos:`);
            files.forEach((f, i) => {
                this.logger.log(`   ${i + 1}. ${f.originalname} (${f.size} bytes, ${f.mimetype})`);
            });
        }
        this.logger.log('════════════════════════════════════════');

        try {
            const verificar = await this.tokenService.verificarTokenAcceso(token);
            if (!verificar.valido) {
                this.logger.warn(`⚠️ Token inválido: ${verificar.error}`);
                return {
                    ok: true,
                    data: {
                        success: false,
                        message: verificar.error || 'Token inválido',
                        data: null,
                    },
                };
            }

            if (verificar.tokenUsado === true) {
                this.logger.warn(`⚠️ Token ya usado`);
                return {
                    ok: true,
                    data: {
                        success: false,
                        message: 'Este enlace ya ha sido utilizado. No puede enviar más información.',
                        data: null,
                    },
                };
            }

            const contratistaId = verificar.contratista.id;

            let datosFormulario: any = {};
            let documentosInfo: any[] = [];

            if (body.data) {
                try {
                    const parsed = JSON.parse(body.data);
                    datosFormulario = parsed;
                    documentosInfo = parsed.documentosNuevos || [];
                    this.logger.log(`✅ body.data parseado correctamente`);
                } catch (e) {
                    this.logger.warn(`⚠️ Error parseando body.data: ${e.message}`);
                    datosFormulario = body;
                }
            } else {
                datosFormulario = body;
            }

            this.logger.log(`📦 Datos del formulario: ${JSON.stringify(datosFormulario, null, 2)}`);

            const ipOrigen = req?.ip || req?.connection?.remoteAddress || '0.0.0.0';
            const userAgent = req?.headers?.['user-agent'] || 'unknown';

            let formulario = await this.formularioService.buscarActivoPorContratista(contratistaId);

            if (!formulario) {
                formulario = await this.formularioService.crearFormulario(
                    contratistaId,
                    datosFormulario,
                    token,
                    ipOrigen,
                    userAgent,
                );
                this.logger.log(`✅ Nuevo formulario creado: ${formulario.id}`);
            } else {
                formulario = await this.formularioService.actualizarFormulario(
                    formulario.id,
                    datosFormulario,
                );
                this.logger.log(`✅ Formulario actualizado: ${formulario.id}`);
            }

            const totalDocumentosEsperados = parseInt(body.total_documentos) || 0;
            this.logger.log(`📊 Total de documentos esperados: ${totalDocumentosEsperados}`);

            const documentosSubidos: any[] = [];
            const tiposValidos = Object.values(TipoDocumentoFormulario);
            const errores: string[] = [];

            if (files && files.length > 0) {
                this.logger.log(`📎 Procesando ${files.length} archivos`);

                for (let i = 0; i < files.length; i++) {
                    const file = files[i];

                    let tipoDoc = body[`tipo_documento_${i}`];

                    if (!tipoDoc && documentosInfo[i]?.tipo) {
                        tipoDoc = documentosInfo[i].tipo;
                    }

                    if (!tipoDoc) {
                        const nombreSinExtension = file.originalname.split('.')[0];
                        const tipoEncontrado = tiposValidos.find(t => nombreSinExtension.includes(t));
                        if (tipoEncontrado) {
                            tipoDoc = tipoEncontrado;
                        }
                    }

                    tipoDoc = tipoDoc || 'OTRO';

                    this.logger.log(`📄 Procesando archivo ${i + 1}: ${file.originalname} - Tipo: ${tipoDoc}`);

                    if (!tiposValidos.includes(tipoDoc as TipoDocumentoFormulario)) {
                        const errorMsg = `Tipo de documento inválido: ${tipoDoc} para archivo ${file.originalname}`;
                        this.logger.warn(`⚠️ ${errorMsg}`);
                        errores.push(errorMsg);
                        continue;
                    }

                    try {
                        const docSubido = await this.formularioService.agregarDocumento(
                            formulario.id,
                            tipoDoc as TipoDocumentoFormulario,
                            file,
                            verificar.contratista.razonSocial || 'contratista',
                        );
                        documentosSubidos.push(docSubido);
                        this.logger.log(`✅ Documento subido: ${tipoDoc} - ${file.originalname}`);
                    } catch (error) {
                        const errorMsg = `Error subiendo documento ${tipoDoc}: ${error.message}`;
                        this.logger.error(`❌ ${errorMsg}`);
                        errores.push(errorMsg);
                    }
                }
            }

            this.logger.log(`📊 Documentos subidos exitosamente: ${documentosSubidos.length}`);
            if (errores.length > 0) {
                this.logger.warn(`⚠️ Errores durante la subida: ${errores.join('; ')}`);
            }

            const documentos = await this.formularioService.obtenerDocumentos(formulario.id);
            const estaCompleto = await this.formularioService.estaCompleto(formulario.id);

            this.logger.log(`📊 Validación de completitud: ${estaCompleto}`);
            this.logger.log(`   - Tipo: ${formulario.tipoContratista}`);
            this.logger.log(`   - Subtipo: ${formulario.subtipoJuridica}`);
            this.logger.log(`   - Documentos subidos: ${documentos.length}`);

            let tokenMarcadoUsado = false;

            if (estaCompleto && !formulario.completado) {
                formulario = await this.formularioService.completarFormulario(formulario.id);
                this.logger.log(`✅ Formulario completado automáticamente: ${formulario.id}`);
            }

            if (!verificar.tokenUsado) {
                try {
                    await this.tokenService.marcarTokenComoUsado(token, contratistaId, formulario.id);
                    tokenMarcadoUsado = true;
                    this.logger.log(`✅ Token marcado como usado`);
                } catch (error) {
                    this.logger.error(`❌ Error marcando token como usado: ${error.message}`);
                }
            }

            const estadoGrupos = await this.formularioService.obtenerEstadoGrupos(formulario.id);

            const camposPermitidos = [
                'representanteLegal',
                'documentoRepresentante',
                'telefono',
                'direccion',
                'departamento',
                'ciudad',
                'tipoContratista',
                'cargo',
                'objetivoContrato'
            ];

            const datosActualizar: any = {};
            Object.keys(datosFormulario).forEach(key => {
                if (camposPermitidos.includes(key) && datosFormulario[key] !== undefined && datosFormulario[key] !== null && datosFormulario[key] !== '') {
                    datosActualizar[key] = datosFormulario[key];
                }
            });

            let contratistaActualizado = verificar.contratista;
            if (Object.keys(datosActualizar).length > 0) {
                contratistaActualizado = await this.contratistaService.actualizar(
                    contratistaId,
                    datosActualizar
                );
                this.logger.log(`✅ Datos del contratista actualizados: ${contratistaActualizado.razonSocial}`);
            }

            this.logger.log(`✅ ========== GUARDADO EXITOSO ==========`);

            return {
                ok: true,
                data: {
                    success: true,
                    message: 'Información guardada exitosamente',
                    data: {
                        formularioId: formulario.id,
                        contratistaId: contratistaId,
                        completado: formulario.completado,
                        documentosSubidos: documentosSubidos.length,
                        totalDocumentos: documentos.length,
                        estado: formulario.estado,
                        estadoGrupos: estadoGrupos,
                        tokenUsado: tokenMarcadoUsado,
                        errores: errores.length > 0 ? errores : undefined,
                    },
                },
            };
        } catch (error) {
            this.logger.error(`❌ ========== ERROR GUARDANDO DATOS ==========`);
            this.logger.error(`❌ Mensaje: ${error.message}`);
            this.logger.error(`❌ Stack: ${error.stack}`);
            return {
                ok: true,
                data: {
                    success: false,
                    message: error.message || 'Error al guardar los datos',
                    data: null,
                },
            };
        }
    }

    /**
     * ✅ Obtener estado de grupos de documentos
     */
    @Get(':formularioId/estado-grupos')
    @HttpCode(HttpStatus.OK)
    async obtenerEstadoGrupos(@Param('formularioId') formularioId: string) {
        try {
            const estado = await this.formularioService.obtenerEstadoGrupos(formularioId);
            return {
                ok: true,
                data: {
                    success: true,
                    data: estado,
                },
            };
        } catch (error) {
            this.logger.error(`❌ Error obteniendo estado: ${error.message}`);
            return {
                ok: true,
                data: {
                    success: false,
                    message: error.message,
                    data: null,
                },
            };
        }
    }

    /**
     * ✅ Descargar documento combinado
     */
    @Get(':formularioId/combinado/:grupo')
    @HttpCode(HttpStatus.OK)
    async descargarCombinado(
        @Param('formularioId') formularioId: string,
        @Param('grupo') grupo: string,
        @Res() res: Response,
    ) {
        try {
            this.logger.log(`📥 Descargando documento combinado: ${grupo}`);

            const { buffer, nombre, mimeType } = await this.formularioService.descargarDocumentoCombinado(
                formularioId,
                grupo
            );

            res.setHeader('Content-Type', mimeType);
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nombre)}"`);
            res.setHeader('Content-Length', buffer.length);

            res.send(buffer);
        } catch (error) {
            this.logger.error(`❌ Error descargando combinado: ${error.message}`);
            if (!res.headersSent) {
                return res.status(HttpStatus.NOT_FOUND).json({
                    ok: true,
                    data: {
                        success: false,
                        message: error.message,
                    }
                });
            }
        }
    }

    @Get('health')
    async healthCheck() {
        return {
            ok: true,
            status: 'ok',
            service: 'contratista-publico',
            timestamp: new Date().toISOString(),
        };
    }

    @Post('test-upload')
    @Public()
    @UseInterceptors(FilesInterceptor('documentos', 20))
    async testUpload(
        @Body() body: any,
        @UploadedFiles() files?: Express.Multer.File[],
    ) {
        console.log('=== TEST UPLOAD ===');
        console.log('Body keys:', Object.keys(body));
        console.log('Files count:', files?.length || 0);

        if (files && files.length > 0) {
            files.forEach((f, i) => {
                console.log(`File ${i}:`, {
                    name: f.originalname,
                    type: f.mimetype,
                    size: f.size,
                });
            });
        }

        let parsedData = {};
        if (body.data) {
            try {
                parsedData = JSON.parse(body.data);
                console.log('Parsed data:', parsedData);
            } catch (e) {
                console.error('Error parsing data:', e);
            }
        }

        return {
            ok: true,
            data: {
                bodyKeys: Object.keys(body),
                fileCount: files?.length || 0,
                files: files?.map(f => ({
                    name: f.originalname,
                    type: f.mimetype,
                    size: f.size,
                })) || [],
                parsedData,
            }
        };
    }

    /**
     * ✅ Listar todos los formularios pendientes de aprobación
     */
    @Get('pendientes-aprobacion')
    @HttpCode(HttpStatus.OK)
    async listarPendientesAprobacion() {
        try {
            const formularios = await this.formularioService.listarPendientesAprobacion();
            return {
                ok: true,
                data: {
                    success: true,
                    data: formularios,
                    total: formularios.length,
                },
            };
        } catch (error) {
            this.logger.error(`❌ Error listando pendientes: ${error.message}`);
            return {
                ok: true,
                data: {
                    success: false,
                    message: error.message,
                    data: null,
                },
            };
        }
    }

    /**
     * ✅ Endpoint de prueba para listar todos los formularios completados
     */
    @Get('pendientes-aprobacion-test')
    @HttpCode(HttpStatus.OK)
    async listarPendientesAprobacionTest() {
        try {
            const formularios = await this.formularioService['formularioRepository'].find({
                where: { estado: EstadoFormulario.COMPLETADO },
                order: { fechaCompletado: 'DESC' },
            });

            const resultado = [];
            for (const formulario of formularios) {
                const documentos = await this.formularioService.obtenerDocumentos(formulario.id);
                const estadoGrupos = await this.formularioService.obtenerEstadoGrupos(formulario.id);

                resultado.push({
                    id: formulario.id,
                    contratistaId: formulario.contratistaId,
                    representanteLegal: formulario.representanteLegal,
                    documentoRepresentante: formulario.documentoRepresentante,
                    telefono: formulario.telefono,
                    direccion: formulario.direccion,
                    departamento: formulario.departamento,
                    ciudad: formulario.ciudad,
                    tipoContratista: formulario.tipoContratista,
                    cargo: formulario.cargo,
                    objetivoContrato: formulario.objetivoContrato,
                    estado: formulario.estado,
                    completado: formulario.completado,
                    fechaCompletado: formulario.fechaCompletado,
                    createdAt: formulario.createdAt,
                    totalDocumentos: documentos.length,
                    estadoGrupos,
                    contratistaNombre: formulario.representanteLegal || 'N/A',
                    contratistaDocumento: formulario.documentoRepresentante || 'N/A',
                });
            }

            return {
                ok: true,
                data: {
                    success: true,
                    data: resultado,
                    total: resultado.length,
                },
            };
        } catch (error) {
            this.logger.error(`❌ Error: ${error.message}`);
            return {
                ok: true,
                data: {
                    success: false,
                    message: error.message,
                    data: null,
                },
            };
        }
    }

    /**
     * ✅ Obtener detalle completo de un formulario para aprobación
     */
    @Get(':formularioId/detalle-aprobacion')
    @HttpCode(HttpStatus.OK)
    async obtenerDetalleAprobacion(@Param('formularioId') formularioId: string) {
        try {
            const detalle = await this.formularioService.obtenerDetalleAprobacion(formularioId);
            return {
                ok: true,
                data: {
                    success: true,
                    data: detalle,
                },
            };
        } catch (error) {
            this.logger.error(`❌ Error obteniendo detalle: ${error.message}`);
            return {
                ok: true,
                data: {
                    success: false,
                    message: error.message,
                    data: null,
                },
            };
        }
    }

    /**
     * ✅ Aprobar un formulario - RECIBE NÚMERO DE CONTRATO
     */
    @Post(':formularioId/aprobar')
    async aprobarFormulario(
        @Param('formularioId') formularioId: string,
        @Body() body: { numeroContrato?: string },
    ) {
        try {
            if (!body.numeroContrato) {
                return {
                    ok: true,
                    data: {
                        success: false,
                        message: 'Debe ingresar un número de contrato para aprobar el formulario',
                        data: null,
                    },
                };
            }

            const resultado = await this.formularioService.aprobarFormulario(
                formularioId,
                null,
                body.numeroContrato,
            );

            return {
                ok: true,
                data: {
                    success: true,
                    message: 'Formulario aprobado exitosamente',
                    data: resultado,
                },
            };
        } catch (error) {
            this.logger.error(`❌ Error aprobando formulario: ${error.message}`);
            return {
                ok: true,
                data: {
                    success: false,
                    message: error.message,
                    data: null,
                },
            };
        }
    }

    /**
     * ✅ Rechazar un formulario
     */
    @Post(':formularioId/rechazar')
    @HttpCode(HttpStatus.OK)
    async rechazarFormulario(
        @Param('formularioId') formularioId: string,
        @Body() body: { motivo: string },
    ) {
        try {
            const resultado = await this.formularioService.rechazarFormulario(
                formularioId,
                body.motivo,
            );
            return {
                ok: true,
                data: {
                    success: true,
                    message: 'Formulario rechazado',
                    data: resultado,
                },
            };
        } catch (error) {
            this.logger.error(`❌ Error rechazando formulario: ${error.message}`);
            return {
                ok: true,
                data: {
                    success: false,
                    message: error.message,
                    data: null,
                },
            };
        }
    }

    @Get('todos-formularios')
    @HttpCode(HttpStatus.OK)
    async listarTodosFormularios() {
        try {
            const formularios = await this.formularioService['formularioRepository'].find({
                order: { createdAt: 'DESC' },
            });

            return {
                ok: true,
                data: {
                    success: true,
                    data: formularios,
                    total: formularios.length,
                },
            };
        } catch (error) {
            this.logger.error(`❌ Error: ${error.message}`);
            return {
                ok: true,
                data: {
                    success: false,
                    message: error.message,
                    data: null,
                },
            };
        }
    }

    /**
     * ✅ Descargar documento individual del formulario público
     */
    @Get(':formularioId/documentos/:documentoId/descargar')
    @HttpCode(HttpStatus.OK)
    async descargarDocumentoIndividual(
        @Param('formularioId') formularioId: string,
        @Param('documentoId') documentoId: string,
        @Res() res: Response,
    ) {
        try {
            this.logger.log(`📥 Descargando documento individual: ${documentoId} del formulario ${formularioId}`);

            const documento = await this.formularioService.obtenerDocumentoPorId(documentoId);

            if (documento.formularioId !== formularioId) {
                this.logger.warn(`⚠️ Documento ${documentoId} no pertenece al formulario ${formularioId}`);
                return res.status(HttpStatus.NOT_FOUND).json({
                    ok: true,
                    data: {
                        success: false,
                        message: 'Documento no encontrado en este formulario',
                    }
                });
            }

            const buffer = await this.formularioService.obtenerBufferDocumento(documentoId);

            if (!buffer) {
                this.logger.warn(`⚠️ Archivo no encontrado para documento: ${documentoId}`);
                return res.status(HttpStatus.NOT_FOUND).json({
                    ok: true,
                    data: {
                        success: false,
                        message: 'Archivo no encontrado',
                    }
                });
            }

            // ✅ MAPEO DE NOMBRES LEGIBLES
            const nombresLegibles: Record<string, string> = {
                // Combinados
                'CERTIFICADO_EXISTENCIA': 'Certificado_de_Existencia_y_Representacion_Legal',
                'CERTIFICADO_ANTECEDENTES': 'Antecedentes_Disciplinarios_Fiscales_Judiciales_y_Medidas_Correctivas',
                'DECLARACION_BIENES': 'Declaracion_de_Bienes_y_Rentas',
                'PAZ_SALVO': 'Paz_y_Salvo_de_Seguridad_Social_y_Parafiscales',
                'SEGURIDAD_SOCIAL': 'Seguridad_Social_Salud_Pension_ARL',

                // Persona Natural
                'CEDULA': 'Cedula_de_Ciudadania',
                'RUT': 'RUT',
                'LIBRETA_MILITAR': 'Libreta_Militar',
                'CERTIFICADO_DISCIPLINARIOS': 'Certificado_de_Antecedentes_Disciplinarios',
                'CERTIFICADO_RESPONSABILIDAD_FISCAL': 'Certificado_de_Responsabilidad_Fiscal',
                'CERTIFICADO_ANTECEDENTES_JUDICIALES': 'Certificado_de_Antecedentes_Judiciales',
                'CERTIFICADO_MEDIDAS_CORRECTIVAS': 'Certificado_de_Medidas_Correctivas',
                'SEGURIDAD_SOCIAL_SALUD': 'Seguridad_Social_Salud',
                'SEGURIDAD_SOCIAL_PENSION': 'Seguridad_Social_Pension',
                'SEGURIDAD_SOCIAL_ARL': 'Seguridad_Social_ARL',
                'CERTIFICADO_BANCARIO': 'Certificado_Bancario',
                'CERTIFICADO_EXPERIENCIA': 'Certificado_de_Experiencia',
                'CERTIFICADO_NO_PLANTA': 'Certificado_No_Planta',
                'CERTIFICADO_IDONEIDAD': 'Certificado_de_Idoneidad',
                'DECLARACION_INHABILIDADES': 'Declaracion_de_Inhabilidades',
                'EXAMEN_INGRESO': 'Examen_de_Ingreso',
                'GARANTIA': 'Garantia',
                'HOJA_VIDA_SIGEP': 'Hoja_de_Vida_SIGEP',
                'PANTALLAZO_SECOP': 'Pantallazo_SECOP',
                'PROPUESTA': 'Propuesta',
                'PUBLICACION_GT': 'Publicacion_GT',
                'REDAM': 'REDAM',
                'SARLAFT': 'SARLAFT',
                'TARJETA_PROFESIONAL': 'Tarjeta_Profesional',
                'CERTIFICADO_INHABILIDADES_E_INCOMPATIBILIDADES': 'Certificado_de_Inhabilidades_e_Incompatibilidades',
                'CERTIFICADO_CUENTA_BANCARIA': 'Certificado_de_Cuenta_Bancaria',

                // Persona Jurídica
                'COTIZACION_UNO': 'Cotizacion_1',
                'COTIZACION_DOS': 'Cotizacion_2',
                'COTIZACION_TRES': 'Cotizacion_3',
                'HOJA_VIDA_PERSONA_JURIDICA': 'Hoja_de_Vida_Persona_Juridica',
                'CERTIFICADO_REPRECENTACION_LEGAL': 'Certificado_de_Representacion_Legal',
                'PROPUESTA_SINDICATO': 'Propuesta_del_Sindicato',
                'ACTA_INSCRIPCION_VIGENCIA': 'Acta_de_Inscripcion_y_Vigencia',
                'CERTIFICADO_JUNTA_DIRECTIVA_SINDICAL': 'Certificado_Junta_Directiva_Sindical',
                'CERTIFICADO_DISCIPLINARIOS_PROCURADORIA_GENERAL_REPRECENTANTE_LEGAL': 'Antecedentes_Disciplinarios_Procuraduria_Representante_Legal',
                'CERTIFICADO_DISCIPLINARIOS_PROCURADORIA_GENERAL_SINDICATO': 'Antecedentes_Disciplinarios_Procuraduria_Sindicato',
                'CERTIFICADO_NO_BOLETIN_RESPONSABLE_FISCALES_CONTRALORIA_REPRESENTANTE_LEGAL': 'No_Boletin_Responsabilidad_Fiscal_Representante_Legal',
                'CERTIFICADO_NO_BOLETIN_RESPONSABLE_FISCALES_CONTRALORIA_SINDICAL': 'No_Boletin_Responsabilidad_Fiscal_Sindical',
                'FORMA_UNICA_DECLARACION_BIENES_Y_RENTA': 'Formulario_Unico_de_Declaracion_de_Bienes_y_Renta',
                'ACTIVIDADES_ECONOMCIAS_PRIVADAS': 'Actividades_Economicas_Privadas',
                'PAZ_SALVO_SALUD': 'Paz_y_Salvo_de_Salud',
                'PAZ_SALVO_PENSION': 'Paz_y_Salvo_de_Pension',
                'PAZ_SALVO_PARAFISCALES': 'Paz_y_Salvo_de_Parafiscales',
                'CC_CONTADOR': 'Cedula_del_Contador',
                'TARJETA_PROFESIONAL_CONTADOR': 'Tarjeta_Profesional_del_Contador',
                'CERTIFICADO_JUNTA_CENTRAL_CONTADORES': 'Certificado_Junta_Central_de_Contadores',
            };

            // ✅ Obtener el nombre legible según el tipo de documento
            const tipoDocumento = String(documento.tipo);
            const nombreBase = nombresLegibles[tipoDocumento] || tipoDocumento;

            // ✅ Usar el nombre original si ya tiene uno descriptivo, si no, generar uno
            let nombreArchivo = documento.nombreArchivo || '';

            // Si el nombre del archivo es genérico (como "CERTIFICADO_ANTECEDENTES.pdf"), usar el nombre legible
            const esNombreGenerico =
                !nombreArchivo ||
                nombreArchivo === `${tipoDocumento}.pdf` ||
                nombreArchivo.startsWith('documento_') ||
                nombreArchivo.includes('fv089') ||
                nombreArchivo.includes('Cuenta de cobro');

            if (esNombreGenerico) {
                nombreArchivo = `${nombreBase}.pdf`;
            }

            // ✅ Si es combinado, usar el nombre del grupo
            if (documento.esCombinado) {
                const nombresCombinados: Record<string, string> = {
                    'CERTIFICADO_EXISTENCIA': 'Certificado_de_Existencia_y_Representacion_Legal.pdf',
                    'CERTIFICADO_ANTECEDENTES': 'Antecedentes_Disciplinarios_Fiscales_Judiciales_y_Medidas_Correctivas.pdf',
                    'DECLARACION_BIENES': 'Declaracion_de_Bienes_y_Rentas.pdf',
                    'PAZ_SALVO': 'Paz_y_Salvo_de_Seguridad_Social_y_Parafiscales.pdf',
                    'SEGURIDAD_SOCIAL': 'Seguridad_Social_Salud_Pension_ARL.pdf',
                };
                nombreArchivo = nombresCombinados[tipoDocumento] || `${nombreBase}.pdf`;
            }

            this.logger.log(`📥 Descargando con nombre: "${nombreArchivo}"`);

            res.setHeader('Content-Type', documento.tipoMime || 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nombreArchivo)}"`);
            res.setHeader('Content-Length', buffer.length);

            res.send(buffer);

            this.logger.log(`✅ Documento ${documentoId} descargado exitosamente como "${nombreArchivo}"`);
        } catch (error) {
            this.logger.error(`❌ Error descargando documento: ${error.message}`);
            if (!res.headersSent) {
                return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
                    ok: true,
                    data: {
                        success: false,
                        message: error.message || 'Error al descargar el documento',
                    }
                });
            }
        }
    }
}