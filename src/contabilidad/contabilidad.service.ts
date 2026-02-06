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
            select: ['id', 'username', 'role', 'fullName']
        });

        if (!user) {
            this.logger.warn(`Usuario no encontrado: ${userId}`);
            throw new NotFoundException('Usuario no encontrado');
        }

        this.logger.debug(`Usuario encontrado: ${user.username} (${user.role})`);

        // 2. Buscar el documento principal
        const documento = await this.documentoRepository.findOne({
            where: { id: documentoId },
            relations: ['radicador', 'usuarioAsignado'],
        });

        if (!documento) {
            this.logger.warn(`Documento no encontrado: ${documentoId}`);
            throw new NotFoundException('Documento no encontrado');
        }

        // 3. Estados permitidos por rol (lógica central aquí)
        const rol = user.role?.toLowerCase() || '';
        const estado = documento.estado?.toUpperCase() || '';

        let tieneAcceso = false;

        if (rol === 'contabilidad' || rol === 'admin') {
            tieneAcceso =
                estado.includes('CONTABILIDAD') ||
                estado === 'APROBADO' ||
                estado.includes('RECHAZADO_CONTABILIDAD') ||
                estado.includes('OBSERVADO_CONTABILIDAD') ||
                estado.includes('GLOSADO_CONTABILIDAD') ||
                estado.includes('COMPLETADO_CONTABILIDAD') ||
                estado.includes('PROCESADO_CONTABILIDAD') ||
                estado === 'APROBADO_AUDITOR' ||           // permite ver justo después de auditoría
                estado === 'COMPLETADO_AUDITOR';
        } else if (rol === 'supervisor') {
            tieneAcceso = ['RADICADO', 'EN_REVISION_SUPERVISOR'].includes(estado);
        } else if (rol === 'auditor') {
            tieneAcceso = estado.includes('AUDITOR') || estado === 'APROBADO';
        }

        if (!tieneAcceso) {
            this.logger.warn(`Acceso denegado - Estado: ${estado} - Rol: ${rol}`);
            throw new ForbiddenException(
                `Solo puedes acceder a documentos en estado RADICADO, EN_REVISION_SUPERVISOR o estados de contabilidad (actual: ${estado})`
            );
        }

        // 4. Buscar registro de contabilidad (solo si el usuario es contador)
        let contabilidadDoc: ContabilidadDocumento | null = null;
        if (rol === 'contabilidad' || rol === 'admin') {
            contabilidadDoc = await this.contabilidadRepository.findOne({
                where: {
                    documento: { id: documentoId },
                    contador: { id: userId }
                },
                relations: ['contador'],
            });
        }

        // 5. Buscar la última auditoría (si existe)
        const auditorDoc = await this.auditorDocumentoRepository.findOne({
            where: { documento: { id: documentoId } },
            relations: ['auditor'],
            order: { fechaActualizacion: 'DESC' }
        });

        // 6. Construir respuesta completa
        const respuesta = this.construirRespuestaDetalle(documento, contabilidadDoc, auditorDoc, user);

        // 7. Registrar acceso (con manejo seguro de radicador_id NULL)
        await this.registrarUltimoAcceso(documento, user);

        this.logger.log(`Detalle entregado exitosamente para documento ${documentoId} a ${user.username}`);
        return respuesta;
    }

    private async registrarUltimoAcceso(documento: Documento, user: User): Promise<void> {
        try {
            // Verificamos si existe el objeto relacionado 'radicador' (ya existe en tu entidad)
            if (!documento.radicador) {
                this.logger.warn(
                    `No se actualiza ultimoAcceso en documento ${documento.id}: no tiene radicador asociado`
                );
                return; // Salimos sin error, no bloqueamos la consulta principal
            }

            // Si sí existe radicador, procedemos normalmente
            documento.ultimoAcceso = new Date();
            documento.ultimoUsuario = user.username || user.email || 'Sistema';

            await this.documentoRepository.save(documento);

            this.logger.debug(
                `Ultimo acceso actualizado en documento ${documento.id} por ${user.username}`
            );
        } catch (error: any) {
            this.logger.error(
                `Error actualizando ultimo acceso en documento ${documento.id}: ${error.message}`,
                error.stack
            );
            // No lanzamos excepción → no queremos que rompa la carga del detalle
        }
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
    // En ContabilidadService.ts
    async subirDocumentosContabilidad(
        documentoId: string,
        contadorId: string,
        datos: {
            tipoCausacion?: TipoCausacion;
            observaciones?: string;
            tieneGlosa?: boolean;
            estadoFinal?: string;
        },
        files: { [key: string]: Express.Multer.File[] },
    ): Promise<{ success: boolean; message: string; contabilidad: ContabilidadDocumento }> {
        const logPrefix = `[SUBIR-DOCS] doc=${documentoId} contador=${contadorId}`;
        this.logger.log(`${logPrefix} Iniciando subida...`);

        // Log de los archivos recibidos
        this.logger.log(`${logPrefix} Archivos recibidos: ${files ? Object.keys(files).join(', ') : 'NINGUNO'}`);
        if (files) {
            Object.keys(files).forEach(key => {
                if (files[key] && files[key][0]) {
                    const file = files[key][0];
                    this.logger.log(`${logPrefix}   → ${key}: ${file.originalname} (${file.size} bytes, ${file.mimetype})`);
                }
            });
        }

        // 1. Buscar registro de contabilidad
        const contabilidadDoc = await this.contabilidadRepository.findOne({
            where: {
                documento: { id: documentoId },
                contador: { id: contadorId },
                estado: ContabilidadEstado.EN_REVISION
            },
            relations: ['documento', 'contador']
        });

        if (!contabilidadDoc) {
            this.logger.error(`${logPrefix} No tiene el documento en revisión`);
            throw new ForbiddenException('No tienes este documento asignado en revisión');
        }

        const documento = contabilidadDoc.documento;
        const contador = contabilidadDoc.contador;

        this.logger.log(`${logPrefix} Documento: ${documento.numeroRadicado}, Contador: ${contador.username}`);

        // 2. Validar que existe la carpeta del radicado
        if (!documento.rutaCarpetaRadicado) {
            this.logger.error(`${logPrefix} No tiene rutaCarpetaRadicado`);
            throw new BadRequestException('El documento no tiene ruta de carpeta asignada');
        }

        if (!fs.existsSync(documento.rutaCarpetaRadicado)) {
            this.logger.error(`${logPrefix} Carpeta no existe: ${documento.rutaCarpetaRadicado}`);
            throw new BadRequestException(`La carpeta del documento no existe: ${documento.rutaCarpetaRadicado}`);
        }

        // 3. Crear carpeta contabilidad si no existe
        const carpetaContabilidad = path.join(documento.rutaCarpetaRadicado, 'contabilidad');
        if (!fs.existsSync(carpetaContabilidad)) {
            fs.mkdirSync(carpetaContabilidad, { recursive: true });
            this.logger.log(`${logPrefix} 📁 Creada carpeta contabilidad: ${carpetaContabilidad}`);
        }

        // 4. Actualizar datos básicos
        if (datos.observaciones) {
            contabilidadDoc.observaciones = datos.observaciones;
        }

        if (datos.tieneGlosa !== undefined) {
            contabilidadDoc.tieneGlosa = datos.tieneGlosa;
            this.logger.log(`${logPrefix} Glosa definida: ${datos.tieneGlosa}`);
        }

        if (datos.tipoCausacion) {
            contabilidadDoc.tipoCausacion = datos.tipoCausacion;
            this.logger.log(`${logPrefix} Tipo causación: ${datos.tipoCausacion}`);
        }

        contabilidadDoc.fechaActualizacion = new Date();

        const archivosGuardados: Record<string, string> = {};

        // 5. Función mejorada para guardar archivos
        const guardarArchivo = async (tipo: string, file?: Express.Multer.File): Promise<boolean> => {
            if (!file) {
                this.logger.log(`${logPrefix} ⚠️ No se recibió archivo para ${tipo}`);
                return false;
            }

            // Validar que el archivo tiene buffer
            if (!file.buffer || file.buffer.length === 0) {
                this.logger.error(`${logPrefix} ❌ Archivo ${tipo} no tiene buffer o está vacío`);
                throw new BadRequestException(`El archivo ${tipo} no tiene datos. Verifica la configuración.`);
            }

            const maxSize = 15 * 1024 * 1024;
            if (file.size > maxSize) {
                throw new BadRequestException(`El archivo ${tipo} (${file.originalname}) excede 15MB`);
            }

            // Validar tipo de archivo
            const allowedMimes = [
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'image/jpeg',
                'image/png',
                'image/jpg',
            ];

            if (!allowedMimes.includes(file.mimetype)) {
                throw new BadRequestException(`Tipo de archivo no permitido para ${tipo}: ${file.mimetype}`);
            }

            try {
                // Generar nombre único
                const extension = path.extname(file.originalname).toLowerCase() || this.obtenerExtensionPorMime(file.mimetype);
                const timestamp = Date.now();
                const hash = crypto.randomBytes(4).toString('hex');
                const nombreArchivo = `${tipo}_${documento.numeroRadicado}_${timestamp}_${hash}${extension}`;
                const rutaCompleta = path.join(carpetaContabilidad, nombreArchivo);

                this.logger.log(`${logPrefix} 💾 Guardando ${tipo} (${file.originalname}) en: ${rutaCompleta}`);

                // Guardar el archivo
                fs.writeFileSync(rutaCompleta, file.buffer);

                // Verificar que se guardó correctamente
                if (!fs.existsSync(rutaCompleta)) {
                    this.logger.error(`${logPrefix} ❌ Archivo no se creó: ${rutaCompleta}`);
                    throw new InternalServerErrorException(`No se pudo guardar el archivo ${tipo}`);
                }

                // Verificar tamaño del archivo guardado
                const stats = fs.statSync(rutaCompleta);
                if (stats.size === 0) {
                    this.logger.error(`${logPrefix} ❌ Archivo se guardó vacío: ${rutaCompleta}`);
                    fs.unlinkSync(rutaCompleta); // Eliminar archivo vacío
                    throw new InternalServerErrorException(`El archivo ${tipo} se guardó vacío`);
                }

                archivosGuardados[tipo] = nombreArchivo;

                // Actualizar ruta en la entidad según el tipo
                const rutaRelativa = path.join('contabilidad', nombreArchivo).replace(/\\/g, '/');
                const fechaActual = new Date();

                switch (tipo) {
                    case 'glosa':
                        contabilidadDoc.glosaPath = rutaRelativa;
                        contabilidadDoc.fechaGlosa = fechaActual;
                        this.logger.log(`${logPrefix} ✅ Glosa guardada: ${rutaRelativa}`);
                        break;
                    case 'causacion':
                        contabilidadDoc.causacionPath = rutaRelativa;
                        contabilidadDoc.fechaCausacion = fechaActual;
                        this.logger.log(`${logPrefix} ✅ Causación guardada: ${rutaRelativa}`);
                        break;
                    case 'extracto':
                        contabilidadDoc.extractoPath = rutaRelativa;
                        contabilidadDoc.fechaExtracto = fechaActual;
                        this.logger.log(`${logPrefix} ✅ Extracto guardado: ${rutaRelativa}`);
                        break;
                    case 'comprobante_egreso':
                        contabilidadDoc.comprobanteEgresoPath = rutaRelativa;
                        contabilidadDoc.fechaComprobanteEgreso = fechaActual;
                        this.logger.log(`${logPrefix} ✅ Comprobante egreso guardado: ${rutaRelativa}`);
                        break;
                    default:
                        this.logger.warn(`${logPrefix} ⚠️ Tipo desconocido: ${tipo}`);
                }

                this.logger.log(`${logPrefix} ✅ ${tipo} guardado correctamente: ${nombreArchivo} (${stats.size} bytes)`);
                return true;

            } catch (error) {
                this.logger.error(`${logPrefix} ❌ Error guardando ${tipo}: ${error.message}`, error.stack);
                throw new InternalServerErrorException(`Error al guardar ${tipo}: ${error.message}`);
            }
        };

        // Método auxiliar para obtener extensión
        const obtenerExtensionPorMime = (mimeType: string): string => {
            const mimeToExt: Record<string, string> = {
                'application/pdf': '.pdf',
                'application/msword': '.doc',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
                'image/jpeg': '.jpg',
                'image/png': '.png',
                'image/jpg': '.jpg',
            };
            return mimeToExt[mimeType] || '.bin';
        };

        // 6. Guardar cada archivo individualmente con manejo de errores
        try {
            // Glosa
            if (files['glosa'] && files['glosa'][0]) {
                await guardarArchivo('glosa', files['glosa'][0]);
            }

            // Causación
            if (files['causacion'] && files['causacion'][0]) {
                await guardarArchivo('causacion', files['causacion'][0]);
            }

            // Extracto
            if (files['extracto'] && files['extracto'][0]) {
                await guardarArchivo('extracto', files['extracto'][0]);
            }

            // Comprobante de Egreso
            if (files['comprobanteEgreso'] && files['comprobanteEgreso'][0]) {
                await guardarArchivo('comprobante_egreso', files['comprobanteEgreso'][0]);
            }

        } catch (error) {
            this.logger.error(`${logPrefix} ❌ Error durante la subida de archivos: ${error.message}`, error.stack);
            throw error;
        }

        // 7. Validación para estado APROBADO
        if (datos.estadoFinal?.toUpperCase() === 'APROBADO') {
            if (!contabilidadDoc.comprobanteEgresoPath) {
                this.logger.error(`${logPrefix} ❌ Para APROBAR debe subir comprobante de egreso`);
                throw new BadRequestException('Para APROBAR es obligatorio subir el Comprobante de Egreso');
            }
        }

        // 8. Mapear estado final
        let estadoFinalMapeado: ContabilidadEstado | undefined;
        if (datos.estadoFinal) {
            const estadoUpper = datos.estadoFinal.toUpperCase();
            switch (estadoUpper) {
                case 'APROBADO':
                    estadoFinalMapeado = ContabilidadEstado.COMPLETADO_CONTABILIDAD;
                    break;
                case 'OBSERVADO':
                    estadoFinalMapeado = ContabilidadEstado.OBSERVADO_CONTABILIDAD;
                    break;
                case 'RECHAZADO':
                    estadoFinalMapeado = ContabilidadEstado.RECHAZADO_CONTABILIDAD;
                    break;
                default:
                    this.logger.warn(`${logPrefix} ⚠️ Estado final no reconocido: ${datos.estadoFinal}`);
            }
        }

        // 9. Aplicar estado si se definió
        if (estadoFinalMapeado) {
            contabilidadDoc.estado = estadoFinalMapeado;
            contabilidadDoc.fechaFinRevision = new Date();

            // Actualizar estado del documento principal
            let nuevoEstadoDocumento = documento.estado;
            switch (estadoFinalMapeado) {
                case ContabilidadEstado.COMPLETADO_CONTABILIDAD:
                    nuevoEstadoDocumento = 'COMPLETADO_CONTABILIDAD';
                    break;
                case ContabilidadEstado.OBSERVADO_CONTABILIDAD:
                    nuevoEstadoDocumento = 'OBSERVADO_CONTABILIDAD';
                    break;
                case ContabilidadEstado.RECHAZADO_CONTABILIDAD:
                    nuevoEstadoDocumento = 'RECHAZADO_CONTABILIDAD';
                    break;
            }

            if (documento.estado !== nuevoEstadoDocumento) {
                documento.estado = nuevoEstadoDocumento;
                documento.fechaActualizacion = new Date();

                // Agregar al historial
                const historial = documento.historialEstados || [];
                historial.push({
                    fecha: new Date(),
                    estado: nuevoEstadoDocumento,
                    usuarioId: contadorId,
                    usuarioNombre: contador.fullName || contador.username,
                    rolUsuario: contador.role,
                    observacion: `Procesado por contabilidad: ${estadoFinalMapeado} - ${datos.observaciones?.substring(0, 100) || 'Sin observación'}`
                });
                documento.historialEstados = historial;

                await this.documentoRepository.save(documento);
                this.logger.log(`${logPrefix} ✅ Estado documento actualizado: ${documento.estado}`);
            }
        }

        // 10. Guardar cambios en la base de datos
        const saved = await this.contabilidadRepository.save(contabilidadDoc);

        // 11. Registrar acceso
        if (documento.rutaCarpetaRadicado) {
            await this.registrarAccesoContabilidad(
                documento.rutaCarpetaRadicado,
                contadorId,
                `SUBIÓ documentos contables`,
                `Archivos: ${Object.keys(archivosGuardados).join(', ') || 'ninguno'} | Estado: ${datos.estadoFinal || 'sin cambio'}`
            );
        }

        // 12. Log del resultado
        this.logger.log(`${logPrefix} 🎉 Subida completada exitosamente`);
        this.logger.log(`${logPrefix}   Archivos guardados: ${JSON.stringify(archivosGuardados)}`);
        this.logger.log(`${logPrefix}   Estado contabilidad: ${saved.estado}`);
        this.logger.log(`${logPrefix}   Ruta glosa: ${saved.glosaPath || 'NO'}`);
        this.logger.log(`${logPrefix}   Ruta causación: ${saved.causacionPath || 'NO'}`);
        this.logger.log(`${logPrefix}   Ruta extracto: ${saved.extractoPath || 'NO'}`);
        this.logger.log(`${logPrefix}   Ruta comprobante: ${saved.comprobanteEgresoPath || 'NO'}`);

        return {
            success: true,
            message: 'Documentos guardados correctamente en el servidor',
            contabilidad: saved
        };
    }

    // Agrega este método auxiliar si no existe
    private obtenerExtensionPorMime(mimeType: string): string {
        const mimeToExt: Record<string, string> = {
            'application/pdf': '.pdf',
            'application/msword': '.doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/jpg': '.jpg',
        };
        return mimeToExt[mimeType] || '.bin';
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
  user: User,
): any {
  // 1. Archivos radicados (los que sube el radicador)
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

  // 2. Archivos de auditoría
  const archivosAuditor = auditorDoc
    ? [
        { 
          tipo: 'rp', 
          descripcion: 'Resolución de Pago', 
          subido: !!auditorDoc.rpPath, 
          nombreArchivo: auditorDoc.rpPath 
        },
        { 
          tipo: 'cdp', 
          descripcion: 'Certificado de Disponibilidad Presupuestal', 
          subido: !!auditorDoc.cdpPath, 
          nombreArchivo: auditorDoc.cdpPath 
        },
        { 
          tipo: 'poliza', 
          descripcion: 'Póliza', 
          subido: !!auditorDoc.polizaPath, 
          nombreArchivo: auditorDoc.polizaPath 
        },
        { 
          tipo: 'certificadoBancario', 
          descripcion: 'Certificado Bancario', 
          subido: !!auditorDoc.certificadoBancarioPath, 
          nombreArchivo: auditorDoc.certificadoBancarioPath 
        },
        { 
          tipo: 'minuta', 
          descripcion: 'Minuta', 
          subido: !!auditorDoc.minutaPath, 
          nombreArchivo: auditorDoc.minutaPath 
        },
        { 
          tipo: 'actaInicio', 
          descripcion: 'Acta de Inicio', 
          subido: !!auditorDoc.actaInicioPath, 
          nombreArchivo: auditorDoc.actaInicioPath 
        },
      ]
    : [];

  // 3. Archivos de contabilidad (para mostrar en la sección de archivos contables)
  const archivosContabilidad = contabilidadDoc
    ? [
        { 
          tipo: 'glosa', 
          descripcion: 'Documento de Glosa', 
          subido: !!contabilidadDoc.glosaPath, 
          nombreArchivo: contabilidadDoc.glosaPath, 
          requerido: contabilidadDoc.tieneGlosa === true 
        },
        { 
          tipo: 'causacion', 
          descripcion: contabilidadDoc.tipoCausacion === TipoCausacion.NOTA_DEBITO 
            ? 'Nota Débito' 
            : contabilidadDoc.tipoCausacion === TipoCausacion.NOTA_CREDITO 
              ? 'Nota Crédito' 
              : 'Comprobante de Egreso / Causación',
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
        },
      ]
    : [];

  // 4. Respuesta completa
  return {
    // ───────────────────────────────────────────────────────────────
    // OBJETO PRINCIPAL: documento (aquí agregamos TODOS los campos de contabilidad)
    // ───────────────────────────────────────────────────────────────
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
      observacion: documento.observacion || '',  // observación general (del radicador/auditor)
      estado: documento.estado,
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

      // CAMPOS DE CONTABILIDAD – ESTO ES LO QUE FALTABA EN TU VERSIÓN ANTERIOR
      observacionesContabilidad: contabilidadDoc?.observaciones || '',  // ← observaciones del contador
      tieneGlosa: contabilidadDoc?.tieneGlosa ?? null,
      tipoCausacion: contabilidadDoc?.tipoCausacion || null,
      glosaPath: contabilidadDoc?.glosaPath || null,
      causacionPath: contabilidadDoc?.causacionPath || null,
      extractoPath: contabilidadDoc?.extractoPath || null,
      comprobanteEgresoPath: contabilidadDoc?.comprobanteEgresoPath || null,
      fechaGlosa: contabilidadDoc?.fechaGlosa || null,
      fechaCausacion: contabilidadDoc?.fechaCausacion || null,
      fechaExtracto: contabilidadDoc?.fechaExtracto || null,
      fechaComprobanteEgreso: contabilidadDoc?.fechaComprobanteEgreso || null,
    },

    // Secciones adicionales que ya tenías
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
  };
}


    async getHistorial(contadorId: string): Promise<any[]> {
        this.logger.log(`Obteniendo historial COMPLETO para contador ${contadorId}`);

        const contabilidadDocs = await this.contabilidadRepository.find({
            where: {
                contador: { id: contadorId },
                // → Quitamos el filtro de estados finales ←
                // estado: In([...])  ← eliminar esta línea
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
            estado: cd.estado,                     // ← muy importante devolver el estado real
            observaciones: cd.observaciones || '',
            tieneGlosa: cd.tieneGlosa,
            tipoCausacion: cd.tipoCausacion,
            fechaActualizacion: cd.fechaActualizacion,
            fechaFinRevision: cd.fechaFinRevision,
            fechaInicioRevision: cd.fechaInicioRevision,
            contadorRevisor: cd.contador?.fullName || cd.contador?.username || 'Contador'
        }));
    }

    async obtenerRechazadosVisibles(user: any): Promise<any[]> {
        const rolUsuario = user.role?.toLowerCase() || '';

        this.logger.log(`[RECHAZADOS-VISIBLES] Rol: ${rolUsuario} | Username: ${user.username}`);

        // Estados de rechazo posibles
        const estadosRechazo = [
            'RECHAZADO_SUPERVISOR',
            'RECHAZADO_AUDITOR_CUENTAS',
            'RECHAZADO_CONTABILIDAD',
            'RECHAZADO_TESORERIA',
            'RECHAZADO_ASESOR_GERENCIA',
            'RECHAZADO_RENDICION_CUENTAS',
            'OBSERVADO_CONTABILIDAD',
            'GLOSADO_CONTABILIDAD'
        ];

        const query = this.documentoRepository
            .createQueryBuilder('doc')
            .leftJoinAndSelect('doc.radicador', 'radicador')
            .where('doc.estado IN (:...estados)', { estados: estadosRechazo })
            .orderBy('doc.fechaActualizacion', 'DESC');

        let estadosPermitidos: string[] = [];

        switch (rolUsuario) {
            case 'admin':
                // Admin ve todo
                estadosPermitidos = estadosRechazo;
                break;

            case 'contabilidad':
                // Solo sus propios rechazos + superiores (TESORERIA, ASESOR, RENDICION)
                estadosPermitidos = [
                    'RECHAZADO_CONTABILIDAD',           // sus propios rechazos
                    'RECHAZADO_TESORERIA',
                    'RECHAZADO_ASESOR_GERENCIA',
                    'RECHAZADO_RENDICION_CUENTAS'
                ];
                break;

            case 'tesoreria':
                estadosPermitidos = [
                    'RECHAZADO_TESORERIA',
                    'RECHAZADO_ASESOR_GERENCIA',
                    'RECHAZADO_RENDICION_CUENTAS'
                ];
                break;

            case 'asesor_gerencia':
                estadosPermitidos = ['RECHAZADO_ASESOR_GERENCIA', 'RECHAZADO_RENDICION_CUENTAS'];
                break;

            case 'rendicion_cuentas':
                estadosPermitidos = ['RECHAZADO_RENDICION_CUENTAS'];
                break;

            default:
                // Otros roles → no ven nada
                estadosPermitidos = [];
        }

        // Aplicar filtro
        if (estadosPermitidos.length > 0) {
            query.andWhere('doc.estado IN (:...permitidos)', { permitidos: estadosPermitidos });
        } else {
            // Vacío para roles sin permiso
            query.andWhere('1 = 0');
        }

        const docs = await query.getMany();

        this.logger.log(`[RECHAZADOS-VISIBLES] Encontrados ${docs.length} documentos para ${rolUsuario}`);

        return docs.map(doc => ({
            id: doc.id,
            numeroRadicado: doc.numeroRadicado,
            numeroContrato: doc.numeroContrato,
            nombreContratista: doc.nombreContratista,
            documentoContratista: doc.documentoContratista,
            fechaInicio: doc.fechaInicio,
            fechaFin: doc.fechaFin,
            fechaRadicacion: doc.fechaRadicacion,
            estado: doc.estado,
            observacion: doc.observacion || '',
            motivoRechazo: doc.observacion || 'Sin motivo detallado',
            ultimoUsuario: doc.ultimoUsuario || 'Sistema',
            rechazadoPor: this.inferirRechazadoPor(doc.estado)
        }));
    }

    // MÉTODO ÚNICO - elimina cualquier duplicado que tengas en el archivo
    private inferirRechazadoPor(estado: string): string {
        const e = (estado || '').toUpperCase();

        if (e.includes('RENDICION')) return 'Rendición Cuentas';
        if (e.includes('ASESOR')) return 'Asesor Gerencia';
        if (e.includes('TESORERIA')) return 'Tesorería';
        if (e.includes('CONTABILIDAD')) return 'Contabilidad';
        if (e.includes('AUDITOR')) return 'Auditoría Cuentas';
        if (e.includes('SUPERVISOR')) return 'Supervisor';

        return 'Sistema / No especificado';
    }


}