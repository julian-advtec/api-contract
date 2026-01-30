import {
    Injectable,
    BadRequestException,
    Logger,
    ForbiddenException,
    NotFoundException,
    UnauthorizedException,
    InternalServerErrorException,
    Inject,
    forwardRef,
    HttpException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Like } from 'typeorm';
import { Documento } from './entities/documento.entity';
import { CreateDocumentoDto } from './dto/create-documento.dto';
import * as fs from 'fs';
import * as path from 'path';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { Contratista } from '../contratista/entities/contratista.entity';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { exec } from 'child_process';
import { promisify } from 'util';
import { EstadosService } from '../estados/estados.service';
import { SupervisorService } from '../supervision/services/supervisor.service';
import { ContratistaService } from '../contratista/contratista.service';

const execAsync = promisify(exec);

@Injectable()
export class RadicacionService {
    private readonly logger = new Logger(RadicacionService.name);
    public basePath = '\\\\R2-D2\\api-contract';

    constructor(
        @InjectRepository(Documento)
        public documentoRepository: Repository<Documento>,
        @InjectRepository(User)
        private userRepository: Repository<User>,
        @InjectRepository(Contratista)
        private contratistaRepository: Repository<Contratista>,
        private estadosService: EstadosService,
        @Inject(forwardRef(() => SupervisorService))
        private supervisorService: SupervisorService,
        private readonly contratistaService: ContratistaService,
    ) {
        this.logger.log(`📁 ======= CONFIGURACIÓN RUTA SERVIDOR =======`);
        this.logger.log(`🌐 Ruta configurada: ${this.basePath}`);
        this.verificarYConfigurarRutaServidor();
    }

    private verificarYConfigurarRutaServidor(): void {
        try {
            this.logger.log(`🔍 Verificando acceso al servidor R2-D2...`);

            const rutasAProbar = [
                '\\\\R2-D2\\api-contract',
                '\\\\\\\\R2-D2\\\\\\\\api-contract',
                '//R2-D2/api-contract',
            ];

            let rutaFuncional = null;

            for (const rutaTest of rutasAProbar) {
                try {
                    this.logger.log(`🔍 Probando ruta: ${rutaTest}`);
                    if (fs.existsSync(rutaTest)) {
                        rutaFuncional = rutaTest;
                        this.logger.log(`✅ Ruta accesible: ${rutaTest}`);
                        break;
                    } else {
                        try {
                            fs.mkdirSync(rutaTest, { recursive: true });
                            if (fs.existsSync(rutaTest)) {
                                rutaFuncional = rutaTest;
                                this.logger.log(`✅ Directorio creado y accesible`);
                                break;
                            }
                        } catch (mkdirError) {
                            this.logger.log(`❌ No se pudo crear directorio: ${mkdirError.message}`);
                        }
                    }
                } catch (error) {
                    this.logger.log(`⚠️ Error accediendo a ruta ${rutaTest}: ${error.message}`);
                }
            }

            if (rutaFuncional) {
                this.basePath = rutaFuncional;
                this.logger.log(`✅ Ruta servidor configurada: ${this.basePath}`);
                this.verificarPermisosEscritura();
            } else {
                this.logger.error(`❌ No se pudo acceder a ninguna ruta del servidor`);
                if (process.env.NODE_ENV === 'development') {
                    const rutaLocal = path.join(process.cwd(), 'uploads-dev-server');
                    this.basePath = rutaLocal;
                    this.logger.warn(`⚠️ EN DESARROLLO: Usando ruta local: ${this.basePath}`);
                    if (!fs.existsSync(this.basePath)) {
                        fs.mkdirSync(this.basePath, { recursive: true });
                        this.logger.log(`✅ Carpeta local creada`);
                    }
                } else {
                    throw new InternalServerErrorException(
                        `No se puede acceder al servidor de archivos R2-D2.`
                    );
                }
            }
        } catch (error) {
            this.logger.error(`❌ Error configurando ruta servidor: ${error.message}`);
            throw error;
        }
    }

    private verificarPermisosEscritura(): void {
        try {
            const testFile = path.join(this.basePath, 'test-escritura-' + Date.now() + '.txt');
            const testContent = `Test de escritura: ${new Date().toISOString()}\n`;

            fs.writeFileSync(testFile, testContent, 'utf8');
            this.logger.log(`✅ Permisos de escritura OK`);

            const contenidoLeido = fs.readFileSync(testFile, 'utf8');
            if (contenidoLeido === testContent) {
                this.logger.log(`✅ Permisos de lectura OK`);
            }

            fs.unlinkSync(testFile);
            this.logger.log(`✅ Archivo de test eliminado`);
        } catch (error) {
            this.logger.error(`❌ Error verificando permisos: ${error.message}`);
            throw new Error(`No hay permisos de escritura en el servidor R2-D2: ${error.message}`);
        }
    }

    async create(
        createDocumentoDto: CreateDocumentoDto,
        files: Array<Express.Multer.File>,
        user: any,
    ): Promise<Documento> {
        try {
            this.logger.log(`📝 ======= INICIANDO CREACIÓN DE DOCUMENTO =======`);
            this.logger.log(`👤 Usuario: ${user.username} (${user.role})`);

            const usuarioCompleto = await this.userRepository.findOne({
                where: { username: user.username.toLowerCase().trim() }
            });

            if (!usuarioCompleto) {
                throw new BadRequestException(`Usuario "${user.username}" no encontrado`);
            }

            const rolUsuario = usuarioCompleto.role?.toString().toLowerCase().trim();
            const puedeRadicar = rolUsuario === 'admin' || rolUsuario === 'radicador';

            if (!puedeRadicar) {
                throw new ForbiddenException(
                    `No tienes permisos para radicar documentos. Tu rol es: ${rolUsuario}.`
                );
            }

            this.logger.log(`✅ PERMISOS OK: ${usuarioCompleto.username} (${rolUsuario})`);

            let contratista: Contratista;
            try {
                const contratistas = await this.contratistaService.buscarPorDocumento(
                    createDocumentoDto.documentoContratista
                );

                if (contratistas.length > 0) {
                    contratista = contratistas[0];
                    this.logger.log(`✅ Contratista existente: ${contratista.id}`);
                } else {
                    contratista = await this.contratistaService.crear({
                        documentoIdentidad: createDocumentoDto.documentoContratista,
                        nombreCompleto: createDocumentoDto.nombreContratista,
                    });
                    this.logger.log(`📝 Nuevo contratista creado: ${contratista.id}`);
                }
            } catch (error) {
                this.logger.error(`❌ Error con contratista: ${error.message}`);
                throw error;
            }

            if (!files || files.length !== 3) {
                throw new BadRequestException('Debe adjuntar exactamente 3 documentos');
            }

            const radicadoRegex = /^R\d{4}-\d{4}$/;
            if (!radicadoRegex.test(createDocumentoDto.numeroRadicado)) {
                throw new BadRequestException(
                    'Formato de radicado inválido. Debe ser RAAAA-NNNN (ej: R2025-0001)'
                );
            }

            const radicadoExistente = await this.documentoRepository.findOne({
                where: { numeroRadicado: createDocumentoDto.numeroRadicado }
            });

            if (radicadoExistente) {
                throw new BadRequestException(
                    `El número de radicado ${createDocumentoDto.numeroRadicado} ya existe`
                );
            }

            const esPrimerRadicado = createDocumentoDto.primerRadicadoDelAno === true;

            if (esPrimerRadicado) {
                this.logger.log(`🏆 Marcado como primer radicado del contrato`);
            }

            const anoRadicado = createDocumentoDto.numeroRadicado.substring(1, 5);
            const rutaCarpetaRadicado = path.join(
                this.basePath,
                createDocumentoDto.documentoContratista,
                anoRadicado,
                createDocumentoDto.numeroContrato,
                createDocumentoDto.numeroRadicado,
            );

            this.logger.log(`📂 Creando carpeta: ${rutaCarpetaRadicado}`);
            this.crearCarpetasEnServidor(rutaCarpetaRadicado);

            const nombresArchivos: string[] = [];
            const descripciones = [
                createDocumentoDto.descripcionCuentaCobro || 'Cuenta de Cobro',
                createDocumentoDto.descripcionSeguridadSocial || 'Seguridad Social',
                createDocumentoDto.descripcionInformeActividades || 'Informe de Actividades',
            ];

            const tiposArchivo = ['cuenta_cobro', 'seguridad_social', 'informe_actividades'];

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const extension = path.extname(file.originalname).toLowerCase();

                if (!['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'].includes(extension)) {
                    throw new BadRequestException(`Extensión no permitida en archivo ${i + 1}`);
                }

                const nombreArchivo = this.crearNombreArchivoSeguro(
                    tiposArchivo[i],
                    createDocumentoDto.numeroRadicado,
                    extension
                );

                const rutaCompleta = path.join(rutaCarpetaRadicado, nombreArchivo);
                fs.writeFileSync(rutaCompleta, file.buffer);

                if (!fs.existsSync(rutaCompleta)) {
                    throw new Error(`No se pudo guardar: ${nombreArchivo}`);
                }

                nombresArchivos.push(nombreArchivo);
            }

            this.crearArchivoRegistroEnServidor(rutaCarpetaRadicado, usuarioCompleto, 'CREACION');

            const documentoData: Partial<Documento> = {
                numeroRadicado: createDocumentoDto.numeroRadicado.trim().toUpperCase(),
                numeroContrato: createDocumentoDto.numeroContrato.trim(),
                nombreContratista: createDocumentoDto.nombreContratista.trim(),
                documentoContratista: createDocumentoDto.documentoContratista.trim(),
                fechaInicio: new Date(createDocumentoDto.fechaInicio),
                fechaFin: new Date(createDocumentoDto.fechaFin),
                fechaRadicacion: new Date(),
                primerRadicadoDelAno: esPrimerRadicado,
                descripcionCuentaCobro: createDocumentoDto.descripcionCuentaCobro?.trim() || 'Cuenta de Cobro',
                descripcionSeguridadSocial: createDocumentoDto.descripcionSeguridadSocial?.trim() || 'Seguridad Social',
                descripcionInformeActividades: createDocumentoDto.descripcionInformeActividades?.trim() || 'Informe de Actividades',
                cuentaCobro: nombresArchivos[0],
                seguridadSocial: nombresArchivos[1],
                informeActividades: nombresArchivos[2],
                observacion: createDocumentoDto.observacion?.trim(),
                radicador: usuarioCompleto,
                nombreRadicador: usuarioCompleto.fullName || usuarioCompleto.username,
                usuarioRadicador: usuarioCompleto.username,
                rutaCarpetaRadicado: rutaCarpetaRadicado,
                ultimoAcceso: new Date(),
                ultimoUsuario: usuarioCompleto.fullName || usuarioCompleto.username,
                fechaActualizacion: new Date(),
                estado: 'RADICADO',
                contratistaId: contratista.id,
                tokenPublico: randomUUID(),
                tokenActivo: true,
                tokenExpiraEn: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
                usuarioAsignado: null,
                usuarioAsignadoNombre: '',
                historialEstados: [{
                    fecha: new Date(),
                    estado: 'RADICADO',
                    usuarioId: usuarioCompleto.id,
                    usuarioNombre: usuarioCompleto.fullName || usuarioCompleto.username,
                    rolUsuario: usuarioCompleto.role,
                    observacion: 'Documento radicado inicialmente',
                }],
            };

            const documento = this.documentoRepository.create(documentoData);
            const savedDocumento = await this.documentoRepository.save(documento);

            this.logger.log(`✅ Creado OK - ID: ${savedDocumento.id}`);
            this.logger.log(`   Primer radicado: ${savedDocumento.primerRadicadoDelAno ? 'SÍ' : 'NO'}`);

            try {
                await this.asignarDocumentoASupervisores(savedDocumento);
            } catch (e) {
                this.logger.warn(`No se pudo asignar a supervisores: ${e.message}`);
            }

            return savedDocumento;

        } catch (error) {
            this.logger.error(`❌ Error creando documento: ${error.message}`);
            throw error instanceof HttpException
                ? error
                : new InternalServerErrorException('Error interno al crear documento');
        }
    }

    // ✅ NUEVO MÉTODO: Verificar y marcar automáticamente primer radicado del año
    private async verificarYMarcarPrimerRadicadoAno(
        numeroRadicado: string
    ): Promise<boolean> {
        try {
            const ano = numeroRadicado.substring(1, 5);

            // Contar cuántos documentos ya existen para este año
            const count = await this.documentoRepository
                .createQueryBuilder('documento')
                .where('documento.numeroRadicado LIKE :ano', { ano: `R${ano}-%` })
                .getCount();

            // Si es el primer documento del año, marcarlo automáticamente
            return count === 0;

        } catch (error) {
            this.logger.error(`❌ Error verificando primer radicado: ${error.message}`);
            return false;
        }
    }

    private crearCarpetasEnServidor(ruta: string): void {
        try {
            this.logger.log(`📁 Creando carpetas en servidor R2-D2: ${ruta}`);
            if (!fs.existsSync(ruta)) {
                fs.mkdirSync(ruta, { recursive: true });
                this.logger.log(`✅ Carpetas creadas en servidor: ${ruta}`);
                if (!fs.existsSync(ruta)) {
                    throw new Error(`No se pudo crear la carpeta en el servidor R2-D2: ${ruta}`);
                }
            } else {
                this.logger.log(`📁 Carpeta ya existe en servidor R2-D2: ${ruta}`);
            }
        } catch (error) {
            this.logger.error(`❌ Error creando carpetas en servidor R2-D2: ${error.message}`);
            throw new Error(`Error creando estructura en servidor R2-D2: ${error.message}`);
        }
    }

    private crearNombreArchivoSeguro(tipo: string, radicado: string, extension: string): string {
        const nombreLimpio = tipo
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^\w._-]/g, '');

        return `${nombreLimpio}_${radicado}${extension}`;
    }

    private limpiarArchivosEnError(rutaCarpeta: string, nombresArchivos: string[]): void {
        try {
            if (!fs.existsSync(rutaCarpeta)) return;
            this.logger.log(`🗑️ Limpiando archivos en error: ${rutaCarpeta}`);

            nombresArchivos.forEach(nombreArchivo => {
                const rutaArchivo = path.join(rutaCarpeta, nombreArchivo);
                if (fs.existsSync(rutaArchivo)) {
                    fs.unlinkSync(rutaArchivo);
                    this.logger.log(`🗑️ Archivo eliminado: ${nombreArchivo}`);
                }
            });

            const archivosRestantes = fs.readdirSync(rutaCarpeta);
            if (archivosRestantes.length === 0) {
                fs.rmdirSync(rutaCarpeta);
                this.logger.log(`🗑️ Carpeta eliminada: ${rutaCarpeta}`);
            }
        } catch (error) {
            this.logger.error(`❌ Error limpiando archivos: ${error.message}`);
        }
    }

    private crearArchivoRegistroEnServidor(rutaCarpeta: string, user: User, accion: string): void {
        try {
            const rutaArchivo = path.join(rutaCarpeta, 'registro_accesos.txt');
            const fecha = new Date().toLocaleString('es-CO', {
                timeZone: 'America/Bogota',
                dateStyle: 'full',
                timeStyle: 'long'
            });

            const contenido = `=== REGISTRO DE ACCESOS - CONTRATOS ===
Fecha: ${fecha}
Usuario: ${user.fullName || user.username} (${user.username})
Rol: ${user.role}
Acción: ${accion}
Ruta servidor R2-D2: ${rutaCarpeta}

--- HISTORIAL DE ACCESOS ---
[${fecha}] ${user.fullName || user.username} (${user.username}) - ${user.role} - ${accion}
`;

            fs.writeFileSync(rutaArchivo, contenido, 'utf8');
            this.logger.log(`✅ Archivo de registro creado en servidor R2-D2: ${rutaArchivo}`);
        } catch (error) {
            this.logger.error(`❌ Error creando archivo de registro: ${error.message}`);
        }
    }

    private async asignarDocumentoASupervisores(documento: Documento): Promise<void> {
        try {
            this.logger.log(`🔄 Asignando documento ${documento.numeroRadicado} a supervisores...`);

            // Llamar al servicio de supervisor para asignar el documento
            await this.supervisorService.asignarDocumentoASupervisoresAutomaticamente(documento.id);

            this.logger.log(`✅ Documento asignado a supervisores automáticamente`);
        } catch (error) {
            this.logger.error(`❌ Error asignando documento a supervisores: ${error.message}`);
            // No lanzamos el error para no interrumpir el flujo principal
        }
    }

    async findAll(user: any): Promise<Documento[]> {
        const role = user.role?.toLowerCase();

        this.logger.log(
            `📋 Usuario ${user.username} (${role}) solicitando TODAS las radicaciones`,
        );

        // ADMIN y RADICADOR → TODO
        if (role === 'admin' || role === 'radicador') {
            return this.documentoRepository.find({
                relations: ['radicador', 'usuarioAsignado'],
                order: { fechaRadicacion: 'DESC' },
            });
        }

        // Usar el servicio de estados para obtener documentos por rol
        return await this.estadosService.obtenerDocumentosAsignados(user);
    }

    async findOne(id: string, user: User): Promise<Documento> {
        try {
            this.logger.log(`🔍 Usuario ${user.username} buscando documento ${id}`);
            const rolUsuario = user.role?.toString().toLowerCase();
            const esAdmin = rolUsuario === UserRole.ADMIN.toLowerCase();
            const esSupervisor = rolUsuario === UserRole.SUPERVISOR.toLowerCase();

            let documento: Documento | null = null;
            if (esAdmin || esSupervisor) {
                documento = await this.documentoRepository.findOne({
                    where: { id },
                    relations: ['radicador', 'usuarioAsignado'],
                });
            } else {
                documento = await this.documentoRepository.findOne({
                    where: {
                        id,
                        radicador: { id: user.id }
                    },
                    relations: ['radicador', 'usuarioAsignado'],
                });
            }

            if (!documento) {
                throw new NotFoundException('Documento no encontrado');
            }

            documento.ultimoAcceso = new Date();
            documento.ultimoUsuario = user.fullName || user.username;
            await this.documentoRepository.save(documento);

            return documento;
        } catch (error) {
            this.logger.error(`❌ Error en findOne: ${error.message}`);
            throw error;
        }
    }

    async findOnePublico(id: string, token: string): Promise<Documento> {
        if (!token) throw new UnauthorizedException('Token requerido');
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            throw new Error('JWT_SECRET no definido en las variables de entorno');
        }

        let payload: any;
        try {
            payload = jwt.verify(token, secret);
        } catch (err) {
            throw new UnauthorizedException('Token inválido o expirado');
        }

        const documento = await this.documentoRepository.findOne({
            where: { id }
        });

        if (!documento) {
            throw new NotFoundException('Documento no encontrado');
        }

        documento.ultimoAcceso = new Date();
        documento.ultimoUsuario = payload.username || 'ACCESO_PUBLICO';
        await this.documentoRepository.save(documento);

        return documento;
    }

    async obtenerRutaArchivo(id: string, numeroDocumento: number, user: User): Promise<string> {
        try {
            this.logger.log(`📥 Usuario ${user.username} descargando documento ${id}, archivo ${numeroDocumento}`);
            let documento: Documento | null = null;
            const rolUsuario = user.role?.toString().toLowerCase();
            const esAdmin = rolUsuario === UserRole.ADMIN.toLowerCase();
            const esSupervisor = rolUsuario === UserRole.SUPERVISOR.toLowerCase();
            const esAuditor = rolUsuario === UserRole.AUDITOR_CUENTAS.toLowerCase();

            if (esAdmin || esSupervisor || esAuditor) {
                documento = await this.documentoRepository.findOne({
                    where: { id },
                });
            } else {
                documento = await this.documentoRepository.findOne({
                    where: {
                        id,
                        radicador: { id: user.id }
                    },
                });
            }

            if (!documento) {
                throw new NotFoundException('Documento no encontrado');
            }

            let nombreArchivo: string;
            switch (numeroDocumento) {
                case 1:
                    nombreArchivo = documento.cuentaCobro;
                    break;
                case 2:
                    nombreArchivo = documento.seguridadSocial;
                    break;
                case 3:
                    nombreArchivo = documento.informeActividades;
                    break;
                default:
                    throw new BadRequestException('Número de documento inválido (1-3)');
            }

            const rutaCompleta = path.join(documento.rutaCarpetaRadicado, nombreArchivo);
            if (!fs.existsSync(rutaCompleta)) {
                throw new NotFoundException(`Archivo no encontrado en el servidor: ${nombreArchivo}`);
            }

            return rutaCompleta;
        } catch (error) {
            this.logger.error(`❌ Error en obtenerRutaArchivo: ${error.message}`);
            throw error;
        }
    }

    async obtenerRutaArchivoPublico(
        documento: Documento,
        numeroDocumento: number,
    ): Promise<string> {
        let nombreArchivo: string;
        switch (numeroDocumento) {
            case 1:
                nombreArchivo = documento.cuentaCobro;
                break;
            case 2:
                nombreArchivo = documento.seguridadSocial;
                break;
            case 3:
                nombreArchivo = documento.informeActividades;
                break;
            default:
                throw new BadRequestException('Número de documento inválido');
        }

        const rutaCompleta = path.join(
            documento.rutaCarpetaRadicado,
            nombreArchivo,
        );

        if (!fs.existsSync(rutaCompleta)) {
            throw new NotFoundException('Archivo no encontrado');
        }

        return rutaCompleta;
    }

    async obtenerPorId(id: string): Promise<Documento> {
        const documento = await this.documentoRepository.findOne({
            where: { id },
            relations: ['radicador', 'usuarioAsignado'],
        });

        if (!documento) {
            throw new NotFoundException('Documento no encontrado');
        }

        return documento;
    }

    async convertirWordAPdf(input: string, output: string): Promise<void> {
        const outDir = path.dirname(output);
        const fileName = path.basename(input);
        const cmd = `soffice --headless --convert-to pdf --outdir "${outDir}" "${input}"`;
        await execAsync(cmd);

        const pdfGenerado = path.join(
            outDir,
            fileName.replace(/\.(docx|doc)$/i, '.pdf')
        );

        if (!fs.existsSync(pdfGenerado)) {
            throw new Error('No se generó el PDF');
        }

        fs.renameSync(pdfGenerado, output);
    }

    async getMisDocumentos(user: any): Promise<Documento[]> {
        const role = user.role?.toLowerCase();

        this.logger.log(
            `📋 Usuario ${user.username} (${role}) listando MIS documentos`,
        );

        // Usar el servicio de estados para obtener documentos asignados
        return await this.estadosService.obtenerDocumentosAsignados(user);
    }

    async actualizarDocumentoConFlujo(
        id: string,
        updates: Partial<Documento>,
        user: User
    ): Promise<Documento> {
        const documento = await this.documentoRepository.findOne({
            where: { id },
            relations: ['radicador', 'usuarioAsignado'],
        });

        if (!documento) {
            throw new NotFoundException('Documento no encontrado');
        }

        // Verificar permisos
        if (user.role !== UserRole.ADMIN && documento.usuarioAsignado?.id !== user.id) {
            throw new ForbiddenException('No tienes permisos para actualizar este documento');
        }

        // Actualizar campos
        Object.assign(documento, updates);
        documento.fechaActualizacion = new Date();
        documento.ultimoAcceso = new Date();
        documento.ultimoUsuario = user.fullName || user.username;

        return await this.documentoRepository.save(documento);
    }

    async obtenerEstadisticasGenerales(): Promise<any> {
        const total = await this.documentoRepository.count();
        const porEstado = await this.documentoRepository
            .createQueryBuilder('documento')
            .select('documento.estado', 'estado')
            .addSelect('COUNT(*)', 'cantidad')
            .groupBy('documento.estado')
            .getRawMany();

        const ultimaSemana = new Date();
        ultimaSemana.setDate(ultimaSemana.getDate() - 7);

        const recientes = await this.documentoRepository.count({
            where: {
                fechaRadicacion: {
                    $gte: ultimaSemana
                } as any
            }
        });

        return {
            total,
            porEstado,
            recientesUltimaSemana: recientes,
            fechaConsulta: new Date().toISOString(),
        };
    }

    async buscarDocumentos(
        criterios: {
            numeroRadicado?: string;
            numeroContrato?: string;
            documentoContratista?: string;
            estado?: string;
            fechaDesde?: Date;
            fechaHasta?: Date;
        },
        user: User
    ): Promise<Documento[]> {
        const query = this.documentoRepository
            .createQueryBuilder('documento')
            .leftJoinAndSelect('documento.radicador', 'radicador')
            .leftJoinAndSelect('documento.usuarioAsignado', 'usuarioAsignado');

        // Aplicar filtros
        if (criterios.numeroRadicado) {
            query.andWhere('documento.numeroRadicado LIKE :numeroRadicado', {
                numeroRadicado: `%${criterios.numeroRadicado}%`
            });
        }

        if (criterios.numeroContrato) {
            query.andWhere('documento.numeroContrato LIKE :numeroContrato', {
                numeroContrato: `%${criterios.numeroContrato}%`
            });
        }

        if (criterios.documentoContratista) {
            query.andWhere('documento.documentoContratista LIKE :documentoContratista', {
                documentoContratista: `%${criterios.documentoContratista}%`
            });
        }

        if (criterios.estado) {
            query.andWhere('documento.estado = :estado', { estado: criterios.estado });
        }

        if (criterios.fechaDesde) {
            query.andWhere('documento.fechaRadicacion >= :fechaDesde', { fechaDesde: criterios.fechaDesde });
        }

        if (criterios.fechaHasta) {
            const fechaHasta = new Date(criterios.fechaHasta);
            fechaHasta.setHours(23, 59, 59, 999);
            query.andWhere('documento.fechaRadicacion <= :fechaHasta', { fechaHasta });
        }

        // Restricciones por rol
        if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPERVISOR) {
            if (user.role === UserRole.RADICADOR) {
                query.andWhere('documento.radicador.id = :userId', { userId: user.id });
            } else {
                query.andWhere('documento.usuarioAsignado.id = :userId', { userId: user.id });
            }
        }

        return query.orderBy('documento.fechaRadicacion', 'DESC').getMany();
    }

    async actualizarCampos(
        id: string,
        campos: {
            estado?: string;
            comentarios?: string;
            correcciones?: string;
            usuarioAsignadoId?: string;
            fechaLimiteRevision?: Date;
        },
        user: User
    ): Promise<Documento> {
        const documento = await this.documentoRepository.findOne({
            where: { id },
            relations: ['usuarioAsignado'],
        });

        if (!documento) {
            throw new NotFoundException('Documento no encontrado');
        }

        // Verificar permisos
        if (user.role !== UserRole.ADMIN && documento.usuarioAsignado?.id !== user.id) {
            throw new ForbiddenException('No tienes permisos para actualizar este documento');
        }

        // Actualizar campos permitidos
        if (campos.estado) {
            documento.estado = campos.estado;
        }

        if (campos.comentarios !== undefined) {
            documento.comentarios = campos.comentarios;
        }

        if (campos.correcciones !== undefined) {
            documento.correcciones = campos.correcciones;
        }

        if (campos.usuarioAsignadoId) {
            const nuevoUsuario = await this.userRepository.findOne({
                where: { id: campos.usuarioAsignadoId }
            });

            if (nuevoUsuario) {
                documento.usuarioAsignado = nuevoUsuario;
                documento.usuarioAsignadoNombre = nuevoUsuario.fullName || nuevoUsuario.username;
            }
        }

        if (campos.fechaLimiteRevision !== undefined) {
            documento.fechaLimiteRevision = campos.fechaLimiteRevision;
        }

        documento.fechaActualizacion = new Date();
        documento.ultimoAcceso = new Date();
        documento.ultimoUsuario = user.fullName || user.username;

        return await this.documentoRepository.save(documento);
    }

    async obtenerDocumentosPorContratista(
        documentoContratista: string,
        user: User
    ): Promise<Documento[]> {
        const query = this.documentoRepository
            .createQueryBuilder('documento')
            .leftJoinAndSelect('documento.radicador', 'radicador')
            .leftJoinAndSelect('documento.usuarioAsignado', 'usuarioAsignado')
            .where('documento.documentoContratista = :documentoContratista', {
                documentoContratista
            });

        // Restricciones por rol
        if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPERVISOR) {
            if (user.role === UserRole.RADICADOR) {
                query.andWhere('documento.radicador.id = :userId', { userId: user.id });
            } else {
                query.andWhere('documento.usuarioAsignado.id = :userId', { userId: user.id });
            }
        }

        return query.orderBy('documento.fechaRadicacion', 'DESC').getMany();
    }

    async obtenerDocumentosVencidos(user: User): Promise<Documento[]> {
        const fechaActual = new Date();

        const query = this.documentoRepository
            .createQueryBuilder('documento')
            .leftJoinAndSelect('documento.radicador', 'radicador')
            .leftJoinAndSelect('documento.usuarioAsignado', 'usuarioAsignado')
            .where('documento.fechaLimiteRevision IS NOT NULL')
            .andWhere('documento.fechaLimiteRevision < :fechaActual', { fechaActual })
            .andWhere('documento.estado NOT IN (:...estadosFinales)', {
                estadosFinales: ['FINALIZADO', 'DEVUELTO']
            });

        // Restricciones por rol
        if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPERVISOR) {
            if (user.role === UserRole.RADICADOR) {
                query.andWhere('documento.radicador.id = :userId', { userId: user.id });
            } else {
                query.andWhere('documento.usuarioAsignado.id = :userId', { userId: user.id });
            }
        }

        return query.orderBy('documento.fechaLimiteRevision', 'ASC').getMany();
    }

    async cambiarEstadoDocumento(
        documentoId: string,
        nuevoEstado: string,
        usuarioId: string,
        observacion?: string
    ): Promise<Documento> {
        try {
            this.logger.log(`🔄 Cambiando estado del documento ${documentoId} a ${nuevoEstado}`);

            const documento = await this.documentoRepository.findOne({
                where: { id: documentoId },
                relations: ['radicador', 'usuarioAsignado']
            });

            if (!documento) {
                throw new NotFoundException('Documento no encontrado');
            }

            const usuario = await this.userRepository.findOne({
                where: { id: usuarioId }
            });

            if (!usuario) {
                throw new NotFoundException('Usuario no encontrado');
            }

            const estadoAnterior = documento.estado;
            documento.estado = nuevoEstado;
            documento.fechaActualizacion = new Date();
            documento.ultimoAcceso = new Date();
            documento.ultimoUsuario = usuario.fullName || usuario.username;

            // Agregar al historial
            const historial = documento.historialEstados || [];
            historial.push({
                fecha: new Date(),
                estado: nuevoEstado,
                usuarioId: usuario.id,
                usuarioNombre: usuario.fullName || usuario.username,
                rolUsuario: usuario.role,
                observacion: observacion || `Cambio de estado: ${estadoAnterior} → ${nuevoEstado}`,
            });
            documento.historialEstados = historial;

            const documentoActualizado = await this.documentoRepository.save(documento);

            // ✅✅✅ NOTIFICAR AL SUPERVISOR SI EL ESTADO REQUIERE SUPERVISIÓN
            if (nuevoEstado === 'RADICADO' || nuevoEstado === 'SUPERVISADO') {
                try {
                    await this.supervisorService.onDocumentoCambiaEstado(documentoId, nuevoEstado);
                    this.logger.log(`✅ Notificación enviada a supervisor sobre cambio de estado`);
                } catch (error) {
                    this.logger.error(`⚠️ Error notificando cambio de estado a supervisor: ${error.message}`);
                    // No fallar la operación principal por esto
                }
            }

            this.logger.log(`✅ Estado del documento ${documento.numeroRadicado} cambiado de ${estadoAnterior} a ${nuevoEstado}`);

            return documentoActualizado;
        } catch (error) {
            this.logger.error(`❌ Error cambiando estado del documento: ${error.message}`);
            throw new InternalServerErrorException(`Error al cambiar estado del documento: ${error.message}`);
        }
    }

    async obtenerConteoDocumentosRadicados(): Promise<number> {
        return await this.documentoRepository.count({
            where: { estado: 'RADICADO' }
        });
    }

    async obtenerContratistaDeDocumento(documentoId: string): Promise<Contratista> {
        const documento = await this.documentoRepository.findOne({
            where: { id: documentoId }
        });

        if (!documento || !documento.contratistaId) {
            throw new NotFoundException('Contratista no encontrado para este documento');
        }

        return await this.contratistaService.buscarPorId(documento.contratistaId);
    }
}