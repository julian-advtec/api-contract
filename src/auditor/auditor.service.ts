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
import { AuditorValidationHelper } from './auditor-validation.helper';

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
    @InjectRepository(AuditorDocumento)
    private auditorDocumentoRepository: Repository<AuditorDocumento>,

  ) {
    this.logger.log('📋 AuditorService inicializado');
  }

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

  async tomarDocumentoParaRevision(documentoId: string, auditorId: string): Promise<{ success: boolean; message: string; documento: any }> {
    this.logger.log(`🤝 Auditor ${auditorId} tomando documento ${documentoId} para revisión`);
    const queryRunner = this.auditorRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const documento = await queryRunner.manager
        .createQueryBuilder(Documento, 'documento')
        .where('documento.id = :id', { id: documentoId })
        .andWhere('documento.estado = :estado', { estado: 'APROBADO_SUPERVISOR' })
        .setLock('pessimistic_write')
        .getOne();

      if (!documento) {
        throw new NotFoundException('Documento no encontrado o no está disponible para auditoría (debe estar en estado APROBADO_SUPERVISOR)');
      }

      const auditor = await queryRunner.manager.findOne(User, {
        where: { id: auditorId }
      });

      if (!auditor) {
        throw new NotFoundException('Auditor no encontrado');
      }

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

      documento.estado = 'EN_REVISION_AUDITOR';
      documento.fechaActualizacion = new Date();
      documento.ultimoAcceso = new Date();
      documento.ultimoUsuario = `Auditor: ${auditor.fullName || auditor.username}`;
      documento.usuarioAsignado = auditor;
      documento.usuarioAsignadoNombre = auditor.fullName || auditor.username;

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

      if (documento && documento.rutaCarpetaRadicado) {
        await this.registrarAccesoAuditor(
          documento.rutaCarpetaRadicado,
          auditorId,
          `TOMÓ documento para auditoría`,
          `Estado: APROBADO_SUPERVISOR → EN_REVISION_AUDITOR`
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



  async obtenerDetalleDocumento(documentoId: string, auditorId: string): Promise<any> {
    this.logger.log(`🔍 Auditor ${auditorId} solicitando detalle de documento ${documentoId}`);

    try {
      // 1. Cargar el auditor completo (User) – esto resuelve el error TS2345
      const auditor = await this.userRepository.findOne({
        where: { id: auditorId }
      });

      if (!auditor) {
        throw new NotFoundException('Auditor no encontrado');
      }

      // 2. Buscar auditor_documento
      const auditorDoc = await this.auditorRepository.findOne({
        where: {
          documento: { id: documentoId },
          auditor: { id: auditorId }
        },
        relations: ['documento', 'documento.radicador', 'documento.usuarioAsignado', 'auditor'],
      });

      // 3. Buscar documento principal
      const documento = await this.documentoRepository.findOne({
        where: { id: documentoId },
        relations: ['radicador', 'usuarioAsignado'],
      });

      if (!documento) {
        throw new NotFoundException('Documento no encontrado');
      }

      // 4. Validaciones de acceso
      if (!auditorDoc && documento.estado !== 'APROBADO_SUPERVISOR') {
        throw new ForbiddenException('No tienes acceso a este documento');
      }

      if (documento.estado === 'EN_REVISION_AUDITOR' && (!auditorDoc || auditorDoc.auditor.id !== auditorId)) {
        throw new ForbiddenException('Este documento está siendo revisado por otro auditor');
      }

      // 5. Construir respuesta pasando el objeto User completo
      return this.construirRespuestaDetalle(documento, auditorDoc, auditor);
    } catch (error) {
      this.logger.error(`❌ Error obteniendo detalle: ${error.message}`);
      throw error;
    }
  }

  /**
 * ✅ Obtener documento para vista de auditoría (modo solo lectura)
 */
  async obtenerDocumentoParaVista(documentoId: string, auditorId?: string): Promise<any> {
    this.logger.log(`🔍 Solicitando documento ${documentoId} para vista de auditoría`);

    // 🔴 IMPORTANTE: Loggear con más detalle
    console.log('[BACKEND DEBUG] Auditor ID recibido:', auditorId);
    console.log('[BACKEND DEBUG] ¿Es undefined?', auditorId === 'undefined' || !auditorId);

    // Sanitizar el auditorId
    let auditorIdSanitizado = auditorId;
    if (auditorId === 'undefined' || !auditorId) {
      console.log('[BACKEND DEBUG] Auditor ID inválido, intentando obtener del contexto...');
    }

    try {
      // 1. Obtener documento
      const documento = await this.documentoRepository.findOne({
        where: { id: documentoId },
        relations: ['radicador', 'usuarioAsignado'],
      });

      if (!documento) {
        throw new NotFoundException('Documento no encontrado');
      }

      console.log('[BACKEND DEBUG] Documento encontrado:', {
        id: documento.id,
        numeroRadicado: documento.numeroRadicado,
        estado: documento.estado,
        primerRadicadoDelAno: documento.primerRadicadoDelAno,
        usuarioAsignadoNombre: documento.usuarioAsignadoNombre,
        rutaCarpetaRadicado: documento.rutaCarpetaRadicado
      });

      // 2. Estados permitidos para auditoría
      const estadosPermitidos = [
        'APROBADO_SUPERVISOR',
        'EN_REVISION_AUDITOR',
        'APROBADO_AUDITOR',
        'OBSERVADO_AUDITOR',
        'RECHAZADO_AUDITOR',
        'COMPLETADO_AUDITOR'
      ];

      if (!estadosPermitidos.includes(documento.estado)) {
        throw new ForbiddenException(
          `Documento en estado "${documento.estado}". Solo visible para auditoría en estados: ${estadosPermitidos.join(', ')}`
        );
      }

      // 3. Obtener auditorDoc - MODIFICADO: Permitir buscar sin auditorId
      let auditorDoc = null;
      const archivosAuditor: any[] = [];

      // 🔴 CRÍTICO: Buscar archivos AUNQUE el auditorId sea undefined
      console.log(`[BACKEND DEBUG] ¿Es primer radicado? ${documento.primerRadicadoDelAno}`);

      if (!documento.primerRadicadoDelAno) {
        console.log('[BACKEND DEBUG] 📁 BÚSQUEDA INTENSIVA DE ARCHIVOS (NO PRIMER RADICADO)');
        console.log('[BACKEND DEBUG] Ruta base del documento:', documento.rutaCarpetaRadicado);

        // 🔍 BÚSQUEDA MEJORADA: Buscar en toda la estructura de carpetas
        const archivosEncontrados = this.busquedaIntensivaArchivos(documento);

        console.log('[BACKEND DEBUG] Archivos encontrados en servidor:', archivosEncontrados);

        // Usar la búsqueda mejorada
        archivosAuditor.push(
          {
            tipo: 'rp',
            descripcion: 'Resolución de Pago',
            subido: archivosEncontrados.rp ? true : false,
            nombreArchivo: archivosEncontrados.rp || '',
            rutaServidor: archivosEncontrados.rp ? this.construirRutaArchivo(documento, archivosEncontrados.rp) : null
          },
          {
            tipo: 'cdp',
            descripcion: 'Certificado de Disponibilidad Presupuestal',
            subido: archivosEncontrados.cdp ? true : false,
            nombreArchivo: archivosEncontrados.cdp || '',
            rutaServidor: archivosEncontrados.cdp ? this.construirRutaArchivo(documento, archivosEncontrados.cdp) : null
          },
          {
            tipo: 'poliza',
            descripcion: 'Póliza',
            subido: archivosEncontrados.poliza ? true : false,
            nombreArchivo: archivosEncontrados.poliza || '',
            rutaServidor: archivosEncontrados.poliza ? this.construirRutaArchivo(documento, archivosEncontrados.poliza) : null
          },
          {
            tipo: 'certificadoBancario',
            descripcion: 'Certificado Bancario',
            subido: archivosEncontrados.certificadoBancario ? true : false,
            nombreArchivo: archivosEncontrados.certificadoBancario || '',
            rutaServidor: archivosEncontrados.certificadoBancario ? this.construirRutaArchivo(documento, archivosEncontrados.certificadoBancario) : null
          },
          {
            tipo: 'minuta',
            descripcion: 'Minuta',
            subido: archivosEncontrados.minuta ? true : false,
            nombreArchivo: archivosEncontrados.minuta || '',
            rutaServidor: archivosEncontrados.minuta ? this.construirRutaArchivo(documento, archivosEncontrados.minuta) : null
          },
          {
            tipo: 'actaInicio',
            descripcion: 'Acta de Inicio',
            subido: archivosEncontrados.actaInicio ? true : false,
            nombreArchivo: archivosEncontrados.actaInicio || '',
            rutaServidor: archivosEncontrados.actaInicio ? this.construirRutaArchivo(documento, archivosEncontrados.actaInicio) : null
          }
        );
      } else {
        // Para primer radicado, intentar obtener auditorDoc
        if (auditorIdSanitizado && auditorIdSanitizado !== 'undefined') {
          auditorDoc = await this.auditorRepository.findOne({
            where: {
              documento: { id: documentoId },
              auditor: { id: auditorIdSanitizado }
            },
            relations: ['auditor'],
          });

          console.log('[BACKEND DEBUG] AuditorDoc encontrado:', auditorDoc ? 'Sí' : 'No');
        }

        // Usar datos de auditorDoc si existe, sino vacíos
        archivosAuditor.push(
          {
            tipo: 'rp',
            descripcion: 'Resolución de Pago',
            subido: !!auditorDoc?.rpPath,
            nombreArchivo: auditorDoc?.rpPath || ''
          },
          {
            tipo: 'cdp',
            descripcion: 'Certificado de Disponibilidad Presupuestal',
            subido: !!auditorDoc?.cdpPath,
            nombreArchivo: auditorDoc?.cdpPath || ''
          },
          {
            tipo: 'poliza',
            descripcion: 'Póliza',
            subido: !!auditorDoc?.polizaPath,
            nombreArchivo: auditorDoc?.polizaPath || ''
          },
          {
            tipo: 'certificadoBancario',
            descripcion: 'Certificado Bancario',
            subido: !!auditorDoc?.certificadoBancarioPath,
            nombreArchivo: auditorDoc?.certificadoBancarioPath || ''
          },
          {
            tipo: 'minuta',
            descripcion: 'Minuta',
            subido: !!auditorDoc?.minutaPath,
            nombreArchivo: auditorDoc?.minutaPath || ''
          },
          {
            tipo: 'actaInicio',
            descripcion: 'Acta de Inicio',
            subido: !!auditorDoc?.actaInicioPath,
            nombreArchivo: auditorDoc?.actaInicioPath || ''
          }
        );
      }

      console.log('[BACKEND DEBUG] Archivos auditor preparados:', archivosAuditor.length);

      // 4. Construir respuesta para vista
      const respuesta = {
        success: true,
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
            estadoDocumento: documento.estado, // Campo duplicado para compatibilidad
            primerRadicadoDelAno: documento.primerRadicadoDelAno,
            usuarioAsignadoNombre: documento.usuarioAsignadoNombre,
            historialEstados: documento.historialEstados || [],
            rutaCarpetaRadicado: documento.rutaCarpetaRadicado,
            cuentaCobro: documento.cuentaCobro,
            seguridadSocial: documento.seguridadSocial,
            informeActividades: documento.informeActividades,
            descripcionCuentaCobro: documento.descripcionCuentaCobro,
            descripcionSeguridadSocial: documento.descripcionSeguridadSocial,
            descripcionInformeActividades: documento.descripcionInformeActividades
          },
          archivosRadicados: [
            {
              numero: 1,
              nombre: documento.cuentaCobro,
              descripcion: documento.descripcionCuentaCobro,
              tipo: 'cuenta_cobro',
              existe: documento.cuentaCobro ? true : false
            },
            {
              numero: 2,
              nombre: documento.seguridadSocial,
              descripcion: documento.descripcionSeguridadSocial,
              tipo: 'seguridad_social',
              existe: documento.seguridadSocial ? true : false
            },
            {
              numero: 3,
              nombre: documento.informeActividades,
              descripcion: documento.descripcionInformeActividades,
              tipo: 'informe_actividades',
              existe: documento.informeActividades ? true : false
            }
          ],
          archivosAuditor: archivosAuditor,
          auditor: auditorDoc ? {
            id: auditorDoc.id,
            estado: auditorDoc.estado,
            observaciones: auditorDoc.observaciones,
            tieneTodosDocumentos: auditorDoc.tieneTodosDocumentos(),
            puedeSubirDocumentos: documento.primerRadicadoDelAno && documento.estado === 'EN_REVISION_AUDITOR',
            documentosSubidos: archivosAuditor.filter(a => a.subido).map(a => a.tipo),
            documentosFaltantes: this.obtenerDocumentosFaltantes(auditorDoc)
          } : null
        }
      };

      console.log('[BACKEND DEBUG] Respuesta final:', {
        estado: respuesta.data.documento.estado,
        primerRadicado: respuesta.data.documento.primerRadicadoDelAno,
        archivosAuditor: respuesta.data.archivosAuditor.length,
        archivosSubidos: respuesta.data.archivosAuditor.filter(a => a.subido).length,
        archivosDetalle: respuesta.data.archivosAuditor.map(a => ({
          tipo: a.tipo,
          subido: a.subido,
          nombre: a.nombreArchivo
        }))
      });

      return respuesta;

    } catch (error) {
      this.logger.error(`❌ Error obteniendo documento para vista: ${error.message}`);
      console.error('[BACKEND DEBUG] Error completo:', error);
      throw error;
    }
  }

  private obtenerDocumentosFaltantes(auditorDoc: AuditorDocumento): string[] {
    const faltantes = [];
    if (!auditorDoc.rpPath) faltantes.push('rp');
    if (!auditorDoc.cdpPath) faltantes.push('cdp');
    if (!auditorDoc.polizaPath) faltantes.push('poliza');
    if (!auditorDoc.certificadoBancarioPath) faltantes.push('certificadoBancario');
    if (!auditorDoc.minutaPath) faltantes.push('minuta');
    if (!auditorDoc.actaInicioPath) faltantes.push('actaInicio');
    return faltantes;
  }



  async obtenerEstadoArchivos(documentoId: string, auditorId: string): Promise<any> {
    this.logger.log(`📊 Verificando estado de archivos para documento ${documentoId}`);

    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId }
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    const auditorDoc = await this.auditorRepository.findOne({
      where: {
        documento: { id: documentoId },
        auditor: { id: auditorId }
      }
    });

    const esPrimerRadicado = documento.primerRadicadoDelAno;

    const archivosAuditoria = [
      {
        tipo: 'rp',
        nombre: 'Resolución de Pago',
        requerido: esPrimerRadicado,
        subido: auditorDoc?.rpPath ? true : false,
        nombreArchivo: auditorDoc?.rpPath || '',
        puedeDescargar: !!auditorDoc?.rpPath,
        puedeSubir: esPrimerRadicado
      },
      {
        tipo: 'cdp',
        nombre: 'Certificado de Disponibilidad Presupuestal',
        requerido: esPrimerRadicado,
        subido: auditorDoc?.cdpPath ? true : false,
        nombreArchivo: auditorDoc?.cdpPath || '',
        puedeDescargar: !!auditorDoc?.cdpPath,
        puedeSubir: esPrimerRadicado
      },
      {
        tipo: 'poliza',
        nombre: 'Póliza',
        requerido: esPrimerRadicado,
        subido: auditorDoc?.polizaPath ? true : false,
        nombreArchivo: auditorDoc?.polizaPath || '',
        puedeDescargar: !!auditorDoc?.polizaPath,
        puedeSubir: esPrimerRadicado
      },
      {
        tipo: 'certificadoBancario',
        nombre: 'Certificado Bancario',
        requerido: esPrimerRadicado,
        subido: auditorDoc?.certificadoBancarioPath ? true : false,
        nombreArchivo: auditorDoc?.certificadoBancarioPath || '',
        puedeDescargar: !!auditorDoc?.certificadoBancarioPath,
        puedeSubir: esPrimerRadicado
      },
      {
        tipo: 'minuta',
        nombre: 'Minuta',
        requerido: esPrimerRadicado,
        subido: auditorDoc?.minutaPath ? true : false,
        nombreArchivo: auditorDoc?.minutaPath || '',
        puedeDescargar: !!auditorDoc?.minutaPath,
        puedeSubir: esPrimerRadicado
      },
      {
        tipo: 'actaInicio',
        nombre: 'Acta de Inicio',
        requerido: esPrimerRadicado,
        subido: auditorDoc?.actaInicioPath ? true : false,
        nombreArchivo: auditorDoc?.actaInicioPath || '',
        puedeDescargar: !!auditorDoc?.actaInicioPath,
        puedeSubir: esPrimerRadicado
      }
    ];

    return {
      documento: {
        id: documento.id,
        numeroRadicado: documento.numeroRadicado,
        primerRadicadoDelAno: esPrimerRadicado,
        estado: documento.estado
      },
      archivos: archivosAuditoria,
      resumen: {
        totalRequeridos: esPrimerRadicado ? 6 : 0,
        totalSubidos: archivosAuditoria.filter(a => a.subido).length,
        completado: esPrimerRadicado ?
          archivosAuditoria.filter(a => a.subido).length === 6 :
          true
      }
    };
  }
  private obtenerArchivosAuditor(auditorDoc: AuditorDocumento): any[] {
    return [
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
      }
    ];
  }

  private crearNombreArchivoSeguro(
    tipo: string,
    radicado: string,
    extension: string,
  ): string {
    const nombreLimpio = tipo
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^\w._-]/g, '');

    const randomName = Array(8)
      .fill(null)
      .map(() => Math.round(Math.random() * 16).toString(16))
      .join('');

    return `${nombreLimpio}_${radicado}-${randomName}${extension}`;
  }

  /**
   * 🔍 BÚSQUEDA INTENSIVA: Busca archivos en toda la estructura del documento
   */
  private busquedaIntensivaArchivos(documento: Documento): {
    rp: string | null;
    cdp: string | null;
    poliza: string | null;
    certificadoBancario: string | null;
    minuta: string | null;
    actaInicio: string | null;
  } {
    const resultado: Record<'rp' | 'cdp' | 'poliza' | 'certificadoBancario' | 'minuta' | 'actaInicio', string | null> = {
      rp: null,
      cdp: null,
      poliza: null,
      certificadoBancario: null,
      minuta: null,
      actaInicio: null,
    };

    if (!documento.rutaCarpetaRadicado) {
      console.log('[BUSQUEDA-INTENSIVA] ❌ No hay ruta de carpeta');
      return resultado;
    }

    const rutaBase = documento.rutaCarpetaRadicado;
    console.log('[BUSQUEDA-INTENSIVA] 🔍 Buscando en ruta:', rutaBase);

    // 1. Primero buscar en la carpeta principal
    const archivosCarpetaPrincipal = this.buscarArchivosEnCarpeta(rutaBase, documento.numeroRadicado);
    console.log('[BUSQUEDA-INTENSIVA] Archivos en carpeta principal:', archivosCarpetaPrincipal);

    // 2. Buscar en subcarpetas (auditor, documentos, anexos, etc.)
    const subcarpetas = ['auditor', 'documentos', 'anexos', 'adjuntos', 'archivos'];

    for (const subcarpeta of subcarpetas) {
      const rutaSubcarpeta = path.join(rutaBase, subcarpeta);
      if (fs.existsSync(rutaSubcarpeta)) {
        console.log(`[BUSQUEDA-INTENSIVA] 🔎 Buscando en subcarpeta: ${subcarpeta}`);
        const archivosSubcarpeta = this.buscarArchivosEnCarpeta(rutaSubcarpeta, documento.numeroRadicado);

        // Actualizar resultados si encontramos archivos
        (Object.keys(archivosSubcarpeta) as (keyof typeof resultado)[]).forEach(tipo => {
          if (archivosSubcarpeta[tipo] && !resultado[tipo]) {
            resultado[tipo] = archivosSubcarpeta[tipo];
            console.log(`[BUSQUEDA-INTENSIVA] ✅ Encontrado ${tipo} en subcarpeta ${subcarpeta}:`, archivosSubcarpeta[tipo]);
          }
        });
      }
    }

    // 3. Buscar en carpetas de auditor específicas (por ID de auditor)
    if (fs.existsSync(rutaBase)) {
      try {
        const items = fs.readdirSync(rutaBase);
        const carpetasAuditor = items.filter(item => {
          const rutaItem = path.join(rutaBase, item);
          return fs.statSync(rutaItem).isDirectory() &&
            (item.includes('auditor') || /^[0-9a-f]{8}-/.test(item)); // UUID de auditor
        });

        for (const carpeta of carpetasAuditor) {
          const rutaAuditorEspecifico = path.join(rutaBase, carpeta);
          console.log(`[BUSQUEDA-INTENSIVA] 🔎 Buscando en carpeta auditor: ${carpeta}`);
          const archivosAuditorEspecifico = this.buscarArchivosEnCarpeta(rutaAuditorEspecifico, documento.numeroRadicado);

          (Object.keys(archivosAuditorEspecifico) as (keyof typeof resultado)[]).forEach(tipo => {
            if (archivosAuditorEspecifico[tipo] && !resultado[tipo]) {
              resultado[tipo] = archivosAuditorEspecifico[tipo];
              console.log(`[BUSQUEDA-INTENSIVA] ✅ Encontrado ${tipo} en carpeta auditor ${carpeta}:`, archivosAuditorEspecifico[tipo]);
            }
          });
        }
      } catch (error) {
        console.error('[BUSQUEDA-INTENSIVA] Error leyendo carpeta:', error.message);
      }
    }

    // 4. Si aún no encontramos, buscar de forma más agresiva
    if (Object.values(resultado).filter(v => v !== null).length === 0) {
      console.log('[BUSQUEDA-INTENSIVA] 🔦 BUSQUEDA AGRESIVA - Recorriendo toda la estructura');
      resultado.rp = this.buscarArchivoAgresivo(rutaBase, ['rp', 'resolucion', 'pago'], documento.numeroRadicado);
      resultado.cdp = this.buscarArchivoAgresivo(rutaBase, ['cdp', 'certificado', 'disponibilidad'], documento.numeroRadicado);
      resultado.poliza = this.buscarArchivoAgresivo(rutaBase, ['poliza', 'cumplimiento'], documento.numeroRadicado);
      resultado.certificadoBancario = this.buscarArchivoAgresivo(rutaBase, ['certificado', 'bancario', 'banco'], documento.numeroRadicado);
      resultado.minuta = this.buscarArchivoAgresivo(rutaBase, ['minuta', 'contrato'], documento.numeroRadicado);
      resultado.actaInicio = this.buscarArchivoAgresivo(rutaBase, ['acta', 'inicio'], documento.numeroRadicado);
    }

    console.log('[BUSQUEDA-INTENSIVA] 🔍 RESULTADO FINAL:', resultado);
    return resultado;
  }

  /**
   * 🔦 BUSQUEDA AGRESIVA: Recorre toda la estructura de carpetas
   */
  private buscarArchivoAgresivo(rutaBase: string, palabrasClave: string[], numeroRadicado: string): string | null {
    try {
      if (!fs.existsSync(rutaBase)) return null;

      const archivosEncontrados: string[] = [];

      const buscarRecursivo = (ruta: string) => {
        try {
          const items = fs.readdirSync(ruta);

          for (const item of items) {
            const rutaItem = path.join(ruta, item);
            const stat = fs.statSync(rutaItem);

            if (stat.isDirectory()) {
              // Buscar en subcarpetas
              buscarRecursivo(rutaItem);
            } else if (stat.isFile()) {
              // Verificar si coincide con las palabras clave
              const nombreLower = item.toLowerCase();
              const radicadoLower = numeroRadicado.toLowerCase();

              // Buscar coincidencias
              const coincidePalabra = palabrasClave.some(palabra =>
                nombreLower.includes(palabra.toLowerCase())
              );

              // También verificar si contiene el número de radicado
              const coincideRadicado = nombreLower.includes(radicadoLower);

              if (coincidePalabra || coincideRadicado) {
                archivosEncontrados.push(item);
                console.log(`[BUSQUEDA-AGRESIVA] 🔍 Coincidencia encontrada: ${item}`, {
                  palabrasClave,
                  coincidePalabra,
                  coincideRadicado
                });
              }
            }
          }
        } catch (error) {
          console.error(`[BUSQUEDA-AGRESIVA] Error en ${ruta}:`, error.message);
        }
      };

      buscarRecursivo(rutaBase);

      // Devolver el primer archivo encontrado
      return archivosEncontrados.length > 0 ? archivosEncontrados[0] : null;
    } catch (error) {
      console.error('[BUSQUEDA-AGRESIVA] Error general:', error.message);
      return null;
    }
  }

  /**
   * 🛠️ Construir ruta completa del archivo
   */
  private construirRutaArchivo(documento: Documento, nombreArchivo: string): string | null {
    if (!nombreArchivo || !documento.rutaCarpetaRadicado) {
      return null;
    }

    // Buscar en múltiples ubicaciones posibles
    const ubicacionesPosibles = [
      documento.rutaCarpetaRadicado,
      path.join(documento.rutaCarpetaRadicado, 'auditor'),
      path.join(documento.rutaCarpetaRadicado, 'documentos'),
      path.join(documento.rutaCarpetaRadicado, 'anexos'),
    ];

    for (const ubicacion of ubicacionesPosibles) {
      const rutaCompleta = path.join(ubicacion, nombreArchivo);
      if (fs.existsSync(rutaCompleta)) {
        console.log(`[CONSTRUIR-RUTA] ✅ Archivo encontrado en: ${ubicacion}`);
        return rutaCompleta;
      }
    }

    console.log(`[CONSTRUIR-RUTA] ❌ Archivo no encontrado: ${nombreArchivo}`);
    return null;
  }

  async subirDocumentosAuditor(
    documentoId: string,
    auditorId: string,
    datos: { observaciones?: string; estado?: AuditorEstado },
    files: { [key: string]: Express.Multer.File[] },
  ) {
    this.logger.log(`📤 Auditor ${auditorId} subiendo documentos para ${documentoId}`);

    // 1. Buscar el documento radicado principal
    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId },
    });

    if (!documento) {
      throw new NotFoundException(`Documento radicado ${documentoId} no encontrado`);
    }

    if (!documento.rutaCarpetaRadicado) {
      throw new BadRequestException('El documento no tiene ruta de carpeta definida');
    }

    const rutaBase = documento.rutaCarpetaRadicado;
    const rutaAuditor = path.join(rutaBase, 'auditor');

    if (!fs.existsSync(rutaAuditor)) {
      fs.mkdirSync(rutaAuditor, { recursive: true });
      this.logger.log(`📁 Carpeta auditor creada/existe: ${rutaAuditor}`);
    }

    // 2. Buscar o crear registro en auditor_documentos
    let auditorDoc = await this.auditorDocumentoRepository.findOne({
      where: {
        documento: { id: documentoId },
        auditor: { id: auditorId },
      },
    });

    if (!auditorDoc) {
      auditorDoc = this.auditorDocumentoRepository.create({
        documento: documento,
        auditor: { id: auditorId } as any, // ← temporal, puedes cargar el user completo si quieres
        estado: AuditorEstado.EN_REVISION,
        fechaInicioRevision: new Date(),
        observaciones: datos.observaciones || '',
      });

      await this.auditorDocumentoRepository.save(auditorDoc);
      this.logger.log(`📝 Nuevo registro AuditorDocumento creado: ${auditorDoc.id}`);
    } else {
      auditorDoc.observaciones = datos.observaciones || auditorDoc.observaciones;
      this.logger.log(`🔄 Actualizando registro AuditorDocumento existente: ${auditorDoc.id}`);
    }

    // 3. Procesamiento de los 6 archivos posibles
    const nombresGuardados: Record<string, string> = {};

    const camposProcesar = [
      { frontend: 'rp', dbKey: 'rpPath' },
      { frontend: 'cdp', dbKey: 'cdpPath' },
      { frontend: 'poliza', dbKey: 'polizaPath' },
      { frontend: 'certificadoBancario', dbKey: 'certificadoBancarioPath' },
      { frontend: 'minuta', dbKey: 'minutaPath' },
      { frontend: 'actaInicio', dbKey: 'actaInicioPath' },
    ];

    for (const campo of camposProcesar) {
      const fileArray = files[campo.frontend];
      if (!fileArray?.length) continue;

      const file = fileArray[0];

      // Verificación crítica (ahora con memoryStorage SIEMPRE debe existir)
      if (!file.buffer) {
        this.logger.error(`Archivo ${campo.frontend} llegó sin buffer → revisar multer config`);
        continue;
      }

      const extension = path.extname(file.originalname).toLowerCase();
      const nombreSeguro = this.crearNombreArchivoSeguro(
        campo.frontend,
        documento.numeroRadicado,
        extension
      );

      const rutaCompleta = path.join(rutaAuditor, nombreSeguro);
      const rutaRelativa = path.join('auditor', nombreSeguro);

      this.logger.log(`[GUARDANDO] ${campo.frontend} → ${rutaCompleta} (${file.size} bytes)`);

      try {
        // Guardamos usando buffer (la forma correcta con memoryStorage)
        fs.writeFileSync(rutaCompleta, file.buffer);

        // Asignamos el path relativo en la entidad
        switch (campo.frontend) {
          case 'rp': auditorDoc.rpPath = rutaRelativa; break;
          case 'cdp': auditorDoc.cdpPath = rutaRelativa; break;
          case 'poliza': auditorDoc.polizaPath = rutaRelativa; break;
          case 'certificadoBancario': auditorDoc.certificadoBancarioPath = rutaRelativa; break;
          case 'minuta': auditorDoc.minutaPath = rutaRelativa; break;
          case 'actaInicio': auditorDoc.actaInicioPath = rutaRelativa; break;
        }

        nombresGuardados[campo.frontend] = nombreSeguro;
        this.logger.log(`[OK] Guardado exitoso → ${rutaCompleta}`);
      } catch (err) {
        this.logger.error(`Fallo al guardar ${campo.frontend}:`, err);
        throw new InternalServerErrorException(`Error guardando archivo ${campo.frontend}`);
      }
    }

    // 4. Actualizar estado si viene en los datos
    if (datos.estado) {
      auditorDoc.estado = datos.estado;
      if (datos.estado === AuditorEstado.APROBADO) {
        auditorDoc.fechaAprobacion = new Date();
        auditorDoc.fechaFinRevision = new Date();
      }
    }

    // 5. Guardar todo
    await this.auditorDocumentoRepository.save(auditorDoc);

    this.logger.log(`✅ Auditoría guardada exitosamente para documento ${documentoId}`);

    return {
      success: true,
      auditorDocumentoId: auditorDoc.id,
      estado: auditorDoc.estado,
      archivosGuardados: nombresGuardados,
      observaciones: auditorDoc.observaciones,
    };
  }

  private obtenerArchivoAuditorDesdeDoc(auditorDoc: AuditorDocumento, tipo: string): string | null {
    switch (tipo) {
      case 'rp':
        return auditorDoc.rpPath || null;
      case 'cdp':
        return auditorDoc.cdpPath || null;
      case 'poliza':
        return auditorDoc.polizaPath || null;
      case 'certificadoBancario':
        return auditorDoc.certificadoBancarioPath || null;
      case 'minuta':
        return auditorDoc.minutaPath || null;
      case 'actaInicio':
        return auditorDoc.actaInicioPath || null;
      default:
        return null;
    }
  }


  private buscarArchivoEnServidor(rutaCarpeta: string, tipo: string, numeroRadicado: string): string | null {
    try {
      if (!fs.existsSync(rutaCarpeta)) {
        return null;
      }

      const archivos = fs.readdirSync(rutaCarpeta);

      // Patrones de búsqueda
      const patrones = [
        `${tipo}_${numeroRadicado}*`,
        `${tipo}_*`,
        `*${tipo}*`
      ];

      for (const patron of patrones) {
        const archivoEncontrado = archivos.find(archivo =>
          archivo.includes(tipo) &&
          !archivo.endsWith('_meta.json')
        );

        if (archivoEncontrado) {
          return archivoEncontrado;
        }
      }

      return null;
    } catch (error) {
      this.logger.error(`Error buscando archivo ${tipo}: ${error.message}`);
      return null;
    }
  }

  /**
   * Obtiene el archivo del auditor desde auditorDoc
   */
  private obtenerArchivoAuditor(auditorDoc: AuditorDocumento, tipo: string): string | null {
    switch (tipo) {
      case 'rp':
        return auditorDoc.rpPath || null;
      case 'cdp':
        return auditorDoc.cdpPath || null;
      case 'poliza':
        return auditorDoc.polizaPath || null;
      case 'certificadoBancario':
        return auditorDoc.certificadoBancarioPath || null;
      case 'minuta':
        return auditorDoc.minutaPath || null;
      case 'actaInicio':
        return auditorDoc.actaInicioPath || null;
      default:
        return null;
    }
  }

  /**
   * Actualiza el path en auditorDoc
   */
  private actualizarPathAuditorDoc(auditorDoc: AuditorDocumento, tipo: string, nombreArchivo: string): void {
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

  async revisarDocumento(
    documentoId: string,
    auditorId: string,
    revisarDto: RevisarAuditorDocumentoDto
  ): Promise<{ success: boolean; message: string; auditor: AuditorDocumento; documento: Documento }> {
    this.logger.log(`🔍 Auditor ${auditorId} revisando documento ${documentoId} - Estado: ${revisarDto.estado}`);

    // ✅ CORREGIDO: Usar el método estático correctamente
    const validationErrors = AuditorValidationHelper.validateRevisarDto(revisarDto);
    if (validationErrors.length > 0) {
      throw new BadRequestException(validationErrors.join('; '));
    }

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

    // ✅ MEJORAR LOGGING PARA DIAGNÓSTICO
    console.log('[BACKEND DEBUG] 🧾 ESTADO ACTUAL DE ARCHIVOS EN BD:');
    console.log('• RP:', auditorDoc.rpPath || 'NO SUBIDO');
    console.log('• CDP:', auditorDoc.cdpPath || 'NO SUBIDO');
    console.log('• Póliza:', auditorDoc.polizaPath || 'NO SUBIDO');
    console.log('• Certificado Bancario:', auditorDoc.certificadoBancarioPath || 'NO SUBIDO');
    console.log('• Minuta:', auditorDoc.minutaPath || 'NO SUBIDO');
    console.log('• Acta Inicio:', auditorDoc.actaInicioPath || 'NO SUBIDO');
    console.log('• ¿Documento es primer radicado?:', documento.primerRadicadoDelAno);
    console.log('• ¿tieneTodosDocumentos()?:', auditorDoc.tieneTodosDocumentos());

    console.log('[BACKEND DEBUG] Validaciones:', {
      estadoDocumento: documento.estado,
      primerRadicadoDelAno: documento.primerRadicadoDelAno,
      tieneTodosDocumentos: auditorDoc.tieneTodosDocumentos(),
      estadoSolicitado: revisarDto.estado
    });

    // ✅ Solo validar archivos completos si es PRIMER RADICADO
    if (documento.primerRadicadoDelAno && !auditorDoc.tieneTodosDocumentos()) {
      console.log('[BACKEND DEBUG] ❌ Validación fallida: primer radicado sin documentos completos');

      // Detallar exactamente qué falta
      const faltantes = [];
      if (!auditorDoc.rpPath) faltantes.push('RP');
      if (!auditorDoc.cdpPath) faltantes.push('CDP');
      if (!auditorDoc.polizaPath) faltantes.push('Póliza');
      if (!auditorDoc.certificadoBancarioPath) faltantes.push('Certificado Bancario');
      if (!auditorDoc.minutaPath) faltantes.push('Minuta');
      if (!auditorDoc.actaInicioPath) faltantes.push('Acta de Inicio');

      console.log('[BACKEND DEBUG] 📋 Documentos faltantes:', faltantes);

      throw new BadRequestException(
        `Debes subir todos los documentos requeridos. Faltan: ${faltantes.join(', ')}`
      );
    }



    console.log('[BACKEND DEBUG] Validaciones:', {
      estadoDocumento: documento.estado,
      primerRadicadoDelAno: documento.primerRadicadoDelAno,
      tieneTodosDocumentos: auditorDoc.tieneTodosDocumentos(),
      estadoSolicitado: revisarDto.estado
    });

    // ✅ Solo validar archivos completos si es PRIMER RADICADO
    if (documento.primerRadicadoDelAno && !auditorDoc.tieneTodosDocumentos()) {
      console.log('[BACKEND DEBUG] Validación fallida: primer radicado sin documentos completos');
      throw new BadRequestException('Debes subir todos los documentos requeridos (RP, CDP, Póliza, Certificado Bancario, Minuta, Acta de Inicio) antes de revisar');
    }

    // Solo verificar observaciones si es necesario
    if ((revisarDto.estado === AuditorEstado.OBSERVADO ||
      revisarDto.estado === AuditorEstado.RECHAZADO) &&
      (!revisarDto.observaciones || revisarDto.observaciones.trim() === '')) {
      throw new BadRequestException('Se requiere una observación para este estado');
    }

    const estadoAnterior = auditorDoc.estado;
    auditorDoc.estado = revisarDto.estado;
    auditorDoc.observaciones = revisarDto.observaciones?.trim() || '';
    auditorDoc.correcciones = revisarDto.correcciones?.trim() || '';
    auditorDoc.fechaActualizacion = new Date();
    auditorDoc.fechaFinRevision = new Date();

    if (revisarDto.estado === AuditorEstado.APROBADO || revisarDto.estado === AuditorEstado.COMPLETADO) {
      auditorDoc.fechaAprobacion = new Date();
    }

    documento.ultimoAcceso = new Date();
    documento.ultimoUsuario = `Auditor: ${auditorDoc.auditor.fullName || auditorDoc.auditor.username}`;
    documento.fechaActualizacion = new Date();

    let mensajeEstado = '';
    let estadoNuevoDocumento = '';

    switch (revisarDto.estado) {
      case AuditorEstado.APROBADO:
        estadoNuevoDocumento = 'APROBADO_AUDITOR';
        documento.comentarios = revisarDto.observaciones || 'Aprobado por auditor de cuentas';
        mensajeEstado = 'Documento aprobado por auditor';
        break;
      case AuditorEstado.OBSERVADO:
        estadoNuevoDocumento = 'OBSERVADO_AUDITOR';
        documento.comentarios = revisarDto.observaciones || 'Observado por auditor de cuentas';
        documento.correcciones = revisarDto.correcciones?.trim() || '';
        mensajeEstado = 'Documento observado por auditor';
        break;
      case AuditorEstado.RECHAZADO:
        estadoNuevoDocumento = 'RECHAZADO_AUDITOR';
        documento.comentarios = revisarDto.observaciones || 'Rechazado por auditor de cuentas';
        mensajeEstado = 'Documento rechazado por auditor';
        break;
      case AuditorEstado.COMPLETADO:
        estadoNuevoDocumento = 'COMPLETADO_AUDITOR';
        documento.comentarios = revisarDto.observaciones || 'Completado por auditor de cuentas';
        mensajeEstado = 'Documento completado por auditor';
        break;
      default:
        throw new BadRequestException(`Estado no válido para revisión: ${revisarDto.estado}`);
    }

    documento.estado = estadoNuevoDocumento;

    // Agregar al historial
    const historial = documento.historialEstados || [];
    historial.push({
      fecha: new Date(),
      estado: estadoNuevoDocumento,
      usuarioId: auditorId,
      usuarioNombre: auditorDoc.auditor.fullName || auditorDoc.auditor.username,
      rolUsuario: auditorDoc.auditor.role,
      observacion: `Revisión de auditor: ${estadoAnterior} → ${revisarDto.estado} - ${revisarDto.observaciones?.substring(0, 100) || 'Sin observación'}`
    });
    documento.historialEstados = historial;

    // Registrar acceso
    if (documento.rutaCarpetaRadicado) {
      await this.registrarAccesoAuditor(
        documento.rutaCarpetaRadicado,
        auditorId,
        `REALIZÓ REVISIÓN`,
        `${estadoAnterior} → ${revisarDto.estado} - ${revisarDto.observaciones?.substring(0, 100) || 'Sin observación'}`
      );
    }

    // Guardar cambios
    await this.documentoRepository.save(documento);
    const savedAuditorDoc = await this.auditorRepository.save(auditorDoc);

    console.log('[BACKEND DEBUG] Revisión completada:', {
      documento: documento.numeroRadicado,
      estadoAnterior: estadoAnterior,
      estadoNuevo: revisarDto.estado,
      estadoDocumentoNuevo: estadoNuevoDocumento,
      mensaje: mensajeEstado
    });

    this.logger.log(`✅ Documento ${documento.numeroRadicado} revisado por auditor. Estado: ${revisarDto.estado}`);

    return {
      success: true,
      message: mensajeEstado,
      auditor: savedAuditorDoc,
      documento
    };
  }

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
    await this.registrarAccesoAuditor(
      documento.rutaCarpetaRadicado,
      auditorId,
      `DESCARGÓ archivo radicado`,
      `Archivo ${numeroArchivo} - ${descripcion || nombreArchivo}`
    );
    return {
      ruta: rutaCompleta,
      nombre: nombreArchivo
    };
  }

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
    await this.registrarAccesoAuditor(
      documento.rutaCarpetaRadicado,
      auditorId,
      `DESCARGÓ archivo de auditor`,
      `Tipo: ${tipoArchivo} - ${nombreArchivo}`
    );
    return {
      ruta: rutaCompleta,
      nombre: nombreArchivo
    };
  }

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
      documento.estado = 'APROBADO_SUPERVISOR';
      documento.fechaActualizacion = new Date();
      documento.ultimoAcceso = new Date();
      documento.ultimoUsuario = `Auditor: ${auditorDoc.auditor.fullName || auditorDoc.auditor.username} (liberó)`;
      documento.usuarioAsignado = null;
      documento.usuarioAsignadoNombre = '';
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
      auditorDoc.estado = AuditorEstado.DISPONIBLE;
      auditorDoc.fechaActualizacion = new Date();
      auditorDoc.fechaFinRevision = new Date();
      auditorDoc.observaciones = 'Documento liberado - Disponible para otros auditores';
      await queryRunner.manager.save(AuditorDocumento, auditorDoc);
      if (documento.rutaCarpetaRadicado) {
        await this.registrarAccesoAuditor(
          documento.rutaCarpetaRadicado,
          auditorId,
          `LIBERÓ documento`,
          `Estado: EN_REVISION_AUDITOR → APROBADO_SUPERVISOR`
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
        this.documentoRepository.count({
          where: { estado: 'APROBADO_SUPERVISOR' }
        }),
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.EN_REVISION
          }
        }),
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.APROBADO
          }
        }),
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.OBSERVADO
          }
        }),
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.RECHAZADO
          }
        }),
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.COMPLETADO
          }
        }),
        this.auditorRepository.createQueryBuilder('ad')
          .leftJoin('ad.documento', 'documento')
          .where('ad.auditor_id = :auditorId', { auditorId })
          .andWhere('documento.primer_radicado_ano = true')
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

  async obtenerHistorialAuditor(auditorId: string): Promise<any[]> {
    try {
      console.log(`[HISTORIAL AUDITOR] Buscando para auditorId: ${auditorId}`);

      const auditorDocs = await this.auditorRepository.find({
        where: { auditor: { id: auditorId } },
        relations: ['documento', 'documento.radicador', 'auditor'],
        order: { fechaActualizacion: 'DESC' },
        take: 50
      });

      console.log(`[HISTORIAL AUDITOR] Registros encontrados en BD: ${auditorDocs.length}`);

      if (auditorDocs.length === 0) {
        console.log('[HISTORIAL AUDITOR] No hay registros para este auditor');
      } else {
        console.log('[HISTORIAL AUDITOR] Primer registro:', {
          id: auditorDocs[0].id,
          estado: auditorDocs[0].estado,
          observaciones: auditorDocs[0].observaciones,
          fechaCreacion: auditorDocs[0].fechaCreacion,
          auditor: auditorDocs[0].auditor?.fullName || auditorDocs[0].auditor?.username,
          documentoId: auditorDocs[0].documento?.id,
          numeroRadicado: auditorDocs[0].documento?.numeroRadicado
        });
      }

      const resultado = auditorDocs.map(ad => ({
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
        fechaInicioRevision: ad.fechaInicioRevision,
        tieneDocumentos: ad.tieneTodosDocumentos(),
        auditorAsignado: ad.auditor?.fullName || ad.auditor?.username
      }));

      console.log(`[HISTORIAL AUDITOR] Enviando al frontend ${resultado.length} registros`);

      return resultado;
    } catch (error) {
      console.error('[HISTORIAL AUDITOR] Error:', error.message, error.stack);
      throw error;
    }
  }

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

  private construirRespuestaDetalle(documento: Documento, auditorDoc: any, auditor: User): any {
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

  private async registrarAccesoAuditor(
    rutaCarpeta: string,
    auditorId: string,
    accion: string,
    detallesExtra?: string
  ): Promise<void> {
    try {
      if (!rutaCarpeta) {
        this.logger.warn('No hay rutaCarpeta para registrar acceso');
        return;
      }
      const rutaArchivo = path.join(rutaCarpeta, 'registro_accesos_auditor.txt');
      const fecha = new Date().toLocaleString('es-CO', {
        timeZone: 'America/Bogota',
        dateStyle: 'full',
        timeStyle: 'long'
      });
      const auditor = await this.userRepository.findOne({ where: { id: auditorId } });
      const nombreAuditor = auditor?.fullName || auditor?.username || 'Auditor desconocido';
      let registro = `[${fecha}] ${nombreAuditor} (${auditor?.username || auditorId}) - AUDITOR - ${accion}`;
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
      this.logger.log(`📝 Registro auditor actualizado: ${rutaArchivo} - ${accion}`);
    } catch (error) {
      this.logger.error(`⚠️ Error registrando acceso auditor: ${error.message}`);
    }
  }

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

  async obtenerMisAuditorias(auditorId: string): Promise<any[]> {
    this.logger.log(`📋 Obteniendo MIS auditorías para auditorId: ${auditorId}`);

    console.log(`[obtenerMisAuditorias] Buscando para auditorId exacto: ${auditorId}`);

    const auditorDocs = await this.auditorRepository.find({
      where: { auditor: { id: auditorId } },
      relations: ['documento', 'auditor'],
      order: { fechaActualizacion: 'DESC' }
    });

    console.log(`[obtenerMisAuditorias] Registros encontrados: ${auditorDocs.length}`);
    if (auditorDocs.length > 0) {
      console.log('Primer registro:', auditorDocs[0]);
    }

    try {
      const auditorDocs = await this.auditorRepository.find({
        where: {
          auditor: { id: auditorId }
          // Sin filtro de estado → trae todos: EN_REVISION, APROBADO_AUDITOR, etc.
        },
        relations: [
          'documento',
          'documento.radicador',
          'documento.usuarioAsignado',
          'auditor'
        ],
        order: { fechaActualizacion: 'DESC' }
      });

      this.logger.log(`✅ Encontradas ${auditorDocs.length} auditorías propias`);

      return auditorDocs.map(ad => ({
        id: ad.documento.id,
        numeroRadicado: ad.documento.numeroRadicado,
        numeroContrato: ad.documento.numeroContrato,
        nombreContratista: ad.documento.nombreContratista,
        documentoContratista: ad.documento.documentoContratista,
        fechaRadicacion: ad.documento.fechaRadicacion,
        estado: ad.documento.estado,              // estado general del doc
        auditorEstado: ad.estado,                 // estado en auditor_documentos
        observaciones: ad.observaciones || '',
        fechaInicioRevision: ad.fechaInicioRevision,
        fechaFinRevision: ad.fechaFinRevision,
        fechaAprobacion: ad.fechaAprobacion,
        primerRadicadoDelAno: ad.documento.primerRadicadoDelAno,
        supervisor: ad.documento.usuarioAsignadoNombre || 'No asignado',
        auditorAsignado: ad.auditor?.fullName || ad.auditor?.username,
        tieneDocumentos: ad.tieneTodosDocumentos()
      }));
    } catch (error) {
      this.logger.error(`❌ Error en mis-auditorias: ${error.message}`);
      throw error;
    }
  }

  private buscarArchivosEnCarpeta(rutaCarpeta: string, numeroRadicado: string): {
    rp: string | null;
    cdp: string | null;
    poliza: string | null;
    certificadoBancario: string | null;
    minuta: string | null;
    actaInicio: string | null;
  } {
    const resultado: Record<'rp' | 'cdp' | 'poliza' | 'certificadoBancario' | 'minuta' | 'actaInicio', string | null> = {
      rp: null,
      cdp: null,
      poliza: null,
      certificadoBancario: null,
      minuta: null,
      actaInicio: null,
    };

    if (!rutaCarpeta || !fs.existsSync(rutaCarpeta)) {
      console.log(`[BUSCAR-CARPETA] ❌ Carpeta no existe: ${rutaCarpeta}`);
      return resultado;
    }

    try {
      const archivos = fs.readdirSync(rutaCarpeta);
      console.log(`[BUSCAR-CARPETA] 📁 Archivos en ${rutaCarpeta}:`, archivos.length);

      const patrones: Record<keyof typeof resultado, RegExp[]> = {
        rp: [
          new RegExp(`rp.*${numeroRadicado}`, 'i'),
          /resoluci[oó]n.*pago/i,
          /rp[_-]/i,
          /^rp/i,
          /.*pago.*/i,
        ],
        cdp: [
          new RegExp(`cdp.*${numeroRadicado}`, 'i'),
          /certificado.*disponibilidad/i,
          /cdp[_-]/i,
          /^cdp/i,
          /.*disponibilidad.*/i,
        ],
        poliza: [
          new RegExp(`poliza.*${numeroRadicado}`, 'i'),
          /p[oó]liza.*cumplimiento/i,
          /poliza[_-]/i,
          /^poliza/i,
          /.*cumplimiento.*/i,
        ],
        certificadoBancario: [
          new RegExp(`certificado.*bancario.*${numeroRadicado}`, 'i'),
          /certificado.*bancario/i,
          /certificado[_-]bancario/i,
          /.*bancario.*/i,
          /.*banco.*/i,
        ],
        minuta: [
          new RegExp(`minuta.*${numeroRadicado}`, 'i'),
          /minuta.*contrato/i,
          /minuta[_-]/i,
          /^minuta/i,
          /.*contrato.*/i,
        ],
        actaInicio: [
          new RegExp(`acta.*inicio.*${numeroRadicado}`, 'i'),
          /acta.*de.*inicio/i,
          /acta[_-]inicio/i,
          /^acta/i,
          /.*inicio.*/i,
        ],
      };

      const ignorar = [
        /_meta\.json$/i,
        /\.tmp$/i,
        /~$/i,
        /^\./,
        /Thumbs\.db/i,
        /desktop\.ini/i,
      ];

      archivos.forEach((archivo) => {
        const nombreLower = archivo.toLowerCase();

        if (ignorar.some((regex) => regex.test(nombreLower))) {
          return;
        }

        (Object.keys(patrones) as (keyof typeof resultado)[]).forEach((tipo) => {
          if (resultado[tipo] !== null) return; // ya encontrado

          const regexList = patrones[tipo];
          if (regexList.some((regex) => regex.test(nombreLower))) {
            resultado[tipo] = archivo;
            console.log(`[BUSCAR-CARPETA] ✅ ${tipo.toUpperCase()} encontrado: ${archivo}`);
          }
        });
      });

      return resultado;
    } catch (error) {
      console.error(`[BUSCAR-CARPETA] Error en ${rutaCarpeta}:`, error);
      return resultado;
    }
  }

  // Método para obtener documento en modo debug
  async obtenerDocumentoDebug(documentoId: string, auditorId: string): Promise<any> {
    this.logger.log(`🔍 [DEBUG] Obteniendo documento ${documentoId} para auditor ${auditorId}`);

    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId },
      select: ['id', 'numeroRadicado', 'estado', 'primerRadicadoDelAno', 'nombreContratista', 'usuarioAsignadoNombre']
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    const auditorDoc = await this.auditorRepository.findOne({
      where: {
        documento: { id: documentoId },
        auditor: { id: auditorId }
      },
      relations: ['auditor']
    });

    const auditor = await this.userRepository.findOne({
      where: { id: auditorId }
    });

    return {
      debug: true,
      timestamp: new Date().toISOString(),
      documento: {
        id: documento.id,
        numeroRadicado: documento.numeroRadicado,
        estado: documento.estado,
        primerRadicadoDelAno: documento.primerRadicadoDelAno,
        nombreContratista: documento.nombreContratista,
        usuarioAsignadoNombre: documento.usuarioAsignadoNombre
      },
      auditorDoc: auditorDoc ? {
        id: auditorDoc.id,
        estado: auditorDoc.estado,
        auditorId: auditorDoc.auditor?.id,
        auditorNombre: auditorDoc.auditor?.fullName || auditorDoc.auditor?.username
      } : null,
      usuario: {
        id: auditorId,
        username: auditor?.username,
        fullName: auditor?.fullName,
        role: auditor?.role
      },
      permisos: {
        puedeVer: ['APROBADO_SUPERVISOR', 'EN_REVISION_AUDITOR', 'APROBADO_AUDITOR', 'OBSERVADO_AUDITOR', 'RECHAZADO_AUDITOR', 'COMPLETADO_AUDITOR'].includes(documento.estado),
        puedeRevisar: documento.estado === 'EN_REVISION_AUDITOR' && auditorDoc?.auditor?.id === auditorId
      }
    };
  }

  async diagnosticoDocumentos(documentoId: string, auditorId: string): Promise<any> {
    const auditorDoc = await this.auditorRepository.findOne({
      where: {
        documento: { id: documentoId },
        auditor: { id: auditorId }
      },
      relations: ['documento']
    });

    if (!auditorDoc) {
      return { error: 'No se encontró registro de auditoría' };
    }

    return {
      auditorDoc: {
        id: auditorDoc.id,
        estado: auditorDoc.estado,
        tieneTodosDocumentos: auditorDoc.tieneTodosDocumentos(),
        archivos: {
          rp: auditorDoc.rpPath,
          cdp: auditorDoc.cdpPath,
          poliza: auditorDoc.polizaPath,
          certificadoBancario: auditorDoc.certificadoBancarioPath,
          minuta: auditorDoc.minutaPath,
          actaInicio: auditorDoc.actaInicioPath
        }
      },
      documento: {
        id: auditorDoc.documento.id,
        numeroRadicado: auditorDoc.documento.numeroRadicado,
        primerRadicadoDelAno: auditorDoc.documento.primerRadicadoDelAno,
        estado: auditorDoc.documento.estado
      }
    };
  }

}