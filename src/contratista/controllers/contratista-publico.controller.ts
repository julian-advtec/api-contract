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
import { EstadoFormulario } from '../entities/formulario-publico.entity'; // ✅ IMPORTADO
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
    @UseInterceptors(FilesInterceptor('documentos', 25))
    async guardarDatos(
        @Param('token') token: string,
        @Body() body: any,
        @UploadedFiles() files?: Express.Multer.File[],
        @Req() req?: any,
    ) {
        this.logger.log(`📝 Guardando datos...`);
        this.logger.log(`📎 Archivos recibidos: ${files?.length || 0}`);
        this.logger.log(`📦 Body keys: ${Object.keys(body).join(', ')}`);

        try {
            const verificar = await this.tokenService.verificarTokenAcceso(token);
            if (!verificar.valido) {
                return {
                    ok: true,
                    data: {
                        success: false,
                        message: verificar.error || 'Token inválido',
                        data: null,
                    },
                };
            }

            // ✅ Verificar si el token ya fue usado ANTES de procesar
            if (verificar.tokenUsado === true) {
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
                } catch (e) {
                    datosFormulario = body;
                }
            } else {
                datosFormulario = body;
            }

            this.logger.log(`📦 Datos recibidos: ${JSON.stringify(datosFormulario, null, 2)}`);

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

            // ✅ Obtener el total de documentos del body
            const totalDocumentosEsperados = parseInt(body.total_documentos) || 0;
            this.logger.log(`📊 Total de documentos esperados: ${totalDocumentosEsperados}`);

            // Procesar archivos subidos
            const documentosSubidos: any[] = [];
            const tiposValidos = Object.values(TipoDocumentoFormulario);
            const errores: string[] = [];

            if (files && files.length > 0) {
                this.logger.log(`📎 Procesando ${files.length} archivos`);

                for (let i = 0; i < files.length; i++) {
                    const file = files[i];

                    // ✅ Obtener el tipo del documento del body usando el índice
                    let tipoDoc = body[`tipo_documento_${i}`];

                    // Si no se encuentra por índice, buscar en documentosInfo
                    if (!tipoDoc && documentosInfo[i]?.tipo) {
                        tipoDoc = documentosInfo[i].tipo;
                    }

                    // Si aún no hay tipo, intentar obtener del nombre del archivo
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

            // Verificar completitud
            const documentos = await this.formularioService.obtenerDocumentos(formulario.id);
            const tiposRequeridos = Object.values(TipoDocumentoFormulario);
            const tiposSubidos = documentos.map(doc => doc.tipo);
            const todosCompletos = tiposRequeridos.every(t => tiposSubidos.includes(t));

            let tokenMarcadoUsado = false;

            if (todosCompletos && !formulario.completado) {
                formulario = await this.formularioService.completarFormulario(formulario.id);
                this.logger.log(`✅ Formulario completado automáticamente: ${formulario.id}`);

                // ✅ MARCAR EL TOKEN COMO USADO DESPUÉS DE COMPLETAR EL FORMULARIO
                try {
                    await this.tokenService.marcarTokenComoUsado(token, contratistaId, formulario.id);
                    tokenMarcadoUsado = true;
                    this.logger.log(`✅ Token marcado como usado: ${token.substring(0, 30)}...`);
                } catch (error) {
                    this.logger.error(`❌ Error marcando token como usado: ${error.message}`);
                }
            }

            // Obtener estado de grupos
            const estadoGrupos = await this.formularioService.obtenerEstadoGrupos(formulario.id);

            // Actualizar contratista
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
                        tokenUsado: tokenMarcadoUsado, // ✅ Indicar si el token fue usado
                        errores: errores.length > 0 ? errores : undefined,
                    },
                },
            };
        } catch (error) {
            this.logger.error(`❌ Error guardando datos: ${error.message}`);
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
     * (Útil para debugging cuando hay problemas con las relaciones)
     */
    @Get('pendientes-aprobacion-test')
    @HttpCode(HttpStatus.OK)
    async listarPendientesAprobacionTest() {
        try {
            // Obtener formularios sin relaciones problemáticas
            const formularios = await this.formularioService['formularioRepository'].find({
                where: { estado: EstadoFormulario.COMPLETADO },
                order: { fechaCompletado: 'DESC' },
            });

            // Enriquecer con datos básicos
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
     * ✅ Aprobar un formulario
     */
    @Post(':formularioId/aprobar')
    @HttpCode(HttpStatus.OK)
    async aprobarFormulario(
        @Param('formularioId') formularioId: string,
        @Body() body: { observaciones?: string },
    ) {
        try {
            const resultado = await this.formularioService.aprobarFormulario(
                formularioId,
                body.observaciones,
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


}