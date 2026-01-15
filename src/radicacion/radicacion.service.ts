import {
    Injectable,
    BadRequestException,
    Logger,
    ForbiddenException,
    NotFoundException,
    UnauthorizedException,
    InternalServerErrorException,
    Inject,
    forwardRef
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
import { SupervisorService } from '../supervision/supervisor.service';
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

            // 1. BUSCAR USUARIO COMPLETO EN BD
            const usuarioCompleto = await this.userRepository.findOne({
                where: { username: user.username.toLowerCase().trim() }
            });

            if (!usuarioCompleto) {
                throw new BadRequestException(`Usuario "${user.username}" no encontrado`);
            }

            // 2. VERIFICAR PERMISOS
            const rolUsuario = usuarioCompleto.role?.toString().toLowerCase().trim();
            const puedeRadicar = rolUsuario === 'admin' || rolUsuario === 'radicador';

            if (!puedeRadicar) {
                throw new ForbiddenException(
                    `No tienes permisos para radicar documentos. Tu rol es: ${rolUsuario}. Solo pueden radicar: admin y radicador.`
                );
            }

            this.logger.log(`✅ PERMISOS OK: ${usuarioCompleto.username} (${rolUsuario}) puede radicar`);

            // 3. BUSCAR O CREAR CONTRATISTA usando el servicio
            let contratista: Contratista;
            try {
                // ✅ CAMBIADO: buscarPorDocumento ahora retorna array
                const contratistas = await this.contratistaService.buscarPorDocumento(createDocumentoDto.documentoContratista);

                if (contratistas.length > 0) {
                    contratista = contratistas[0];
                    this.logger.log(`✅ Contratista existente: ${contratista.id} - ${contratista.nombreCompleto}`);
                } else {
                    // Crear nuevo contratista si no existe
                    contratista = await this.contratistaService.crear({
                        documentoIdentidad: createDocumentoDto.documentoContratista,
                        nombreCompleto: createDocumentoDto.nombreContratista,
                    });
                    this.logger.log(`📝 Nuevo contratista creado: ${contratista.id} - ${contratista.nombreCompleto}`);
                }
            } catch (error) {
                this.logger.error(`❌ Error buscando/creando contratista: ${error.message}`);
                throw error;
            }

            // 4. VALIDAR ARCHIVOS
            if (!files || files.length !== 3) {
                throw new BadRequestException('Debe adjuntar exactamente 3 documentos');
            }

            // 5. VALIDAR FORMATO DE RADICADO
            const radicadoRegex = /^R\d{4}-\d{3}$/;
            if (!radicadoRegex.test(createDocumentoDto.numeroRadicado)) {
                throw new BadRequestException('Formato de radicado inválido. Debe ser: RAAAA-NNN (ej: R2024-001)');
            }

            // 6. VERIFICAR SI EL RADICADO YA EXISTE
            const radicadoExistente = await this.documentoRepository.findOne({
                where: { numeroRadicado: createDocumentoDto.numeroRadicado }
            });

            if (radicadoExistente) {
                throw new BadRequestException(`El número de radicado ${createDocumentoDto.numeroRadicado} ya existe`);
            }

            // 7. OBTENER AÑO DEL RADICADO
            const anoRadicado = createDocumentoDto.numeroRadicado.substring(1, 5);

            // 8. VERIFICAR Y MARCAR COMO PRIMER RADICADO DEL AÑO
            let esPrimerRadicadoAno = createDocumentoDto.primerRadicadoDelAno || false;

            if (esPrimerRadicadoAno) {
                // Verificar si ya existe un primer radicado para este año
                const primerRadicadoExistente = await this.documentoRepository.findOne({
                    where: {
                        primerRadicadoDelAno: true,
                        numeroRadicado: Like(`R${anoRadicado}-%`)
                    }
                });

                if (primerRadicadoExistente) {
                    this.logger.warn(`⚠️ Ya existe un primer radicado para el año ${anoRadicado}: ${primerRadicadoExistente.numeroRadicado}`);
                    esPrimerRadicadoAno = false; // No marcar como primer radicado si ya existe uno
                } else {
                    this.logger.log(`✅ Documento marcado como primer radicado del año ${anoRadicado}`);
                }
            }

            // 9. CREAR ESTRUCTURA DE CARPETAS EN SERVIDOR R2-D2
            const rutaCarpetaRadicado = path.join(
                this.basePath,
                createDocumentoDto.documentoContratista,
                anoRadicado,
                createDocumentoDto.numeroContrato,
                createDocumentoDto.numeroRadicado,
            );

            this.logger.log(`📂 Creando estructura en servidor: ${rutaCarpetaRadicado}`);
            this.crearCarpetasEnServidor(rutaCarpetaRadicado);

            // 10. GUARDAR ARCHIVOS EN EL SERVIDOR R2-D2
            this.logger.log(`💾 ======= GUARDANDO ARCHIVOS EN SERVIDOR R2-D2 =======`);
            const nombresArchivos: string[] = [];

            // Definir descripciones para los archivos
            const descripciones = [
                createDocumentoDto.descripcionCuentaCobro || 'Cuenta de Cobro',
                createDocumentoDto.descripcionSeguridadSocial || 'Seguridad Social',
                createDocumentoDto.descripcionInformeActividades || 'Informe de Actividades',
            ];

            // Tipos de archivo esperados
            const tiposArchivo = ['cuenta_cobro', 'seguridad_social', 'informe_actividades'];

            for (let i = 0; i < files.length; i++) {
                try {
                    const file = files[i];
                    const extension = path.extname(file.originalname).toLowerCase();
                    const descripcion = descripciones[i];
                    const tipoArchivo = tiposArchivo[i];

                    // Validar extensión del archivo
                    const extensionesPermitidas = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];
                    if (!extensionesPermitidas.includes(extension)) {
                        throw new BadRequestException(
                            `Archivo ${i + 1} tiene extensión no permitida. Permitidas: ${extensionesPermitidas.join(', ')}`
                        );
                    }

                    // Crear nombre seguro para el archivo
                    const nombreArchivo = this.crearNombreArchivoSeguro(
                        tipoArchivo,
                        createDocumentoDto.numeroRadicado,
                        extension
                    );

                    const rutaCompleta = path.join(rutaCarpetaRadicado, nombreArchivo);
                    this.logger.log(`💾 Guardando archivo ${i + 1}: ${nombreArchivo} (${file.size} bytes)`);

                    // Verificar que exista la carpeta
                    if (!fs.existsSync(rutaCarpetaRadicado)) {
                        throw new Error(`Carpeta no existe en servidor: ${rutaCarpetaRadicado}`);
                    }

                    // Guardar archivo en el servidor
                    fs.writeFileSync(rutaCompleta, file.buffer);

                    // Verificar que se guardó correctamente
                    if (!fs.existsSync(rutaCompleta)) {
                        throw new Error(`Archivo no se guardó en servidor: ${rutaCompleta}`);
                    }

                    const stats = fs.statSync(rutaCompleta);
                    this.logger.log(`   ✅ Archivo guardado: ${stats.size} bytes`);
                    nombresArchivos.push(nombreArchivo);

                } catch (fileError) {
                    this.logger.error(`❌ Error guardando archivo ${i + 1}: ${fileError.message}`);
                    this.limpiarArchivosEnError(rutaCarpetaRadicado, nombresArchivos);
                    throw new BadRequestException(`Error guardando archivo ${i + 1}: ${fileError.message}`);
                }
            }

            this.logger.log(`✅ Todos los archivos guardados en servidor: ${nombresArchivos.length} archivos`);

            // 11. CREAR ARCHIVO DE REGISTRO EN EL SERVIDOR
            this.crearArchivoRegistroEnServidor(rutaCarpetaRadicado, usuarioCompleto, 'CREACION');
            this.logger.log(`✅ Archivo de registro creado en servidor`);

            // ✅✅✅ **IMPORTANTE: ELIMINADO BUSQUEDA DE SUPERVISOR PARA ASIGNACIÓN AUTOMÁTICA**
            // NO buscar supervisor automáticamente - el documento quedará disponible en lista

            this.logger.log(`📋 Documento quedará disponible en lista para que CUALQUIER supervisor lo tome`);

            // 12. CREAR HISTORIAL INICIAL
            const historialEstados = [{
                fecha: new Date(),
                estado: 'RADICADO',
                usuarioId: usuarioCompleto.id,
                usuarioNombre: usuarioCompleto.fullName || usuarioCompleto.username,
                rolUsuario: usuarioCompleto.role,
                observacion: 'Documento radicado inicialmente - Disponible para supervisores',
            }];

            // 13. PREPARAR DATOS DEL DOCUMENTO
            const documentoData: Partial<Documento> = {
                // Información básica
                numeroRadicado: createDocumentoDto.numeroRadicado,
                numeroContrato: createDocumentoDto.numeroContrato,
                nombreContratista: createDocumentoDto.nombreContratista,
                documentoContratista: createDocumentoDto.documentoContratista,

                // Fechas
                fechaInicio: new Date(createDocumentoDto.fechaInicio),
                fechaFin: new Date(createDocumentoDto.fechaFin),
                fechaRadicacion: new Date(),

                // Marcación como primer radicado
                primerRadicadoDelAno: esPrimerRadicadoAno,

                // Descripciones de archivos
                descripcionCuentaCobro: createDocumentoDto.descripcionCuentaCobro || 'Cuenta de Cobro',
                descripcionSeguridadSocial: createDocumentoDto.descripcionSeguridadSocial || 'Seguridad Social',
                descripcionInformeActividades: createDocumentoDto.descripcionInformeActividades || 'Informe de Actividades',

                // Nombres de archivos guardados
                cuentaCobro: nombresArchivos[0],
                seguridadSocial: nombresArchivos[1],
                informeActividades: nombresArchivos[2],

                // Observaciones
                observacion: createDocumentoDto.observacion,

                // Información del radicador
                radicador: usuarioCompleto,
                nombreRadicador: usuarioCompleto.fullName || usuarioCompleto.username,
                usuarioRadicador: usuarioCompleto.username,

                // Rutas y ubicación
                rutaCarpetaRadicado: rutaCarpetaRadicado,

                // Metadatos de acceso
                ultimoAcceso: new Date(),
                ultimoUsuario: usuarioCompleto.fullName || usuarioCompleto.username,
                fechaActualizacion: new Date(),

                // Estado y flujo
                estado: 'RADICADO',
                contratistaId: contratista.id,

                // Tokens para acceso público
                tokenPublico: randomUUID(),
                tokenActivo: true,
                tokenExpiraEn: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 7 días

                // ✅✅✅ **CRÍTICO: NO ASIGNAR SUPERVISOR AUTOMÁTICAMENTE**
                usuarioAsignado: null, // 👈 Dejar como null
                usuarioAsignadoNombre: '', // 👈 Dejar vacío

                // Historial
                historialEstados: historialEstados,
            };

            // 14. CREAR Y GUARDAR DOCUMENTO EN BASE DE DATOS
            this.logger.log(`💾 ======= GUARDANDO DOCUMENTO EN BASE DE DATOS =======`);

            const documento = this.documentoRepository.create(documentoData);

            try {
                const savedDocumento = await this.documentoRepository.save(documento);
                this.logger.log(`✅ Documento guardado en BD con ID: ${savedDocumento.id}`);

                // 15. ASIGNAR DOCUMENTO A SUPERVISORES AUTOMÁTICAMENTE (solo como "disponible" en sus listas)
                try {
                    await this.asignarDocumentoASupervisores(savedDocumento);
                    this.logger.log(`✅ Documento marcado como disponible para todos los supervisores`);
                } catch (asignacionError) {
                    this.logger.warn(`⚠️ Error en asignación a supervisores: ${asignacionError.message}`);
                    // No fallar la operación principal por esto
                }

                // 16. REGISTRAR ÉXITO
                this.logger.log(`🎉 ======= DOCUMENTO CREADO EXITOSAMENTE =======`);
                this.logger.log(`📄 Número radicado: ${savedDocumento.numeroRadicado}`);
                this.logger.log(`👤 Contratista: ${savedDocumento.nombreContratista}`);
                this.logger.log(`📅 Primer radicado del año: ${savedDocumento.primerRadicadoDelAno ? 'Sí' : 'No'}`);
                this.logger.log(`📁 Ruta servidor: ${savedDocumento.rutaCarpetaRadicado}`);
                this.logger.log(`👥 Estado: Disponible para que cualquier supervisor lo tome`);

                return savedDocumento;

            } catch (dbError) {
                this.logger.error(`❌ Error guardando en BD: ${dbError.message}`);

                // Limpiar archivos si hay error en BD
                this.limpiarArchivosEnError(rutaCarpetaRadicado, nombresArchivos);

                if (dbError.code === '23505' || dbError.message.includes('duplicate key')) {
                    throw new BadRequestException('El número de radicado ya existe en la base de datos');
                }

                throw new BadRequestException(`Error al guardar documento en base de datos: ${dbError.message}`);
            }

        } catch (error) {
            this.logger.error(`❌ ======= ERROR EN CREACIÓN DE DOCUMENTO =======`);
            this.logger.error(`❌ Mensaje: ${error.message}`);
            this.logger.error(`❌ Stack: ${error.stack}`);

            // Re-lanzar errores específicos
            if (error instanceof ForbiddenException ||
                error instanceof BadRequestException ||
                error instanceof NotFoundException) {
                throw error;
            }

            // Error genérico
            throw new BadRequestException(`Error interno al crear documento: ${error.message}`);
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