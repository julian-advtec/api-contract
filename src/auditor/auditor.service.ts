import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
  ForbiddenException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
   * ✅ OBTENER DOCUMENTOS APROBADOS POR SUPERVISOR (estado APROBADO_SUPERVISOR)
   */
  async obtenerDocumentosDisponibles(auditorId: string): Promise<any[]> {
    this.logger.log(`📋 Auditor ${auditorId} solicitando documentos disponibles`);

    try {
      const documentos = await this.documentoRepository
        .createQueryBuilder('documento')
        .leftJoinAndSelect('documento.radicador', 'radicador')
        .leftJoinAndSelect('documento.usuarioAsignado', 'usuarioAsignado')
        .where("documento.estado = :estado", { estado: 'APROBADO_SUPERVISOR' })
        .orderBy('documento.fechaRadicacion', 'ASC')
        .getMany();

      this.logger.log(`✅ Encontrados ${documentos.length} documentos en estado APROBADO_SUPERVISOR`);

      const auditorDocs = await this.auditorRepository.find({
        where: {
          auditor: { id: auditorId },
          estado: AuditorEstado.EN_REVISION
        },
        relations: ['documento']
      });

      const documentosEnRevisionIds = auditorDocs.map(ad => ad.documento.id);

      const documentosConEstado = documentos.map(documento => {
        const estaRevisandoYo = documentosEnRevisionIds.includes(documento.id);

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
          disponible: true,
          asignacion: {
            enRevision: estaRevisandoYo,
            puedoTomar: !estaRevisandoYo && documento.estado === 'APROBADO_SUPERVISOR',
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

    try {
      const documento = await this.documentoRepository.findOne({
        where: { id: documentoId, estado: 'APROBADO_SUPERVISOR' },
        relations: ['radicador', 'usuarioAsignado']
      });

      if (!documento) {
        throw new NotFoundException('Documento no encontrado o no está disponible para auditoría (debe estar en estado APROBADO_SUPERVISOR)');
      }

      const auditor = await this.userRepository.findOne({
        where: { id: auditorId }
      });

      if (!auditor) {
        throw new NotFoundException('Auditor no encontrado');
      }

      if (documento.usuarioAsignado && documento.usuarioAsignado.id !== auditorId) {
        // Verificar si ya hay un auditor asignado a través de la tabla auditor_documentos
        const auditorDocExistente = await this.auditorRepository.findOne({
          where: { 
            documento: { id: documentoId },
            estado: AuditorEstado.EN_REVISION
          }
        });

        if (auditorDocExistente) {
          throw new BadRequestException(`Este documento ya está siendo revisado por otro auditor`);
        }
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

      await this.documentoRepository.save(documento);
      this.logger.log(`📝 Documento principal actualizado a estado: ${documento.estado}`);

      // Crear o actualizar registro en auditor_documentos
      let auditorDoc = await this.auditorRepository.findOne({
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
        auditorDoc = this.auditorRepository.create({
          documento: documento,
          auditor: auditor,
          estado: AuditorEstado.EN_REVISION,
          fechaCreacion: new Date(),
          fechaActualizacion: new Date(),
          fechaInicioRevision: new Date(),
          observaciones: 'Documento tomado para revisión de auditoría'
        });
      }

      await this.auditorRepository.save(auditorDoc);

      // Registrar acceso
      if (documento && documento.rutaCarpetaRadicado) {
        await this.registrarAccesoAuditor(
          documento.rutaCarpetaRadicado,
          auditorId,
          `TOMÓ documento para revisión de auditoría. Estado: APROBADO_SUPERVISOR → EN_REVISION_AUDITOR`
        );
      }

      this.logger.log(`✅ Documento ${documento.numeroRadicado} tomado para revisión por ${auditor.username}. Estado actualizado a EN_REVISION_AUDITOR`);

      return {
        success: true,
        message: `Documento ${documento.numeroRadicado} tomado para revisión de auditoría`,
        documento: this.mapearDocumentoParaRespuesta(documento, auditorDoc)
      };

    } catch (error) {
      this.logger.error(`❌ Error tomando documento: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * ✅ OBTENER DOCUMENTOS QUE ESTOY REVISANDO
   */
  async obtenerDocumentosEnRevision(auditorId: string): Promise<any[]> {
    this.logger.log(`📋 Auditor ${auditorId} solicitando documentos en revisión`);

    try {
      const documentos = await this.documentoRepository
        .createQueryBuilder('documento')
        .leftJoinAndSelect('documento.radicador', 'radicador')
        .leftJoin('auditor_documentos', 'ad', 'ad.documento_id = documento.id')
        .where('ad.auditor_id = :auditorId', { auditorId })
        .andWhere('ad.estado = :estado', { estado: AuditorEstado.EN_REVISION })
        .andWhere('documento.estado = :docEstado', { docEstado: 'EN_REVISION_AUDITOR' })
        .orderBy('ad.fechaInicioRevision', 'DESC')
        .getMany();

      const auditorDocs = await this.auditorRepository.find({
        where: {
          auditor: { id: auditorId },
          estado: AuditorEstado.EN_REVISION
        },
        relations: ['auditor', 'documento']
      });

      const mapaAsignaciones = new Map();
      auditorDocs.forEach(ad => {
        mapaAsignaciones.set(ad.documento.id, ad);
      });

      return documentos.map(documento => {
        const asignacion = mapaAsignaciones.get(documento.id);
        return this.mapearDocumentoParaRespuesta(documento, asignacion);
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
          auditor: { id: auditorId },
          estado: AuditorEstado.EN_REVISION
        },
        relations: ['documento', 'documento.radicador', 'documento.usuarioAsignado'],
      });

      const documento = await this.documentoRepository.findOne({
        where: { id: documentoId },
        relations: ['radicador', 'usuarioAsignado'],
      });

      if (!documento) {
        throw new NotFoundException('Documento no encontrado');
      }

      if (documento.estado !== 'APROBADO_SUPERVISOR' && documento.estado !== 'EN_REVISION_AUDITOR') {
        throw new BadRequestException('Solo puedes acceder a documentos en estado APROBADO_SUPERVISOR o EN_REVISION_AUDITOR');
      }

      return this.construirRespuestaDetalle(documento, auditorDoc, auditor);

    } catch (error) {
      this.logger.error(`❌ Error obteniendo detalle: ${error.message}`);
      if (error instanceof ForbiddenException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al obtener detalle del documento');
    }
  }

  /**
   * ✅ SUBIR DOCUMENTOS DE AUDITORÍA
   */
    async subirDocumentosAuditor(
    documentoId: string,
    auditorId: string,
    subirDto: SubirDocumentosAuditorDto,
    files: { [fieldname: string]: Express.Multer.File[] }
  ): Promise<{ auditor: AuditorDocumento; documento: Documento }> {
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

    // Guardar cada archivo y actualizar los paths - CORREGIDO (usando switch)
    for (const tipo of archivosRequeridos) {
      const archivo = files[tipo][0];
      const nombreArchivo = await this.guardarArchivoAuditor(documento, archivo, tipo, auditorId);
      
      // ✅ CORRECCIÓN: Usar switch en lugar de acceso dinámico
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
      observacion: 'Documentos de auditoría subidos'
    });
    documento.historialEstados = historial;

    await this.registrarAccesoAuditor(
      documento.rutaCarpetaRadicado,
      auditorId,
      `SUBIO documentos de auditoría: RP, CDP, Póliza, Certificado Bancario, Minuta, Acta de Inicio`
    );

    await this.documentoRepository.save(documento);
    const savedAuditorDoc = await this.auditorRepository.save(auditorDoc);

    this.logger.log(`✅ Documentos de auditoría subidos para documento ${documento.numeroRadicado}`);

    return {
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
  ): Promise<{ auditor: AuditorDocumento; documento: Documento }> {
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

    // Verificar que se hayan subido todos los documentos requeridos
    if (!auditorDoc.tieneTodosDocumentos()) {
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
    switch (revisarDto.estado) {
      case AuditorEstado.APROBADO:
        documento.estado = 'APROBADO_AUDITOR';
        documento.comentarios = revisarDto.observaciones || 'Aprobado por auditor de cuentas';
        break;

      case AuditorEstado.OBSERVADO:
        documento.estado = 'OBSERVADO_AUDITOR';
        documento.comentarios = revisarDto.observaciones || 'Observado por auditor de cuentas';
        documento.correcciones = revisarDto.correcciones?.trim() || '';
        break;

      case AuditorEstado.RECHAZADO:
        documento.estado = 'RECHAZADO_AUDITOR';
        documento.comentarios = revisarDto.observaciones || 'Rechazado por auditor de cuentas';
        break;

      case AuditorEstado.COMPLETADO:
        documento.estado = 'COMPLETADO_AUDITOR';
        documento.comentarios = revisarDto.observaciones || 'Completado por auditor de cuentas';
        break;
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

    // Verificar acceso: puede ver documentos en APROBADO_SUPERVISOR o si es suyo
    const auditorDoc = await this.auditorRepository.findOne({
      where: {
        documento: { id: documentoId },
        auditor: { id: auditorId }
      }
    });

    if (!auditorDoc && documento.estado !== 'APROBADO_SUPERVISOR') {
      throw new ForbiddenException('No tienes permisos para acceder a este documento');
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

    const rutaCompleta = path.join(documento.rutaCarpetaRadicado, nombreArchivo);

    if (!fs.existsSync(rutaCompleta)) {
      throw new NotFoundException(`Archivo no encontrado en el servidor: ${nombreArchivo}`);
    }

    this.registrarAccesoAuditor(
      documento.rutaCarpetaRadicado,
      auditorId,
      `DESCARGÓ archivo radicado: ${nombreArchivo}`
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
    
    // ✅ CORRECCIÓN: Usar switch en lugar de acceso dinámico
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
      throw new NotFoundException(`Archivo de tipo ${tipoArchivo} no encontrado`);
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

    try {
      const auditorDoc = await this.auditorRepository.findOne({
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
      documento.ultimoUsuario = `Auditor: liberado`;
      documento.usuarioAsignado = null;
      documento.usuarioAsignadoNombre = '';

      // Agregar al historial
      const historial = documento.historialEstados || [];
      historial.push({
        fecha: new Date(),
        estado: 'APROBADO_SUPERVISOR',
        usuarioId: auditorId,
        usuarioNombre: 'Sistema',
        rolUsuario: 'AUDITOR_CUENTAS',
        observacion: 'Documento liberado por auditor - Volvió a estado APROBADO_SUPERVISOR'
      });
      documento.historialEstados = historial;

      await this.documentoRepository.save(documento);

      // Actualizar registro de auditor
      auditorDoc.estado = AuditorEstado.DISPONIBLE;
      auditorDoc.fechaActualizacion = new Date();
      auditorDoc.fechaFinRevision = new Date();
      auditorDoc.observaciones = 'Documento liberado - Disponible para otros auditores';

      await this.auditorRepository.save(auditorDoc);

      if (documento.rutaCarpetaRadicado) {
        await this.registrarAccesoAuditor(
          documento.rutaCarpetaRadicado,
          auditorId,
          `LIBERÓ documento. Estado: EN_REVISION_AUDITOR → APROBADO_SUPERVISOR`
        );
      }

      this.logger.log(`✅ Documento ${documento.numeroRadicado} liberado por ${auditorId}. Estado revertido a APROBADO_SUPERVISOR`);

      return {
        success: true,
        message: 'Documento liberado correctamente y disponible para otros auditores'
      };

    } catch (error) {
      this.logger.error(`❌ Error liberando documento: ${error.message}`);
      throw error;
    }
  }

  /**
   * ✅ OBTENER ESTADÍSTICAS DEL AUDITOR
   */
  async obtenerEstadisticasAuditor(auditorId: string): Promise<any> {
    try {
      this.logger.log(`📊 Obteniendo estadísticas para auditor: ${auditorId}`);

      const totalDocumentosAprobadosSupervisor = await this.documentoRepository.count({
        where: { estado: 'APROBADO_SUPERVISOR' }
      });

      const [enRevision, aprobados, observados, rechazados, completados] = await Promise.all([
        this.auditorRepository
          .createQueryBuilder('auditor')
          .leftJoin('auditor.auditor', 'usuario')
          .where('usuario.id = :auditorId', { auditorId })
          .andWhere('auditor.estado = :estado', { estado: AuditorEstado.EN_REVISION })
          .getCount(),

        this.auditorRepository
          .createQueryBuilder('auditor')
          .leftJoin('auditor.auditor', 'usuario')
          .where('usuario.id = :auditorId', { auditorId })
          .andWhere('auditor.estado = :estado', { estado: AuditorEstado.APROBADO })
          .getCount(),

        this.auditorRepository
          .createQueryBuilder('auditor')
          .leftJoin('auditor.auditor', 'usuario')
          .where('usuario.id = :auditorId', { auditorId })
          .andWhere('auditor.estado = :estado', { estado: AuditorEstado.OBSERVADO })
          .getCount(),

        this.auditorRepository
          .createQueryBuilder('auditor')
          .leftJoin('auditor.auditor', 'usuario')
          .where('usuario.id = :auditorId', { auditorId })
          .andWhere('auditor.estado = :estado', { estado: AuditorEstado.RECHAZADO })
          .getCount(),

        this.auditorRepository
          .createQueryBuilder('auditor')
          .leftJoin('auditor.auditor', 'usuario')
          .where('usuario.id = :auditorId', { auditorId })
          .andWhere('auditor.estado = :estado', { estado: AuditorEstado.COMPLETADO })
          .getCount()
      ]);

      const fechaLimite = new Date();
      fechaLimite.setDate(fechaLimite.getDate() - 7);

      const recientes = await this.auditorRepository
        .createQueryBuilder('auditor')
        .leftJoin('auditor.auditor', 'usuario')
        .where('usuario.id = :auditorId', { auditorId })
        .andWhere('auditor.fechaCreacion >= :fechaLimite', { fechaLimite })
        .getCount();

      const aprobadosCompletos = await this.auditorRepository
        .createQueryBuilder('auditor')
        .leftJoin('auditor.auditor', 'usuario')
        .where('usuario.id = :auditorId', { auditorId })
        .andWhere('auditor.estado IN (:...estados)', { estados: [AuditorEstado.APROBADO, AuditorEstado.COMPLETADO] })
        .andWhere('auditor.fechaCreacion IS NOT NULL')
        .andWhere('auditor.fechaAprobacion IS NOT NULL')
        .select(['auditor.fechaCreacion', 'auditor.fechaAprobacion'])
        .getMany();

      let tiempoPromedioHoras = 0;
      if (aprobadosCompletos.length > 0) {
        const totalHoras = aprobadosCompletos.reduce((total, doc) => {
          const inicio = new Date(doc.fechaCreacion);
          const fin = new Date(doc.fechaAprobacion);
          const horas = (fin.getTime() - inicio.getTime()) / (1000 * 60 * 60);
          return total + horas;
        }, 0);
        tiempoPromedioHoras = Math.round(totalHoras / aprobadosCompletos.length);
      }

      const totalProcesados = aprobados + observados + rechazados + completados;
      const eficiencia = totalProcesados > 0 ?
        Math.round(((aprobados + completados) / totalProcesados) * 100) : 0;

      const estadisticas = {
        totalDocumentosDisponibles: totalDocumentosAprobadosSupervisor,
        enRevision: enRevision,
        aprobados: aprobados,
        observados: observados,
        rechazados: rechazados,
        completados: completados,
        recientes: recientes,
        tiempoPromedioHoras: tiempoPromedioHoras,
        eficiencia: eficiencia,
        totales: {
          enRevision: enRevision,
          aprobados: aprobados,
          observados: observados,
          rechazados: rechazados,
          completados: completados,
          total: enRevision + aprobados + observados + rechazados + completados
        },
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
        'image/png'
      ];

      if (!allowedMimes.includes(archivo.mimetype)) {
        throw new BadRequestException(`Tipo de archivo no permitido para ${tipo}`);
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

      const metadatos = {
        nombreOriginal: archivo.originalname,
        nombreGuardado: nombreArchivo,
        mimeType: archivo.mimetype,
        tamanio: archivo.size,
        fechaSubida: new Date().toISOString(),
        tipoDocumento: tipo,
        descripcion: this.obtenerDescripcionTipo(tipo),
        auditorId: auditorId
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
    // ✅ CORRECCIÓN: Usar switch en lugar de objeto con index signature
    switch (tipo) {
      case 'rp':
        return 'Resolución de Pago';
      case 'cdp':
        return 'Certificado de Disponibilidad Presupuestal';
      case 'poliza':
        return 'Póliza';
      case 'certificadoBancario':
        return 'Certificado Bancario';
      case 'minuta':
        return 'Minuta';
      case 'actaInicio':
        return 'Acta de Inicio';
      default:
        return tipo;
    }
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
        tieneDocumentos: auditorDoc.tieneTodosDocumentos()
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
        nombre: documento.cuentaCobro,
        descripcion: documento.descripcionCuentaCobro,
        tipo: 'cuenta_cobro',
        existe: fs.existsSync(path.join(documento.rutaCarpetaRadicado, documento.cuentaCobro))
      },
      {
        nombre: documento.seguridadSocial,
        descripcion: documento.descripcionSeguridadSocial,
        tipo: 'seguridad_social',
        existe: fs.existsSync(path.join(documento.rutaCarpetaRadicado, documento.seguridadSocial))
      },
      {
        nombre: documento.informeActividades,
        descripcion: documento.descripcionInformeActividades,
        tipo: 'informe_actividades',
        existe: fs.existsSync(path.join(documento.rutaCarpetaRadicado, documento.informeActividades))
      }
    ];

    // Archivos del auditor (si existen)
    const archivosAuditor = [
      { tipo: 'rp', descripcion: 'Resolución de Pago', subido: !!auditorDoc?.rpPath },
      { tipo: 'cdp', descripcion: 'Certificado de Disponibilidad Presupuestal', subido: !!auditorDoc?.cdpPath },
      { tipo: 'poliza', descripcion: 'Póliza', subido: !!auditorDoc?.polizaPath },
      { tipo: 'certificadoBancario', descripcion: 'Certificado Bancario', subido: !!auditorDoc?.certificadoBancarioPath },
      { tipo: 'minuta', descripcion: 'Minuta', subido: !!auditorDoc?.minutaPath },
      { tipo: 'actaInicio', descripcion: 'Acta de Inicio', subido: !!auditorDoc?.actaInicioPath }
    ];

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
        tieneTodosDocumentos: auditorDoc.tieneTodosDocumentos(),
        documentosSubidos: archivosAuditor.filter(a => a.subido).map(a => a.tipo)
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