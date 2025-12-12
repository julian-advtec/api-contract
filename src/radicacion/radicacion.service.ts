import { Injectable, BadRequestException, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Documento } from './entities/documento.entity';
import { CreateDocumentoDto } from './dto/create-documento.dto';
import * as fs from 'fs';
import * as path from 'path';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';

@Injectable()
export class RadicacionService {
  private readonly basePath = process.env.NODE_ENV === 'production' 
    ? '\\\\R2-D2\\api-contract'
    : './uploads';
  private readonly logger = new Logger(RadicacionService.name);

  constructor(
    @InjectRepository(Documento)
    private documentoRepository: Repository<Documento>,
  ) {
    this.logger.log(`📁 Ruta base configurada: ${this.basePath}`);
    this.logger.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
  }

  async create(
    createDocumentoDto: CreateDocumentoDto,
    files: Array<Express.Multer.File>,
    user: User,
  ): Promise<Documento> {
    try {
      this.logger.log(`📝 ======= INICIANDO CREACIÓN DE DOCUMENTO =======`);
      this.logger.log(`👤 Usuario: ${user.username} (${user.role})`);
      this.logger.log(`📄 Radicado: ${createDocumentoDto.numeroRadicado}`);
      this.logger.log(`📋 Contrato: ${createDocumentoDto.numeroContrato}`);
      this.logger.log(`📁 Archivos recibidos: ${files?.length || 0}`);

      // 1. Verificar permisos del usuario
      this.logger.log(`🔐 Verificando permisos...`);
      const userRole = user.role?.toString().toUpperCase();
      const allowedRoles = [UserRole.RADICADOR, UserRole.ADMIN].map(r => r.toString().toUpperCase());
      
      this.logger.debug(`🔍 Rol usuario: ${userRole}, Roles permitidos: ${JSON.stringify(allowedRoles)}`);
      
      if (!allowedRoles.includes(userRole)) {
        this.logger.warn(`🚫 Usuario ${user.username} no tiene permisos para radicar`);
        throw new ForbiddenException('No tienes permisos para radicar documentos');
      }
      
      this.logger.log(`✅ Permisos OK`);

      // 2. Validar archivos
      this.logger.log(`📋 Validando archivos...`);
      if (!files || files.length !== 3) {
        this.logger.error(`❌ Se requieren 3 archivos, recibidos: ${files?.length || 0}`);
        throw new BadRequestException('Debe adjuntar exactamente 3 documentos');
      }
      
      // Verificar cada archivo
      files.forEach((file, index) => {
        this.logger.log(`📄 Archivo ${index + 1}: ${file.originalname} (${file.size} bytes, ${file.mimetype})`);
      });
      
      this.logger.log(`✅ Archivos validados OK`);

      // 3. Validar formato radicado
      this.logger.log(`🔤 Validando formato de radicado...`);
      const radicadoRegex = /^R\d{4}-\d{3}$/;
      if (!radicadoRegex.test(createDocumentoDto.numeroRadicado)) {
        this.logger.error(`❌ Formato inválido: ${createDocumentoDto.numeroRadicado}`);
        throw new BadRequestException('Formato: RAAAA-NNN (ej: R2024-001)');
      }
      
      this.logger.log(`✅ Formato radicado OK`);

      // 4. Verificar radicado único
      this.logger.log(`🔍 Verificando duplicado de radicado...`);
      const existeRadicado = await this.documentoRepository.findOne({
        where: { numeroRadicado: createDocumentoDto.numeroRadicado },
      });
      
      if (existeRadicado) {
        this.logger.error(`❌ Radicado ya existe: ${createDocumentoDto.numeroRadicado}`);
        throw new BadRequestException('El número de radicado ya existe');
      }
      
      this.logger.log(`✅ Radicado único OK`);

      // 5. Crear estructura de carpetas
      this.logger.log(`📁 Creando estructura de carpetas...`);
      const ano = createDocumentoDto.numeroRadicado.substring(1, 5);
      const rutaCarpetaRadicado = path.join(
        this.basePath,
        createDocumentoDto.documentoContratista,
        ano,
        createDocumentoDto.numeroContrato,
        createDocumentoDto.numeroRadicado,
      );

      this.logger.log(`📂 Ruta completa: ${rutaCarpetaRadicado}`);
      
      try {
        this.crearCarpetas(rutaCarpetaRadicado);
        this.logger.log(`✅ Carpetas creadas OK`);
      } catch (error) {
        this.logger.error(`❌ Error creando carpetas: ${error.message}`);
        throw new BadRequestException('Error creando estructura de carpetas: ' + error.message);
      }

      // 6. Crear archivo de registro
      this.logger.log(`📝 Creando archivo de registro...`);
      this.crearArchivoRegistro(rutaCarpetaRadicado, user, 'CREACION');
      this.logger.log(`✅ Archivo de registro creado OK`);

      // 7. Guardar archivos
      this.logger.log(`💾 Guardando archivos...`);
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
          
          // Crear nombre seguro para el archivo
          const nombreArchivo = this.crearNombreArchivoSeguro(
            descripcion, 
            createDocumentoDto.numeroRadicado, 
            extension
          );
          
          const rutaCompleta = path.join(rutaCarpetaRadicado, nombreArchivo);
          
          this.logger.log(`💾 Guardando archivo ${i + 1}:`);
          this.logger.log(`   Nombre original: ${file.originalname}`);
          this.logger.log(`   Nombre guardado: ${nombreArchivo}`);
          this.logger.log(`   Ruta: ${rutaCompleta}`);
          this.logger.log(`   Tamaño: ${file.size} bytes`);
          this.logger.log(`   Buffer existe: ${!!file.buffer}`);
          this.logger.log(`   Buffer tamaño: ${file.buffer?.length || 0} bytes`);
          
          // Verificar que la carpeta existe
          if (!fs.existsSync(rutaCarpetaRadicado)) {
            this.logger.error(`❌ Carpeta no existe: ${rutaCarpetaRadicado}`);
            throw new Error(`Carpeta no existe: ${rutaCarpetaRadicado}`);
          }
          
          // Intentar escribir el archivo
          fs.writeFileSync(rutaCompleta, file.buffer);
          this.logger.log(`   ✅ Archivo guardado exitosamente`);
          nombresArchivos.push(nombreArchivo);
          
          // Verificar que el archivo se creó
          if (fs.existsSync(rutaCompleta)) {
            const stats = fs.statSync(rutaCompleta);
            this.logger.log(`   ✅ Archivo verificado: ${stats.size} bytes`);
          } else {
            this.logger.error(`❌ Archivo no se creó: ${rutaCompleta}`);
            throw new Error(`Archivo no se creó: ${rutaCompleta}`);
          }
          
        } catch (fileError) {
          this.logger.error(`❌ Error guardando archivo ${i + 1}: ${fileError.message}`);
          this.logger.error(`❌ Stack: ${fileError.stack}`);
          throw new BadRequestException(`Error guardando archivo ${i + 1}: ${fileError.message}`);
        }
      }
      
      this.logger.log(`✅ Todos los archivos guardados: ${nombresArchivos.length}`);

      // 8. Crear documento en BD
      this.logger.log(`💾 Creando documento en base de datos...`);
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
        radicador: user,
        nombreRadicador: user.fullName || user.username,
        usuarioRadicador: user.username,
        rutaCarpetaRadicado: rutaCarpetaRadicado,
        fechaRadicacion: new Date(),
        ultimoAcceso: new Date(),
        ultimoUsuario: user.fullName || user.username,
        estado: 'RADICADO',
      });

      this.logger.log(`📊 Datos del documento para BD:`);
      this.logger.log(JSON.stringify({
        numeroRadicado: documento.numeroRadicado,
        numeroContrato: documento.numeroContrato,
        nombreContratista: documento.nombreContratista.substring(0, 30) + '...',
        archivos: nombresArchivos,
        ruta: documento.rutaCarpetaRadicado,
        radicador: documento.usuarioRadicador
      }, null, 2));

      try {
        const savedDocumento = await this.documentoRepository.save(documento);
        this.logger.log(`✅ Documento guardado en BD con ID: ${savedDocumento.id}`);
        this.logger.log(`🎉 ======= DOCUMENTO CREADO EXITOSAMENTE =======`);
        
        return savedDocumento;
      } catch (error) {
        this.logger.error(`❌ Error guardando en BD: ${error.message}`);
        this.logger.error(`❌ Error code: ${error.code}`);
        this.logger.error(`❌ Error stack: ${error.stack}`);
        this.logger.error(`❌ Error detalles:`, error);
        
        // Intentar eliminar los archivos si falló la BD
        this.logger.log(`🧹 Limpiando archivos creados...`);
        try {
          this.limpiarArchivosEnError(rutaCarpetaRadicado, nombresArchivos);
        } catch (cleanupError) {
          this.logger.error(`❌ Error limpiando archivos: ${cleanupError.message}`);
        }
        
        throw new BadRequestException(`Error al guardar documento en base de datos: ${error.message}`);
      }

    } catch (error) {
      this.logger.error(`❌ ======= ERROR EN CREACIÓN DE DOCUMENTO =======`);
      this.logger.error(`❌ Tipo: ${error.constructor.name}`);
      this.logger.error(`❌ Mensaje: ${error.message}`);
      this.logger.error(`❌ Stack: ${error.stack}`);
      
      if (error instanceof ForbiddenException || 
          error instanceof BadRequestException || 
          error instanceof NotFoundException) {
        throw error;
      }
      
      this.logger.error(`❌ Error no controlado: ${error.message}`);
      throw new BadRequestException(`Error interno al crear documento: ${error.message}`);
    }
  }

  async findAll(user: User): Promise<Documento[]> {
    try {
      this.logger.log(`📋 Usuario ${user.username} (${user.role}) listando documentos`);

      // Normalizar el rol a mayúsculas
      const userRole = user.role?.toString().toUpperCase();
      
      const allowedRoles = [
        UserRole.RADICADOR.toString().toUpperCase(),
        UserRole.ADMIN.toString().toUpperCase(),
        UserRole.SUPERVISOR.toString().toUpperCase(),
        UserRole.AUDITOR_CUENTAS.toString().toUpperCase()
      ];

      if (!allowedRoles.includes(userRole)) {
        this.logger.warn(`🚫 Usuario ${user.username} no tiene permisos para ver documentos`);
        throw new ForbiddenException(`No tienes permisos para ver documentos. Rol: ${user.role}`);
      }

      // Si es ADMIN o SUPERVISOR, puede ver todos los documentos
      if ([UserRole.ADMIN.toString().toUpperCase(), UserRole.SUPERVISOR.toString().toUpperCase()].includes(userRole)) {
        const documentos = await this.documentoRepository.find({
          order: { fechaRadicacion: 'DESC' },
          relations: ['radicador'],
        });
        this.logger.log(`👁️ Mostrando todos los documentos: ${documentos.length}`);
        return documentos;
      }

      // Si es RADICADOR o AUDITOR_CUENTAS, solo ve sus propios documentos
      const documentos = await this.documentoRepository.find({
        where: { radicador: { id: user.id } },
        order: { fechaRadicacion: 'DESC' },
        relations: ['radicador'],
      });
      this.logger.log(`👁️ Mostrando documentos propios: ${documentos.length}`);
      return documentos;

    } catch (error) {
      this.logger.error(`❌ Error en findAll: ${error.message}`);
      throw error;
    }
  }

  async findOne(id: string, user: User): Promise<Documento> {
    try {
      this.logger.log(`🔍 Usuario ${user.username} buscando documento ${id}`);

      // Verificar permisos
      const userRole = user.role?.toString().toUpperCase();
      const allowedRoles = [
        UserRole.RADICADOR.toString().toUpperCase(),
        UserRole.ADMIN.toString().toUpperCase(),
        UserRole.SUPERVISOR.toString().toUpperCase()
      ];

      if (!allowedRoles.includes(userRole)) {
        throw new ForbiddenException(`No tienes permisos para ver este documento. Rol: ${user.role}`);
      }

      let documento: Documento | null = null;
      
      // ADMIN y SUPERVISOR pueden ver cualquier documento
      if ([UserRole.ADMIN.toString().toUpperCase(), UserRole.SUPERVISOR.toString().toUpperCase()].includes(userRole)) {
        documento = await this.documentoRepository.findOne({
          where: { id },
          relations: ['radicador'],
        });
      } else {
        // RADICADOR solo puede ver sus propios documentos
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

      // Actualizar archivo de registro
      this.actualizarArchivoRegistro(documento.rutaCarpetaRadicado, user, 'CONSULTA');

      return documento;

    } catch (error) {
      this.logger.error(`❌ Error en findOne: ${error.message}`);
      throw error;
    }
  }

  async obtenerRutaArchivo(id: string, numeroDocumento: number, user: User): Promise<string> {
    try {
      this.logger.log(`📥 Usuario ${user.username} descargando documento ${id}, archivo ${numeroDocumento}`);

      // Verificar permisos
      const userRole = user.role?.toString().toUpperCase();
      const allowedRoles = [
        UserRole.RADICADOR.toString().toUpperCase(),
        UserRole.ADMIN.toString().toUpperCase(),
        UserRole.SUPERVISOR.toString().toUpperCase(),
        UserRole.AUDITOR_CUENTAS.toString().toUpperCase()
      ];

      if (!allowedRoles.includes(userRole)) {
        throw new ForbiddenException(`No tienes permisos para descargar archivos. Rol: ${user.role}`);
      }

      let documento: Documento | null = null;
      
      // ADMIN, SUPERVISOR y AUDITOR pueden descargar cualquier documento
      if ([
        UserRole.ADMIN.toString().toUpperCase(), 
        UserRole.SUPERVISOR.toString().toUpperCase(), 
        UserRole.AUDITOR_CUENTAS.toString().toUpperCase()
      ].includes(userRole)) {
        documento = await this.documentoRepository.findOne({
          where: { id },
        });
      } else {
        // RADICADOR solo puede descargar sus propios documentos
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

      // Actualizar archivo de registro
      this.actualizarArchivoRegistro(documento.rutaCarpetaRadicado, user, 'DESCARGA');

      const rutaCompleta = path.join(documento.rutaCarpetaRadicado, nombreArchivo);
      
      // Verificar que el archivo existe
      if (!fs.existsSync(rutaCompleta)) {
        throw new NotFoundException(`Archivo no encontrado: ${nombreArchivo}`);
      }

      return rutaCompleta;

    } catch (error) {
      this.logger.error(`❌ Error en obtenerRutaArchivo: ${error.message}`);
      throw error;
    }
  }

  // ========== MÉTODOS AUXILIARES ==========

  private crearNombreArchivoSeguro(descripcion: string, radicado: string, extension: string): string {
    // Eliminar caracteres no seguros y espacios
    const nombreLimpio = descripcion
      .replace(/\s+/g, '_')
      .replace(/[^\w.-]/g, '')
      .toLowerCase();
    
    return `${nombreLimpio}_${radicado}${extension}`;
  }

  private limpiarArchivosEnError(rutaCarpeta: string, nombresArchivos: string[]): void {
    try {
      // Eliminar archivos creados
      nombresArchivos.forEach(nombreArchivo => {
        const rutaArchivo = path.join(rutaCarpeta, nombreArchivo);
        if (fs.existsSync(rutaArchivo)) {
          fs.unlinkSync(rutaArchivo);
          this.logger.log(`🗑️ Archivo eliminado: ${rutaArchivo}`);
        }
      });
      
      // Eliminar carpeta si está vacía
      if (fs.existsSync(rutaCarpeta)) {
        const archivos = fs.readdirSync(rutaCarpeta);
        if (archivos.length === 0) {
          fs.rmdirSync(rutaCarpeta);
          this.logger.log(`🗑️ Carpeta eliminada: ${rutaCarpeta}`);
        }
      }
    } catch (error) {
      this.logger.error(`❌ Error en limpieza: ${error.message}`);
    }
  }

  private crearCarpetas(ruta: string): void {
    try {
      if (!fs.existsSync(ruta)) {
        this.logger.log(`📁 Creando carpeta: ${ruta}`);
        fs.mkdirSync(ruta, { recursive: true });
        this.logger.log(`✅ Carpeta creada: ${ruta}`);
      } else {
        this.logger.log(`📁 Carpeta ya existe: ${ruta}`);
      }
    } catch (error) {
      this.logger.error(`❌ Error creando carpetas: ${error.message}`);
      throw new BadRequestException('Error creando estructura de carpetas: ' + error.message);
    }
  }

  private crearArchivoRegistro(rutaCarpeta: string, user: User, accion: string): void {
    try {
      const rutaArchivo = path.join(rutaCarpeta, 'registro_accesos.txt');
      
      const contenido = `=== REGISTRO DE ACCESOS ===
Radicado creado por: ${user.fullName || user.username} (${user.username})
Rol: ${user.role}
Fecha: ${new Date().toLocaleString('es-CO')}
Acción: ${accion}

--- HISTORIAL DE ACCESOS ---
${this.formatearRegistro(user, accion)}
`;
      
      fs.writeFileSync(rutaArchivo, contenido, 'utf8');
      this.logger.log(`✅ Archivo de registro creado: ${rutaArchivo}`);
    } catch (error) {
      this.logger.error(`❌ Error creando registro: ${error.message}`);
    }
  }

  private actualizarArchivoRegistro(rutaCarpeta: string, user: User, accion: string): void {
    try {
      const rutaArchivo = path.join(rutaCarpeta, 'registro_accesos.txt');
      
      if (!fs.existsSync(rutaArchivo)) {
        this.crearArchivoRegistro(rutaCarpeta, user, accion);
        return;
      }

      let contenido = fs.readFileSync(rutaArchivo, 'utf8');
      const nuevaLinea = this.formatearRegistro(user, accion);
      
      const lineas = contenido.split('\n');
      const historialIndex = lineas.findIndex(l => l.includes('--- HISTORIAL DE ACCESOS ---'));
      
      if (historialIndex !== -1) {
        lineas.splice(historialIndex + 1, 0, nuevaLinea);
        
        const historialStart = historialIndex + 1;
        const historialEnd = lineas.length;
        const lineasHistorial = historialEnd - historialStart;
        
        if (lineasHistorial > 50) {
          lineas.splice(historialStart + 50, lineasHistorial - 50);
        }
        
        contenido = lineas.join('\n');
        fs.writeFileSync(rutaArchivo, contenido, 'utf8');
      }
    } catch (error) {
      this.logger.error(`❌ Error actualizando registro: ${error.message}`);
    }
  }

  private formatearRegistro(user: User, accion: string): string {
    const fecha = new Date().toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      dateStyle: 'short',
      timeStyle: 'medium',
    });
    
    return `[${fecha}] ${user.fullName || user.username} (${user.username}) - ${user.role} - ${accion}`;
  }
}