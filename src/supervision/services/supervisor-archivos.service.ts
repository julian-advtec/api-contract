import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

import { SupervisorDocumento, SupervisorEstado } from '../entities/supervisor.entity';
import { Documento } from '../../radicacion/entities/documento.entity';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class SupervisorArchivosService {
  private readonly logger = new Logger(SupervisorArchivosService.name);

  constructor(
    @InjectRepository(SupervisorDocumento)
    private supervisorRepository: Repository<SupervisorDocumento>,

    @InjectRepository(Documento)
    private documentoRepository: Repository<Documento>,

    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  

  /**
   * ✅ DESCARGAR ARCHIVO RADICADO – PERMISO RELAJADO
   */
  async descargarArchivoRadicado(
    documentoId: string,
    numeroArchivo: number,
    userId: string,
  ): Promise<{ ruta: string; nombre: string }> {
    this.logger.log(`📥 Usuario ${userId} solicitando archivo ${numeroArchivo} de ${documentoId}`);

    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId },
      relations: ['radicador', 'usuarioAsignado'],
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    // ✅ PERMISO RELAJADO: Cualquiera autenticado puede descargar/ver
    // Solo se restringe si el documento está en estado muy avanzado o eliminado
    if (documento.estado === 'FINALIZADO' || documento.estado === 'RECHAZADO_PERMANENTE') {
      // Puedes mantener esta restricción si quieres, o quitarla
      throw new ForbiddenException('Este documento ya no está disponible para descarga');
    }

    let nombreArchivo: string;
    switch (numeroArchivo) {
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
        throw new BadRequestException('Número de archivo inválido (1-3)');
    }

    if (!nombreArchivo) {
      throw new NotFoundException('Este archivo no existe en el documento');
    }

    const rutaCompleta = path.join(documento.rutaCarpetaRadicado, nombreArchivo);

    if (!fs.existsSync(rutaCompleta)) {
      throw new NotFoundException(`Archivo físico no encontrado: ${nombreArchivo}`);
    }

    // Registrar acceso (opcional)
    this.registrarAccesoSupervisor(
      documento.rutaCarpetaRadicado,
      userId,
      `ACCEDIÓ a archivo ${numeroArchivo}: ${nombreArchivo}`,
    );

    return { ruta: rutaCompleta, nombre: nombreArchivo };
  }

  /**
   * ✅ OBTENER ARCHIVO DE PAZ Y SALVO - BÚSQUEDA MEJORADA
   */
  async obtenerArchivoPazSalvo(
    supervisorId: string,
    nombreArchivo: string
  ): Promise<{ ruta: string; nombre: string }> {
    try {
      // 1. Primero buscar en la base de datos
      const supervisorDoc = await this.supervisorRepository.findOne({
        where: {
          supervisor: { id: supervisorId },
          pazSalvo: nombreArchivo
        },
        relations: ['documento']
      });

      // 2. Si se encuentra en BD, usar esa ruta
      if (supervisorDoc && supervisorDoc.documento) {
        const documento = supervisorDoc.documento;
        const rutaSupervisor = path.join(documento.rutaCarpetaRadicado, 'supervisor');
        const rutaCompleta = path.join(rutaSupervisor, nombreArchivo);

        if (fs.existsSync(rutaCompleta)) {
          return {
            ruta: rutaCompleta,
            nombre: nombreArchivo
          };
        }
      }

      // 3. Si no se encuentra en BD, buscar en rutas alternativas
      this.logger.log(`🔍 Buscando archivo de paz y salvo en rutas alternativas: ${nombreArchivo}`);
      
      const posiblesRutas = this.obtenerPosiblesRutasArchivo(nombreArchivo, 'paz-salvo');
      
      for (const rutaCompleta of posiblesRutas) {
        if (fs.existsSync(rutaCompleta)) {
          this.logger.log(`✅ Archivo encontrado en ruta alternativa: ${rutaCompleta}`);
          return {
            ruta: rutaCompleta,
            nombre: nombreArchivo
          };
        }
      }

      // 4. Si aún no se encuentra, buscar archivos similares
      const archivoSinExtension = this.obtenerNombreSinExtension(nombreArchivo);
      const archivosSimilares = this.buscarArchivosSimilares(archivoSinExtension, 'paz-salvo');
      
      if (archivosSimilares.length > 0) {
        this.logger.log(`🔄 Archivos similares encontrados: ${archivosSimilares.join(', ')}`);
        const primeraRuta = archivosSimilares[0];
        return {
          ruta: primeraRuta,
          nombre: path.basename(primeraRuta)
        };
      }

      // 5. Último recurso: buscar en toda la carpeta uploads
      const archivosEncontrados = this.buscarEnTodaCarpetaUploads(nombreArchivo);
      if (archivosEncontrados.length > 0) {
        const primeraRuta = archivosEncontrados[0];
        return {
          ruta: primeraRuta,
          nombre: path.basename(primeraRuta)
        };
      }

      throw new NotFoundException(`Archivo de paz y salvo "${nombreArchivo}" no encontrado. Rutas verificadas: ${posiblesRutas.join(', ')}`);

    } catch (error) {
      this.logger.error(`❌ Error obteniendo archivo de paz y salvo: ${error.message}`);
      throw new HttpException(
        error.message || 'Error obteniendo archivo de paz y salvo',
        HttpStatus.NOT_FOUND
      );
    }
  }

  /**
   * ✅ OBTENER ARCHIVO DEL SUPERVISOR (APROBACIÓN) - BÚSQUEDA MEJORADA
   */
  async obtenerArchivoSupervisor(
    supervisorId: string,
    nombreArchivo: string
  ): Promise<{ ruta: string; nombre: string }> {
    try {
      // 1. Primero buscar en la base de datos
      const supervisorDoc = await this.supervisorRepository.findOne({
        where: {
          supervisor: { id: supervisorId },
          nombreArchivoSupervisor: nombreArchivo
        },
        relations: ['documento']
      });

      // 2. Si se encuentra en BD, usar esa ruta
      if (supervisorDoc && supervisorDoc.documento) {
        const documento = supervisorDoc.documento;
        const rutaSupervisor = path.join(documento.rutaCarpetaRadicado, 'supervisor');
        const rutaCompleta = path.join(rutaSupervisor, nombreArchivo);

        if (fs.existsSync(rutaCompleta)) {
          return {
            ruta: rutaCompleta,
            nombre: nombreArchivo
          };
        }
      }

      // 3. Si no se encuentra en BD, buscar en rutas alternativas
      this.logger.log(`🔍 Buscando archivo supervisor en rutas alternativas: ${nombreArchivo}`);
      
      const posiblesRutas = this.obtenerPosiblesRutasArchivo(nombreArchivo, 'supervisor');
      
      for (const rutaCompleta of posiblesRutas) {
        if (fs.existsSync(rutaCompleta)) {
          this.logger.log(`✅ Archivo encontrado en ruta alternativa: ${rutaCompleta}`);
          return {
            ruta: rutaCompleta,
            nombre: nombreArchivo
          };
        }
      }

      // 4. Buscar archivos con nombres similares
      const archivoSinExtension = this.obtenerNombreSinExtension(nombreArchivo);
      const archivosSimilares = this.buscarArchivosSimilares(archivoSinExtension, 'supervisor');
      
      if (archivosSimilares.length > 0) {
        this.logger.log(`🔄 Archivos similares encontrados: ${archivosSimilares.join(', ')}`);
        const primeraRuta = archivosSimilares[0];
        return {
          ruta: primeraRuta,
          nombre: path.basename(primeraRuta)
        };
      }

      // 5. Último recurso: buscar en toda la carpeta uploads
      const archivosEncontrados = this.buscarEnTodaCarpetaUploads(nombreArchivo);
      if (archivosEncontrados.length > 0) {
        const primeraRuta = archivosEncontrados[0];
        return {
          ruta: primeraRuta,
          nombre: path.basename(primeraRuta)
        };
      }

      // 6. Para debugging: listar qué archivos existen en uploads
      const archivosDisponibles = this.listarArchivosEnUploads();
      this.logger.warn(`Archivos disponibles en uploads: ${JSON.stringify(archivosDisponibles.slice(0, 10))}`);

      throw new NotFoundException(`Archivo supervisor "${nombreArchivo}" no encontrado. Rutas verificadas: ${posiblesRutas.join(', ')}`);

    } catch (error) {
      this.logger.error(`❌ Error obteniendo archivo supervisor: ${error.message}`);
      throw new HttpException(
        error.message || 'Error obteniendo archivo supervisor',
        HttpStatus.NOT_FOUND
      );
    }
  }

  /**
   * ✅ OBTENER POSIBLES RUTAS PARA UN ARCHIVO
   */
  private obtenerPosiblesRutasArchivo(nombreArchivo: string, tipo: 'supervisor' | 'paz-salvo'): string[] {
    const rutas = [];
    const baseDir = process.cwd();

    // Rutas específicas para supervisor
    if (tipo === 'supervisor') {
      rutas.push(
        path.join(baseDir, 'uploads', 'supervisor', nombreArchivo),
        path.join(baseDir, 'uploads', 'aprobaciones', nombreArchivo),
        path.join(baseDir, 'uploads', 'revisiones', nombreArchivo),
        path.join(baseDir, 'uploads', 'documentos', 'supervisor', nombreArchivo),
        path.join(baseDir, 'uploads', 'temp', nombreArchivo),
      );
    }

    // Rutas específicas para paz y salvo
    if (tipo === 'paz-salvo') {
      rutas.push(
        path.join(baseDir, 'uploads', 'paz-salvo', nombreArchivo),
        path.join(baseDir, 'uploads', 'supervisor', 'paz-salvo', nombreArchivo),
        path.join(baseDir, 'uploads', 'documentos', 'paz-salvo', nombreArchivo),
      );
    }

    // Rutas comunes para ambos tipos
    rutas.push(
      path.join(baseDir, 'uploads', nombreArchivo),
      path.join(baseDir, 'public', 'uploads', nombreArchivo),
      path.join(baseDir, 'public', nombreArchivo),
      path.join(baseDir, nombreArchivo)
    );

    // Añadir rutas con subcarpetas de fecha
    const fecha = new Date();
    const ano = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    
    if (tipo === 'supervisor') {
      rutas.push(path.join(baseDir, 'uploads', 'supervisor', `${ano}-${mes}-${dia}`, nombreArchivo));
    }
    if (tipo === 'paz-salvo') {
      rutas.push(path.join(baseDir, 'uploads', 'paz-salvo', `${ano}-${mes}-${dia}`, nombreArchivo));
    }

    return rutas;
  }

  /**
   * ✅ BUSCAR ARCHIVOS SIMILARES
   */
  private buscarArchivosSimilares(archivoSinExtension: string, tipo: 'supervisor' | 'paz-salvo'): string[] {
    const archivosEncontrados: string[] = [];
    const baseDir = process.cwd();
    
    const carpetasBusqueda = [
      path.join(baseDir, 'uploads'),
      path.join(baseDir, 'uploads', tipo === 'supervisor' ? 'supervisor' : 'paz-salvo'),
      path.join(baseDir, 'uploads', 'documentos'),
    ];

    for (const carpeta of carpetasBusqueda) {
      if (!fs.existsSync(carpeta)) continue;
      
      const archivos = this.buscarArchivosRecursivos(carpeta);
      
      for (const archivo of archivos) {
        const nombreArchivo = path.basename(archivo);
        const nombreSinExtension = this.obtenerNombreSinExtension(nombreArchivo);
        
        // Verificar si el nombre contiene el patrón buscado
        if (nombreSinExtension.includes(archivoSinExtension) || 
            archivoSinExtension.includes(nombreSinExtension)) {
          archivosEncontrados.push(archivo);
        }
      }
    }

    return archivosEncontrados;
  }

  /**
   * ✅ BUSCAR ARCHIVOS EN TODA LA CARPETA UPLOADS
   */
  private buscarEnTodaCarpetaUploads(nombreArchivo: string): string[] {
    const archivosEncontrados: string[] = [];
    const baseDir = process.cwd();
    const uploadsDir = path.join(baseDir, 'uploads');
    
    if (!fs.existsSync(uploadsDir)) {
      return archivosEncontrados;
    }

    const archivos = this.buscarArchivosRecursivos(uploadsDir);
    
    for (const archivo of archivos) {
      if (path.basename(archivo) === nombreArchivo) {
        archivosEncontrados.push(archivo);
      }
    }

    return archivosEncontrados;
  }

  /**
   * ✅ BUSCAR ARCHIVOS RECURSIVAMENTE EN UNA CARPETA
   */
  private buscarArchivosRecursivos(carpeta: string): string[] {
    const archivos: string[] = [];
    
    try {
      const items = fs.readdirSync(carpeta, { withFileTypes: true });
      
      for (const item of items) {
        const rutaCompleta = path.join(carpeta, item.name);
        
        if (item.isDirectory()) {
          // Buscar recursivamente en subcarpetas
          archivos.push(...this.buscarArchivosRecursivos(rutaCompleta));
        } else if (item.isFile()) {
          archivos.push(rutaCompleta);
        }
      }
    } catch (error) {
      this.logger.error(`Error buscando en carpeta ${carpeta}: ${error.message}`);
    }

    return archivos;
  }

  /**
   * ✅ OBTENER NOMBRE SIN EXTENSIÓN
   */
  private obtenerNombreSinExtension(nombreArchivo: string): string {
    return nombreArchivo.replace(/\.[^/.]+$/, '');
  }

  /**
   * ✅ LISTAR ARCHIVOS EN UPLOADS (PARA DEBUGGING)
   */
  private listarArchivosEnUploads(): string[] {
    try {
      const uploadsDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        return ['No existe carpeta uploads'];
      }

      const archivos: string[] = [];
      
      const listarRecursivo = (dir: string, prefix = '') => {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const item of items) {
          const itemPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            listarRecursivo(itemPath, `${prefix}${item.name}/`);
          } else {
            archivos.push(`${prefix}${item.name}`);
          }
        }
      };

      listarRecursivo(uploadsDir);
      return archivos;
    } catch (error) {
      return [`Error listando archivos: ${error.message}`];
    }
  }

  /**
   * ✅ REGISTRAR ACCESO DEL SUPERVISOR
   */
  private async registrarAccesoSupervisor(
    rutaCarpeta: string,
    supervisorId: string,
    accion: string
  ): Promise<void> {
    try {
      const rutaArchivo = path.join(rutaCarpeta, 'registro_accesos_supervisor.txt');
      const fecha = new Date().toLocaleString('es-CO', {
        timeZone: 'America/Bogota',
        dateStyle: 'full',
        timeStyle: 'long'
      });

      const supervisor = await this.userRepository.findOne({
        where: { id: supervisorId }
      });

      const registro = `[${fecha}] ${supervisor?.fullName || supervisor?.username} (${supervisor?.username}) - SUPERVISOR - ${accion}\n`;

      let contenidoExistente = '';
      if (fs.existsSync(rutaArchivo)) {
        contenidoExistente = fs.readFileSync(rutaArchivo, 'utf8');
      }

      const lineas = contenidoExistente.split('\n');
      const lineasActualizadas = [...lineas.slice(-99), registro];

      const contenidoActualizado = lineasActualizadas.join('\n');
      fs.writeFileSync(rutaArchivo, contenidoActualizado, 'utf8');

      this.logger.log(`📝 Registro de acceso supervisor actualizado: ${rutaArchivo}`);
    } catch (error) {
      this.logger.error(`⚠️ Error actualizando registro de supervisor: ${error.message}`);
    }
  }
}