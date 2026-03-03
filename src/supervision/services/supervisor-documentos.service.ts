import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupervisorDocumento, SupervisorEstado } from '../entities/supervisor.entity';
import { Documento } from '../../radicacion/entities/documento.entity';
import { User } from '../../users/entities/user.entity';
import { UserRole } from '../../users/enums/user-role.enum';

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
  ) { }

  /**
   * ✅ OBTENER DOCUMENTOS DISPONIBLES PARA REVISIÓN
   */
  async obtenerDocumentosDisponibles(supervisorId: string): Promise<any[]> {
    this.logger.log(`📋 Supervisor ${supervisorId} solicitando documentos disponibles`);

    try {
      const documentos = await this.documentoRepository
        .createQueryBuilder('documento')
        .leftJoinAndSelect('documento.radicador', 'radicador')
        .leftJoinAndSelect('documento.usuarioAsignado', 'usuarioAsignado')
        .where("documento.estado = :estado", { estado: 'RADICADO' })
        .orderBy('documento.fechaRadicacion', 'ASC')
        .getMany();

      this.logger.log(`✅ Encontrados ${documentos.length} documentos en estado RADICADO`);

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
          asignacion: {
            enRevision: estaRevisandoYo,
            puedoTomar: !estaRevisandoYo && documento.estado === 'RADICADO',
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

  /**
   * ✅ TOMAR DOCUMENTO PARA REVISIÓN
   */
  async tomarDocumentoParaRevision(documentoId: string, supervisorId: string): Promise<{ success: boolean; message: string; documento: any }> {
    this.logger.log(`🤝 Supervisor ${supervisorId} tomando documento ${documentoId} para revisión`);

    try {
      const documento = await this.documentoRepository.findOne({
        where: { id: documentoId, estado: 'RADICADO' },
        relations: ['radicador', 'usuarioAsignado']
      });

      if (!documento) {
        throw new NotFoundException('Documento no encontrado o no está disponible para revisión (debe estar en estado RADICADO)');
      }

      const supervisor = await this.userRepository.findOne({
        where: { id: supervisorId }
      });

      if (!supervisor) {
        throw new NotFoundException('Supervisor no encontrado');
      }

      if (documento.usuarioAsignado && documento.usuarioAsignado.id !== supervisorId) {
        throw new BadRequestException(`Este documento ya está asignado a ${documento.usuarioAsignadoNombre}`);
      }

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
        observacion: `Documento tomado para revisión por supervisor ${supervisor.username}`
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
        supervisorDoc.fechaInicioRevision = new Date();
        supervisorDoc.observacion = 'Documento tomado para revisión';
      } else {
        supervisorDoc = this.supervisorRepository.create({
          documento: documento,
          supervisor: supervisor,
          estado: SupervisorEstado.EN_REVISION,
          fechaCreacion: new Date(),
          fechaActualizacion: new Date(),
          fechaInicioRevision: new Date(),
          observacion: 'Documento tomado para revisión'
        });
      }

      await this.supervisorRepository.save(supervisorDoc);

      this.logger.log(`✅ Documento ${documento.numeroRadicado} tomado para revisión por ${supervisor.username}. Estado actualizado a EN_REVISION_SUPERVISOR`);

      return {
        success: true,
        message: `Documento ${documento.numeroRadicado} tomado para revisión`,
        documento: this.mapearDocumentoParaRespuesta(documento, supervisorDoc)
      };

    } catch (error) {
      this.logger.error(`❌ Error tomando documento: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * ✅ OBTENER DOCUMENTOS QUE ESTOY REVISANDO
   */
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

  /**
   * ✅ LIBERAR DOCUMENTO
   */
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

      documento.estado = 'RADICADO';
      documento.fechaActualizacion = new Date();
      documento.ultimoAcceso = new Date();
      documento.ultimoUsuario = `Supervisor: liberado`;
      documento.usuarioAsignado = null;
      documento.usuarioAsignadoNombre = '';

      const historial = documento.historialEstados || [];
      historial.push({
        fecha: new Date(),
        estado: 'RADICADO',
        usuarioId: supervisorId,
        usuarioNombre: 'Sistema',
        rolUsuario: 'SUPERVISOR',
        observacion: 'Documento liberado por supervisor - Volvió a estado RADICADO'
      });
      documento.historialEstados = historial;

      await this.documentoRepository.save(documento);

      supervisorDoc.estado = SupervisorEstado.DISPONIBLE;
      supervisorDoc.fechaActualizacion = new Date();
      supervisorDoc.fechaFinRevision = new Date();
      supervisorDoc.observacion = 'Documento liberado - Disponible para otros supervisores';

      await this.supervisorRepository.save(supervisorDoc);

      this.logger.log(`✅ Documento ${documento.numeroRadicado} liberado por ${supervisorId}. Estado revertido a RADICADO`);

      return {
        success: true,
        message: 'Documento liberado correctamente y disponible para otros supervisores'
      };

    } catch (error) {
      this.logger.error(`❌ Error liberando documento: ${error.message}`);
      throw error;
    }
  }

  /**
   * ✅ OBTENER DETALLE DE DOCUMENTO PARA REVISIÓN
   */
  async obtenerDetalleDocumento(documentoId: string, supervisorId: string): Promise<any> {
    this.logger.log(`🔍 Supervisor ${supervisorId} solicitando detalle de documento ${documentoId}`);

    try {
      const supervisor = await this.userRepository.findOne({
        where: { id: supervisorId }
      });

      if (!supervisor) {
        throw new NotFoundException('Supervisor no encontrado');
      }

      const supervisorDoc = await this.supervisorRepository.findOne({
        where: {
          documento: { id: documentoId },
          supervisor: { id: supervisorId }
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

      if (supervisorDoc) {
        return this.construirRespuestaDetalle(documento, supervisorDoc, supervisor);
      } else {
        if (documento.estado !== 'RADICADO' && documento.estado !== 'EN_REVISION_SUPERVISOR') {
          throw new BadRequestException('Solo puedes acceder a documentos en estado RADICADO o EN_REVISION_SUPERVISOR');
        }
        return this.construirRespuestaDetalle(documento, null, supervisor);
      }

    } catch (error) {
      this.logger.error(`❌ Error obteniendo detalle: ${error.message}`);
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al obtener detalle del documento');
    }
  }

  /**
   * ✅ ASIGNAR DOCUMENTO A SUPERVISORES AUTOMÁTICAMENTE
   */
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

      if (documento.estado !== 'RADICADO') {
        this.logger.warn(`⚠️ Documento ${documentoId} no está en estado RADICADO, estado actual: ${documento.estado}`);
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

  /**
   * ✅ WEBHOOK para cambio de estado
   */
  async onDocumentoCambiaEstado(documentoId: string, nuevoEstado: string): Promise<void> {
    this.logger.log(`🔄 Webhook: Documento ${documentoId} cambió a estado ${nuevoEstado}`);

    try {
      if (nuevoEstado === 'RADICADO') {
        await this.asignarDocumentoASupervisoresAutomaticamente(documentoId);
      }
    } catch (error) {
      this.logger.error(`❌ Error procesando webhook de estado: ${error.message}`);
    }
  }

  /**
   * ✅ ASIGNAR TODOS LOS DOCUMENTOS RADICADOS A SUPERVISORES
   */
  async asignarTodosDocumentosASupervisores(): Promise<{ asignados: number; total: number }> {
    try {
      this.logger.log('🔄 Asignando TODOS los documentos RADICADOS a supervisores...');

      const documentosRadicados = await this.documentoRepository.find({
        where: { estado: 'RADICADO' }
      });

      if (documentosRadicados.length === 0) {
        this.logger.log('✅ No hay documentos RADICADOS para asignar');
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
        return { asignados: 0, total: documentosRadicados.length };
      }

      let documentosAsignados = 0;

      for (const documento of documentosRadicados) {
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

      this.logger.log(`✅ ${documentosAsignados} documentos disponibles de ${documentosRadicados.length} totales`);
      return {
        asignados: documentosAsignados,
        total: documentosRadicados.length
      };

    } catch (error) {
      this.logger.error(`❌ Error asignando todos los documentos: ${error.message}`);
      throw new InternalServerErrorException('Error al asignar documentos a supervisores');
    }
  }

  /**
   * ✅ OBTENER CONTEO DE DOCUMENTOS RADICADOS
   */
  async obtenerConteoDocumentosRadicados(): Promise<number> {
    return await this.documentoRepository.count({
      where: { estado: 'RADICADO' }
    });
  }

  /**
   * ✅ MÉTODO AUXILIAR: Mapear documento para respuesta
   */
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
      asignacion: supervisorDoc ? {
        id: supervisorDoc.id,
        estado: supervisorDoc.estado,
        fechaInicioRevision: supervisorDoc.fechaInicioRevision,
        supervisor: {
          id: supervisorDoc.supervisor.id,
          nombre: supervisorDoc.supervisor.fullName,
          username: supervisorDoc.supervisor.username
        }
      } : null
    };
  }

  /**
   * Helper para construir respuesta de detalle
   */
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
        descripcionInformeActividades: documento.descripcionInformeActividades
      },
      supervisor: supervisorDoc ? {
        id: supervisorDoc.id,
        estado: supervisorDoc.estado,
        observacion: supervisorDoc.observacion,
        fechaCreacion: supervisorDoc.fechaCreacion,
        fechaInicioRevision: supervisorDoc.fechaInicioRevision,
        nombreArchivoSupervisor: supervisorDoc.nombreArchivoSupervisor,
        pazSalvo: supervisorDoc.pazSalvo
      } : null
    };
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
        informeActividades: sd.documento.informeActividades
      }));
    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos revisados: ${error.message}`);
      throw error;
    }

  }

  // En supervisor-documentos.service.ts (Backend)
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
          // Estado del documento principal
          estado: documento.estado,
          // Estado en supervisor_documentos
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

}