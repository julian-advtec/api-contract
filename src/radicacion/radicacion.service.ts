import {
    Injectable,
    BadRequestException,
    Logger,
    ForbiddenException,
    NotFoundException,
    UnauthorizedException,
    InternalServerErrorException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Documento } from './entities/documento.entity';
import { CreateDocumentoDto } from './dto/create-documento.dto';
import * as fs from 'fs';
import * as path from 'path';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { Contratista } from './entities/contratista.entity';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Injectable()
export class RadicacionService {
    private readonly logger = new Logger(RadicacionService.name);

    // RUTA CORRECTA DEL SERVIDOR - IMPORTANTE: usar doble backslash para UNC
    private basePath = '\\\\R2-D2\\api-contract';



    constructor(
        @InjectRepository(Documento)
        private documentoRepository: Repository<Documento>,
        @InjectRepository(User)
        private userRepository: Repository<User>,
        @InjectRepository(Contratista)
        private contratistaRepository: Repository<Contratista>,
    ) {
        this.logger.log(`📁 ======= CONFIGURACIÓN RUTA SERVIDOR =======`);
        this.logger.log(`🌐 Ruta configurada: ${this.basePath}`);
        this.logger.log(`📌 Tipo de ruta: UNC (Windows Network Path)`);

        this.verificarYConfigurarRutaServidor();
    }

    private verificarYConfigurarRutaServidor(): void {
        try {
            this.logger.log(`🔍 Verificando acceso al servidor R2-D2...`);

            // IMPORTANTE: En Windows, para rutas UNC necesitamos doble backslash
            const rutasAProbar = [
                '\\\\R2-D2\\api-contract',           // UNC estándar
                '\\\\\\\\R2-D2\\\\\\\\api-contract', // UNC con escape
                '//R2-D2/api-contract',             // Formato alternativo
            ];

            let rutaFuncional = null;

            for (const rutaTest of rutasAProbar) {
                try {
                    this.logger.log(`🔍 Probando ruta: ${rutaTest}`);

                    // Intentar acceder a la ruta
                    if (fs.existsSync(rutaTest)) {
                        rutaFuncional = rutaTest;
                        this.logger.log(`✅ Ruta accesible: ${rutaTest}`);
                        break;
                    } else {
                        this.logger.log(`❌ Ruta no existe: ${rutaTest}`);

                        // Intentar crear directorio para probar permisos
                        try {
                            this.logger.log(`🔄 Intentando crear directorio...`);
                            fs.mkdirSync(rutaTest, { recursive: true });
                            this.logger.log(`✅ Se pudo crear directorio: ${rutaTest}`);

                            // Verificar que realmente se creó
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

                // Verificar permisos de escritura
                this.verificarPermisosEscritura();
            } else {
                this.logger.error(`❌ No se pudo acceder a ninguna ruta del servidor`);

                // En desarrollo, usar una carpeta local temporal
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
                        `No se puede acceder al servidor de archivos R2-D2. ` +
                        `Verifique: 1) El servidor esté encendido, 2) La ruta sea correcta, ` +
                        `3) Tenga permisos de red`
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

            this.logger.log(`🔍 Verificando permisos de escritura en: ${this.basePath}`);
            this.logger.log(`📝 Creando archivo de test: ${testFile}`);

            // Intentar escribir
            fs.writeFileSync(testFile, testContent, 'utf8');
            this.logger.log(`✅ Permisos de escritura OK`);

            // Verificar lectura
            const contenidoLeido = fs.readFileSync(testFile, 'utf8');
            if (contenidoLeido === testContent) {
                this.logger.log(`✅ Permisos de lectura OK`);
            }

            // Limpiar
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
            this.logger.log(`📁 Ruta base servidor: ${this.basePath}`);

            // 1. BUSCAR USUARIO COMPLETO EN BD
            this.logger.log(`🔍 Buscando usuario en base de datos...`);
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

            // 3. BUSCAR O CREAR CONTRATISTA
            this.logger.log(`🔍 Buscando/creando contratista...`);
            let contratista = await this.contratistaRepository.findOne({
                where: { documentoIdentidad: createDocumentoDto.documentoContratista }
            });

            if (!contratista) {
                this.logger.log(`📝 Creando nuevo contratista: ${createDocumentoDto.nombreContratista}`);
                contratista = this.contratistaRepository.create({
                    documentoIdentidad: createDocumentoDto.documentoContratista,
                    nombreCompleto: createDocumentoDto.nombreContratista,
                });
                contratista = await this.contratistaRepository.save(contratista);
                this.logger.log(`✅ Contratista creado: ${contratista.id}`);
            } else {
                this.logger.log(`✅ Contratista existente: ${contratista.id}`);
            }

            // 4. VALIDAR DATOS
            this.logger.log(`📋 Validando datos...`);
            if (!files || files.length !== 3) {
                throw new BadRequestException('Debe adjuntar exactamente 3 documentos');
            }

            const radicadoRegex = /^R\d{4}-\d{3}$/;
            if (!radicadoRegex.test(createDocumentoDto.numeroRadicado)) {
                throw new BadRequestException('Formato: RAAAA-NNN (ej: R2024-001)');
            }

            // 5. CREAR ESTRUCTURA EN SERVIDOR R2-D2
            this.logger.log(`📁 ======= CREANDO ESTRUCTURA EN SERVIDOR R2-D2 =======`);

            const ano = createDocumentoDto.numeroRadicado.substring(1, 5);

            // CONSTRUIR RUTA CORRECTA usando path.join con la basePath del servidor
            const rutaCarpetaRadicado = path.join(
                this.basePath,  // <-- Esta es la ruta del servidor R2-D2
                createDocumentoDto.documentoContratista,
                ano,
                createDocumentoDto.numeroContrato,
                createDocumentoDto.numeroRadicado,
            );

            this.logger.log(`📂 RUTA COMPLETA EN SERVIDOR: ${rutaCarpetaRadicado}`);

            // Crear carpetas en el servidor
            this.crearCarpetasEnServidor(rutaCarpetaRadicado);

            // 6. GUARDAR ARCHIVOS EN EL SERVIDOR R2-D2
            this.logger.log(`💾 ======= GUARDANDO ARCHIVOS EN SERVIDOR R2-D2 =======`);
            const nombresArchivos: string[] = [];

            for (let i = 0; i < files.length; i++) {
                try {
                    const file = files[i];
                    const extension = path.extname(file.originalname);
                    const descripcion = [
                        createDocumentoDto.descripcionDoc1 || 'Documento 1',
                        createDocumentoDto.descripcionDoc2 || 'Documento 2',
                        createDocumentoDto.descripcionDoc3 || 'Documento 3',
                    ][i];

                    const nombreArchivo = this.crearNombreArchivoSeguro(
                        descripcion,
                        createDocumentoDto.numeroRadicado,
                        extension
                    );

                    // Ruta completa en el servidor R2-D2
                    const rutaCompleta = path.join(rutaCarpetaRadicado, nombreArchivo);

                    this.logger.log(`💾 Guardando archivo ${i + 1}: ${nombreArchivo}`);
                    this.logger.log(`   Ruta en servidor R2-D2: ${rutaCompleta}`);
                    this.logger.log(`   Tamaño: ${file.size} bytes`);

                    // Verificar que la carpeta existe en el servidor
                    if (!fs.existsSync(rutaCarpetaRadicado)) {
                        throw new Error(`Carpeta no existe en servidor R2-D2: ${rutaCarpetaRadicado}`);
                    }

                    // Guardar archivo en el servidor R2-D2
                    fs.writeFileSync(rutaCompleta, file.buffer);

                    // Verificar que se guardó correctamente
                    if (!fs.existsSync(rutaCompleta)) {
                        throw new Error(`Archivo no se guardó en servidor R2-D2: ${rutaCompleta}`);
                    }

                    const stats = fs.statSync(rutaCompleta);
                    this.logger.log(`   ✅ Archivo guardado en R2-D2: ${stats.size} bytes`);
                    nombresArchivos.push(nombreArchivo);

                } catch (fileError) {
                    this.logger.error(`❌ Error guardando archivo ${i + 1}: ${fileError.message}`);
                    this.limpiarArchivosEnError(rutaCarpetaRadicado, nombresArchivos);
                    throw new BadRequestException(`Error guardando archivo ${i + 1}: ${fileError.message}`);
                }
            }

            this.logger.log(`✅ Todos los archivos guardados en servidor R2-D2: ${nombresArchivos.length}`);

            // 7. CREAR ARCHIVO DE REGISTRO/LOG EN LA CARPETA DEL SERVIDOR
            this.logger.log(`📝 Creando archivo de registro en carpeta del servidor...`);
            this.crearArchivoRegistroEnServidor(rutaCarpetaRadicado, usuarioCompleto, 'CREACION');
            this.logger.log(`✅ Archivo de registro creado en: ${rutaCarpetaRadicado}/registro_accesos.txt`);

            // 8. GUARDAR DOCUMENTO EN BASE DE DATOS
            this.logger.log(`💾 ======= GUARDANDO DOCUMENTO EN BASE DE DATOS =======`);

            // Crear documento para la base de datos
            const documento = this.documentoRepository.create({
                numeroRadicado: createDocumentoDto.numeroRadicado,
                numeroContrato: createDocumentoDto.numeroContrato,
                nombreContratista: createDocumentoDto.nombreContratista,
                documentoContratista: createDocumentoDto.documentoContratista,
                fechaInicio: new Date(createDocumentoDto.fechaInicio),
                fechaFin: new Date(createDocumentoDto.fechaFin),
                descripcionDoc1: createDocumentoDto.descripcionDoc1 || 'Documento 1',
                descripcionDoc2: createDocumentoDto.descripcionDoc2 || 'Documento 2',
                descripcionDoc3: createDocumentoDto.descripcionDoc3 || 'Documento 3',
                nombreDocumento1: nombresArchivos[0],
                nombreDocumento2: nombresArchivos[1],
                nombreDocumento3: nombresArchivos[2],
                radicador: usuarioCompleto,
                nombreRadicador: usuarioCompleto.fullName || usuarioCompleto.username,
                usuarioRadicador: usuarioCompleto.username,
                rutaCarpetaRadicado: rutaCarpetaRadicado,  // <-- ESTA ES LA RUTA COMPLETA EN EL SERVIDOR
                fechaRadicacion: new Date(),
                ultimoAcceso: new Date(),
                ultimoUsuario: usuarioCompleto.fullName || usuarioCompleto.username,
                estado: 'RADICADO',
                contratistaId: contratista.id,
            });

            try {
                const savedDocumento = await this.documentoRepository.save(documento);

                this.logger.log(`✅ Documento guardado en BD con ID: ${savedDocumento.id}`);
                this.logger.log(`🎉 ======= DOCUMENTO CREADO EXITOSAMENTE =======`);
                this.logger.log(`📁 Ruta en servidor R2-D2: ${rutaCarpetaRadicado}`);
                this.logger.log(`📄 Número radicado: ${savedDocumento.numeroRadicado}`);
                this.logger.log(`👤 Contratista: ${contratista.nombreCompleto} (${contratista.documentoIdentidad})`);
                this.logger.log(`👤 Radicador: ${usuarioCompleto.username} (${usuarioCompleto.role})`);

                return savedDocumento;
            } catch (error) {
                this.logger.error(`❌ Error guardando en BD: ${error.message}`);
                this.logger.error(`❌ Error completo:`, error);
                this.limpiarArchivosEnError(rutaCarpetaRadicado, nombresArchivos);
                throw new BadRequestException(`Error al guardar documento en base de datos: ${error.message}`);
            }

        } catch (error) {
            this.logger.error(`❌ ======= ERROR EN CREACIÓN DE DOCUMENTO =======`);
            this.logger.error(`❌ Mensaje: ${error.message}`);
            this.logger.error(`❌ Stack:`, error.stack);

            if (error instanceof ForbiddenException ||
                error instanceof BadRequestException ||
                error instanceof NotFoundException) {
                throw error;
            }

            throw new BadRequestException(`Error interno al crear documento: ${error.message}`);
        }
    }

    // ======= MÉTODOS AUXILIARES ESPECÍFICOS PARA SERVIDOR R2-D2 =======

    private crearCarpetasEnServidor(ruta: string): void {
        try {
            this.logger.log(`📁 Creando carpetas en servidor R2-D2: ${ruta}`);

            if (!fs.existsSync(ruta)) {
                // Crear directorios recursivamente
                fs.mkdirSync(ruta, { recursive: true });
                this.logger.log(`✅ Carpetas creadas en servidor: ${ruta}`);

                // Verificar que se crearon correctamente
                if (fs.existsSync(ruta)) {
                    this.logger.log(`✅ Verificación OK: Carpeta existe en servidor R2-D2`);
                } else {
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

    private crearNombreArchivoSeguro(descripcion: string, radicado: string, extension: string): string {
        const nombreLimpio = descripcion
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, '_')
            .replace(/[^\w.-]/g, '')
            .toLowerCase();

        return `${nombreLimpio}_${radicado}${extension.toLowerCase()}`;
    }

    private limpiarArchivosEnError(rutaCarpeta: string, nombresArchivos: string[]): void {
        try {
            if (!fs.existsSync(rutaCarpeta)) return;

            this.logger.log(`🗑️ Limpiando archivos en error: ${rutaCarpeta}`);

            // Eliminar archivos creados
            nombresArchivos.forEach(nombreArchivo => {
                const rutaArchivo = path.join(rutaCarpeta, nombreArchivo);
                if (fs.existsSync(rutaArchivo)) {
                    fs.unlinkSync(rutaArchivo);
                    this.logger.log(`🗑️ Archivo eliminado: ${nombreArchivo}`);
                }
            });

            // Verificar si la carpeta está vacía y eliminarla
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



    private async guardarDocumentoBD(
        createDocumentoDto: CreateDocumentoDto,
        nombresArchivos: string[],
        rutaCarpetaRadicado: string,
        usuarioCompleto: User,
        contratistaId: string
    ): Promise<Documento> {
        try {
            // Preparar fechas
            const fechaInicio = new Date(createDocumentoDto.fechaInicio);
            const fechaFin = new Date(createDocumentoDto.fechaFin);
            const ahora = new Date();

            // Crear documento
            const documento = this.documentoRepository.create({
                numeroRadicado: createDocumentoDto.numeroRadicado,
                numeroContrato: createDocumentoDto.numeroContrato,
                nombreContratista: createDocumentoDto.nombreContratista,
                documentoContratista: createDocumentoDto.documentoContratista,
                fechaInicio: fechaInicio,
                fechaFin: fechaFin,
                descripcionDoc1: createDocumentoDto.descripcionDoc1 || 'Documento 1',
                descripcionDoc2: createDocumentoDto.descripcionDoc2 || 'Documento 2',
                descripcionDoc3: createDocumentoDto.descripcionDoc3 || 'Documento 3',
                nombreDocumento1: nombresArchivos[0],
                nombreDocumento2: nombresArchivos[1],
                nombreDocumento3: nombresArchivos[2],
                radicador: usuarioCompleto,
                nombreRadicador: usuarioCompleto.fullName || usuarioCompleto.username,
                usuarioRadicador: usuarioCompleto.username,
                rutaCarpetaRadicado: rutaCarpetaRadicado, // Esta es la ruta COMPLETA en el servidor
                fechaRadicacion: ahora,
                ultimoAcceso: ahora,
                ultimoUsuario: usuarioCompleto.fullName || usuarioCompleto.username,
                estado: 'RADICADO',
                contratistaId: contratistaId,
            });

            documento.tokenPublico = randomUUID();
            documento.tokenActivo = true;
            documento.tokenExpiraEn = new Date(
                Date.now() + 1000 * 60 * 60 * 24 * 7 // 7 días
            );

            // Guardar en base de datos
            const documentoGuardado = await this.documentoRepository.save(documento);

            this.logger.log(`✅ Documento guardado en BD: ${documentoGuardado.id}`);
            return documentoGuardado;

        } catch (error) {
            this.logger.error(`❌ Error guardando en BD: ${error.message}`);

            // Si hay error de duplicado de radicado
            if (error.code === '23505' || error.message.includes('duplicate key')) {
                throw new BadRequestException('El número de radicado ya existe');
            }

            throw new BadRequestException(`Error al guardar documento en base de datos: ${error.message}`);
        }
    }

    // Método para verificar existencia de radicado
    private async verificarRadicadoExistente(numeroRadicado: string): Promise<boolean> {
        const existe = await this.documentoRepository.findOne({
            where: { numeroRadicado },
            select: ['id']
        });
        return !!existe;
    }

    // MÉTODOS DE CONSULTA

    async findAll(user: User): Promise<Documento[]> {
        try {
            this.logger.log(`📋 Usuario ${user.username} (${user.role}) listando documentos`);

            const rolUsuario = user.role?.toString().toLowerCase();
            const esAdmin = rolUsuario === UserRole.ADMIN.toLowerCase();
            const esSupervisor = rolUsuario === UserRole.SUPERVISOR.toLowerCase();

            let query = this.documentoRepository.createQueryBuilder('documento')
                .leftJoinAndSelect('documento.radicador', 'radicador')
                .orderBy('documento.fechaRadicacion', 'DESC');

            // Filtrar por usuario si no es admin ni supervisor
            if (!esAdmin && !esSupervisor) {
                query = query.where('radicador.id = :userId', { userId: user.id });
            }

            const documentos = await query.getMany();
            this.logger.log(`👁️ Documentos encontrados: ${documentos.length}`);
            return documentos;

        } catch (error) {
            this.logger.error(`❌ Error en findAll: ${error.message}`);
            throw error;
        }
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
                    relations: ['radicador'],
                });
            } else {
                documento = await this.documentoRepository.findOne({
                    where: {
                        id,
                        radicador: { id: user.id }
                    },
                    relations: ['radicador'],
                });
            }

            if (!documento) {
                throw new NotFoundException('Documento no encontrado');
            }

            // Actualizar último acceso
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

        // Busca el documento por ID, ya no hace falta comparar tokenPublico
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

            // Obtener nombre del archivo según el número
            let nombreArchivo: string;
            switch (numeroDocumento) {
                case 1:
                    nombreArchivo = documento.nombreDocumento1;
                    break;
                case 2:
                    nombreArchivo = documento.nombreDocumento2;
                    break;
                case 3:
                    nombreArchivo = documento.nombreDocumento3;
                    break;
                default:
                    throw new BadRequestException('Número de documento inválido (1-3)');
            }

            // Construir ruta completa
            const rutaCompleta = path.join(documento.rutaCarpetaRadicado, nombreArchivo);

            // Verificar que el archivo existe en el servidor
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
                nombreArchivo = documento.nombreDocumento1;
                break;
            case 2:
                nombreArchivo = documento.nombreDocumento2;
                break;
            case 3:
                nombreArchivo = documento.nombreDocumento3;
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
            where: { id }
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

}