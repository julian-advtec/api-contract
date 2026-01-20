// src/auditor/services/auditor.service.ts (versión completa y corregida)
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
import { AuditorDocumento, AuditorEstado } from './entities/auditor-documento.entity';
import { Documento } from './../radicacion/entities/documento.entity';
import { User } from './../users/entities/user.entity';
import { UserRole } from './../users/enums/user-role.enum';
import { RevisarAuditorDocumentoDto } from './dto/revisar-auditor-documento.dto';
import { SubirDocumentosAuditorDto } from './dto/subir-documentos-auditor.dto';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class AuditorService {
  private readonly logger = new Logger(AuditorService.name);
  private basePath = '\\\\R2-D2\\api-contract';

  constructor(
    @InjectRepository(AuditorDocumento)
    private auditorRepository: Repository<AuditorDocumento>,

    @InjectRepository(Documento)
    private documentoRepository: Repository<Documento>,

    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {
    this.logger.log('📋 AuditorService inicializado');
  }

  /**
   * ✅ OBTENER DOCUMENTOS DISPONIBLES PARA AUDITORÍA (estado APROBADO_SUPERVISOR)
   * Con verificación de primer_radicado_ano
   */
  async obtenerDocumentosDisponibles(auditorId: string): Promise<any[]> {
    this.logger.log(`📋 Auditor ${auditorId} solicitando documentos disponibles`);

    try {
      // Buscar documentos en estado APROBADO_SUPERVISOR
      const documentos = await this.documentoRepository
        .createQueryBuilder('documento')
        .leftJoinAndSelect('documento.radicador', 'radicador')
        .leftJoinAndSelect('documento.usuarioAsignado', 'usuarioAsignado')
        .where("documento.estado = :estado", { estado: 'APROBADO_SUPERVISOR' })
        .orderBy('documento.fechaRadicacion', 'ASC')
        .getMany();

      this.logger.log(`✅ Encontrados ${documentos.length} documentos en estado APROBADO_SUPERVISOR`);

      // Obtener documentos que ya estoy revisando
      const auditorDocs = await this.auditorRepository.find({
        where: {
          auditor: { id: auditorId },
          estado: AuditorEstado.EN_REVISION
        },
        relations: ['documento']
      });

      const documentosEnRevisionIds = auditorDocs.map(ad => ad.documento.id);

      // Mapear documentos con información de asignación
      const documentosConEstado = documentos.map(documento => {
        const estaRevisandoYo = documentosEnRevisionIds.includes(documento.id);
        const puedeSubirDocumentos = documento.primerRadicadoDelAno;

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
          observacion: documento.observacion || '',
          primerRadicadoDelAno: documento.primerRadicadoDelAno,
          disponible: true,
          asignacion: {
            enRevision: estaRevisandoYo,
            puedoTomar: !estaRevisandoYo && documento.estado === 'APROBADO_SUPERVISOR',
            puedeSubirDocumentos: puedeSubirDocumentos,
            supervisorAsignado: documento.usuarioAsignadoNombre,
            tieneSupervisor: !!documento.usuarioAsignadoNombre
          }
        };
      });

      return documentosConEstado;

    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos disponibles: ${error.message}`);
      throw error;
    }
  }

  /**
   * ✅ TOMAR DOCUMENTO PARA REVISIÓN
   */
  async tomarDocumentoParaRevision(documentoId: string, auditorId: string): Promise<{ success: boolean; message: string; documento: any }> {
    this.logger.log(`🤝 Auditor ${auditorId} tomando documento ${documentoId} para revisión`);

    const queryRunner = this.auditorRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Buscar documento con bloqueo para evitar condiciones de carrera
      const documento = await queryRunner.manager.findOne(Documento, {
        where: { id: documentoId, estado: 'APROBADO_SUPERVISOR' },
        relations: ['radicador', 'usuarioAsignado'],
        lock: { mode: 'pessimistic_write' }
      });

      if (!documento) {
        throw new NotFoundException('Documento no encontrado o no está disponible para auditoría (debe estar en estado APROBADO_SUPERVISOR)');
      }

      const auditor = await queryRunner.manager.findOne(User, {
        where: { id: auditorId }
      });

      if (!auditor) {
        throw new NotFoundException('Auditor no encontrado');
      }

      // Verificar si ya está siendo revisado por otro auditor
      const auditorDocExistente = await queryRunner.manager.findOne(AuditorDocumento, {
        where: { 
          documento: { id: documentoId },
          estado: AuditorEstado.EN_REVISION
        },
        relations: ['auditor']
      });

      if (auditorDocExistente) {
        const otroAuditor = auditorDocExistente.auditor;
        throw new ConflictException(
          `Este documento ya está siendo revisado por el auditor ${otroAuditor.fullName || otroAuditor.username}`
        );
      }

      // Actualizar documento principal
      documento.estado = 'EN_REVISION_AUDITOR';
      documento.fechaActualizacion = new Date();
      documento.ultimoAcceso = new Date();
      documento.ultimoUsuario = `Auditor: ${auditor.fullName || auditor.username}`;
      documento.usuarioAsignado = auditor;
      documento.usuarioAsignadoNombre = auditor.fullName || auditor.username;

      // Agregar al historial
      const historial = documento.historialEstados || [];
      historial.push({
        fecha: new Date(),
        estado: 'EN_REVISION_AUDITOR',
        usuarioId: auditor.id,
        usuarioNombre: auditor.fullName || auditor.username,
        rolUsuario: auditor.role,
        observacion: `Documento tomado para revisión por auditor ${auditor.username}`
      });
      documento.historialEstados = historial;

      await queryRunner.manager.save(Documento, documento);
      this.logger.log(`📝 Documento principal actualizado a estado: ${documento.estado}`);

      // Crear o actualizar registro en auditor_documentos
      let auditorDoc = await queryRunner.manager.findOne(AuditorDocumento, {
        where: {
          documento: { id: documentoId },
          auditor: { id: auditorId }
        },
        relations: ['documento', 'auditor']
      });

      if (auditorDoc) {
        auditorDoc.estado = AuditorEstado.EN_REVISION;
        auditorDoc.fechaActualizacion = new Date();
        auditorDoc.fechaInicioRevision = new Date();
        auditorDoc.observaciones = 'Documento tomado para revisión de auditoría';
      } else {
        auditorDoc = queryRunner.manager.create(AuditorDocumento, {
          documento: documento,
          auditor: auditor,
          estado: AuditorEstado.EN_REVISION,
          fechaCreacion: new Date(),
          fechaActualizacion: new Date(),
          fechaInicioRevision: new Date(),
          observaciones: 'Documento tomado para revisión de auditoría'
        });
      }

      await queryRunner.manager.save(AuditorDocumento, auditorDoc);

      // Registrar acceso
      if (documento && documento.rutaCarpetaRadicado) {
        await this.registrarAccesoAuditor(
          documento.rutaCarpetaRadicado,
          auditorId,
          `TOMÓ documento para revisión de auditoría. Estado: APROBADO_SUPERVISOR → EN_REVISION_AUDITOR`
        );
      }

      await queryRunner.commitTransaction();
      this.logger.log(`✅ Documento ${documento.numeroRadicado} tomado para revisión por ${auditor.username}. Estado actualizado a EN_REVISION_AUDITOR`);

      return {
        success: true,
        message: `Documento ${documento.numeroRadicado} tomado para revisión de auditoría`,
        documento: this.mapearDocumentoParaRespuesta(documento, auditorDoc)
      };

    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`❌ Error tomando documento: ${error.message}`, error.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * ✅ OBTENER DOCUMENTOS QUE ESTOY REVISANDO
   */
  async obtenerDocumentosEnRevision(auditorId: string): Promise<any[]> {
    this.logger.log(`📋 Auditor ${auditorId} solicitando documentos en revisión`);

    try {
      const auditorDocs = await this.auditorRepository.find({
        where: {
          auditor: { id: auditorId },
          estado: AuditorEstado.EN_REVISION
        },
        relations: ['documento', 'documento.radicador', 'auditor']
      });

      return auditorDocs.map(auditorDoc => {
        return this.mapearDocumentoParaRespuesta(auditorDoc.documento, auditorDoc);
      });

    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos en revisión: ${error.message}`);
      throw error;
    }
  }

  /**
   * ✅ OBTENER DETALLE DE DOCUMENTO PARA AUDITORÍA
   */
  async obtenerDetalleDocumento(documentoId: string, auditorId: string): Promise<any> {
    this.logger.log(`🔍 Auditor ${auditorId} solicitando detalle de documento ${documentoId}`);

    try {
      const auditor = await this.userRepository.findOne({
        where: { id: auditorId }
      });

      if (!auditor) {
        throw new NotFoundException('Auditor no encontrado');
      }

      const auditorDoc = await this.auditorRepository.findOne({
        where: {
          documento: { id: documentoId },
          auditor: { id: auditorId }
        },
        relations: ['documento', 'documento.radicador', 'documento.usuarioAsignado', 'auditor'],
      });

      const documento = await this.documentoRepository.findOne({
        where: { id: documentoId },
        relations: ['radicador', 'usuarioAsignado'],
      });

      if (!documento) {
        throw new NotFoundException('Documento no encontrado');
      }

      // Verificar permisos de acceso
      if (!auditorDoc && documento.estado !== 'APROBADO_SUPERVISOR') {
        throw new ForbiddenException('No tienes acceso a este documento');
      }

      // Si está en revisión, asegurarse que es del auditor actual
      if (documento.estado === 'EN_REVISION_AUDITOR' && (!auditorDoc || auditorDoc.auditor.id !== auditorId)) {
        throw new ForbiddenException('Este documento está siendo revisado por otro auditor');
      }

      return this.construirRespuestaDetalle(documento, auditorDoc, auditor);

    } catch (error) {
      this.logger.error(`❌ Error obteniendo detalle: ${error.message}`);
      throw error;
    }
  }

  /**
   * ✅ SUBIR DOCUMENTOS DE AUDITORÍA
   * Solo si es primer_radicado_ano = true
   */
  async subirDocumentosAuditor(
    documentoId: string,
    auditorId: string,
    subirDto: SubirDocumentosAuditorDto,
    files: { [fieldname: string]: Express.Multer.File[] }
  ): Promise<{ success: boolean; message: string; auditor: AuditorDocumento; documento: Documento }> {
    this.logger.log(`📤 Auditor ${auditorId} subiendo documentos para documento ${documentoId}`);

    const auditorDoc = await this.auditorRepository.findOne({
      where: {
        documento: { id: documentoId },
        auditor: { id: auditorId },
        estado: AuditorEstado.EN_REVISION
      },
      relations: ['documento', 'auditor']
    });

    if (!auditorDoc) {
      throw new ForbiddenException('No tienes este documento en revisión o no has tomado este documento');
    }

    const documento = auditorDoc.documento;

    // Verificar si es primer radicado del año y puede subir documentos
    if (!documento.primerRadicadoDelAno) {
      throw new BadRequestException('Este documento no es el primer radicado del año. Solo se pueden subir documentos en el primer radicado del año.');
    }

    // Verificar que todos los archivos requeridos están presentes
    const archivosRequeridos = ['rp', 'cdp', 'poliza', 'certificadoBancario', 'minuta', 'actaInicio'];
    const archivosFaltantes = archivosRequeridos.filter(tipo => !files[tipo] || files[tipo].length === 0);

    if (archivosFaltantes.length > 0) {
      throw new BadRequestException(`Faltan archivos requeridos: ${archivosFaltantes.join(', ')}`);
    }

    // Crear carpeta de auditor si no existe
    const rutaAuditor = path.join(documento.rutaCarpetaRadicado, 'auditor', auditorId);
    if (!fs.existsSync(rutaAuditor)) {
      fs.mkdirSync(rutaAuditor, { recursive: true });
    }

    // Guardar cada archivo
    for (const tipo of archivosRequeridos) {
      const archivo = files[tipo][0];
      const nombreArchivo = await this.guardarArchivoAuditor(documento, archivo, tipo, auditorId);
      
      // Asignar el path según el tipo de documento
      switch (tipo) {
        case 'rp':
          auditorDoc.rpPath = nombreArchivo;
          break;
        case 'cdp':
          auditorDoc.cdpPath = nombreArchivo;
          break;
        case 'poliza':
          auditorDoc.polizaPath = nombreArchivo;
          break;
        case 'certificadoBancario':
          auditorDoc.certificadoBancarioPath = nombreArchivo;
          break;
        case 'minuta':
          auditorDoc.minutaPath = nombreArchivo;
          break;
        case 'actaInicio':
          auditorDoc.actaInicioPath = nombreArchivo;
          break;
      }
    }

    // Actualizar observaciones
    if (subirDto.observaciones) {
      auditorDoc.observaciones = subirDto.observaciones;
    }

    auditorDoc.fechaActualizacion = new Date();
    documento.ultimoAcceso = new Date();
    documento.ultimoUsuario = `Auditor: ${auditorDoc.auditor.fullName || auditorDoc.auditor.username}`;
    documento.fechaActualizacion = new Date();

    // Agregar al historial
    const historial = documento.historialEstados || [];
    historial.push({
      fecha: new Date(),
      estado: 'EN_REVISION_AUDITOR',
      usuarioId: auditorId,
      usuarioNombre: auditorDoc.auditor.fullName || auditorDoc.auditor.username,
      rolUsuario: auditorDoc.auditor.role,
      observacion: 'Documentos de auditoría subidos (primer radicado del año)'
    });
    documento.historialEstados = historial;

    await this.registrarAccesoAuditor(
      documento.rutaCarpetaRadicado,
      auditorId,
      `SUBIO documentos de auditoría (primer radicado): RP, CDP, Póliza, Certificado Bancario, Minuta, Acta de Inicio`
    );

    await this.documentoRepository.save(documento);
    const savedAuditorDoc = await this.auditorRepository.save(auditorDoc);

    this.logger.log(`✅ Documentos de auditoría subidos para documento ${documento.numeroRadicado} (primer radicado)`);

    return {
      success: true,
      message: 'Documentos de auditoría subidos correctamente',
      auditor: savedAuditorDoc,
      documento
    };
  }

  /**
   * ✅ REVISAR Y APROBAR/RECHAZAR DOCUMENTO
   */
  async revisarDocumento(
    documentoId: string,
    auditorId: string,
    revisarDto: RevisarAuditorDocumentoDto
  ): Promise<{ success: boolean; message: string; auditor: AuditorDocumento; documento: Documento }> {
    this.logger.log(`🔍 Auditor ${auditorId} revisando documento ${documentoId} - Estado: ${revisarDto.estado}`);

    const auditorDoc = await this.auditorRepository.findOne({
      where: {
        documento: { id: documentoId },
        auditor: { id: auditorId },
        estado: AuditorEstado.EN_REVISION
      },
      relations: ['documento', 'auditor']
    });

    if (!auditorDoc) {
      throw new ForbiddenException('No tienes este documento en revisión');
    }

    const documento = auditorDoc.documento;

    // Verificar si es primer radicado y si se requieren documentos
    if (documento.primerRadicadoDelAno && !auditorDoc.tieneTodosDocumentos()) {
      throw new BadRequestException('Debes subir todos los documentos requeridos (RP, CDP, Póliza, Certificado Bancario, Minuta, Acta de Inicio) antes de revisar');
    }

    if ((revisarDto.estado === AuditorEstado.OBSERVADO ||
      revisarDto.estado === AuditorEstado.RECHAZADO) &&
      (!revisarDto.observaciones || revisarDto.observaciones.trim() === '')) {
      throw new BadRequestException('Se requiere una observación para este estado');
    }

    const estadoAnterior = auditorDoc.estado;
    auditorDoc.estado = revisarDto.estado;
    auditorDoc.observaciones = revisarDto.observaciones?.trim() || '';
    auditorDoc.fechaActualizacion = new Date();
    auditorDoc.fechaFinRevision = new Date();

    if (revisarDto.estado === AuditorEstado.APROBADO || revisarDto.estado === AuditorEstado.COMPLETADO) {
      auditorDoc.fechaAprobacion = new Date();
    }

    documento.ultimoAcceso = new Date();
    documento.ultimoUsuario = `Auditor: ${auditorDoc.auditor.fullName || auditorDoc.auditor.username}`;
    documento.fechaActualizacion = new Date();

    // Actualizar estado del documento según la decisión del auditor
    let mensajeEstado = '';
    switch (revisarDto.estado) {
      case AuditorEstado.APROBADO:
        documento.estado = 'APROBADO_AUDITOR';
        documento.comentarios = revisarDto.observaciones || 'Aprobado por auditor de cuentas';
        mensajeEstado = 'Documento aprobado por auditor';
        break;

      case AuditorEstado.OBSERVADO:
        documento.estado = 'OBSERVADO_AUDITOR';
        documento.comentarios = revisarDto.observaciones || 'Observado por auditor de cuentas';
        documento.correcciones = revisarDto.correcciones?.trim() || '';
        mensajeEstado = 'Documento observado por auditor';
        break;

      case AuditorEstado.RECHAZADO:
        documento.estado = 'RECHAZADO_AUDITOR';
        documento.comentarios = revisarDto.observaciones || 'Rechazado por auditor de cuentas';
        mensajeEstado = 'Documento rechazado por auditor';
        break;

      case AuditorEstado.COMPLETADO:
        documento.estado = 'COMPLETADO_AUDITOR';
        documento.comentarios = revisarDto.observaciones || 'Completado por auditor de cuentas';
        mensajeEstado = 'Documento completado por auditor';
        break;

      default:
        throw new BadRequestException('Estado no válido para revisión');
    }

    this.agregarAlHistorial(documento, auditorDoc.auditor, estadoAnterior, revisarDto.estado, revisarDto.observaciones);

    await this.registrarAccesoAuditor(
      documento.rutaCarpetaRadicado,
      auditorId,
      `REVISIÓN: ${estadoAnterior} → ${revisarDto.estado} - ${revisarDto.observaciones?.substring(0, 50) || 'Sin observación'}`
    );

    await this.documentoRepository.save(documento);
    const savedAuditorDoc = await this.auditorRepository.save(auditorDoc);

    this.logger.log(`✅ Documento ${documento.numeroRadicado} revisado por auditor. Estado: ${revisarDto.estado}`);

    return {
      success: true,
      message: mensajeEstado,
      auditor: savedAuditorDoc,
      documento
    };
  }

  /**
   * ✅ DESCARGAR ARCHIVO DEL RADICADOR
   */
  async descargarArchivoRadicado(
    documentoId: string,
    numeroArchivo: number,
    auditorId: string
  ): Promise<{ ruta: string; nombre: string }> {
    this.logger.log(`📥 Auditor ${auditorId} descargando archivo ${numeroArchivo} del documento ${documentoId}`);

    const auditor = await this.userRepository.findOne({
      where: { id: auditorId }
    });

    if (!auditor) {
      throw new NotFoundException('Auditor no encontrado');
    }

    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId }
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    // Verificar acceso
    const auditorDoc = await this.auditorRepository.findOne({
      where: {
        documento: { id: documentoId },
        auditor: { id: auditorId }
      }
    });

    // Puede acceder si:
    // 1. Tiene un registro de auditor (está revisando o ha revisado)
    // 2. O el documento está en estado APROBADO_SUPERVISOR (disponible para todos)
    if (!auditorDoc && documento.estado !== 'APROBADO_SUPERVISOR') {
      throw new ForbiddenException('No tienes permisos para acceder a este documento');
    }

    let nombreArchivo: string;
    let descripcion: string;

    switch (numeroArchivo) {
      case 1:
        nombreArchivo = documento.cuentaCobro;
        descripcion = documento.descripcionCuentaCobro;
        break;
      case 2:
        nombreArchivo = documento.seguridadSocial;
        descripcion = documento.descripcionSeguridadSocial;
        break;
      case 3:
        nombreArchivo = documento.informeActividades;
        descripcion = documento.descripcionInformeActividades;
        break;
      default:
        throw new BadRequestException('Número de archivo inválido (1-3)');
    }

    if (!nombreArchivo) {
      throw new NotFoundException(`Archivo no encontrado para el documento`);
    }

    const rutaCompleta = path.join(documento.rutaCarpetaRadicado, nombreArchivo);

    if (!fs.existsSync(rutaCompleta)) {
      throw new NotFoundException(`Archivo no encontrado en el servidor: ${nombreArchivo}`);
    }

    this.registrarAccesoAuditor(
      documento.rutaCarpetaRadicado,
      auditorId,
      `DESCARGÓ archivo radicado: ${descripcion || nombreArchivo}`
    );

    return {
      ruta: rutaCompleta,
      nombre: nombreArchivo
    };
  }

  /**
   * ✅ DESCARGAR ARCHIVO SUBIDO POR EL AUDITOR
   */
  async descargarArchivoAuditor(
    documentoId: string,
    tipoArchivo: string,
    auditorId: string
  ): Promise<{ ruta: string; nombre: string }> {
    this.logger.log(`📥 Auditor ${auditorId} descargando archivo ${tipoArchivo} del documento ${documentoId}`);

    const auditorDoc = await this.auditorRepository.findOne({
      where: {
        documento: { id: documentoId },
        auditor: { id: auditorId }
      },
      relations: ['documento']
    });

    if (!auditorDoc) {
      throw new NotFoundException('Documento de auditor no encontrado');
    }

    const documento = auditorDoc.documento;
    
    let nombreArchivo: string;
    switch (tipoArchivo) {
      case 'rp':
        nombreArchivo = auditorDoc.rpPath;
        break;
      case 'cdp':
        nombreArchivo = auditorDoc.cdpPath;
        break;
      case 'poliza':
        nombreArchivo = auditorDoc.polizaPath;
        break;
      case 'certificadoBancario':
        nombreArchivo = auditorDoc.certificadoBancarioPath;
        break;
      case 'minuta':
        nombreArchivo = auditorDoc.minutaPath;
        break;
      case 'actaInicio':
        nombreArchivo = auditorDoc.actaInicioPath;
        break;
      default:
        throw new NotFoundException(`Tipo de archivo no válido: ${tipoArchivo}`);
    }

    if (!nombreArchivo) {
      throw new NotFoundException(`Archivo de tipo ${tipoArchivo} no fue subido para este documento`);
    }

    const rutaCompleta = path.join(documento.rutaCarpetaRadicado, 'auditor', auditorId, nombreArchivo);

    if (!fs.existsSync(rutaCompleta)) {
      throw new NotFoundException(`Archivo no encontrado en el servidor: ${nombreArchivo}`);
    }

    return {
      ruta: rutaCompleta,
      nombre: nombreArchivo
    };
  }

  /**
   * ✅ LIBERAR DOCUMENTO
   */
  async liberarDocumento(documentoId: string, auditorId: string): Promise<{ success: boolean; message: string }> {
    this.logger.log(`🔄 Auditor ${auditorId} liberando documento ${documentoId}`);

    const queryRunner = this.auditorRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const auditorDoc = await queryRunner.manager.findOne(AuditorDocumento, {
        where: {
          documento: { id: documentoId },
          auditor: { id: auditorId },
          estado: AuditorEstado.EN_REVISION
        },
        relations: ['documento', 'auditor']
      });

      if (!auditorDoc) {
        throw new NotFoundException('No tienes este documento en revisión');
      }

      const documento = auditorDoc.documento;

      // Revertir estado del documento principal
      documento.estado = 'APROBADO_SUPERVISOR';
      documento.fechaActualizacion = new Date();
      documento.ultimoAcceso = new Date();
      documento.ultimoUsuario = `Auditor: ${auditorDoc.auditor.fullName || auditorDoc.auditor.username} (liberado)`;
      documento.usuarioAsignado = null;
      documento.usuarioAsignadoNombre = '';

      // Agregar al historial
      const historial = documento.historialEstados || [];
      historial.push({
        fecha: new Date(),
        estado: 'APROBADO_SUPERVISOR',
        usuarioId: auditorId,
        usuarioNombre: auditorDoc.auditor.fullName || auditorDoc.auditor.username,
        rolUsuario: 'AUDITOR_CUENTAS',
        observacion: 'Documento liberado por auditor - Volvió a estado APROBADO_SUPERVISOR'
      });
      documento.historialEstados = historial;

      await queryRunner.manager.save(Documento, documento);

      // Actualizar registro de auditor
      auditorDoc.estado = AuditorEstado.DISPONIBLE;
      auditorDoc.fechaActualizacion = new Date();
      auditorDoc.fechaFinRevision = new Date();
      auditorDoc.observaciones = 'Documento liberado - Disponible para otros auditores';

      await queryRunner.manager.save(AuditorDocumento, auditorDoc);

      if (documento.rutaCarpetaRadicado) {
        await this.registrarAccesoAuditor(
          documento.rutaCarpetaRadicado,
          auditorId,
          `LIBERÓ documento. Estado: EN_REVISION_AUDITOR → APROBADO_SUPERVISOR`
        );
      }

      await queryRunner.commitTransaction();
      this.logger.log(`✅ Documento ${documento.numeroRadicado} liberado por ${auditorId}. Estado revertido a APROBADO_SUPERVISOR`);

      return {
        success: true,
        message: 'Documento liberado correctamente y disponible para otros auditores'
      };

    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`❌ Error liberando documento: ${error.message}`);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * ✅ OBTENER ESTADÍSTICAS DEL AUDITOR
   */
  async obtenerEstadisticasAuditor(auditorId: string): Promise<any> {
    try {
      this.logger.log(`📊 Obteniendo estadísticas para auditor: ${auditorId}`);

      const [
        totalDocumentosDisponibles,
        enRevision,
        aprobados,
        observados,
        rechazados,
        completados,
        primerRadicados
      ] = await Promise.all([
        // Total documentos disponibles
        this.documentoRepository.count({
          where: { estado: 'APROBADO_SUPERVISOR' }
        }),

        // Documentos en revisión
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.EN_REVISION
          }
        }),

        // Aprobados
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.APROBADO
          }
        }),

        // Observados
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.OBSERVADO
          }
        }),

        // Rechazados
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.RECHAZADO
          }
        }),

        // Completados
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.COMPLETADO
          }
        }),

        // Primer radicados del año
        this.auditorRepository.createQueryBuilder('ad')
          .leftJoin('ad.documento', 'documento')
          .where('ad.auditor_id = :auditorId', { auditorId })
          .andWhere('documento.primer_radicado_ano = true')
          .getCount()
      ]);

      // Documentos procesados recientemente (últimos 7 días)
      const fechaLimite = new Date();
      fechaLimite.setDate(fechaLimite.getDate() - 7);

      const recientes = await this.auditorRepository
        .createQueryBuilder('auditor')
        .leftJoin('auditor.auditor', 'usuario')
        .where('usuario.id = :auditorId', { auditorId })
        .andWhere('auditor.fechaCreacion >= :fechaLimite', { fechaLimite })
        .getCount();

      // Tiempo promedio de revisión
      const revisionesCompletas = await this.auditorRepository
        .createQueryBuilder('ad')
        .where('ad.auditor_id = :auditorId', { auditorId })
        .andWhere('ad.estado IN (:...estados)', { 
          estados: [AuditorEstado.APROBADO, AuditorEstado.COMPLETADO, AuditorEstado.RECHAZADO, AuditorEstado.OBSERVADO] 
        })
        .andWhere('ad.fechaInicioRevision IS NOT NULL')
        .andWhere('ad.fechaFinRevision IS NOT NULL')
        .select(['ad.fechaInicioRevision', 'ad.fechaFinRevision'])
        .getMany();

      let tiempoPromedioHoras = 0;
      if (revisionesCompletas.length > 0) {
        const totalHoras = revisionesCompletas.reduce((total, doc) => {
          const inicio = new Date(doc.fechaInicioRevision);
          const fin = new Date(doc.fechaFinRevision);
          const horas = (fin.getTime() - inicio.getTime()) / (1000 * 60 * 60);
          return total + horas;
        }, 0);
        tiempoPromedioHoras = Math.round(totalHoras / revisionesCompletas.length);
      }

      // Eficiencia
      const totalProcesados = aprobados + observados + rechazados + completados;
      const eficiencia = totalProcesados > 0 ?
        Math.round(((aprobados + completados) / totalProcesados) * 100) : 0;

      const estadisticas = {
        totalDocumentosDisponibles: totalDocumentosDisponibles,
        misDocumentos: {
          enRevision: enRevision,
          aprobados: aprobados,
          observados: observados,
          rechazados: rechazados,
          completados: completados,
          primerRadicados: primerRadicados,
          total: enRevision + aprobados + observados + rechazados + completados
        },
        recientes: recientes,
        tiempoPromedioHoras: tiempoPromedioHoras,
        eficiencia: eficiencia,
        fechaConsulta: new Date().toISOString()
      };

      this.logger.log(`✅ Estadísticas calculadas para auditor ${auditorId}`);

      return estadisticas;

    } catch (error) {
      this.logger.error(`❌ Error calculando estadísticas: ${error.message}`);
      throw new InternalServerErrorException(`Error al obtener estadísticas: ${error.message}`);
    }
  }

  /**
   * ✅ OBTENER HISTORIAL DE AUDITORÍAS
   */
  async obtenerHistorialAuditor(auditorId: string): Promise<any[]> {
    try {
      const auditorDocs = await this.auditorRepository.find({
        where: { auditor: { id: auditorId } },
        relations: ['documento', 'documento.radicador'],
        order: { fechaActualizacion: 'DESC' },
        take: 50
      });

      return auditorDocs.map(ad => ({
        id: ad.id,
        documento: {
          id: ad.documento.id,
          numeroRadicado: ad.documento.numeroRadicado,
          nombreContratista: ad.documento.nombreContratista,
          documentoContratista: ad.documento.documentoContratista,
          numeroContrato: ad.documento.numeroContrato,
          fechaRadicacion: ad.documento.fechaRadicacion,
          estado: ad.documento.estado,
          primerRadicadoDelAno: ad.documento.primerRadicadoDelAno
        },
        auditor: ad.auditor?.fullName || ad.auditor?.username,
        estado: ad.estado,
        observaciones: ad.observaciones,
        fechaCreacion: ad.fechaCreacion,
        fechaActualizacion: ad.fechaActualizacion,
        fechaAprobacion: ad.fechaAprobacion,
        tieneDocumentos: ad.tieneTodosDocumentos()
      }));

    } catch (error) {
      this.logger.error(`❌ Error obteniendo historial: ${error.message}`);
      throw error;
    }
  }

  /**
   * ✅ HELPER: Guardar archivo de auditor
   */
  private async guardarArchivoAuditor(
    documento: Documento,
    archivo: Express.Multer.File,
    tipo: string,
    auditorId: string
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

      const rutaAuditor = path.join(documento.rutaCarpetaRadicado, 'auditor', auditorId);
      if (!fs.existsSync(rutaAuditor)) {
        fs.mkdirSync(rutaAuditor, { recursive: true });
      }

      const extension = path.extname(archivo.originalname);
      const nombreBase = `${tipo}_${documento.numeroRadicado}`;
      const timestamp = Date.now();
      const hash = crypto.randomBytes(4).toString('hex');
      const nombreArchivo = `${nombreBase}_${timestamp}_${hash}${extension}`;
      const rutaCompleta = path.join(rutaAuditor, nombreArchivo);

      fs.writeFileSync(rutaCompleta, archivo.buffer);

      // Guardar metadatos
      const metadatos = {
        nombreOriginal: archivo.originalname,
        nombreGuardado: nombreArchivo,
        mimeType: archivo.mimetype,
        tamanio: archivo.size,
        fechaSubida: new Date().toISOString(),
        tipoDocumento: tipo,
        descripcion: this.obtenerDescripcionTipo(tipo),
        auditorId: auditorId,
        documentoId: documento.id,
        numeroRadicado: documento.numeroRadicado
      };

      fs.writeFileSync(
        path.join(rutaAuditor, `${nombreBase}_${timestamp}_${hash}_meta.json`),
        JSON.stringify(metadatos, null, 2)
      );

      this.logger.log(`💾 Archivo de auditor (${tipo}) guardado: ${rutaCompleta} (${archivo.size} bytes)`);

      return nombreArchivo;
    } catch (error) {
      this.logger.error(`❌ Error guardando archivo de auditor (${tipo}): ${error.message}`);
      throw new BadRequestException(`Error al guardar archivo ${tipo}: ${error.message}`);
    }
  }

  /**
   * ✅ HELPER: Obtener descripción del tipo de documento
   */
  private obtenerDescripcionTipo(tipo: string): string {
    const descripciones: Record<string, string> = {
      'rp': 'Resolución de Pago',
      'cdp': 'Certificado de Disponibilidad Presupuestal',
      'poliza': 'Póliza de Cumplimiento',
      'certificadoBancario': 'Certificado Bancario',
      'minuta': 'Minuta de Contrato',
      'actaInicio': 'Acta de Inicio'
    };
    
    return descripciones[tipo] || tipo;
  }

  /**
   * ✅ HELPER: Mapear documento para respuesta
   */
  private mapearDocumentoParaRespuesta(documento: Documento, auditorDoc?: AuditorDocumento): any {
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
      observacion: documento.observacion,
      primerRadicadoDelAno: documento.primerRadicadoDelAno,
      usuarioAsignadoNombre: documento.usuarioAsignadoNombre,
      asignacion: auditorDoc ? {
        id: auditorDoc.id,
        estado: auditorDoc.estado,
        fechaInicioRevision: auditorDoc.fechaInicioRevision,
        auditor: {
          id: auditorDoc.auditor.id,
          nombre: auditorDoc.auditor.fullName,
          username: auditorDoc.auditor.username
        },
        tieneDocumentos: auditorDoc.tieneTodosDocumentos(),
        puedeSubirDocumentos: documento.primerRadicadoDelAno
      } : null
    };
  }

  /**
   * ✅ HELPER: Construir respuesta de detalle
   */
  private construirRespuestaDetalle(documento: Documento, auditorDoc: any, auditor: User): any {
    // Archivos del radicador
    const archivosRadicados = [
      {
        numero: 1,
        nombre: documento.cuentaCobro,
        descripcion: documento.descripcionCuentaCobro,
        tipo: 'cuenta_cobro',
        existe: documento.cuentaCobro ? fs.existsSync(path.join(documento.rutaCarpetaRadicado, documento.cuentaCobro)) : false,
        ruta: documento.cuentaCobro ? path.join(documento.rutaCarpetaRadicado, documento.cuentaCobro) : null
      },
      {
        numero: 2,
        nombre: documento.seguridadSocial,
        descripcion: documento.descripcionSeguridadSocial,
        tipo: 'seguridad_social',
        existe: documento.seguridadSocial ? fs.existsSync(path.join(documento.rutaCarpetaRadicado, documento.seguridadSocial)) : false,
        ruta: documento.seguridadSocial ? path.join(documento.rutaCarpetaRadicado, documento.seguridadSocial) : null
      },
      {
        numero: 3,
        nombre: documento.informeActividades,
        descripcion: documento.descripcionInformeActividades,
        tipo: 'informe_actividades',
        existe: documento.informeActividades ? fs.existsSync(path.join(documento.rutaCarpetaRadicado, documento.informeActividades)) : false,
        ruta: documento.informeActividades ? path.join(documento.rutaCarpetaRadicado, documento.informeActividades) : null
      }
    ];

    // Archivos del auditor (si existen)
    const archivosAuditor = [
      { 
        tipo: 'rp', 
        descripcion: 'Resolución de Pago', 
        subido: !!auditorDoc?.rpPath,
        nombreArchivo: auditorDoc?.rpPath 
      },
      { 
        tipo: 'cdp', 
        descripcion: 'Certificado de Disponibilidad Presupuestal', 
        subido: !!auditorDoc?.cdpPath,
        nombreArchivo: auditorDoc?.cdpPath 
      },
      { 
        tipo: 'poliza', 
        descripcion: 'Póliza', 
        subido: !!auditorDoc?.polizaPath,
        nombreArchivo: auditorDoc?.polizaPath 
      },
      { 
        tipo: 'certificadoBancario', 
        descripcion: 'Certificado Bancario', 
        subido: !!auditorDoc?.certificadoBancarioPath,
        nombreArchivo: auditorDoc?.certificadoBancarioPath 
      },
      { 
        tipo: 'minuta', 
        descripcion: 'Minuta', 
        subido: !!auditorDoc?.minutaPath,
        nombreArchivo: auditorDoc?.minutaPath 
      },
      { 
        tipo: 'actaInicio', 
        descripcion: 'Acta de Inicio', 
        subido: !!auditorDoc?.actaInicioPath,
        nombreArchivo: auditorDoc?.actaInicioPath 
      }
    ];

    // Actualizar último acceso
    documento.ultimoAcceso = new Date();
    documento.ultimoUsuario = `Auditor: ${auditor.username}`;
    this.documentoRepository.save(documento);

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
        estadoActual: auditorDoc?.estado || 'DISPONIBLE',
        estadoDocumento: documento.estado,
        primerRadicadoDelAno: documento.primerRadicadoDelAno,
        usuarioAsignado: documento.usuarioAsignadoNombre,
        historialEstados: documento.historialEstados || [],
        rutaCarpeta: documento.rutaCarpetaRadicado,
        tokenPublico: documento.tokenPublico,
        cuentaCobro: documento.cuentaCobro,
        seguridadSocial: documento.seguridadSocial,
        informeActividades: documento.informeActividades,
        descripcionCuentaCobro: documento.descripcionCuentaCobro,
        descripcionSeguridadSocial: documento.descripcionSeguridadSocial,
        descripcionInformeActividades: documento.descripcionInformeActividades
      },
      archivosRadicados: archivosRadicados,
      archivosAuditor: archivosAuditor,
      auditor: auditorDoc ? {
        id: auditorDoc.id,
        estado: auditorDoc.estado,
        observaciones: auditorDoc.observaciones,
        fechaCreacion: auditorDoc.fechaCreacion,
        fechaInicioRevision: auditorDoc.fechaInicioRevision,
        fechaFinRevision: auditorDoc.fechaFinRevision,
        fechaAprobacion: auditorDoc.fechaAprobacion,
        tieneTodosDocumentos: auditorDoc.tieneTodosDocumentos(),
        documentosSubidos: archivosAuditor.filter(a => a.subido).map(a => a.tipo),
        puedeSubirDocumentos: documento.primerRadicadoDelAno
      } : null
    };
  }

  /**
   * ✅ HELPER: Registrar acceso del auditor
   */
  private async registrarAccesoAuditor(
    rutaCarpeta: string,
    auditorId: string,
    accion: string
  ): Promise<void> {
    try {
      const rutaArchivo = path.join(rutaCarpeta, 'registro_accesos_auditor.txt');
      const fecha = new Date().toLocaleString('es-CO', {
        timeZone: 'America/Bogota',
        dateStyle: 'full',
        timeStyle: 'long'
      });

      const auditor = await this.userRepository.findOne({
        where: { id: auditorId }
      });

      const registro = `[${fecha}] ${auditor?.fullName || auditor?.username} (${auditor?.username}) - AUDITOR - ${accion}\n`;

      let contenidoExistente = '';
      if (fs.existsSync(rutaArchivo)) {
        contenidoExistente = fs.readFileSync(rutaArchivo, 'utf8');
      }

      const lineas = contenidoExistente.split('\n');
      const lineasActualizadas = [...lineas.slice(-99), registro];

      const contenidoActualizado = lineasActualizadas.join('\n');
      fs.writeFileSync(rutaArchivo, contenidoActualizado, 'utf8');

      this.logger.log(`📝 Registro de acceso auditor actualizado: ${rutaArchivo}`);
    } catch (error) {
      this.logger.error(`⚠️ Error actualizando registro de auditor: ${error.message}`);
    }
  }

  /**
   * ✅ HELPER: Agregar al historial
   */
  private agregarAlHistorial(
    documento: Documento,
    auditor: User,
    estadoAnterior: string,
    estadoNuevo: string,
    observaciones?: string
  ): void {
    const historial = documento.historialEstados || [];

    historial.push({
      fecha: new Date(),
      estado: estadoNuevo,
      usuarioId: auditor.id,
      usuarioNombre: auditor.fullName || auditor.username,
      rolUsuario: auditor.role,
      observacion: observaciones || `Auditor: ${estadoAnterior} → ${estadoNuevo}`,
    });

    documento.historialEstados = historial;
  }
}