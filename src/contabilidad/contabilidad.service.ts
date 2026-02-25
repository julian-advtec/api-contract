import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
    ConflictException,
    Logger,
    InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
    ContabilidadDocumento,
    ContabilidadEstado,
    TipoCausacion,
} from './entities/contabilidad-documento.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { AuditorDocumento } from '../auditor/entities/auditor-documento.entity';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { extname } from 'path';
import * as mime from 'mime-types';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { UserRole } from '../users/enums/user-role.enum';

const execAsync = promisify(exec);




@Injectable()
export class ContabilidadService {
    private readonly logger = new Logger(ContabilidadService.name);
    private readonly basePath: string;

    constructor(
        @InjectRepository(ContabilidadDocumento)
        private contabilidadRepository: Repository<ContabilidadDocumento>,
        @InjectRepository(Documento)
        private documentoRepository: Repository<Documento>,
        @InjectRepository(User)
        private userRepository: Repository<User>,
        @InjectRepository(AuditorDocumento)
        private auditorDocumentoRepository: Repository<AuditorDocumento>,
        private configService: ConfigService,
    ) {
        this.basePath = this.configService.get<string>('RUTA_BASE_ARCHIVOS') || '\\\\R2-D2\\api-contract';
        this.logger.log(`Ruta base configurada: ${this.basePath}`);
    }

    // ───────────────────────────────────────────────────────────────
    // 1. DOCUMENTOS DISPONIBLES
    // ───────────────────────────────────────────────────────────────
    async obtenerDocumentosDisponibles(contadorId: string): Promise<any[]> {
        this.logger.log(`[START] Obteniendo documentos disponibles para contador ${contadorId}`);

        try {
            const qb = this.documentoRepository.createQueryBuilder('d')
                .where("d.estado IN ('APROBADO_AUDITOR', 'COMPLETADO_AUDITOR')");

            qb.andWhere(
                `NOT EXISTS (
          SELECT 1 
          FROM contabilidad_documentos cd
          WHERE cd."documento_id" = d.id 
          AND cd.estado NOT IN ('DISPONIBLE')
        )`
            );

            qb.leftJoinAndSelect('d.radicador', 'radicador')
                .leftJoinAndSelect('d.usuarioAsignado', 'asignado')
                .orderBy('d.fechaRadicacion', 'ASC');

            const documentos = await qb.getMany();

            this.logger.log(`[SUCCESS] Encontrados ${documentos.length} documentos disponibles`);

            return documentos.map(doc => ({
                id: doc.id,
                numeroRadicado: doc.numeroRadicado,
                numeroContrato: doc.numeroContrato,
                nombreContratista: doc.nombreContratista,
                documentoContratista: doc.documentoContratista,
                fechaRadicacion: doc.fechaRadicacion,
                fechaInicio: doc.fechaInicio,
                fechaFin: doc.fechaFin,
                estado: doc.estado,
                observacion: doc.observacion || '',
                radicador: doc.radicador?.fullName || doc.radicador?.username || 'Sistema',
                supervisor: doc.usuarioAsignadoNombre || 'No asignado',
                disponible: true,
                enRevisionPorMi: false,
                tipo: 'disponible'
            }));
        } catch (error: any) {
            this.logger.error(`[ERROR CRÍTICO] Falló obtenerDocumentosDisponibles`, error.stack);
            throw new InternalServerErrorException('Error interno al cargar documentos disponibles');
        }
    }

    // ───────────────────────────────────────────────────────────────
    // 2. TOMAR DOCUMENTO PARA REVISIÓN
    // ───────────────────────────────────────────────────────────────
    async tomarDocumentoParaRevision(
        documentoId: string,
        contadorId: string,
    ): Promise<{ success: boolean; message: string; documento: any }> {
        const queryRunner = this.contabilidadRepository.manager.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const documento = await queryRunner.manager
                .createQueryBuilder(Documento, 'd')
                .where('d.id = :id', { id: documentoId })
                .andWhere("d.estado IN ('APROBADO_AUDITOR', 'COMPLETADO_AUDITOR')")
                .setLock('pessimistic_write')
                .getOne();

            if (!documento) {
                throw new NotFoundException('Documento no disponible para contabilidad');
            }

            const contador = await queryRunner.manager.findOne(User, { where: { id: contadorId } });
            if (!contador) throw new NotFoundException('Usuario no encontrado');

            let contabilidadDoc = await queryRunner.manager.findOne(ContabilidadDocumento, {
                where: { documento: { id: documentoId }, contador: { id: contadorId } },
            });

            if (contabilidadDoc) {
                contabilidadDoc.estado = ContabilidadEstado.EN_REVISION;
                contabilidadDoc.fechaInicioRevision = new Date();
            } else {
                contabilidadDoc = queryRunner.manager.create(ContabilidadDocumento, {
                    documento,
                    contador,
                    estado: ContabilidadEstado.EN_REVISION,
                    fechaCreacion: new Date(),
                    fechaInicioRevision: new Date(),
                });
            }

            documento.estado = ContabilidadEstado.EN_REVISION;
            documento.usuarioAsignado = contador;
            documento.usuarioAsignadoNombre = contador.fullName || contador.username;
            documento.fechaActualizacion = new Date();

            await queryRunner.manager.save(documento);
            await queryRunner.manager.save(contabilidadDoc);

            await queryRunner.commitTransaction();

            return {
                success: true,
                message: 'Documento tomado para revisión contable',
                documento: { id: documento.id, numeroRadicado: documento.numeroRadicado, estado: documento.estado },
            };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

    // ───────────────────────────────────────────────────────────────
    // 3. OBTENER DOCUMENTOS EN REVISIÓN
    // ───────────────────────────────────────────────────────────────
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

    // ───────────────────────────────────────────────────────────────
    // 4. OBTENER DETALLE DE DOCUMENTO

    // ───────────────────────────────────────────────────────────────
    private puedeVerDetalleEnEstadoActual(
        estado: string,
        rolUsuario: UserRole | string,
    ): boolean {
        const e = (estado || '').toUpperCase();

        // Estados muy iniciales → solo roles muy tempranos
        if (e.includes('RADICADO') || e.includes('PENDIENTE') || e.includes('ENVIADO')) {
            return [UserRole.ADMIN, UserRole.RADICADOR].includes(rolUsuario as any);
        }

        // Estados activos de contabilidad → contadores + supervisores + posteriores (lectura)
        if (
            e.includes('CONTABILIDAD') ||
            e.includes('EN_REVISION_CONTABILIDAD') ||
            e.includes('GLOSADO') ||
            e.includes('PROCESADO_CONTABILIDAD')
        ) {
            return [
                UserRole.ADMIN,
                UserRole.CONTABILIDAD,
                UserRole.SUPERVISOR,
                UserRole.ASESOR_GERENCIA,      // ← AGREGADO
                UserRole.RENDICION_CUENTAS,    // ← AGREGADO
            ].some(r => r === rolUsuario);
        }

        // Estados posteriores (tesorería, gerencia, rendición, finalizados)
        if (
            e.includes('TESORERIA') ||
            e.includes('GERENCIA') ||
            e.includes('RENDICION') ||
            e.includes('APROBADO_RENDICION_CUENTAS') ||
            e.includes('APROBADO_POR_GERENCIA') ||
            e.includes('COMPLETADO') ||
            e.includes('FINALIZADO') ||
            e.includes('CERRADO') ||
            e.includes('RECHAZADO') ||
            e.includes('OBSERVADO')
        ) {
            // Permitir lectura a: admin, gerencia, rendición y contabilidad (por si necesitan revisar histórico)
            return [
                UserRole.ADMIN,
                UserRole.ASESOR_GERENCIA,     // ← soluciona tu 403 principal
                UserRole.RENDICION_CUENTAS,   // ← para que rendición vea contabilidad histórica
                UserRole.CONTABILIDAD,        // opcional, pero útil
            ].some(r => r === rolUsuario);
        }

        // Por defecto: solo admin en estados desconocidos
        return rolUsuario === UserRole.ADMIN;
    }

    async obtenerDetalleDocumento(documentoId: string, userId: string): Promise<any> {
        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('Usuario no encontrado');

        const documento = await this.documentoRepository.findOne({
            where: { id: documentoId },
            relations: ['radicador', 'usuarioAsignado'],
        });

        if (!documento) throw new NotFoundException('Documento no encontrado');

        const estadoUpper = documento.estado?.toUpperCase() || '';

        // Validación basada en rol y estado
        if (!this.puedeVerDetalleEnEstadoActual(estadoUpper, user.role)) {
            throw new ForbiddenException(`No tienes acceso en estado: ${documento.estado}`);
        }

        // Buscar registro contable (sin filtrar por contador actual)
        const contabilidadDoc = await this.contabilidadRepository.findOne({
            where: { documento: { id: documentoId } },  // ← SIN filtrar por contador
            relations: ['contador'],
            order: { fechaActualizacion: 'DESC' }
        });

        // Buscar registro de auditoría (el más reciente)
        const auditorDoc = await this.auditorDocumentoRepository.findOne({
            where: { documento: { id: documentoId } },
            relations: ['auditor'],
            order: { fechaActualizacion: 'DESC' },
        });

        // Construir respuesta con manejo de nulls
        return this.construirRespuestaDetalle(documento, contabilidadDoc, auditorDoc, user);
    }

    // ───────────────────────────────────────────────────────────────
    // 5. DEFINIR GLOSA
    // ───────────────────────────────────────────────────────────────
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

    // ───────────────────────────────────────────────────────────────
    // 6. SUBIR DOCUMENTOS DE CONTABILIDAD
    // ───────────────────────────────────────────────────────────────
    async subirDocumentosContabilidad(
        documentoId: string,
        contadorId: string,
        datos: {
            observaciones?: string;
            tipoProceso?: string;
            estadoFinal?: string;
            tieneGlosa?: boolean;
            tipoCausacion?: TipoCausacion;
        },
        files: { [key: string]: Express.Multer.File[] },
    ): Promise<{ success: boolean; message: string; contabilidad: ContabilidadDocumento }> {
        const queryRunner = this.contabilidadRepository.manager.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const contabilidadDoc = await queryRunner.manager.findOne(ContabilidadDocumento, {
                where: {
                    documento: { id: documentoId },
                    contador: { id: contadorId },
                    estado: ContabilidadEstado.EN_REVISION,
                },
                relations: ['documento', 'contador'],
            });

            if (!contabilidadDoc) {
                throw new ForbiddenException('No tienes este documento en revisión');
            }

            const documento = contabilidadDoc.documento;

            const carpetaContabilidad = path.join(documento.rutaCarpetaRadicado, 'contabilidad');
            if (!fs.existsSync(carpetaContabilidad)) {
                fs.mkdirSync(carpetaContabilidad, { recursive: true });
            }

            const archivosGuardados: Record<string, string> = {};

            const tipos = ['glosa', 'causacion', 'extracto', 'comprobanteEgreso'];
            for (const tipo of tipos) {
                const file = files[tipo]?.[0];
                if (file) {
                    const nombre = await this.guardarArchivo(file, tipo, documento.rutaCarpetaRadicado);
                    archivosGuardados[tipo] = nombre;

                    switch (tipo) {
                        case 'glosa':
                            contabilidadDoc.glosaPath = nombre;
                            contabilidadDoc.fechaGlosa = new Date();
                            break;
                        case 'causacion':
                            contabilidadDoc.causacionPath = nombre;
                            contabilidadDoc.fechaCausacion = new Date();
                            break;
                        case 'extracto':
                            contabilidadDoc.extractoPath = nombre;
                            contabilidadDoc.fechaExtracto = new Date();
                            break;
                        case 'comprobanteEgreso':
                            contabilidadDoc.comprobanteEgresoPath = nombre;
                            contabilidadDoc.fechaComprobanteEgreso = new Date();
                            break;
                    }
                }
            }

            if (datos.observaciones) contabilidadDoc.observaciones = datos.observaciones;
            if (datos.tipoProceso) contabilidadDoc.tipoProceso = datos.tipoProceso;
            if (datos.tieneGlosa !== undefined) contabilidadDoc.tieneGlosa = datos.tieneGlosa;
            if (datos.tipoCausacion) contabilidadDoc.tipoCausacion = datos.tipoCausacion;

            if (datos.estadoFinal?.toUpperCase() === 'APROBADO') {
                if (!contabilidadDoc.comprobanteEgresoPath) {
                    throw new BadRequestException('Obligatorio subir comprobante de egreso para aprobar');
                }
            }

            if (datos.estadoFinal) {
                const estadoMap: Record<string, ContabilidadEstado> = {
                    APROBADO: ContabilidadEstado.COMPLETADO,
                    OBSERVADO: ContabilidadEstado.OBSERVADO,
                    RECHAZADO: ContabilidadEstado.RECHAZADO,
                    GLOSADO: ContabilidadEstado.GLOSADO,
                    PROCESADO: ContabilidadEstado.PROCESADO,
                };

                const nuevoEstado = estadoMap[datos.estadoFinal.toUpperCase()];
                if (nuevoEstado) {
                    contabilidadDoc.estado = nuevoEstado;
                    contabilidadDoc.fechaFinRevision = new Date();

                    let estadoDoc = '';
                    switch (nuevoEstado) {
                        case ContabilidadEstado.COMPLETADO:
                            estadoDoc = 'COMPLETADO_CONTABILIDAD';
                            break;
                        case ContabilidadEstado.GLOSADO:
                            estadoDoc = 'GLOSADO_CONTABILIDAD';
                            break;
                        case ContabilidadEstado.PROCESADO:
                            estadoDoc = 'PROCESADO_CONTABILIDAD';
                            break;
                        case ContabilidadEstado.OBSERVADO:
                            estadoDoc = 'OBSERVADO_CONTABILIDAD';
                            break;
                        case ContabilidadEstado.RECHAZADO:
                            estadoDoc = 'RECHAZADO_CONTABILIDAD';
                            break;
                    }
                    if (estadoDoc) {
                        documento.estado = estadoDoc;
                        documento.fechaActualizacion = new Date();
                    }
                }
            }

            await queryRunner.manager.save(contabilidadDoc);
            await queryRunner.manager.save(documento);

            await queryRunner.commitTransaction();

            return {
                success: true,
                message: 'Documentos subidos correctamente',
                contabilidad: contabilidadDoc,
            };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

    // ───────────────────────────────────────────────────────────────
    // 7. FINALIZAR REVISIÓN
    // ───────────────────────────────────────────────────────────────
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

            const validacion = contabilidadDoc.puedeFinalizar();
            if (!validacion.puede) {
                throw new BadRequestException(validacion.razon);
            }

            contabilidadDoc.estado = estado;
            contabilidadDoc.observaciones = observaciones || contabilidadDoc.observaciones;
            contabilidadDoc.fechaActualizacion = new Date();
            contabilidadDoc.fechaFinRevision = new Date();

            let estadoNuevoDocumento = '';

            switch (estado) {
                case ContabilidadEstado.GLOSADO:
                    estadoNuevoDocumento = 'GLOSADO_CONTABILIDAD';
                    break;
                case ContabilidadEstado.PROCESADO:
                    estadoNuevoDocumento = 'PROCESADO_CONTABILIDAD';
                    break;
                case ContabilidadEstado.COMPLETADO:
                    estadoNuevoDocumento = 'COMPLETADO_CONTABILIDAD';
                    break;
                case ContabilidadEstado.OBSERVADO:
                    estadoNuevoDocumento = 'OBSERVADO_CONTABILIDAD';
                    break;
                case ContabilidadEstado.RECHAZADO:
                    estadoNuevoDocumento = 'RECHAZADO_CONTABILIDAD';
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

            await queryRunner.manager.save(Documento, documento);
            await queryRunner.manager.save(ContabilidadDocumento, contabilidadDoc);

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

    // ───────────────────────────────────────────────────────────────
    // 8. LIBERAR DOCUMENTO
    // ───────────────────────────────────────────────────────────────
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

            documento.estado = 'APROBADO_AUDITOR';
            documento.fechaActualizacion = new Date();
            documento.ultimoAcceso = new Date();
            documento.ultimoUsuario = `Contabilidad: ${contabilidadDoc.contador.fullName || contabilidadDoc.contador.username} (liberó)`;
            documento.usuarioAsignado = null;
            documento.usuarioAsignadoNombre = '';

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

            contabilidadDoc.estado = ContabilidadEstado.DISPONIBLE;
            contabilidadDoc.fechaActualizacion = new Date();
            contabilidadDoc.fechaFinRevision = new Date();
            contabilidadDoc.observaciones = 'Documento liberado - Disponible para otros contadores';

            await queryRunner.manager.save(Documento, documento);
            await queryRunner.manager.save(ContabilidadDocumento, contabilidadDoc);

            if (documento.rutaCarpetaRadicado) {
                await this.registrarAccesoContabilidad(
                    documento.rutaCarpetaRadicado,
                    contadorId,
                    `LIBERÓ documento`,
                    `Estado: EN_REVISION → APROBADO_AUDITOR`
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

    // ───────────────────────────────────────────────────────────────
    // 9. OBTENER MIS AUDITORÍAS
    // ───────────────────────────────────────────────────────────────
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

    // ───────────────────────────────────────────────────────────────
    // 10. OBTENER DOCUMENTO PARA VISTA
    // ───────────────────────────────────────────────────────────────
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
            'EN_REVISION',
            'GLOSADO',
            'PROCESADO',
            'COMPLETADO',
            'OBSERVADO',
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
            { numero: 1, nombre: documento.cuentaCobro, descripcion: documento.descripcionCuentaCobro, tipo: 'cuenta_cobro', existe: !!documento.cuentaCobro },
            { numero: 2, nombre: documento.seguridadSocial, descripcion: documento.descripcionSeguridadSocial, tipo: 'seguridad_social', existe: !!documento.seguridadSocial },
            { numero: 3, nombre: documento.informeActividades, descripcion: documento.descripcionInformeActividades, tipo: 'informe_actividades', existe: !!documento.informeActividades },
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
            { tipo: 'glosa', descripcion: 'Documento de Glosa', subido: !!contabilidadDoc.glosaPath, nombreArchivo: contabilidadDoc.glosaPath, requerido: contabilidadDoc.tieneGlosa === true },
            { tipo: 'causacion', descripcion: contabilidadDoc.tipoCausacion === TipoCausacion.NOTA_DEBITO ? 'Nota Débito' : contabilidadDoc.tipoCausacion === TipoCausacion.NOTA_CREDITO ? 'Nota Crédito' : 'Comprobante de Egreso', subido: !!contabilidadDoc.causacionPath, nombreArchivo: contabilidadDoc.causacionPath, requerido: true },
            { tipo: 'extracto', descripcion: 'Extracto Bancario', subido: !!contabilidadDoc.extractoPath, nombreArchivo: contabilidadDoc.extractoPath, requerido: contabilidadDoc.tieneGlosa === true },
            { tipo: 'comprobanteEgreso', descripcion: 'Comprobante de Egreso', subido: !!contabilidadDoc.comprobanteEgresoPath, nombreArchivo: contabilidadDoc.comprobanteEgresoPath, requerido: contabilidadDoc.tieneGlosa === false }
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
                auditor: auditorDoc ? { id: auditorDoc.id, estado: auditorDoc.estado, observaciones: auditorDoc.observaciones, auditor: auditorDoc.auditor?.fullName || auditorDoc.auditor?.username } : null,
                contabilidad: contabilidadDoc ? { id: contabilidadDoc.id, estado: contabilidadDoc.estado, tieneGlosa: contabilidadDoc.tieneGlosa, tipoCausacion: contabilidadDoc.tipoCausacion, observaciones: contabilidadDoc.observaciones, fechaCreacion: contabilidadDoc.fechaCreacion, fechaInicioRevision: contabilidadDoc.fechaInicioRevision, fechaFinRevision: contabilidadDoc.fechaFinRevision, puedeFinalizar: contabilidadDoc.puedeFinalizar().puede, documentosSubidos: archivosContabilidad.filter(a => a.subido).map(a => a.tipo), contador: contabilidadDoc.contador?.fullName || contabilidadDoc.contador?.username } : null,
            }
        };

        return respuesta;
    }

    // ───────────────────────────────────────────────────────────────
    // 11. OBTENER RUTA COMPLETA DE ARCHIVO (CORREGIDO)
    // ───────────────────────────────────────────────────────────────
    async obtenerRutaArchivoContabilidadFull(
        documentoId: string,
        tipo: string,
        userId?: string,
    ): Promise<{ rutaAbsoluta: string; nombreArchivo: string }> {
        const documento = await this.documentoRepository.findOne({ where: { id: documentoId } });
        if (!documento) throw new NotFoundException('Documento no encontrado');

        let contabilidadDoc: ContabilidadDocumento | null = null;

        if (userId) {
            contabilidadDoc = await this.contabilidadRepository.findOne({
                where: { documento: { id: documentoId }, contador: { id: userId } },
            });
        }

        if (!contabilidadDoc) {
            contabilidadDoc = await this.contabilidadRepository.findOne({
                where: { documento: { id: documentoId } },
                order: { fechaActualizacion: 'DESC' },
            });
        }

        if (!contabilidadDoc) throw new NotFoundException('No hay registro de contabilidad');

        let nombreArchivo: string | null = null;

        switch (tipo.toLowerCase()) {
            case 'glosa':
                nombreArchivo = contabilidadDoc.glosaPath ?? null;
                break;
            case 'causacion':
                nombreArchivo = contabilidadDoc.causacionPath ?? null;
                break;
            case 'extracto':
                nombreArchivo = contabilidadDoc.extractoPath ?? null;
                break;
            case 'comprobanteegreso':
            case 'comprobante':
                nombreArchivo = contabilidadDoc.comprobanteEgresoPath ?? null;
                break;
            default:
                throw new BadRequestException('Tipo no soportado');
        }

        if (!nombreArchivo) {
            throw new NotFoundException(`No hay archivo de tipo ${tipo}`);
        }

        // CORRECCIÓN: Limpiar la ruta base
        let rutaBase = this.basePath;
        // Eliminar backslashes al final
        rutaBase = rutaBase.replace(/\\+$/, '').replace(/\/+$/, '');

        // Obtener la ruta del documento (ya debería ser relativa)
        const rutaCarpeta = documento.rutaCarpetaRadicado || '';

        // Limpiar la ruta de la carpeta (eliminar posibles duplicados de la base)
        let rutaCarpetaLimpia = rutaCarpeta;
        // Si la rutaCarpeta ya contiene la base, extraer solo la parte relativa
        if (rutaCarpeta.includes('R2-D2\\api-contract')) {
            rutaCarpetaLimpia = rutaCarpeta.split('api-contract\\').pop() || '';
        }

        // Construir la ruta completa
        let rutaAbsoluta = path.join(rutaBase, rutaCarpetaLimpia, nombreArchivo);

        // Normalizar para Windows
        rutaAbsoluta = rutaAbsoluta.replace(/\//g, '\\');

        this.logger.log(`🔍 Buscando archivo: ${rutaAbsoluta}`);

        if (!fs.existsSync(rutaAbsoluta)) {
            // Segundo intento: si nombreArchivo ya tiene 'contabilidad/', usarlo directamente
            const rutaAlternativa = path.join(rutaBase, rutaCarpetaLimpia, nombreArchivo.replace(/^contabilidad[\\\/]/, ''));
            this.logger.log(`🔄 Intento alternativo: ${rutaAlternativa}`);

            if (fs.existsSync(rutaAlternativa)) {
                rutaAbsoluta = rutaAlternativa;
                this.logger.log(`✅ Archivo encontrado en alternativa`);
            } else {
                throw new NotFoundException(`Archivo ${tipo} no encontrado en el servidor`);
            }
        }

        return { rutaAbsoluta, nombreArchivo: path.basename(nombreArchivo) };
    }


    // ───────────────────────────────────────────────────────────────
    // 12. DESCARGAR ARCHIVO
    // ───────────────────────────────────────────────────────────────
    async descargarArchivoContabilidad(
        documentoId: string,
        tipo: string,
        contadorId: string,
    ): Promise<{ ruta: string; nombre: string }> {
        const contabilidadDoc = await this.contabilidadRepository.findOne({
            where: { documento: { id: documentoId }, contador: { id: contadorId } },
            relations: ['documento'],
        });

        if (!contabilidadDoc) throw new ForbiddenException('Acceso no autorizado');

        let nombreArchivo: string | null = null;

        switch (tipo.toLowerCase()) {
            case 'glosa':
                nombreArchivo = contabilidadDoc.glosaPath ?? null;
                break;
            case 'causacion':
                nombreArchivo = contabilidadDoc.causacionPath ?? null;
                break;
            case 'extracto':
                nombreArchivo = contabilidadDoc.extractoPath ?? null;
                break;
            case 'comprobanteegreso':
            case 'comprobante':
                nombreArchivo = contabilidadDoc.comprobanteEgresoPath ?? null;
                break;
            default:
                throw new BadRequestException('Tipo de archivo inválido');
        }

        if (!nombreArchivo) {
            throw new NotFoundException(`No existe archivo de tipo ${tipo}`);
        }

        let rutaCompleta = nombreArchivo;
        if (!rutaCompleta.includes('contabilidad')) {
            rutaCompleta = path.join('contabilidad', rutaCompleta);
        }

        const rutaAbsoluta = path.join(this.basePath, contabilidadDoc.documento.rutaCarpetaRadicado || '', rutaCompleta);

        if (!fs.existsSync(rutaAbsoluta)) {
            throw new NotFoundException('Archivo no encontrado en disco');
        }

        return {
            ruta: rutaAbsoluta,
            nombre: path.basename(nombreArchivo),
        };
    }

    // ───────────────────────────────────────────────────────────────
    // 13. OBTENER HISTORIAL
    // ───────────────────────────────────────────────────────────────
    async getHistorial(contadorId: string): Promise<any[]> {
        this.logger.log(`Obteniendo historial COMPLETO para contador ${contadorId}`);

        const contabilidadDocs = await this.contabilidadRepository.find({
            where: { contador: { id: contadorId } },
            relations: ['documento', 'contador'],
            order: { fechaActualizacion: 'DESC' }
        });

        return contabilidadDocs.map(cd => {
            let estadoReal = 'PROCESADO';

            if (cd.fechaFinRevision) {
                if (cd.observaciones) {
                    const obsUpper = (cd.observaciones || '').toUpperCase();
                    if (obsUpper.includes('RECHAZ') || obsUpper.includes('RECHAZADO')) {
                        estadoReal = 'RECHAZADO';
                    } else if (obsUpper.includes('OBSERV') || obsUpper.includes('OBSERVADO')) {
                        estadoReal = 'OBSERVADO';
                    } else {
                        estadoReal = 'COMPLETADO';
                    }
                } else {
                    estadoReal = 'COMPLETADO';
                }
            } else if (cd.comprobanteEgresoPath || cd.causacionPath) {
                estadoReal = 'PROCESADO';
            }

            return {
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
                    fechaActualizacion: cd.documento.fechaActualizacion,
                    estado: cd.documento.estado
                },
                estado: estadoReal,
                observaciones: cd.observaciones || '',
                tieneGlosa: cd.tieneGlosa,
                tipoCausacion: cd.tipoCausacion,
                fechaActualizacion: cd.fechaActualizacion,
                fechaFinRevision: cd.fechaFinRevision,
                fechaInicioRevision: cd.fechaInicioRevision,
                contadorRevisor: cd.contador?.fullName || cd.contador?.username || 'Contador'
            };
        });
    }

    // ───────────────────────────────────────────────────────────────
    // 14. OBTENER RECHAZADOS VISIBLES
    // ───────────────────────────────────────────────────────────────
    async obtenerRechazadosVisibles(user: any): Promise<any[]> {
        const rolUsuario = user.role?.toLowerCase() || '';

        this.logger.log(`[RECHAZADOS-VISIBLES] Rol: ${rolUsuario} | Username: ${user.username}`);

        const estadosRechazo = [
            'RECHAZADO_SUPERVISOR',
            'RECHAZADO_AUDITOR_CUENTAS',
            'RECHAZADO',
            'RECHAZADO_TESORERIA',
            'RECHAZADO_ASESOR_GERENCIA',
            'RECHAZADO_RENDICION_CUENTAS',
            'OBSERVADO',
            'GLOSADO'
        ];

        const query = this.documentoRepository
            .createQueryBuilder('doc')
            .leftJoinAndSelect('doc.radicador', 'radicador')
            .where('doc.estado IN (:...estados)', { estados: estadosRechazo })
            .orderBy('doc.fechaActualizacion', 'DESC');

        let estadosPermitidos: string[] = [];

        switch (rolUsuario) {
            case 'admin':
                estadosPermitidos = estadosRechazo;
                break;
            case 'contabilidad':
                estadosPermitidos = ['RECHAZADO', 'RECHAZADO_TESORERIA', 'RECHAZADO_ASESOR_GERENCIA', 'RECHAZADO_RENDICION_CUENTAS'];
                break;
            case 'tesoreria':
                estadosPermitidos = ['RECHAZADO_TESORERIA', 'RECHAZADO_ASESOR_GERENCIA', 'RECHAZADO_RENDICION_CUENTAS'];
                break;
            case 'asesor_gerencia':
                estadosPermitidos = ['RECHAZADO_ASESOR_GERENCIA', 'RECHAZADO_RENDICION_CUENTAS'];
                break;
            case 'rendicion_cuentas':
                estadosPermitidos = ['RECHAZADO_RENDICION_CUENTAS'];
                break;
            default:
                estadosPermitidos = [];
        }

        if (estadosPermitidos.length > 0) {
            query.andWhere('doc.estado IN (:...permitidos)', { permitidos: estadosPermitidos });
        } else {
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

    // ───────────────────────────────────────────────────────────────
    // 15. OBTENER CONTABILIDAD DOCUMENTO
    // ───────────────────────────────────────────────────────────────
    async obtenerContabilidadDocumento(documentoId: string, userId: string) {
        return this.contabilidadRepository.findOne({
            where: { documento: { id: documentoId }, contador: { id: userId } },
            relations: ['contador'],
        });
    }

    // ───────────────────────────────────────────────────────────────
    // 16. CONVERTIR WORD A PDF
    // ───────────────────────────────────────────────────────────────
    async convertirWordAPdf(inputPath: string, outputPath: string): Promise<void> {
        const cmd = `soffice --headless --convert-to pdf --outdir "${path.dirname(outputPath)}" "${inputPath}"`;

        return new Promise((resolve, reject) => {
            exec(cmd, (error, stdout, stderr) => {
                if (error) return reject(error);
                if (stderr) this.logger.warn(`[STDERR] ${stderr}`);

                const pdfGenerado = path.join(
                    path.dirname(outputPath),
                    path.basename(inputPath).replace(/\.(doc|docx)$/i, '.pdf'),
                );

                if (fs.existsSync(pdfGenerado)) {
                    fs.renameSync(pdfGenerado, outputPath);
                    resolve();
                } else {
                    reject(new Error('No se generó el PDF'));
                }
            });
        });
    }

    // ───────────────────────────────────────────────────────────────
    // MÉTODOS AUXILIARES PRIVADOS
    // ───────────────────────────────────────────────────────────────
    private async guardarArchivo(
        file: Express.Multer.File,
        tipo: string,
        rutaBase: string,
    ): Promise<string> {
        const carpeta = path.join(rutaBase, 'contabilidad');
        if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });

        const ext = extname(file.originalname) || '.pdf';
        const nombre = `${tipo}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
        const rutaCompleta = path.join(carpeta, nombre);

        fs.writeFileSync(rutaCompleta, file.buffer);

        return path.join('contabilidad', nombre);
    }

    private inferirEstadoFinal(estado?: ContabilidadEstado): string {
        if (!estado) return 'No registrada';
        switch (estado) {
            case ContabilidadEstado.COMPLETADO:
                return 'APROBADO';
            case ContabilidadEstado.OBSERVADO:
                return 'OBSERVADO';
            case ContabilidadEstado.RECHAZADO:
                return 'RECHAZADO';
            default:
                return 'PENDIENTE';
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
            asignacionContabilidad: contabilidadDoc ? {
                id: contabilidadDoc.id,
                estado: contabilidadDoc.estado,
                tieneGlosa: contabilidadDoc.tieneGlosa,
                tipoCausacion: contabilidadDoc.tipoCausacion,
                fechaInicioRevision: contabilidadDoc.fechaInicioRevision,
                contador: { id: contabilidadDoc.contador.id, nombre: contabilidadDoc.contador.fullName || contabilidadDoc.contador.username },
            } : null,
        };
    }

    private async registrarAccesoContabilidad(
        rutaCarpeta: string,
        contadorId: string,
        accion: string,
        detallesExtra?: string
    ): Promise<void> {
        try {
            if (!rutaCarpeta) return;

            const rutaArchivo = path.join(rutaCarpeta, 'registro_accesos.txt');
            const fecha = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full', timeStyle: 'long' });

            const contador = await this.userRepository.findOne({ where: { id: contadorId } });
            const nombreContador = contador?.fullName || contador?.username || 'Contador desconocido';

            let registro = `[${fecha}] ${nombreContador} (${contador?.username || contadorId}) - CONTABILIDAD - ${accion}`;
            if (detallesExtra) registro += ` | ${detallesExtra}`;
            registro += '\n';

            let contenidoExistente = fs.existsSync(rutaArchivo) ? fs.readFileSync(rutaArchivo, 'utf8') : '';
            const lineas = contenidoExistente.split('\n');
            const lineasActualizadas = [...lineas.slice(-99), registro];
            fs.writeFileSync(rutaArchivo, lineasActualizadas.join('\n'), 'utf8');

            this.logger.log(`📝 Registro contabilidad actualizado: ${rutaArchivo} - ${accion}`);
        } catch (error) {
            this.logger.error(`⚠️ Error registrando acceso contabilidad: ${error.message}`);
        }
    }

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

    private construirRespuestaDetalle(
        documento: Documento,
        contabilidadDoc: ContabilidadDocumento | null,
        auditorDoc: AuditorDocumento | null,
        user: User,
    ): any {
        // Si no hay contabilidadDoc, devolver datos vacíos en lugar de null
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
                estado: documento.estado,
                observacionesContabilidad: contabilidadDoc?.observaciones || '',
                tipoProceso: contabilidadDoc?.tipoProceso || 'n/a',
                tieneGlosa: contabilidadDoc?.tieneGlosa ?? null,
                glosaPath: contabilidadDoc?.glosaPath || null,
                causacionPath: contabilidadDoc?.causacionPath || null,
                extractoPath: contabilidadDoc?.extractoPath || null,
                comprobanteEgresoPath: contabilidadDoc?.comprobanteEgresoPath || null,
                estadoFinal: contabilidadDoc ? this.inferirEstadoFinal(contabilidadDoc.estado) : 'PENDIENTE',
            },
            archivosRadicados: [
                { numero: 1, nombre: documento.cuentaCobro, tipo: 'cuenta_cobro', existe: !!documento.cuentaCobro },
                { numero: 2, nombre: documento.seguridadSocial, tipo: 'seguridad_social', existe: !!documento.seguridadSocial },
                { numero: 3, nombre: documento.informeActividades, tipo: 'informe_actividades', existe: !!documento.informeActividades },
            ],
            archivosAuditor: auditorDoc ? [
                { tipo: 'rp', subido: !!auditorDoc.rpPath, nombre: auditorDoc.rpPath },
                { tipo: 'cdp', subido: !!auditorDoc.cdpPath, nombre: auditorDoc.cdpPath },
                { tipo: 'poliza', subido: !!auditorDoc.polizaPath, nombre: auditorDoc.polizaPath },
                { tipo: 'certificadoBancario', subido: !!auditorDoc.certificadoBancarioPath, nombre: auditorDoc.certificadoBancarioPath },
                { tipo: 'minuta', subido: !!auditorDoc.minutaPath, nombre: auditorDoc.minutaPath },
                { tipo: 'actaInicio', subido: !!auditorDoc.actaInicioPath, nombre: auditorDoc.actaInicioPath },
            ] : [],
            archivosContabilidad: contabilidadDoc ? [
                { tipo: 'glosa', subido: !!contabilidadDoc.glosaPath, nombre: contabilidadDoc.glosaPath },
                { tipo: 'causacion', subido: !!contabilidadDoc.causacionPath, nombre: contabilidadDoc.causacionPath },
                { tipo: 'extracto', subido: !!contabilidadDoc.extractoPath, nombre: contabilidadDoc.extractoPath },
                { tipo: 'comprobanteEgreso', subido: !!contabilidadDoc.comprobanteEgresoPath, nombre: contabilidadDoc.comprobanteEgresoPath },
            ] : [],  // ← Devuelve array vacío en lugar de null
            contabilidad: contabilidadDoc ? {
                id: contabilidadDoc.id,
                estado: contabilidadDoc.estado,
                observaciones: contabilidadDoc.observaciones,
                tipoProceso: contabilidadDoc.tipoProceso,
                tieneGlosa: contabilidadDoc.tieneGlosa,
                contador: contabilidadDoc.contador?.fullName || contabilidadDoc.contador?.username,
                // Indicador de que existe registro contable
                existeRegistro: true
            } : {
                // Objeto vacío pero con indicador de que no existe
                existeRegistro: false,
                estado: null,
                observaciones: '',
                tipoProceso: null,
                tieneGlosa: null,
                contador: null
            },
        };
    }


}