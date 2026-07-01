// src/supervisor/services/supervisor-documentos.service.ts

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
  ForbiddenException,

} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupervisorDocumento, SupervisorEstado } from '../entities/supervisor.entity';
import { Documento } from '../../radicacion/entities/documento.entity';
import { User } from '../../users/entities/user.entity';
import { UserRole } from '../../users/enums/user-role.enum';
import { StorageService } from '../../common/storage/storage.service';
import { SignaturesService } from '../../signatures/signatures.service';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as path from 'path';
import { SignaturePositionDto } from '../dto/signature-position.dto';

import { promises as fsPromises } from 'fs';
import * as fs from 'fs';

import { SupervisorSignatureService } from './supervisor-signature.service';

@Injectable()
export class SupervisorDocumentosService {
  private readonly logger = new Logger(SupervisorDocumentosService.name);

  constructor(
    @InjectRepository(SupervisorDocumento)
    private supervisorRepository: Repository<SupervisorDocumento>,
    @InjectRepository(Documento)
    private documentoRepository: Repository<Documento>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private storageService: StorageService,
    private signaturesService: SignaturesService,
    private supervisorSignatureService: SupervisorSignatureService,
  ) { }

  async obtenerDocumentosDisponibles(supervisorId: string): Promise<any[]> {
    this.logger.log(`📋 Supervisor ${supervisorId} solicitando documentos disponibles (APROBADOS POR AUDITOR O EN_REVISION_SUPERVISOR)`);

    try {
      // ✅ Cambiar: Buscar documentos en APROBADO_AUDITOR O EN_REVISION_SUPERVISOR
      const documentos = await this.documentoRepository
        .createQueryBuilder('documento')
        .leftJoinAndSelect('documento.radicador', 'radicador')
        .leftJoinAndSelect('documento.usuarioAsignado', 'usuarioAsignado')
        .where("documento.estado IN (:...estados)", {
          estados: ['APROBADO_AUDITOR', 'EN_REVISION_SUPERVISOR']
        })
        .orderBy('documento.fechaRadicacion', 'ASC')
        .getMany();

      this.logger.log(`✅ Encontrados ${documentos.length} documentos en estados APROBADO_AUDITOR o EN_REVISION_SUPERVISOR`);

      const supervisorDocs = await this.supervisorRepository.find({
        where: {
          supervisor: { id: supervisorId },
          estado: SupervisorEstado.EN_REVISION
        },
        relations: ['documento']
      });

      const documentosEnRevisionIds = supervisorDocs.map(sd => sd.documento.id);

      const documentosConEstado = documentos.map(documento => {
        const estaRevisandoYo = documentosEnRevisionIds.includes(documento.id);
        const estadoDoc = documento.estado;

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
          observacion: documento.observacion || '',
          disponible: true,
          tieneActa: !!documento.actaSupervisionPath,
          actaNombre: documento.actaSupervisionNombre,
          auditorAprobo: estadoDoc === 'APROBADO_AUDITOR',
          yaEnRevision: estadoDoc === 'EN_REVISION_SUPERVISOR',
          asignacion: {
            enRevision: estaRevisandoYo,
            puedoTomar: !estaRevisandoYo && estadoDoc === 'APROBADO_AUDITOR',
            puedeContinuar: estaRevisandoYo && estadoDoc === 'EN_REVISION_SUPERVISOR',
            usuarioAsignado: documento.usuarioAsignadoNombre,
            supervisorActual: documento.usuarioAsignado ?
              documento.usuarioAsignado.fullName || documento.usuarioAsignado.username : null
          }
        };
      });

      return documentosConEstado;
    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos disponibles: ${error.message}`);
      throw error;
    }
  }

  // src/supervisor/services/supervisor-documentos.service.ts

  async tomarDocumentoParaRevision(documentoId: string, supervisorId: string): Promise<{ success: boolean; message: string; documento: any }> {
    this.logger.log(`🤝 Supervisor ${supervisorId} tomando documento ${documentoId} para revisión`);

    try {
      // ✅ Permitir documentos en APROBADO_AUDITOR o EN_REVISION_SUPERVISOR (si ya está asignado a este supervisor)
      const documento = await this.documentoRepository.findOne({
        where: { id: documentoId },
        relations: ['radicador', 'usuarioAsignado']
      });

      if (!documento) {
        throw new NotFoundException('Documento no encontrado');
      }

      // Verificar si ya está en revisión por este supervisor
      const existingSupervisorDoc = await this.supervisorRepository.findOne({
        where: {
          documento: { id: documentoId },
          supervisor: { id: supervisorId }
        },
        relations: ['documento', 'supervisor']
      });

      // Si ya tiene un registro y está EN_REVISION, permitir continuar
      if (existingSupervisorDoc && existingSupervisorDoc.estado === SupervisorEstado.EN_REVISION) {
        this.logger.log(`📝 Supervisor ${supervisorId} continúa revisión del documento ${documentoId}`);

        return {
          success: true,
          message: `Continuando revisión del documento ${documento.numeroRadicado}`,
          documento: this.mapearDocumentoParaRespuesta(documento, existingSupervisorDoc)
        };
      }

      // Si no está en estado permitido para tomar
      if (documento.estado !== 'APROBADO_AUDITOR' && documento.estado !== 'EN_REVISION_SUPERVISOR') {
        throw new BadRequestException(`Documento no disponible para revisión. Estado actual: ${documento.estado}`);
      }

      // Si ya está en revisión por otro supervisor
      if (documento.estado === 'EN_REVISION_SUPERVISOR' && documento.usuarioAsignado && documento.usuarioAsignado.id !== supervisorId) {
        throw new BadRequestException(`Este documento ya está siendo revisado por ${documento.usuarioAsignadoNombre}`);
      }

      const supervisor = await this.userRepository.findOne({
        where: { id: supervisorId }
      });

      if (!supervisor) {
        throw new NotFoundException('Supervisor no encontrado');
      }

      // Actualizar estado del documento principal
      const estadoAnterior = documento.estado;
      documento.estado = 'EN_REVISION_SUPERVISOR';
      documento.fechaActualizacion = new Date();
      documento.ultimoAcceso = new Date();
      documento.ultimoUsuario = `Supervisor: ${supervisor.fullName || supervisor.username}`;
      documento.usuarioAsignado = supervisor;
      documento.usuarioAsignadoNombre = supervisor.fullName || supervisor.username;

      const historial = documento.historialEstados || [];
      historial.push({
        fecha: new Date(),
        estado: 'EN_REVISION_SUPERVISOR',
        usuarioId: supervisor.id,
        usuarioNombre: supervisor.fullName || supervisor.username,
        rolUsuario: supervisor.role,
        observacion: estadoAnterior === 'APROBADO_AUDITOR'
          ? `Documento tomado para revisión por supervisor (aprobado previamente por auditor)`
          : `Supervisor ${supervisor.username} continúa revisión del documento`
      });
      documento.historialEstados = historial;

      await this.documentoRepository.save(documento);
      this.logger.log(`📝 Documento principal actualizado a estado: ${documento.estado}`);

      let supervisorDoc = await this.supervisorRepository.findOne({
        where: {
          documento: { id: documentoId },
          supervisor: { id: supervisorId }
        },
        relations: ['documento', 'supervisor']
      });

      if (supervisorDoc) {
        supervisorDoc.estado = SupervisorEstado.EN_REVISION;
        supervisorDoc.fechaActualizacion = new Date();
        supervisorDoc.fechaInicioRevision = supervisorDoc.fechaInicioRevision || new Date();
        supervisorDoc.observacion = estadoAnterior === 'APROBADO_AUDITOR'
          ? 'Documento tomado para revisión (aprobado por auditor)'
          : 'Continuación de revisión';
      } else {
        supervisorDoc = this.supervisorRepository.create({
          documento: documento,
          supervisor: supervisor,
          estado: SupervisorEstado.EN_REVISION,
          fechaCreacion: new Date(),
          fechaActualizacion: new Date(),
          fechaInicioRevision: new Date(),
          observacion: 'Documento tomado para revisión (aprobado por auditor)'
        });
      }

      await this.supervisorRepository.save(supervisorDoc);

      this.logger.log(`✅ Documento ${documento.numeroRadicado} en revisión por ${supervisor.username}. Estado: EN_REVISION_SUPERVISOR`);

      return {
        success: true,
        message: estadoAnterior === 'APROBADO_AUDITOR'
          ? `Documento ${documento.numeroRadicado} tomado para revisión`
          : `Continuando revisión del documento ${documento.numeroRadicado}`,
        documento: this.mapearDocumentoParaRespuesta(documento, supervisorDoc)
      };
    } catch (error) {
      this.logger.error(`❌ Error tomando documento: ${error.message}`, error.stack);
      throw error;
    }
  }

  async obtenerDocumentosEnRevision(supervisorId: string): Promise<any[]> {
    this.logger.log(`📋 Supervisor ${supervisorId} solicitando documentos en revisión`);

    try {
      const documentos = await this.documentoRepository
        .createQueryBuilder('documento')
        .leftJoinAndSelect('documento.radicador', 'radicador')
        .leftJoin('supervisor_documentos', 'sd', 'sd.documento_id = documento.id')
        .where('sd.supervisor_id = :supervisorId', { supervisorId })
        .andWhere('sd.estado = :estado', { estado: SupervisorEstado.EN_REVISION })
        .andWhere('documento.estado = :docEstado', { docEstado: 'EN_REVISION_SUPERVISOR' })
        .orderBy('sd.fechaInicioRevision', 'DESC')
        .getMany();

      const supervisorDocs = await this.supervisorRepository.find({
        where: {
          supervisor: { id: supervisorId },
          estado: SupervisorEstado.EN_REVISION
        },
        relations: ['supervisor', 'documento']
      });

      const mapaAsignaciones = new Map();
      supervisorDocs.forEach(sd => {
        mapaAsignaciones.set(sd.documento.id, sd);
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

  async liberarDocumento(documentoId: string, supervisorId: string): Promise<{ success: boolean; message: string }> {
    this.logger.log(`🔄 Supervisor ${supervisorId} liberando documento ${documentoId}`);

    try {
      const supervisorDoc = await this.supervisorRepository.findOne({
        where: {
          documento: { id: documentoId },
          supervisor: { id: supervisorId },
          estado: SupervisorEstado.EN_REVISION
        },
        relations: ['documento', 'supervisor']
      });

      if (!supervisorDoc) {
        throw new NotFoundException('No tienes este documento en revisión');
      }

      const documento = supervisorDoc.documento;

      documento.estado = 'APROBADO_AUDITOR';
      documento.fechaActualizacion = new Date();
      documento.ultimoAcceso = new Date();
      documento.ultimoUsuario = `Supervisor: liberado`;
      documento.usuarioAsignado = null;
      documento.usuarioAsignadoNombre = '';

      const historial = documento.historialEstados || [];
      historial.push({
        fecha: new Date(),
        estado: 'APROBADO_AUDITOR',
        usuarioId: supervisorId,
        usuarioNombre: 'Sistema',
        rolUsuario: 'SUPERVISOR',
        observacion: 'Documento liberado por supervisor - Volvió a estado APROBADO_AUDITOR'
      });
      documento.historialEstados = historial;

      await this.documentoRepository.save(documento);

      supervisorDoc.estado = SupervisorEstado.DISPONIBLE;
      supervisorDoc.fechaActualizacion = new Date();
      supervisorDoc.fechaFinRevision = new Date();
      supervisorDoc.observacion = 'Documento liberado - Disponible para otros supervisores';

      await this.supervisorRepository.save(supervisorDoc);

      this.logger.log(`✅ Documento ${documento.numeroRadicado} liberado por ${supervisorId}. Estado revertido a APROBADO_AUDITOR`);

      return {
        success: true,
        message: 'Documento liberado correctamente y disponible para otros supervisores'
      };
    } catch (error) {
      this.logger.error(`❌ Error liberando documento: ${error.message}`);
      throw error;
    }
  }

  async obtenerDetalleDocumento(documentoId: string, userId: string): Promise<any> {
    this.logger.log(`🔍 Supervisor ${userId} solicitando detalle de documento ${documentoId}`);

    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId },
      relations: ['radicador', 'usuarioAsignado']
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    // ✅ INCLUIR LOS CAMPOS DEL ACTA FIRMADA EN LA RESPUESTA
    const detalle = {
      id: documento.id,
      numeroRadicado: documento.numeroRadicado,
      numeroContrato: documento.numeroContrato,
      nombreContratista: documento.nombreContratista,
      documentoContratista: documento.documentoContratista,
      emailContratista: documento.emailContratista,
      telefonoContratista: documento.telefonoContratista,
      fechaInicio: documento.fechaInicio,
      fechaFin: documento.fechaFin,
      estado: documento.estado,
      fechaRadicacion: documento.fechaRadicacion,
      observacion: documento.observacion,
      nombreRadicador: documento.nombreRadicador,
      usuarioRadicador: documento.usuarioRadicador,
      rutaCarpetaRadicado: documento.rutaCarpetaRadicado,
      primerRadicadoDelAno: documento.primerRadicadoDelAno,
      esUltimoRadicado: documento.esUltimoRadicado,
      usuarioAsignadoNombre: documento.usuarioAsignadoNombre,
      comentarios: documento.comentarios,
      correcciones: documento.correcciones,
      historialEstados: documento.historialEstados || [],

      // Archivos radicados
      cuentaCobro: documento.cuentaCobro,
      seguridadSocial: documento.seguridadSocial,
      informeActividades: documento.informeActividades,
      descripcionCuentaCobro: documento.descripcionCuentaCobro,
      descripcionSeguridadSocial: documento.descripcionSeguridadSocial,
      descripcionInformeActividades: documento.descripcionInformeActividades,

      // Acta de supervisión
      actaSupervisionPath: documento.actaSupervisionPath,
      actaSupervisionNombre: documento.actaSupervisionNombre,
      actaSupervisionSubidaPor: documento.actaSupervisionSubidaPor,
      actaSupervisionFecha: documento.actaSupervisionFecha,

      // ✅ Acta firmada
      actaFirmadaPath: documento.actaFirmadaPath,
      actaFirmadaNombre: documento.actaFirmadaNombre,
      actaFirmadaFecha: documento.actaFirmadaFecha,
      actaFirmadaPor: documento.actaFirmadaPor,
      tieneActaFirmada: !!documento.actaFirmadaPath
    };

    this.logger.log(`✅ Detalle construido para ${documento.numeroRadicado}. Tiene acta firmada: ${detalle.tieneActaFirmada}`);

    return detalle;
  }


  async asignarDocumentoASupervisoresAutomaticamente(documentoId: string): Promise<void> {
    try {
      this.logger.log(`🔄 Asignando documento ${documentoId} a supervisores automáticamente...`);

      const documento = await this.documentoRepository.findOne({
        where: { id: documentoId },
        relations: ['radicador']
      });

      if (!documento) {
        this.logger.error(`❌ Documento ${documentoId} no encontrado`);
        return;
      }

      if (documento.estado !== 'APROBADO_AUDITOR') {
        this.logger.warn(`⚠️ Documento ${documentoId} no está en estado APROBADO_AUDITOR, estado actual: ${documento.estado}`);
        return;
      }

      const asignacionesExistentes = await this.supervisorRepository.find({
        where: { documento: { id: documentoId } }
      });

      if (asignacionesExistentes.length > 0) {
        this.logger.log(`✅ Documento ${documentoId} ya tiene ${asignacionesExistentes.length} asignaciones`);
        return;
      }

      const supervisores = await this.userRepository.find({
        where: {
          role: UserRole.SUPERVISOR,
          isActive: true
        }
      });

      if (supervisores.length === 0) {
        this.logger.warn('⚠️ No hay supervisores disponibles para asignar documento');
        return;
      }

      this.logger.log(`👥 ${supervisores.length} supervisores activos encontrados`);

      for (const supervisor of supervisores) {
        try {
          const supervisorDoc = this.supervisorRepository.create({
            documento: documento,
            supervisor: supervisor,
            estado: SupervisorEstado.DISPONIBLE,
            fechaCreacion: new Date(),
            fechaActualizacion: new Date()
          });

          await this.supervisorRepository.save(supervisorDoc);
          this.logger.log(`✅ Documento ${documento.numeroRadicado} marcado como disponible para supervisor ${supervisor.username}`);
        } catch (error) {
          this.logger.error(`❌ Error asignando a supervisor ${supervisor.username}: ${error.message}`);
        }
      }

      this.logger.log(`✅ Documento ${documento.numeroRadicado} disponible para ${supervisores.length} supervisores`);
    } catch (error) {
      this.logger.error(`❌ Error en asignación automática: ${error.message}`);
      throw new InternalServerErrorException('Error al asignar documento a supervisores');
    }
  }

  async onDocumentoCambiaEstado(documentoId: string, nuevoEstado: string): Promise<void> {
    this.logger.log(`🔄 Webhook: Documento ${documentoId} cambió a estado ${nuevoEstado}`);

    try {
      if (nuevoEstado === 'APROBADO_AUDITOR') {
        await this.asignarDocumentoASupervisoresAutomaticamente(documentoId);
      }
    } catch (error) {
      this.logger.error(`❌ Error procesando webhook de estado: ${error.message}`);
    }
  }

  async asignarTodosDocumentosASupervisores(): Promise<{ asignados: number; total: number }> {
    try {
      this.logger.log('🔄 Asignando TODOS los documentos APROBADOS_AUDITOR a supervisores...');

      const documentos = await this.documentoRepository.find({
        where: { estado: 'APROBADO_AUDITOR' }
      });

      if (documentos.length === 0) {
        this.logger.log('✅ No hay documentos APROBADOS_AUDITOR para asignar');
        return { asignados: 0, total: 0 };
      }

      const supervisores = await this.userRepository.find({
        where: {
          role: UserRole.SUPERVISOR,
          isActive: true
        }
      });

      if (supervisores.length === 0) {
        this.logger.warn('⚠️ No hay supervisores disponibles');
        return { asignados: 0, total: documentos.length };
      }

      let documentosAsignados = 0;

      for (const documento of documentos) {
        try {
          const tieneAsignaciones = await this.supervisorRepository.count({
            where: { documento: { id: documento.id } }
          });

          if (!tieneAsignaciones) {
            for (const supervisor of supervisores) {
              const supervisorDoc = this.supervisorRepository.create({
                documento: documento,
                supervisor: supervisor,
                estado: SupervisorEstado.DISPONIBLE,
                fechaCreacion: new Date(),
                fechaActualizacion: new Date()
              });

              await this.supervisorRepository.save(supervisorDoc);
            }
            documentosAsignados++;
            this.logger.log(`✅ Documento ${documento.numeroRadicado} disponible para ${supervisores.length} supervisores`);
          } else {
            this.logger.log(`📌 Documento ${documento.numeroRadicado} ya tiene asignaciones`);
          }
        } catch (error) {
          this.logger.error(`❌ Error asignando documento ${documento.numeroRadicado}: ${error.message}`);
        }
      }

      this.logger.log(`✅ ${documentosAsignados} documentos disponibles de ${documentos.length} totales`);
      return {
        asignados: documentosAsignados,
        total: documentos.length
      };
    } catch (error) {
      this.logger.error(`❌ Error asignando todos los documentos: ${error.message}`);
      throw new InternalServerErrorException('Error al asignar documentos a supervisores');
    }
  }

  async obtenerConteoDocumentosRadicados(): Promise<number> {
    return await this.documentoRepository.count({
      where: { estado: 'APROBADO_AUDITOR' }
    });
  }

  async obtenerDocumentosRevisados(supervisorId: string): Promise<any[]> {
    this.logger.log(`📋 Supervisor ${supervisorId} solicitando documentos revisados`);

    try {
      const supervisiones = await this.supervisorRepository.find({
        where: [
          { supervisor: { id: supervisorId }, estado: SupervisorEstado.APROBADO },
          { supervisor: { id: supervisorId }, estado: SupervisorEstado.OBSERVADO },
          { supervisor: { id: supervisorId }, estado: SupervisorEstado.RECHAZADO }
        ],
        relations: ['documento', 'documento.radicador'],
        order: { fechaActualizacion: 'DESC' },
        take: 100
      });

      return supervisiones.map(sd => ({
        id: sd.documento.id,
        numeroRadicado: sd.documento.numeroRadicado,
        numeroContrato: sd.documento.numeroContrato,
        nombreContratista: sd.documento.nombreContratista,
        documentoContratista: sd.documento.documentoContratista,
        fechaRadicacion: sd.documento.fechaRadicacion,
        fechaInicio: sd.documento.fechaInicio,
        fechaFin: sd.documento.fechaFin,
        estado: sd.estado,
        radicador: sd.documento.nombreRadicador,
        fechaRechazo: sd.fechaAprobacion || sd.fechaActualizacion,
        observaciones: sd.observacion,
        supervisorRechazo: sd.supervisor?.fullName || sd.supervisor?.username,
        cuentaCobro: sd.documento.cuentaCobro,
        seguridadSocial: sd.documento.seguridadSocial,
        informeActividades: sd.documento.informeActividades,
        actaFirmadaPath: sd.actaFirmadaPath,
        actaFirmadaNombre: sd.actaFirmadaNombre,
        fechaFirma: sd.fechaFirma
      }));
    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos revisados: ${error.message}`);
      throw error;
    }
  }

  async obtenerMisSupervisiones(supervisorId: string): Promise<any[]> {
    this.logger.log(`📋 Supervisor ${supervisorId} solicitando todas sus supervisiones`);

    try {
      const misSupervisiones = await this.supervisorRepository.find({
        where: {
          supervisor: { id: supervisorId }
        },
        relations: ['documento', 'documento.radicador'],
        order: { fechaActualizacion: 'DESC' }
      });

      this.logger.log(`✅ Encontradas ${misSupervisiones.length} supervisiones para el supervisor`);

      return misSupervisiones.map(sd => {
        const documento = sd.documento;

        return {
          id: documento.id,
          numeroRadicado: documento.numeroRadicado,
          numeroContrato: documento.numeroContrato,
          nombreContratista: documento.nombreContratista,
          documentoContratista: documento.documentoContratista,
          fechaInicio: documento.fechaInicio,
          fechaFin: documento.fechaFin,
          fechaRadicacion: documento.fechaRadicacion,
          radicador: documento.nombreRadicador,
          estado: documento.estado,
          supervisorEstado: sd.estado,
          observacion: sd.observacion || '',
          fechaInicioRevision: sd.fechaInicioRevision,
          fechaFinRevision: sd.fechaFinRevision,
          fechaAprobacion: sd.fechaAprobacion,
          supervisorAsignado: sd.supervisor?.fullName || sd.supervisor?.username,
          tieneArchivo: !!sd.nombreArchivoSupervisor,
          nombreArchivoSupervisor: sd.nombreArchivoSupervisor,
          tienePazSalvo: !!sd.pazSalvo,
          pazSalvo: sd.pazSalvo,
          tieneActaFirmada: !!sd.actaFirmadaPath,
          actaFirmadaNombre: sd.actaFirmadaNombre,
          fechaFirma: sd.fechaFirma,
          puedeEditar: sd.estado === 'EN_REVISION',
          cuentaCobro: documento.cuentaCobro,
          seguridadSocial: documento.seguridadSocial,
          informeActividades: documento.informeActividades
        };
      });
    } catch (error) {
      this.logger.error(`❌ Error obteniendo supervisiones: ${error.message}`);
      throw error;
    }
  }


async obtenerActaFirmada(
  documentoId: string,
  userId: string
): Promise<{ buffer: Buffer; mimeType: string; nombre: string }> {
  this.logger.log(`📄 Usuario ${userId} solicitando acta firmada del documento ${documentoId}`);

  const documento = await this.documentoRepository.findOne({
    where: { id: documentoId }
  });

  if (!documento) {
    throw new NotFoundException('Documento no encontrado');
  }

  // Verificar en documentos primero
  let actaPath = documento.actaFirmadaPath;
  
  // Si no está en documentos, buscar en supervisor_documentos
  if (!actaPath) {
    const supervisorDoc = await this.supervisorRepository.findOne({
      where: { documento: { id: documentoId } },
      order: { fechaActualizacion: 'DESC' }
    });
    
    if (supervisorDoc && supervisorDoc.actaFirmadaPath) {
      actaPath = supervisorDoc.actaFirmadaPath;
      this.logger.log(`📝 Acta firmada encontrada en supervisor_documentos: ${actaPath}`);
      
      // Sincronizar con documentos
      documento.actaFirmadaPath = actaPath;
      documento.actaFirmadaNombre = supervisorDoc.actaFirmadaNombre;
      documento.actaFirmadaFecha = supervisorDoc.fechaFirma;
      documento.actaFirmadaPor = supervisorDoc.supervisor?.id;
      await this.documentoRepository.save(documento);
      this.logger.log(`✅ Acta firmada sincronizada con documentos`);
    }
  }

  if (!actaPath) {
    this.logger.warn(`⚠️ Documento ${documento.numeroRadicado} no tiene acta firmada`);
    throw new NotFoundException('No hay acta firmada para este documento');
  }

  // ✅ CONSTRUIR LA RUTA COMPLETA CORRECTAMENTE
  let rutaCompleta: string;
  
  // Si la ruta ya es absoluta
  if (actaPath.includes(':') || actaPath.startsWith('\\\\')) {
    rutaCompleta = actaPath;
  } 
  // Si la ruta es relativa (empieza con "firmas/")
  else if (actaPath.startsWith('firmas') || actaPath.startsWith('firmas\\')) {
    // Construir ruta completa: basePath + carpeta_documento + actaPath
    rutaCompleta = path.join(documento.rutaCarpetaRadicado, actaPath);
  }
  else {
    // Si es solo el nombre del archivo
    rutaCompleta = path.join(documento.rutaCarpetaRadicado, 'firmas', actaPath);
  }

  this.logger.log(`📁 Buscando acta firmada en: ${rutaCompleta}`);

  // Verificar que el archivo exista
  if (!fs.existsSync(rutaCompleta)) {
    this.logger.error(`❌ El archivo no existe en: ${rutaCompleta}`);
    throw new NotFoundException('El archivo del acta firmada no existe en el servidor');
  }

  const buffer = fs.readFileSync(rutaCompleta);
  const stats = fs.statSync(rutaCompleta);
  this.logger.log(`✅ Acta firmada encontrada: ${rutaCompleta} (${stats.size} bytes)`);

  return {
    buffer,
    mimeType: 'application/pdf',
    nombre: documento.actaFirmadaNombre || `acta_firmada_${documento.numeroRadicado}.pdf`
  };
}

  // ==================== VER ACTA DE SUPERVISIÓN ====================
  async obtenerActaSupervision(
    documentoId: string,
    userId: string
  ): Promise<{ buffer: Buffer; mimeType: string; nombre: string }> {
    this.logger.log(`📄 Usuario ${userId} solicitando acta de supervisión del documento ${documentoId}`);

    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId }
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    if (!documento.actaSupervisionPath) {
      throw new NotFoundException('Este documento no tiene acta de supervisión');
    }

    try {
      const buffer = await this.storageService.getFile(documento.actaSupervisionPath);
      const extension = path.extname(documento.actaSupervisionNombre || '').toLowerCase();

      const mimeTypes: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };

      return {
        buffer,
        mimeType: mimeTypes[extension] || 'application/octet-stream',
        nombre: documento.actaSupervisionNombre || 'acta_supervision.pdf',
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo acta de supervisión: ${error.message}`);
      throw new NotFoundException('No se pudo obtener el archivo del acta de supervisión');
    }
  }

  // ==================== VER ACTA ORIGINAL ====================
async obtenerActaOriginal(
  documentoId: string,
  userId: string
): Promise<{ buffer: Buffer; mimeType: string; nombre: string }> {
  this.logger.log(`📄 Usuario ${userId} solicitando acta original del documento ${documentoId}`);

  const documento = await this.documentoRepository.findOne({
    where: { id: documentoId }
  });

  if (!documento) {
    throw new NotFoundException('Documento no encontrado');
  }

  if (!documento.actaSupervisionPath) {
    throw new NotFoundException('Este documento no tiene acta de supervisión');
  }

  // Método mejorado para buscar el archivo
  const buffer = await this.buscarArchivoActa(documento);
  
  const extension = path.extname(documento.actaSupervisionNombre || '').toLowerCase();

  const mimeTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };

  return {
    buffer,
    mimeType: mimeTypes[extension] || 'application/octet-stream',
    nombre: documento.actaSupervisionNombre || `acta_original_${documento.numeroRadicado}.pdf`,
  };
}

// Nuevo método auxiliar para buscar el archivo en múltiples ubicaciones
private async buscarArchivoActa(documento: Documento): Promise<Buffer> {
  const actaPath = documento.actaSupervisionPath;
  const carpetaBase = documento.rutaCarpetaRadicado;
  
  // Posibles ubicaciones a buscar
  const posiblesRutas = [
    actaPath, // Ruta directa
    path.join(carpetaBase, actaPath), // Unida a la carpeta del documento
    path.join(carpetaBase, 'actas', actaPath), // Subcarpeta actas
    path.join(carpetaBase, path.basename(actaPath)), // Solo el nombre del archivo
    path.join(carpetaBase, 'acta_supervision_' + documento.numeroRadicado + '.pdf'), // Formato esperado
  ];

  // Intentar con storageService primero (solo si la ruta es relativa)
  try {
    // Si la ruta parece relativa (no contiene : ni \\)
    if (!actaPath.includes(':') && !actaPath.startsWith('\\\\')) {
      const buffer = await this.storageService.getFile(actaPath);
      this.logger.log(`✅ Acta encontrada con storageService: ${actaPath}`);
      return buffer;
    }
  } catch (error) {
    this.logger.warn(`storageService falló: ${error.message}`);
  }

  // Buscar con fs en las posibles rutas
  for (const ruta of posiblesRutas) {
    if (ruta && fs.existsSync(ruta)) {
      this.logger.log(`✅ Acta encontrada en: ${ruta}`);
      return fs.readFileSync(ruta);
    }
  }

  // Buscar cualquier PDF en la carpeta que contenga "acta"
  if (fs.existsSync(carpetaBase)) {
    const archivos = fs.readdirSync(carpetaBase);
    const actaPdf = archivos.find(f => 
      f.toLowerCase().includes('acta') && 
      f.toLowerCase().endsWith('.pdf')
    );
    
    if (actaPdf) {
      const rutaActa = path.join(carpetaBase, actaPdf);
      this.logger.log(`✅ Acta encontrada por búsqueda: ${rutaActa}`);
      return fs.readFileSync(rutaActa);
    }
  }

  this.logger.error(`❌ Acta no encontrada en ninguna ubicación. Path almacenado: ${actaPath}`);
  throw new NotFoundException(`No se pudo encontrar el archivo del acta original. Path: ${actaPath}`);
}

  // ==================== FIRMAR ACTA ====================
  async firmarActa(
    documentoId: string,
    supervisorId: string,
    signatureId: string,
    position: SignaturePositionDto
  ): Promise<{ success: boolean; message: string; data: any }> {
    this.logger.log(`🔏 Firmando acta para documento ${documentoId} por supervisor ${supervisorId}`);

    const queryRunner = this.documentoRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const documento = await queryRunner.manager.findOne(Documento, {
        where: { id: documentoId }
      });

      if (!documento) {
        throw new NotFoundException('Documento no encontrado');
      }

      if (!documento.actaSupervisionPath) {
        throw new BadRequestException('El documento no tiene acta de supervisión para firmar');
      }

      if (documento.actaFirmadaPath) {
        throw new BadRequestException('El documento ya tiene un acta firmada');
      }

      if (documento.usuarioAsignado?.id !== supervisorId) {
        const supervisor = await this.userRepository.findOne({ where: { id: supervisorId } });
        if (supervisor?.role !== 'admin') {
          throw new ForbiddenException('No tienes permisos para firmar este documento');
        }
      }

      // Obtener el buffer del acta de supervisión
      let actaBuffer: Buffer;
      let actaPath = documento.actaSupervisionPath;

      if (fs.existsSync(actaPath)) {
        actaBuffer = fs.readFileSync(actaPath);
      } else {
        const rutaCompleta = path.join(documento.rutaCarpetaRadicado, actaPath);
        if (!fs.existsSync(rutaCompleta)) {
          throw new NotFoundException('El archivo del acta de supervisión no existe');
        }
        actaBuffer = fs.readFileSync(rutaCompleta);
      }

      const signedPdfBuffer = await this.supervisorSignatureService.aplicarFirmaEnActa(
        actaBuffer,
        signatureId,
        position
      );

      const fechaFirma = new Date();
      const firmasDir = path.join(documento.rutaCarpetaRadicado, 'firmas');

      if (!fs.existsSync(firmasDir)) {
        fs.mkdirSync(firmasDir, { recursive: true });
      }

      const nombreActaFirmada = `acta_firmada_${documento.numeroRadicado}_${fechaFirma.getTime()}.pdf`;
      const rutaRelativaFirmada = path.join('firmas', nombreActaFirmada).replace(/\\/g, '/');
      const rutaAbsolutaFirmada = path.join(firmasDir, nombreActaFirmada);


      fs.writeFileSync(rutaAbsolutaFirmada, signedPdfBuffer);

      // Actualizar DOCUMENTOS
      documento.actaFirmadaPath = rutaRelativaFirmada;
      documento.actaFirmadaNombre = nombreActaFirmada;
      documento.actaFirmadaFecha = fechaFirma;
      documento.actaFirmadaPor = supervisorId;
      documento.estado = 'APROBADO';
      documento.fechaActualizacion = new Date();

      // Actualizar SUPERVISOR_DOCUMENTOS
      let supervisorDoc = await queryRunner.manager.findOne(SupervisorDocumento, {
        where: {
          documento: { id: documentoId },
          supervisor: { id: supervisorId }
        }
      });

      if (supervisorDoc) {
        supervisorDoc.estado = SupervisorEstado.APROBADO;
        supervisorDoc.actaFirmadaPath = rutaRelativaFirmada;
        supervisorDoc.actaFirmadaNombre = nombreActaFirmada;
        supervisorDoc.fechaFirma = fechaFirma;
        supervisorDoc.fechaAprobacion = fechaFirma;
        supervisorDoc.fechaActualizacion = new Date();
      } else {
        const supervisor = await this.userRepository.findOne({ where: { id: supervisorId } });
        supervisorDoc = queryRunner.manager.create(SupervisorDocumento, {
          documento: documento,
          supervisor: supervisor,
          estado: SupervisorEstado.APROBADO,
          actaFirmadaPath: rutaRelativaFirmada,
          actaFirmadaNombre: nombreActaFirmada,
          fechaFirma: fechaFirma,
          fechaAprobacion: fechaFirma,
          fechaCreacion: new Date(),
          fechaActualizacion: new Date()
        });
      }
      

      const historial = documento.historialEstados || [];
      historial.push({
        fecha: new Date(),
        estado: 'APROBADO',
        usuarioId: supervisorId,
        usuarioNombre: 'Supervisor',
        rolUsuario: 'supervisor',
        observacion: `Acta firmada digitalmente. Archivo: ${nombreActaFirmada}`
      });
      documento.historialEstados = historial;

      await queryRunner.manager.save(documento);
      await queryRunner.manager.save(supervisorDoc);
      await queryRunner.commitTransaction();

      this.logger.log(`✅ Acta firmada exitosamente para ${documento.numeroRadicado}`);
      this.logger.log(`   Ruta guardada en documentos: ${documento.actaFirmadaPath}`);

      return {
        success: true,
        message: 'Acta firmada exitosamente',
        data: {
          documentoId: documento.id,
          numeroRadicado: documento.numeroRadicado,
          actaFirmadaPath: documento.actaFirmadaPath,
          actaFirmadaNombre: documento.actaFirmadaNombre,
          fechaFirma: documento.actaFirmadaFecha,
          estado: documento.estado
        }
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`❌ Error firmando acta: ${error.message}`);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private mapearDocumentoParaRespuesta(documento: Documento, supervisorDoc?: SupervisorDocumento): any {
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
      observacion: documento.observacion,
      usuarioAsignadoNombre: documento.usuarioAsignadoNombre,
      tieneActa: !!documento.actaSupervisionPath,
      actaNombre: documento.actaSupervisionNombre,
      asignacion: supervisorDoc ? {
        id: supervisorDoc.id,
        estado: supervisorDoc.estado,
        fechaInicioRevision: supervisorDoc.fechaInicioRevision,
        actaFirmadaPath: supervisorDoc.actaFirmadaPath,
        actaFirmadaNombre: supervisorDoc.actaFirmadaNombre,
        fechaFirma: supervisorDoc.fechaFirma,
        supervisor: {
          id: supervisorDoc.supervisor.id,
          nombre: supervisorDoc.supervisor.fullName,
          username: supervisorDoc.supervisor.username
        }
      } : null
    };
  }


  private construirRespuestaDetalle(documento: Documento, supervisorDoc: any, supervisor: User): any {
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
        observacion: documento.observacion,
        estadoActual: supervisorDoc?.estado || 'DISPONIBLE',
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
        descripcionInformeActividades: documento.descripcionInformeActividades,
        tieneActaOriginal: !!documento.actaSupervisionPath,
        actaOriginalNombre: documento.actaSupervisionNombre,
        actaOriginalSubidaPor: documento.actaSupervisionSubidaPor,
        actaOriginalFecha: documento.actaSupervisionFecha
      },
      supervisor: supervisorDoc ? {
        id: supervisorDoc.id,
        estado: supervisorDoc.estado,
        observacion: supervisorDoc.observacion,
        correcciones: supervisorDoc.correcciones,
        fechaCreacion: supervisorDoc.fechaCreacion,
        fechaInicioRevision: supervisorDoc.fechaInicioRevision,
        nombreArchivoSupervisor: supervisorDoc.nombreArchivoSupervisor,
        pazSalvo: supervisorDoc.pazSalvo,
        actaFirmadaPath: supervisorDoc.actaFirmadaPath,
        actaFirmadaNombre: supervisorDoc.actaFirmadaNombre,
        fechaFirma: supervisorDoc.fechaFirma
      } : null
    };
  }



  // src/supervision/services/supervisor-documentos.service.ts

  async obtenerDocumentoPorId(documentoId: string): Promise<Documento> {
    this.logger.log(`🔍 Buscando documento por ID: ${documentoId}`);

    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId },
      relations: ['radicador', 'usuarioAsignado']
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    return documento;
  }


}