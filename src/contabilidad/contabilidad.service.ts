import {
    Injectable,
    NotFoundException,
    BadRequestException,
    Logger,
    InternalServerErrorException,
    ForbiddenException,
    ConflictException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
    ContabilidadDocumento,
    ContabilidadEstado,
    TipoCausacion
} from './entities/contabilidad-documento.entity';
import { Documento } from './../radicacion/entities/documento.entity';
import { User } from './../users/entities/user.entity';
import { UserRole } from './../users/enums/user-role.enum';
import { AuditorDocumento, AuditorEstado } from './../auditor/entities/auditor-documento.entity';
import { extname } from 'path';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as mime from 'mime-types';

const execAsync = promisify(exec);

@Injectable()
export class ContabilidadService {
    private readonly logger = new Logger(ContabilidadService.name);

    constructor(
        @InjectRepository(ContabilidadDocumento)
        private contabilidadRepository: Repository<ContabilidadDocumento>,
        @InjectRepository(Documento)
        private documentoRepository: Repository<Documento>,
        @InjectRepository(User)
        private userRepository: Repository<User>,
        @InjectRepository(AuditorDocumento)
        private auditorDocumentoRepository: Repository<AuditorDocumento>,
        private readonly configService: ConfigService,
    ) {
        this.logger.log('📋 ContabilidadService inicializado');
    }

    // Obtener documentos disponibles (aprobados por auditor)
    async obtenerDocumentosDisponibles(contadorId: string): Promise<any[]> {
        this.logger.log(`📋 Contador ${contadorId} solicitando documentos disponibles`);

        try {
            // Buscar documentos que estén en estados de auditoría aprobados
            const documentos = await this.documentoRepository
                .createQueryBuilder('documento')
                .leftJoinAndSelect('documento.radicador', 'radicador')
                .leftJoinAndSelect('documento.usuarioAsignado', 'usuarioAsignado')
                .where("documento.estado IN (:...estados)", {
                    estados: ['APROBADO_AUDITOR', 'COMPLETADO_AUDITOR']
                })
                .orderBy('documento.fechaRadicacion', 'ASC')
                .getMany();

            this.logger.log(`✅ Encontrados ${documentos.length} documentos aprobados por auditoría`);

            // Verificar cuáles ya están siendo revisados por este contador
            const contabilidadDocs = await this.contabilidadRepository.find({
                where: {
                    contador: { id: contadorId },
                    estado: ContabilidadEstado.EN_REVISION
                },
                relations: ['documento']
            });

            const documentosEnRevisionIds = contabilidadDocs.map(cd => cd.documento.id);

            // Filtrar documentos que ya están siendo revisados por OTRO contador
            const documentosFiltrados = documentos.filter(documento => {
                // Si el documento ya está en revisión por contabilidad, verificar quién lo tiene
                if (documento.estado === 'EN_REVISION_CONTABILIDAD') {
                    // Buscar registro de contabilidad para este documento
                    const contabilidadDoc = contabilidadDocs.find(cd => cd.documento.id === documento.id);
                    // Solo está disponible si este contador YA lo tiene
                    return contabilidadDoc !== undefined;
                }
                return true; // Si no está en revisión, está disponible
            });

            const documentosConEstado = documentosFiltrados.map(documento => {
                const estaRevisandoYo = documentosEnRevisionIds.includes(documento.id);
                const yaEstaEnContabilidad = documento.estado === 'EN_REVISION_CONTABILIDAD';

                return {
                    id: documento.id,
                    numeroRadicado: documento.numeroRadicado,
                    numeroContrato: documento.numeroContrato,
                    nombreContratista: documento.nombreContratista,
                    documentoContratista: documento.documentoContratista,
                    fechaInicio: documento.fechaInicio,
                    fechaFin: documento.fechaFin,
                    estado: documento.estado,
                    fechaRadicacion: documento.fechaRadicacion,
                    radicador: documento.nombreRadicador,
                    supervisor: documento.usuarioAsignadoNombre,
                    auditor: documento.usuarioAsignadoNombre,
                    observacion: documento.observacion || '',
                    disponible: !yaEstaEnContabilidad || estaRevisandoYo,
                    asignacion: {
                        enRevision: estaRevisandoYo,
                        puedoTomar: !yaEstaEnContabilidad,
                        tieneGlosaDefinida: false,
                        supervisorAsignado: documento.usuarioAsignadoNombre,
                    }
                };
            });

            return documentosConEstado;
        } catch (error) {
            this.logger.error(`❌ Error obteniendo documentos disponibles: ${error.message}`);
            throw error;
        }
    }

    // Tomar documento para revisión
    async tomarDocumentoParaRevision(documentoId: string, contadorId: string): Promise<{
        success: boolean;
        message: string;
        documento: any
    }> {
        this.logger.log(`🤝 Contador ${contadorId} tomando documento ${documentoId} para revisión`);

        const queryRunner = this.contabilidadRepository.manager.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // Verificar que el documento esté en estado aprobado por auditoría
            const documento = await queryRunner.manager
                .createQueryBuilder(Documento, 'documento')
                .where('documento.id = :id', { id: documentoId })
                .andWhere('documento.estado IN (:...estados)', {
                    estados: ['APROBADO_AUDITOR', 'COMPLETADO_AUDITOR']
                })
                .setLock('pessimistic_write')
                .getOne();

            if (!documento) {
                throw new NotFoundException(
                    'Documento no encontrado o no está disponible para contabilidad (debe estar aprobado por auditoría)'
                );
            }

            // Verificar que no esté ya en revisión por contabilidad
            if (documento.estado === 'EN_REVISION_CONTABILIDAD') {
                throw new ConflictException(
                    'Este documento ya está siendo revisado por otro contador'
                );
            }

            const contador = await queryRunner.manager.findOne(User, {
                where: { id: contadorId }
            });

            if (!contador) {
                throw new NotFoundException('Contador no encontrado');
            }

            // Verificar si ya hay registro de contabilidad (aunque no esté en revisión)
            const contabilidadDocExistente = await queryRunner.manager.findOne(ContabilidadDocumento, {
                where: {
                    documento: { id: documentoId },
                    contador: { id: contadorId }
                },
                relations: ['contador']
            });

            if (contabilidadDocExistente) {
                // Si ya existe, actualizarlo a EN_REVISION
                contabilidadDocExistente.estado = ContabilidadEstado.EN_REVISION;
                contabilidadDocExistente.fechaActualizacion = new Date();
                contabilidadDocExistente.fechaInicioRevision = new Date();
                await queryRunner.manager.save(ContabilidadDocumento, contabilidadDocExistente);
            } else {
                // Crear nuevo registro
                const contabilidadDoc = queryRunner.manager.create(ContabilidadDocumento, {
                    documento: documento,
                    contador: contador,
                    estado: ContabilidadEstado.EN_REVISION,
                    fechaCreacion: new Date(),
                    fechaActualizacion: new Date(),
                    fechaInicioRevision: new Date(),
                    observaciones: 'Documento tomado para revisión de contabilidad'
                });
                await queryRunner.manager.save(ContabilidadDocumento, contabilidadDoc);
            }

            // Actualizar estado del documento
            documento.estado = 'EN_REVISION_CONTABILIDAD';
            documento.fechaActualizacion = new Date();
            documento.ultimoAcceso = new Date();
            documento.ultimoUsuario = `Contabilidad: ${contador.fullName || contador.username}`;
            documento.usuarioAsignado = contador;
            documento.usuarioAsignadoNombre = contador.fullName || contador.username;

            // Agregar al historial
            const historial = documento.historialEstados || [];
            historial.push({
                fecha: new Date(),
                estado: 'EN_REVISION_CONTABILIDAD',
                usuarioId: contador.id,
                usuarioNombre: contador.fullName || contador.username,
                rolUsuario: contador.role,
                observacion: `Documento tomado para revisión por contabilidad ${contador.username}`
            });
            documento.historialEstados = historial;

            await queryRunner.manager.save(Documento, documento);

            // Registrar acceso
            if (documento.rutaCarpetaRadicado) {
                await this.registrarAccesoContabilidad(
                    documento.rutaCarpetaRadicado,
                    contadorId,
                    `TOMÓ documento para contabilidad`,
                    `Estado: ${documento.estado}`
                );
            }

            await queryRunner.commitTransaction();

            this.logger.log(`✅ Documento ${documento.numeroRadicado} tomado para revisión por ${contador.username}`);

            return {
                success: true,
                message: `Documento ${documento.numeroRadicado} tomado para revisión de contabilidad`,
                documento: this.mapearDocumentoParaRespuesta(documento)
            };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error(`❌ Error tomando documento: ${error.message}`, error.stack);
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

    // Obtener documentos en revisión por el contador
    async obtenerDocumentosEnRevision(contadorId: string): Promise<any[]> {
        this.logger.log(`📋 Contador ${contadorId} solicitando documentos en revisión`);

        try {
            const contabilidadDocs = await this.contabilidadRepository.find({
                where: {
                    contador: { id: contadorId },
                    estado: ContabilidadEstado.EN_REVISION
                },
                relations: ['documento', 'documento.radicador', 'contador']
            });

            return contabilidadDocs.map(contabilidadDoc => {
                return this.mapearDocumentoParaRespuesta(contabilidadDoc.documento, contabilidadDoc);
            });
        } catch (error) {
            this.logger.error(`❌ Error obteniendo documentos en revisión: ${error.message}`);
            throw error;
        }
    }

    // Obtener detalle de documento con información de auditoría
    // En ContabilidadService
    async obtenerDetalleDocumento(documentoId: string, userId: string): Promise<any> {
        this.logger.log(`🔍 Usuario ${userId} solicitando detalle del documento ${documentoId}`);

        // 1. Buscar el usuario que hace la petición
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: ['id', 'username', 'role', 'fullName'] // solo lo necesario
        });

        if (!user) {
            this.logger.warn(`Usuario no encontrado: ${userId}`);
            throw new NotFoundException('Usuario no encontrado');
        }

        this.logger.debug(`Usuario encontrado: ${user.username} (${user.role})`);

        // 2. Buscar el registro de contabilidad (solo si el usuario actual lo tiene asignado)
        const contabilidadDoc = await this.contabilidadRepository.findOne({
            where: {
                documento: { id: documentoId },
                contador: { id: userId }
            },
            relations: ['documento', 'contador'],
        });

        // 3. Buscar el documento principal
        const documento = await this.documentoRepository.findOne({
            where: { id: documentoId },
            relations: ['radicador', 'usuarioAsignado'],
        });

        if (!documento) {
            this.logger.warn(`Documento no encontrado: ${documentoId}`);
            throw new NotFoundException('Documento no encontrado');
        }

        // 4. Estados permitidos para contabilidad
        const estadosPermitidos = [
            'APROBADO_AUDITOR',
            'COMPLETADO_AUDITOR',
            'EN_REVISION_CONTABILIDAD',
            'EN_PROCESO_CONTABILIDAD',
            'PROCESADO_CONTABILIDAD',
            'COMPLETADO_CONTABILIDAD'
        ];

        if (!estadosPermitidos.includes(documento.estado)) {
            this.logger.warn(`Estado no permitido para contabilidad: ${documento.estado}`);
            throw new ForbiddenException('Documento no disponible para contabilidad');
        }

        // 5. Regla de acceso según rol
        if (documento.estado === 'EN_REVISION_CONTABILIDAD') {
            // Caso especial: ADMIN puede ver TODO
            if (user.role === UserRole.ADMIN) {
                this.logger.log(`Admin ${user.username} accediendo a documento en revisión de otro usuario`);
                // Continúa sin validar asignación
            }
            // Caso normal: solo el contador asignado puede verlo
            else {
                if (!contabilidadDoc || contabilidadDoc.contador.id !== userId) {
                    this.logger.warn(
                        `Acceso denegado - Documento en revisión por otro usuario. ` +
                        `Solicitante: ${user.username} (${userId}), Asignado: ${contabilidadDoc?.contador?.username || 'nadie'}`
                    );
                    throw new ForbiddenException('Este documento está siendo revisado por otro contador');
                }
            }
        }

        // 6. Buscar info de auditoría (la última)
        const auditorDoc = await this.auditorDocumentoRepository.findOne({
            where: { documento: { id: documentoId } },
            relations: ['auditor'],
            order: { fechaActualizacion: 'DESC' }
        });

        // 7. Construir y devolver la respuesta
        const respuesta = this.construirRespuestaDetalle(documento, contabilidadDoc, auditorDoc, user);

        this.logger.log(`Detalle entregado exitosamente para documento ${documentoId} a ${user.username}`);

        return respuesta;
    }

    // Definir si hay glosa
    async definirGlosa(
        documentoId: string,
        contadorId: string,
        tieneGlosa: boolean
    ): Promise<{ success: boolean; message: string; contabilidad: ContabilidadDocumento }> {
        this.logger.log(`📝 Contador ${contadorId} definiendo glosa para documento ${documentoId}: ${tieneGlosa}`);

        const contabilidadDoc = await this.contabilidadRepository.findOne({
            where: {
                documento: { id: documentoId },
                contador: { id: contadorId },
                estado: ContabilidadEstado.EN_REVISION
            },
            relations: ['documento', 'contador']
        });

        if (!contabilidadDoc) {
            throw new ForbiddenException('No tienes este documento en revisión');
        }

        contabilidadDoc.tieneGlosa = tieneGlosa;
        contabilidadDoc.fechaActualizacion = new Date();

        // Si no hay glosa, establecer tipo de causación como comprobante de egreso
        if (!tieneGlosa) {
            contabilidadDoc.tipoCausacion = TipoCausacion.COMPROBANTE_EGRESO;
        }

        await this.contabilidadRepository.save(contabilidadDoc);

        return {
            success: true,
            message: `Glosa definida: ${tieneGlosa ? 'Con glosa' : 'Sin glosa'}`,
            contabilidad: contabilidadDoc
        };
    }

    // Subir documentos de contabilidad
    async subirDocumentosContabilidad(
        documentoId: string,
        contadorId: string,
        datos: {
            tipoCausacion?: TipoCausacion;
            observaciones?: string;
            tieneGlosa?: boolean;
        },
        files: { [key: string]: Express.Multer.File[] },
    ): Promise<{ success: boolean; message: string; contabilidad: ContabilidadDocumento }> {
        this.logger.log(`📤 Subiendo documentos de contabilidad para doc:${documentoId} contador:${contadorId}`);

        const contabilidadDoc = await this.contabilidadRepository.findOne({
            where: {
                documento: { id: documentoId },
                contador: { id: contadorId },
                estado: ContabilidadEstado.EN_REVISION
            },
            relations: ['documento']
        });

        if (!contabilidadDoc) {
            throw new ForbiddenException('No tienes este documento en revisión');
        }

        const documento = contabilidadDoc.documento;

        // Validar que tenga definido si hay glosa
        if (contabilidadDoc.tieneGlosa === undefined && datos.tieneGlosa === undefined) {
            throw new BadRequestException('Debe definir primero si hay glosa');
        }

        // Actualizar datos
        if (datos.tieneGlosa !== undefined) {
            contabilidadDoc.tieneGlosa = datos.tieneGlosa;
        }

        if (datos.tipoCausacion) {
            contabilidadDoc.tipoCausacion = datos.tipoCausacion;
        }

        if (datos.observaciones) {
            contabilidadDoc.observaciones = datos.observaciones;
        }

        contabilidadDoc.fechaActualizacion = new Date();

        // Crear carpeta de contabilidad si no existe
        const carpetaContabilidad = path.join(documento.rutaCarpetaRadicado, 'contabilidad');
        if (!fs.existsSync(carpetaContabilidad)) {
            fs.mkdirSync(carpetaContabilidad, { recursive: true });
        }

        // Procesar archivos
        const archivosGuardados: Record<string, string> = {};

        // Glosa
        if (files['glosa']?.[0]) {
            const archivo = files['glosa'][0];
            const nombreArchivo = await this.guardarArchivoContabilidad(
                documento,
                archivo,
                'glosa',
                contadorId
            );
            contabilidadDoc.glosaPath = nombreArchivo;
            contabilidadDoc.fechaGlosa = new Date();
            archivosGuardados['glosa'] = nombreArchivo;
        }

        // Causación
        if (files['causacion']?.[0]) {
            const archivo = files['causacion'][0];
            const nombreArchivo = await this.guardarArchivoContabilidad(
                documento,
                archivo,
                'causacion',
                contadorId
            );
            contabilidadDoc.causacionPath = nombreArchivo;
            contabilidadDoc.fechaCausacion = new Date();
            archivosGuardados['causacion'] = nombreArchivo;
        }

        // Extracto
        if (files['extracto']?.[0]) {
            const archivo = files['extracto'][0];
            const nombreArchivo = await this.guardarArchivoContabilidad(
                documento,
                archivo,
                'extracto',
                contadorId
            );
            contabilidadDoc.extractoPath = nombreArchivo;
            contabilidadDoc.fechaExtracto = new Date();
            archivosGuardados['extracto'] = nombreArchivo;
        }

        // Comprobante de egreso
        if (files['comprobanteEgreso']?.[0]) {
            const archivo = files['comprobanteEgreso'][0];
            const nombreArchivo = await this.guardarArchivoContabilidad(
                documento,
                archivo,
                'comprobante_egreso',
                contadorId
            );
            contabilidadDoc.comprobanteEgresoPath = nombreArchivo;
            contabilidadDoc.fechaComprobanteEgreso = new Date();
            archivosGuardados['comprobanteEgreso'] = nombreArchivo;
        }

        // Guardar cambios
        const saved = await this.contabilidadRepository.save(contabilidadDoc);

        // Registrar acceso
        if (documento.rutaCarpetaRadicado) {
            await this.registrarAccesoContabilidad(
                documento.rutaCarpetaRadicado,
                contadorId,
                `SUBIR documentos contabilidad`,
                `Archivos: ${Object.keys(archivosGuardados).join(', ')}`
            );
        }

        return {
            success: true,
            message: 'Documentos procesados correctamente',
            contabilidad: saved
        };
    }

    // Finalizar revisión de contabilidad
    async finalizarRevision(
        documentoId: string,
        contadorId: string,
        estado: ContabilidadEstado,
        observaciones?: string
    ): Promise<{ success: boolean; message: string; documento: Documento }> {
        this.logger.log(`🏁 Contador ${contadorId} finalizando documento ${documentoId} con estado: ${estado}`);

        const queryRunner = this.contabilidadRepository.manager.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const contabilidadDoc = await queryRunner.manager.findOne(ContabilidadDocumento, {
                where: {
                    documento: { id: documentoId },
                    contador: { id: contadorId },
                    estado: ContabilidadEstado.EN_REVISION
                },
                relations: ['documento', 'contador']
            });

            if (!contabilidadDoc) {
                throw new ForbiddenException('No tienes este documento en revisión');
            }

            const documento = contabilidadDoc.documento;
            const contador = contabilidadDoc.contador;

            // Validar documentos completos
            const validacion = contabilidadDoc.puedeFinalizar();
            if (!validacion.puede) {
                throw new BadRequestException(validacion.razon);
            }

            // Actualizar estado de contabilidad
            contabilidadDoc.estado = estado;
            contabilidadDoc.observaciones = observaciones || contabilidadDoc.observaciones;
            contabilidadDoc.fechaActualizacion = new Date();
            contabilidadDoc.fechaFinRevision = new Date();

            // Actualizar estado del documento principal
            let estadoNuevoDocumento = '';

            switch (estado) {
                case ContabilidadEstado.GLOSADO_CONTABILIDAD:
                    estadoNuevoDocumento = 'GLOSADO_CONTABILIDAD';
                    break;

                case ContabilidadEstado.PROCESADO_CONTABILIDAD:
                    estadoNuevoDocumento = 'PROCESADO_CONTABILIDAD';
                    break;

                case ContabilidadEstado.COMPLETADO_CONTABILIDAD:
                    estadoNuevoDocumento = 'COMPLETADO_CONTABILIDAD';
                    break;

                case ContabilidadEstado.OBSERVADO_CONTABILIDAD:
                    estadoNuevoDocumento = 'OBSERVADO_CONTABILIDAD';
                    break;

                default:
                    estadoNuevoDocumento = 'PROCESADO_CONTABILIDAD';
                    break;
            }

            documento.estado = estadoNuevoDocumento;
            documento.fechaActualizacion = new Date();
            documento.ultimoAcceso = new Date();
            documento.ultimoUsuario = `Contabilidad: ${contador.fullName || contador.username}`;
            documento.usuarioAsignado = null;
            documento.usuarioAsignadoNombre = '';

            // Agregar al historial
            const historial = documento.historialEstados || [];
            historial.push({
                fecha: new Date(),
                estado: estadoNuevoDocumento,
                usuarioId: contadorId,
                usuarioNombre: contador.fullName || contador.username,
                rolUsuario: contador.role,
                observacion: `Procesado por contabilidad: ${estado} - ${observaciones?.substring(0, 100) || 'Sin observación'}`
            });
            documento.historialEstados = historial;

            // Guardar cambios
            await queryRunner.manager.save(Documento, documento);
            await queryRunner.manager.save(ContabilidadDocumento, contabilidadDoc);

            // Registrar acceso
            if (documento.rutaCarpetaRadicado) {
                await this.registrarAccesoContabilidad(
                    documento.rutaCarpetaRadicado,
                    contadorId,
                    `FINALIZÓ revisión contabilidad`,
                    `Estado: ${estado}`
                );
            }

            await queryRunner.commitTransaction();

            this.logger.log(`✅ Documento ${documento.numeroRadicado} finalizado por contabilidad`);

            return {
                success: true,
                message: `Documento ${estadoNuevoDocumento} exitosamente`,
                documento
            };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error(`❌ Error finalizando documento: ${error.message}`);
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

    // Liberar documento
    async liberarDocumento(documentoId: string, contadorId: string): Promise<{ success: boolean; message: string }> {
        this.logger.log(`🔄 Contador ${contadorId} liberando documento ${documentoId}`);

        const queryRunner = this.contabilidadRepository.manager.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const contabilidadDoc = await queryRunner.manager.findOne(ContabilidadDocumento, {
                where: {
                    documento: { id: documentoId },
                    contador: { id: contadorId },
                    estado: ContabilidadEstado.EN_REVISION
                },
                relations: ['documento', 'contador']
            });

            if (!contabilidadDoc) {
                throw new NotFoundException('No tienes este documento en revisión');
            }

            const documento = contabilidadDoc.documento;

            // Restaurar estado anterior del documento
            documento.estado = 'APROBADO_AUDITOR'; // Volver a estado de auditoría
            documento.fechaActualizacion = new Date();
            documento.ultimoAcceso = new Date();
            documento.ultimoUsuario = `Contabilidad: ${contabilidadDoc.contador.fullName || contabilidadDoc.contador.username} (liberó)`;
            documento.usuarioAsignado = null;
            documento.usuarioAsignadoNombre = '';

            // Agregar al historial
            const historial = documento.historialEstados || [];
            historial.push({
                fecha: new Date(),
                estado: 'APROBADO_AUDITOR',
                usuarioId: contadorId,
                usuarioNombre: contabilidadDoc.contador.fullName || contabilidadDoc.contador.username,
                rolUsuario: 'CONTABILIDAD',
                observacion: 'Documento liberado por contabilidad - Volvió a estado APROBADO_AUDITOR'
            });
            documento.historialEstados = historial;

            // Actualizar registro de contabilidad
            contabilidadDoc.estado = ContabilidadEstado.DISPONIBLE;
            contabilidadDoc.fechaActualizacion = new Date();
            contabilidadDoc.fechaFinRevision = new Date();
            contabilidadDoc.observaciones = 'Documento liberado - Disponible para otros contadores';

            await queryRunner.manager.save(Documento, documento);
            await queryRunner.manager.save(ContabilidadDocumento, contabilidadDoc);

            // Registrar acceso
            if (documento.rutaCarpetaRadicado) {
                await this.registrarAccesoContabilidad(
                    documento.rutaCarpetaRadicado,
                    contadorId,
                    `LIBERÓ documento`,
                    `Estado: EN_REVISION_CONTABILIDAD → APROBADO_AUDITOR`
                );
            }

            await queryRunner.commitTransaction();

            return {
                success: true,
                message: 'Documento liberado correctamente y disponible para otros contadores'
            };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error(`❌ Error liberando documento: ${error.message}`);
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

    // Obtener mis auditorías (para contabilidad)
    async obtenerMisAuditorias(contadorId: string): Promise<any[]> {
        this.logger.log(`📋 Obteniendo MIS auditorías para contadorId: ${contadorId}`);

        const contabilidadDocs = await this.contabilidadRepository.find({
            where: { contador: { id: contadorId } },
            relations: ['documento', 'contador'],
            order: { fechaActualizacion: 'DESC' }
        });

        return contabilidadDocs.map(cd => ({
            id: cd.documento.id,
            numeroRadicado: cd.documento.numeroRadicado,
            numeroContrato: cd.documento.numeroContrato,
            nombreContratista: cd.documento.nombreContratista,
            documentoContratista: cd.documento.documentoContratista,
            fechaRadicacion: cd.documento.fechaRadicacion,
            estado: cd.documento.estado,
            contabilidadEstado: cd.estado,
            observaciones: cd.observaciones || '',
            fechaInicioRevision: cd.fechaInicioRevision,
            fechaFinRevision: cd.fechaFinRevision,
            tieneGlosa: cd.tieneGlosa,
            tipoCausacion: cd.tipoCausacion,
            supervisor: cd.documento.usuarioAsignadoNombre || 'No asignado',
            contadorAsignado: cd.contador?.fullName || cd.contador?.username,
        }));
    }

    // Obtener documento para vista
    async obtenerDocumentoParaVista(documentoId: string, contadorId?: string): Promise<any> {
        this.logger.log(`🔍 Solicitando documento ${documentoId} para vista de contabilidad`);

        const documento = await this.documentoRepository.findOne({
            where: { id: documentoId },
            relations: ['radicador', 'usuarioAsignado'],
        });

        if (!documento) {
            throw new NotFoundException(`Documento ${documentoId} no encontrado`);
        }

        const estadosPermitidos = [
            'APROBADO_AUDITOR',
            'COMPLETADO_AUDITOR',
            'EN_REVISION_CONTABILIDAD',
            'GLOSADO_CONTABILIDAD',
            'PROCESADO_CONTABILIDAD',
            'COMPLETADO_CONTABILIDAD',
            'OBSERVADO_CONTABILIDAD',
        ];

        if (!estadosPermitidos.includes(documento.estado)) {
            throw new ForbiddenException(`Estado no permitido: ${documento.estado}`);
        }

        let contabilidadDoc: ContabilidadDocumento | null = null;
        let auditorDoc: AuditorDocumento | null = null;

        if (contadorId) {
            contabilidadDoc = await this.contabilidadRepository.findOne({
                where: {
                    documento: { id: documentoId },
                    contador: { id: contadorId },
                },
                relations: ['contador'],
            });

            auditorDoc = await this.auditorDocumentoRepository.findOne({
                where: { documento: { id: documentoId } },
                relations: ['auditor'],
                order: { fechaActualizacion: 'DESC' }
            });
        }

        const archivosRadicados = [
            {
                numero: 1,
                nombre: documento.cuentaCobro,
                descripcion: documento.descripcionCuentaCobro,
                tipo: 'cuenta_cobro',
                existe: !!documento.cuentaCobro,
            },
            {
                numero: 2,
                nombre: documento.seguridadSocial,
                descripcion: documento.descripcionSeguridadSocial,
                tipo: 'seguridad_social',
                existe: !!documento.seguridadSocial,
            },
            {
                numero: 3,
                nombre: documento.informeActividades,
                descripcion: documento.descripcionInformeActividades,
                tipo: 'informe_actividades',
                existe: !!documento.informeActividades,
            },
        ];

        const archivosAuditor = auditorDoc ? [
            { tipo: 'rp', descripcion: 'Resolución de Pago', subido: !!auditorDoc.rpPath, nombreArchivo: auditorDoc.rpPath },
            { tipo: 'cdp', descripcion: 'Certificado de Disponibilidad Presupuestal', subido: !!auditorDoc.cdpPath, nombreArchivo: auditorDoc.cdpPath },
            { tipo: 'poliza', descripcion: 'Póliza', subido: !!auditorDoc.polizaPath, nombreArchivo: auditorDoc.polizaPath },
            { tipo: 'certificadoBancario', descripcion: 'Certificado Bancario', subido: !!auditorDoc.certificadoBancarioPath, nombreArchivo: auditorDoc.certificadoBancarioPath },
            { tipo: 'minuta', descripcion: 'Minuta', subido: !!auditorDoc.minutaPath, nombreArchivo: auditorDoc.minutaPath },
            { tipo: 'actaInicio', descripcion: 'Acta de Inicio', subido: !!auditorDoc.actaInicioPath, nombreArchivo: auditorDoc.actaInicioPath },
        ] : [];

        const archivosContabilidad = contabilidadDoc ? [
            {
                tipo: 'glosa',
                descripcion: 'Documento de Glosa',
                subido: !!contabilidadDoc.glosaPath,
                nombreArchivo: contabilidadDoc.glosaPath,
                requerido: contabilidadDoc.tieneGlosa === true
            },
            {
                tipo: 'causacion',
                descripcion: contabilidadDoc.tipoCausacion === TipoCausacion.NOTA_DEBITO ? 'Nota Débito' :
                    contabilidadDoc.tipoCausacion === TipoCausacion.NOTA_CREDITO ? 'Nota Crédito' :
                        'Comprobante de Egreso',
                subido: !!contabilidadDoc.causacionPath,
                nombreArchivo: contabilidadDoc.causacionPath,
                requerido: true
            },
            {
                tipo: 'extracto',
                descripcion: 'Extracto Bancario',
                subido: !!contabilidadDoc.extractoPath,
                nombreArchivo: contabilidadDoc.extractoPath,
                requerido: contabilidadDoc.tieneGlosa === true
            },
            {
                tipo: 'comprobanteEgreso',
                descripcion: 'Comprobante de Egreso',
                subido: !!contabilidadDoc.comprobanteEgresoPath,
                nombreArchivo: contabilidadDoc.comprobanteEgresoPath,
                requerido: contabilidadDoc.tieneGlosa === false
            }
        ] : [];

        const respuesta = {
            data: {
                documento: {
                    id: documento.id,
                    numeroRadicado: documento.numeroRadicado,
                    numeroContrato: documento.numeroContrato,
                    nombreContratista: documento.nombreContratista,
                    documentoContratista: documento.documentoContratista,
                    fechaInicio: documento.fechaInicio,
                    fechaFin: documento.fechaFin,
                    fechaRadicacion: documento.fechaRadicacion,
                    radicador: documento.nombreRadicador,
                    supervisor: documento.usuarioAsignadoNombre,
                    observacion: documento.observacion,
                    estado: documento.estado,
                    estadoDocumento: documento.estado,
                    primerRadicadoDelAno: documento.primerRadicadoDelAno,
                    usuarioAsignadoNombre: documento.usuarioAsignadoNombre,
                    historialEstados: documento.historialEstados || [],
                    rutaCarpetaRadicado: documento.rutaCarpetaRadicado,
                    cuentaCobro: documento.cuentaCobro,
                    seguridadSocial: documento.seguridadSocial,
                    informeActividades: documento.informeActividades,
                    descripcionCuentaCobro: documento.descripcionCuentaCobro,
                    descripcionSeguridadSocial: documento.descripcionSeguridadSocial,
                    descripcionInformeActividades: documento.descripcionInformeActividades,
                },
                archivosRadicados,
                archivosAuditor,
                archivosContabilidad,
                auditor: auditorDoc
                    ? {
                        id: auditorDoc.id,
                        estado: auditorDoc.estado,
                        observaciones: auditorDoc.observaciones,
                        auditor: auditorDoc.auditor?.fullName || auditorDoc.auditor?.username,
                    }
                    : null,
                contabilidad: contabilidadDoc
                    ? {
                        id: contabilidadDoc.id,
                        estado: contabilidadDoc.estado,
                        tieneGlosa: contabilidadDoc.tieneGlosa,
                        tipoCausacion: contabilidadDoc.tipoCausacion,
                        observaciones: contabilidadDoc.observaciones,
                        fechaCreacion: contabilidadDoc.fechaCreacion,
                        fechaInicioRevision: contabilidadDoc.fechaInicioRevision,
                        fechaFinRevision: contabilidadDoc.fechaFinRevision,
                        puedeFinalizar: contabilidadDoc.puedeFinalizar().puede,
                        documentosSubidos: archivosContabilidad.filter(a => a.subido).map(a => a.tipo),
                        contador: contabilidadDoc.contador?.fullName || contabilidadDoc.contador?.username,
                    }
                    : null,
            }
        };

        return respuesta;
    }

    // Método para descargar archivos
    async descargarArchivoContabilidad(
        documentoId: string,
        tipo: string,
        contadorId: string
    ): Promise<{ ruta: string; nombre: string }> {
        const contabilidadDoc = await this.contabilidadRepository.findOne({
            where: {
                documento: { id: documentoId },
                contador: { id: contadorId }
            },
            relations: ['documento'],
        });

        if (!contabilidadDoc) {
            throw new ForbiddenException('No tienes acceso a este documento');
        }

        const documento = contabilidadDoc.documento;

        let nombreArchivo: string | null = null;

        switch (tipo.toLowerCase()) {
            case 'glosa':
                nombreArchivo = contabilidadDoc.glosaPath;
                break;
            case 'causacion':
                nombreArchivo = contabilidadDoc.causacionPath;
                break;
            case 'extracto':
                nombreArchivo = contabilidadDoc.extractoPath;
                break;
            case 'comprobanteegreso':
                nombreArchivo = contabilidadDoc.comprobanteEgresoPath;
                break;
            default:
                throw new BadRequestException('Tipo de archivo no válido');
        }

        if (!nombreArchivo) {
            throw new BadRequestException('Archivo no encontrado');
        }

        const rutaCompleta = path.join(documento.rutaCarpetaRadicado, nombreArchivo);

        if (!fs.existsSync(rutaCompleta)) {
            throw new BadRequestException('El archivo no existe en el servidor');
        }

        const nombreDescarga = path.basename(nombreArchivo);

        await this.registrarAccesoContabilidad(
            documento.rutaCarpetaRadicado,
            contadorId,
            `DESCARGÓ archivo contabilidad`,
            `Tipo: ${tipo} - ${nombreDescarga}`
        );

        return {
            ruta: rutaCompleta,
            nombre: nombreDescarga
        };
    }

    // Obtener ruta completa del archivo (para vistas públicas)
    async obtenerRutaArchivoContabilidadFull(
        documentoId: string,
        tipo: string,
        userId?: string,
    ): Promise<{ rutaAbsoluta: string; nombreArchivo: string }> {
        const logPrefix = `[obtenerRutaArchivoContabilidadFull] doc=${documentoId} tipo=${tipo} user=${userId || 'anon'}`;

        const documento = await this.documentoRepository.findOne({
            where: { id: documentoId },
        });

        if (!documento) {
            throw new NotFoundException(`Documento ${documentoId} no encontrado`);
        }

        let contabilidadDoc: ContabilidadDocumento | null = null;

        if (userId) {
            contabilidadDoc = await this.contabilidadRepository.findOne({
                where: {
                    documento: { id: documentoId },
                    contador: { id: userId }
                },
            });
        }

        // Si no se encuentra con usuario específico, buscar cualquier registro
        if (!contabilidadDoc) {
            contabilidadDoc = await this.contabilidadRepository.findOne({
                where: { documento: { id: documentoId } },
                order: { fechaActualizacion: 'DESC' }
            });
        }

        if (!contabilidadDoc) {
            throw new NotFoundException('Registro de contabilidad no encontrado');
        }

        let nombreArchivoBd: string | null = null;

        switch (tipo.toLowerCase()) {
            case 'glosa':
                nombreArchivoBd = contabilidadDoc.glosaPath;
                break;
            case 'causacion':
                nombreArchivoBd = contabilidadDoc.causacionPath;
                break;
            case 'extracto':
                nombreArchivoBd = contabilidadDoc.extractoPath;
                break;
            case 'comprobanteegreso':
                nombreArchivoBd = contabilidadDoc.comprobanteEgresoPath;
                break;
            default:
                throw new BadRequestException(`Tipo de archivo no soportado: ${tipo}`);
        }

        if (!nombreArchivoBd) {
            throw new NotFoundException(`No existe archivo registrado para tipo ${tipo}`);
        }

        let rutaBase = this.configService.get<string>('RUTA_BASE_ARCHIVOS') || '\\\\R2-D2\\api-contract';
        rutaBase = '\\\\' + rutaBase.replace(/^\\\\?/, '').replace(/^[\/\\]+/, '');

        let rutaCarpeta = documento.rutaCarpetaRadicado || '';
        rutaCarpeta = rutaCarpeta
            .replace(/^\\\\R2-D2\\api-contract/i, '')
            .replace(/^[\/\\]+/, '')
            .replace(/[\/\\]+$/, '')
            .trim();

        const rutaContabilidad = path.join(rutaCarpeta, 'contabilidad');

        let rutaAbsoluta = path.join(rutaBase, rutaContabilidad, nombreArchivoBd);
        rutaAbsoluta = rutaAbsoluta.replace(/\//g, '\\').replace(/^\\+/, '\\\\');

        if (!fs.existsSync(rutaAbsoluta)) {
            throw new NotFoundException(`Archivo ${tipo} no encontrado en disco`);
        }

        return { rutaAbsoluta, nombreArchivo: path.basename(nombreArchivoBd) };
    }

    // Métodos auxiliares privados
    private async guardarArchivoContabilidad(
        documento: Documento,
        archivo: Express.Multer.File,
        tipo: string,
        contadorId: string
    ): Promise<string> {
        try {
            const maxSize = 15 * 1024 * 1024;
            if (archivo.size > maxSize) {
                throw new BadRequestException(`El archivo ${tipo} excede el tamaño máximo de 15MB`);
            }

            const allowedMimes = [
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'image/jpeg',
                'image/png',
                'image/jpg'
            ];

            if (!allowedMimes.includes(archivo.mimetype)) {
                throw new BadRequestException(`Tipo de archivo no permitido para ${tipo}: ${archivo.mimetype}`);
            }

            const rutaContabilidad = path.join(documento.rutaCarpetaRadicado, 'contabilidad');
            if (!fs.existsSync(rutaContabilidad)) {
                fs.mkdirSync(rutaContabilidad, { recursive: true });
            }

            const extension = extname(archivo.originalname);
            const timestamp = Date.now();
            const randomHash = Math.random().toString(36).substring(7);

            const nombreArchivo = `${tipo}_${documento.numeroRadicado}_${timestamp}_${randomHash}${extension}`;
            const rutaCompleta = path.join(rutaContabilidad, nombreArchivo);

            fs.writeFileSync(rutaCompleta, archivo.buffer);

            // Guardar metadatos
            const metadatos = {
                nombreOriginal: archivo.originalname,
                nombreGuardado: nombreArchivo,
                mimeType: archivo.mimetype,
                tamanio: archivo.size,
                fechaSubida: new Date().toISOString(),
                tipoDocumento: tipo,
                contadorId: contadorId,
                documentoId: documento.id,
                numeroRadicado: documento.numeroRadicado
            };

            fs.writeFileSync(
                path.join(rutaContabilidad, `${tipo}_${timestamp}_${randomHash}_meta.json`),
                JSON.stringify(metadatos, null, 2)
            );

            this.logger.log(`💾 Archivo de contabilidad (${tipo}) guardado: ${rutaCompleta}`);

            return path.join('contabilidad', nombreArchivo);
        } catch (error) {
            this.logger.error(`❌ Error guardando archivo de contabilidad (${tipo}): ${error.message}`);
            throw new BadRequestException(`Error al guardar archivo ${tipo}: ${error.message}`);
        }
    }

    private mapearDocumentoParaRespuesta(documento: Documento, contabilidadDoc?: ContabilidadDocumento): any {
        return {
            id: documento.id,
            numeroRadicado: documento.numeroRadicado,
            numeroContrato: documento.numeroContrato,
            nombreContratista: documento.nombreContratista,
            documentoContratista: documento.documentoContratista,
            fechaInicio: documento.fechaInicio,
            fechaFin: documento.fechaFin,
            estado: documento.estado,
            fechaRadicacion: documento.fechaRadicacion,
            observacion: documento.observacion || '',
            primerRadicadoDelAno: documento.primerRadicadoDelAno,
            usuarioAsignadoNombre: documento.usuarioAsignadoNombre,
            asignacionContabilidad: contabilidadDoc
                ? {
                    id: contabilidadDoc.id,
                    estado: contabilidadDoc.estado,
                    tieneGlosa: contabilidadDoc.tieneGlosa,
                    tipoCausacion: contabilidadDoc.tipoCausacion,
                    fechaInicioRevision: contabilidadDoc.fechaInicioRevision,
                    contador: {
                        id: contabilidadDoc.contador.id,
                        nombre: contabilidadDoc.contador.fullName || contabilidadDoc.contador.username,
                    },
                }
                : null,
        };
    }



    private async registrarAccesoContabilidad(
        rutaCarpeta: string,
        contadorId: string,
        accion: string,
        detallesExtra?: string
    ): Promise<void> {
        try {
            if (!rutaCarpeta) {
                this.logger.warn('No hay rutaCarpeta para registrar acceso');
                return;
            }

            const rutaArchivo = path.join(rutaCarpeta, 'registro_accesos_contabilidad.txt');
            const fecha = new Date().toLocaleString('es-CO', {
                timeZone: 'America/Bogota',
                dateStyle: 'full',
                timeStyle: 'long'
            });

            const contador = await this.userRepository.findOne({ where: { id: contadorId } });
            const nombreContador = contador?.fullName || contador?.username || 'Contador desconocido';

            let registro = `[${fecha}] ${nombreContador} (${contador?.username || contadorId}) - CONTABILIDAD - ${accion}`;
            if (detallesExtra) {
                registro += ` | ${detallesExtra}`;
            }
            registro += '\n';

            let contenidoExistente = '';
            if (fs.existsSync(rutaArchivo)) {
                contenidoExistente = fs.readFileSync(rutaArchivo, 'utf8');
            }

            const lineas = contenidoExistente.split('\n');
            const lineasActualizadas = [...lineas.slice(-99), registro];
            fs.writeFileSync(rutaArchivo, lineasActualizadas.join('\n'), 'utf8');

            this.logger.log(`📝 Registro contabilidad actualizado: ${rutaArchivo} - ${accion}`);
        } catch (error) {
            this.logger.error(`⚠️ Error registrando acceso contabilidad: ${error.message}`);
        }
    }

    // Convertir Word a PDF
    async convertirWordAPdf(inputPath: string, outputPath: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const cmd = `soffice --headless --convert-to pdf --outdir "${path.dirname(outputPath)}" "${inputPath}"`;

            exec(cmd, (error: Error | null, stdout: string, stderr: string) => {
                if (error) {
                    this.logger.error(`[CONVERSIÓN ERROR] ${error.message}`);
                    return reject(error);
                }

                if (stderr) {
                    this.logger.warn(`[CONVERSIÓN STDERR] ${stderr}`);
                }

                const pdfGenerado = path.join(
                    path.dirname(outputPath),
                    path.basename(inputPath).replace(/\.(docx|doc)$/i, '.pdf')
                );

                if (fs.existsSync(pdfGenerado)) {
                    fs.renameSync(pdfGenerado, outputPath);
                    this.logger.log(`[CONVERSIÓN OK] PDF creado: ${outputPath}`);
                    resolve();
                } else {
                    reject(new Error(`No se generó el PDF esperado en ${path.dirname(outputPath)}`));
                }
            });
        });
    }

    // Obtener registro de contabilidad por documento y contador
    async obtenerContabilidadDocumento(documentoId: string, contadorId: string): Promise<ContabilidadDocumento | null> {
        return this.contabilidadRepository.findOne({
            where: {
                documento: { id: documentoId },
                contador: { id: contadorId },
            },
            relations: ['documento', 'contador'],
        });
    }
    private construirRespuestaDetalle(
        documento: Documento,
        contabilidadDoc: ContabilidadDocumento | null,
        auditorDoc: AuditorDocumento | null,
        contador: User,
    ): any {
        // Archivos radicados (ya lo tenías)
        const archivosRadicados = [
            {
                numero: 1,
                nombre: documento.cuentaCobro,
                descripcion: documento.descripcionCuentaCobro,
                tipo: 'cuenta_cobro',
                existe: documento.cuentaCobro ? fs.existsSync(path.join(documento.rutaCarpetaRadicado || '', documento.cuentaCobro)) : false,
            },
            {
                numero: 2,
                nombre: documento.seguridadSocial,
                descripcion: documento.descripcionSeguridadSocial,
                tipo: 'seguridad_social',
                existe: documento.seguridadSocial ? fs.existsSync(path.join(documento.rutaCarpetaRadicado || '', documento.seguridadSocial)) : false,
            },
            {
                numero: 3,
                nombre: documento.informeActividades,
                descripcion: documento.descripcionInformeActividades,
                tipo: 'informe_actividades',
                existe: documento.informeActividades ? fs.existsSync(path.join(documento.rutaCarpetaRadicado || '', documento.informeActividades)) : false,
            }
        ];

        // ────────────────────────────────────────────────────────────────
        //  IMPORTANTE: AGREGAMOS archivosAuditor aquí
        // ────────────────────────────────────────────────────────────────
        const archivosAuditor = auditorDoc ? [
            {
                tipo: 'rp',
                descripcion: 'Resolución de Pago (RP)',
                subido: !!auditorDoc.rpPath,
                nombreArchivo: auditorDoc.rpPath || 'No subido'
            },
            {
                tipo: 'cdp',
                descripcion: 'Certificado de Disponibilidad Presupuestal (CDP)',
                subido: !!auditorDoc.cdpPath,
                nombreArchivo: auditorDoc.cdpPath || 'No subido'
            },
            {
                tipo: 'poliza',
                descripcion: 'Póliza de Cumplimiento',
                subido: !!auditorDoc.polizaPath,
                nombreArchivo: auditorDoc.polizaPath || 'No subido'
            },
            {
                tipo: 'certificadoBancario',
                descripcion: 'Certificado Bancario',
                subido: !!auditorDoc.certificadoBancarioPath,
                nombreArchivo: auditorDoc.certificadoBancarioPath || 'No subido'
            },
            {
                tipo: 'minuta',
                descripcion: 'Minuta de Contrato',
                subido: !!auditorDoc.minutaPath,
                nombreArchivo: auditorDoc.minutaPath || 'No subido'
            },
            {
                tipo: 'actaInicio',
                descripcion: 'Acta de Inicio',
                subido: !!auditorDoc.actaInicioPath,
                nombreArchivo: auditorDoc.actaInicioPath || 'No subido'
            }
        ] : [];

        // Archivos de contabilidad (ya lo tenías)
        const archivosContabilidad = contabilidadDoc ? [
            {
                tipo: 'glosa',
                descripcion: 'Documento de Glosa',
                subido: !!contabilidadDoc.glosaPath,
                nombreArchivo: contabilidadDoc.glosaPath,
                requerido: contabilidadDoc.tieneGlosa === true
            },
            {
                tipo: 'causacion',
                descripcion: contabilidadDoc.tipoCausacion === TipoCausacion.NOTA_DEBITO ? 'Nota Débito' :
                    contabilidadDoc.tipoCausacion === TipoCausacion.NOTA_CREDITO ? 'Nota Crédito' :
                        'Comprobante de Egreso',
                subido: !!contabilidadDoc.causacionPath,
                nombreArchivo: contabilidadDoc.causacionPath,
                requerido: true
            },
            {
                tipo: 'extracto',
                descripcion: 'Extracto Bancario',
                subido: !!contabilidadDoc.extractoPath,
                nombreArchivo: contabilidadDoc.extractoPath,
                requerido: contabilidadDoc.tieneGlosa === true
            },
            {
                tipo: 'comprobanteEgreso',
                descripcion: 'Comprobante de Egreso',
                subido: !!contabilidadDoc.comprobanteEgresoPath,
                nombreArchivo: contabilidadDoc.comprobanteEgresoPath,
                requerido: contabilidadDoc.tieneGlosa === false
            }
        ] : [];

        // Actualizar último acceso
        documento.ultimoAcceso = new Date();
        documento.ultimoUsuario = `Contabilidad: ${contador.username}`;
        this.documentoRepository.save(documento).catch(err => {
            this.logger.warn(`Error actualizando ultimo acceso: ${err.message}`);
        });

        // Respuesta completa
        return {
            documento: {
                id: documento.id,
                numeroRadicado: documento.numeroRadicado,
                numeroContrato: documento.numeroContrato,
                nombreContratista: documento.nombreContratista,
                documentoContratista: documento.documentoContratista,
                fechaInicio: documento.fechaInicio,
                fechaFin: documento.fechaFin,
                fechaRadicacion: documento.fechaRadicacion,
                radicador: documento.nombreRadicador,
                supervisor: documento.usuarioAsignadoNombre,
                observacion: documento.observacion,
                estadoActual: contabilidadDoc?.estado || 'DISPONIBLE',
                estadoDocumento: documento.estado,
                primerRadicadoDelAno: documento.primerRadicadoDelAno,
                usuarioAsignado: documento.usuarioAsignadoNombre,
                historialEstados: documento.historialEstados || [],
                rutaCarpeta: documento.rutaCarpetaRadicado,
                cuentaCobro: documento.cuentaCobro,
                seguridadSocial: documento.seguridadSocial,
                informeActividades: documento.informeActividades,
                descripcionCuentaCobro: documento.descripcionCuentaCobro,
                descripcionSeguridadSocial: documento.descripcionSeguridadSocial,
                descripcionInformeActividades: documento.descripcionInformeActividades,
            },
            archivosRadicados,
            archivosAuditor,           // ← Esto es lo nuevo y crítico
            archivosContabilidad,
            auditor: auditorDoc ? {
                id: auditorDoc.id,
                auditor: auditorDoc.auditor?.fullName || auditorDoc.auditor?.username,
                estado: auditorDoc.estado,
                observaciones: auditorDoc.observaciones,
                fechaAprobacion: auditorDoc.fechaAprobacion
            } : null,
            contabilidad: contabilidadDoc ? {
                id: contabilidadDoc.id,
                estado: contabilidadDoc.estado,
                tieneGlosa: contabilidadDoc.tieneGlosa,
                tipoCausacion: contabilidadDoc.tipoCausacion,
                observaciones: contabilidadDoc.observaciones,
                fechaCreacion: contabilidadDoc.fechaCreacion,
                fechaInicioRevision: contabilidadDoc.fechaInicioRevision,
                fechaFinRevision: contabilidadDoc.fechaFinRevision,
                puedeFinalizar: contabilidadDoc.puedeFinalizar().puede,
                documentosSubidos: archivosContabilidad.filter(a => a.subido).map(a => a.tipo),
            } : null
        };
    }



// En getHistorial (el In ahora usa los valores correctos del enum)

async getHistorial(contadorId: string): Promise<any[]> {
  this.logger.log(`Obteniendo historial para contador ${contadorId}`);

  const contabilidadDocs = await this.contabilidadRepository.find({
    where: {
      contador: { id: contadorId },
      estado: In([
        ContabilidadEstado.PROCESADO_CONTABILIDAD,
        ContabilidadEstado.COMPLETADO_CONTABILIDAD,
        ContabilidadEstado.GLOSADO_CONTABILIDAD,
        ContabilidadEstado.OBSERVADO_CONTABILIDAD,
        ContabilidadEstado.RECHAZADO_CONTABILIDAD
      ])
    },
    relations: ['documento', 'contador'],
    order: { fechaActualizacion: 'DESC' }
  });

  return contabilidadDocs.map(cd => ({
    id: cd.id,
    documento: {
      id: cd.documento.id,
      numeroRadicado: cd.documento.numeroRadicado,
      numeroContrato: cd.documento.numeroContrato,
      nombreContratista: cd.documento.nombreContratista,
      documentoContratista: cd.documento.documentoContratista,
      fechaInicio: cd.documento.fechaInicio,
      fechaFin: cd.documento.fechaFin,
      fechaRadicacion: cd.documento.fechaRadicacion,
      fechaActualizacion: cd.documento.fechaActualizacion
    },
    estado: cd.estado,
    observaciones: cd.observaciones || '',
    tieneGlosa: cd.tieneGlosa,
    tipoCausacion: cd.tipoCausacion,
    fechaActualizacion: cd.fechaActualizacion,
    fechaFinRevision: cd.fechaFinRevision,
    contadorRevisor: cd.contador?.fullName || cd.contador?.username || 'Contador'
  }));
}

}