import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
  ForbiddenException,
  Inject,
  forwardRef
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupervisorDocumento, SupervisorEstado } from './entities/supervisor.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { RevisarDocumentoDto } from './dto/revisar-documento.dto';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { RadicacionService } from '../radicacion/radicacion.service';

@Injectable()
export class SupervisorService {
  private readonly logger = new Logger(SupervisorService.name);
  private basePath = '\\\\R2-D2\\api-contract';

  constructor(
    @InjectRepository(SupervisorDocumento)
    private supervisorRepository: Repository<SupervisorDocumento>,

    @InjectRepository(Documento)
    private documentoRepository: Repository<Documento>,

    @InjectRepository(User)
    private userRepository: Repository<User>,

    @Inject(forwardRef(() => RadicacionService))
    private radicacionService: RadicacionService,
  ) {
    this.logger.log('📋 SupervisorService inicializado');
  }

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

      if (documento && documento.rutaCarpetaRadicado) {
        await this.registrarAccesoSupervisor(
          documento.rutaCarpetaRadicado,
          supervisorId,
          `TOMÓ documento para revisión. Estado: RADICADO → EN_REVISION_SUPERVISOR`
        );
      }

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

      if (documento.rutaCarpetaRadicado) {
        await this.registrarAccesoSupervisor(
          documento.rutaCarpetaRadicado,
          supervisorId,
          `LIBERÓ documento. Estado: EN_REVISION_SUPERVISOR → RADICADO`
        );
      }

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
          // ✅ QUITAR: estado: SupervisorEstado.EN_REVISION (permitir todos los estados)
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

      // ✅ MODIFICAR: Permitir acceso en todos los estados para consulta
      // Solo restringir si NO es el supervisor asignado y el documento NO está disponible
      if (supervisorDoc) {
        // Si tiene asignación, permitir acceso sin importar el estado
        return this.construirRespuestaDetalle(documento, supervisorDoc, supervisor);
      } else {
        // Si no tiene asignación, solo permitir acceso si está en estados disponibles
        if (documento.estado !== 'RADICADO' && documento.estado !== 'EN_REVISION_SUPERVISOR') {
          throw new BadRequestException('Solo puedes acceder a documentos en estado RADICADO o EN_REVISION_SUPERVISOR');
        }
        return this.construirRespuestaDetalle(documento, null, supervisor);
      }

    } catch (error) {
      this.logger.error(`❌ Error obteniendo detalle: ${error.message}`);
      if (error instanceof ForbiddenException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al obtener detalle del documento');
    }
  }

  /**
   * Helper para construir respuesta de detalle
   */
  private construirRespuestaDetalle(documento: Documento, supervisorDoc: any, supervisor: User): any {
    const archivos = [
      {
        nombre: documento.cuentaCobro,
        descripcion: documento.descripcionCuentaCobro,
        ruta: path.join(documento.rutaCarpetaRadicado, documento.cuentaCobro),
        existe: fs.existsSync(path.join(documento.rutaCarpetaRadicado, documento.cuentaCobro))
      },
      {
        nombre: documento.seguridadSocial,
        descripcion: documento.descripcionSeguridadSocial,
        ruta: path.join(documento.rutaCarpetaRadicado, documento.seguridadSocial),
        existe: fs.existsSync(path.join(documento.rutaCarpetaRadicado, documento.seguridadSocial))
      },
      {
        nombre: documento.informeActividades,
        descripcion: documento.descripcionInformeActividades,
        ruta: path.join(documento.rutaCarpetaRadicado, documento.informeActividades),
        existe: fs.existsSync(path.join(documento.rutaCarpetaRadicado, documento.informeActividades))
      }
    ];

    documento.ultimoAcceso = new Date();
    documento.ultimoUsuario = `Supervisor: ${supervisor.username}`;
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
      archivosRadicados: archivos,
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


  async corregirDatosInconsistentes(): Promise<{ corregidos: number; total: number }> {
    try {
      this.logger.log('🔄 Iniciando corrección de datos inconsistentes...');

      // 1. Encontrar supervisiones con paz y salvo pero radicado sin marcar como último
      const supervisionesConPazSalvo = await this.supervisorRepository
        .createQueryBuilder('supervisor')
        .leftJoinAndSelect('supervisor.documento', 'documento')
        .where('supervisor.paz_salvo IS NOT NULL')
        .andWhere('supervisor.paz_salvo != :empty', { empty: '' })
        .andWhere('(documento.esUltimoRadicado = :false OR documento.esUltimoRadicado IS NULL)', { false: false })
        .getMany();

      this.logger.log(`📊 Encontradas ${supervisionesConPazSalvo.length} supervisiones con paz y salvo pero sin marcar como último radicado`);

      let documentosCorregidos = 0;

      // 2. Actualizar cada documento
      for (const supervisorDoc of supervisionesConPazSalvo) {
        try {
          const documento = supervisorDoc.documento;

          if (documento) {
            documento.esUltimoRadicado = true;
            documento.fechaActualizacion = new Date();
            documento.ultimoUsuario = `Sistema: corrección automática`;

            await this.documentoRepository.save(documento);
            documentosCorregidos++;

            this.logger.log(`✅ Documento ${documento.numeroRadicado} marcado como último radicado (tiene paz y salvo)`);
          }
        } catch (error) {
          this.logger.error(`❌ Error corrigiendo documento ${supervisorDoc.documento?.numeroRadicado}: ${error.message}`);
        }
      }

      this.logger.log(`✅ Corrección completada: ${documentosCorregidos} documentos corregidos`);

      return {
        corregidos: documentosCorregidos,
        total: supervisionesConPazSalvo.length
      };

    } catch (error) {
      this.logger.error(`❌ Error en corrección de datos: ${error.message}`);
      throw new InternalServerErrorException('Error al corregir datos inconsistentes');
    }
  }

  // ✅ MODIFICAR EL MÉTODO revisarDocumento para asegurar consistencia
  async revisarDocumento(
    documentoId: string,
    supervisorId: string,
    revisarDto: RevisarDocumentoDto,
    archivoSupervisor?: Express.Multer.File,
    pazSalvoArchivo?: Express.Multer.File
  ): Promise<{ supervisor: SupervisorDocumento; documento: Documento }> {
    this.logger.log(`🔍 Supervisor ${supervisorId} revisando documento ${documentoId} - Estado: ${revisarDto.estado}`);

    // ✅ LOG ADICIONAL: Verificar datos recibidos
    this.logger.log(`📝 DTO recibido:`, JSON.stringify(revisarDto));
    this.logger.log(`📝 ¿Tiene archivo supervisor?: ${!!archivoSupervisor}`);
    this.logger.log(`📝 ¿Tiene pazSalvo archivo?: ${!!pazSalvoArchivo}`);
    this.logger.log(`📝 Requiere paz y salvo?: ${revisarDto.requierePazSalvo}`);
    this.logger.log(`📝 Es último radicado?: ${revisarDto.esUltimoRadicado}`);

    // ✅ VALIDACIÓN MEJORADA: Si se sube paz y salvo, forzar que sea último radicado
    if (pazSalvoArchivo && !revisarDto.esUltimoRadicado) {
      this.logger.warn('⚠️ Se subió archivo de paz y salvo pero no está marcado como último radicado. Forzando...');
      revisarDto.esUltimoRadicado = true;
    }

    // ✅ VALIDACIÓN MEJORADA: Si es último radicado y aprobado, requiere paz y salvo
    if (revisarDto.estado === SupervisorEstado.APROBADO &&
      revisarDto.esUltimoRadicado &&
      !pazSalvoArchivo) {
      throw new BadRequestException('Para marcar como último radicado APROBADO debe adjuntar el archivo de paz y salvo');
    }

    const supervisorDoc = await this.supervisorRepository.findOne({
      where: {
        documento: { id: documentoId },
        supervisor: { id: supervisorId },
        estado: SupervisorEstado.EN_REVISION
      },
      relations: ['documento', 'supervisor']
    });

    if (!supervisorDoc) {
      throw new ForbiddenException('No tienes este documento en revisión');
    }

    const documento = supervisorDoc.documento;

    // ✅ ACTUALIZAR EL DOCUMENTO PRINCIPAL CON ES_ULTIMO_RADICADO
    documento.esUltimoRadicado = revisarDto.esUltimoRadicado || false;

    // Resto del código permanece igual...
    if ((revisarDto.estado === SupervisorEstado.OBSERVADO ||
      revisarDto.estado === SupervisorEstado.RECHAZADO) &&
      (!revisarDto.observacion || revisarDto.observacion.trim() === '')) {
      throw new BadRequestException('Se requiere una observación para este estado');
    }

    // Guardar archivo de aprobación si existe
    if (archivoSupervisor && revisarDto.estado === SupervisorEstado.APROBADO) {
      const nombreArchivo = await this.guardarArchivoSupervisor(documento, archivoSupervisor, 'aprobacion');
      supervisorDoc.nombreArchivoSupervisor = nombreArchivo;
    }

    // Guardar archivo de paz y salvo si existe
    if (pazSalvoArchivo && revisarDto.estado === SupervisorEstado.APROBADO && revisarDto.esUltimoRadicado) {
      const nombrePazSalvo = await this.guardarArchivoSupervisor(documento, pazSalvoArchivo, 'paz_salvo');
      supervisorDoc.pazSalvo = nombrePazSalvo;
    }

    const estadoAnterior = supervisorDoc.estado;
    supervisorDoc.estado = revisarDto.estado;
    supervisorDoc.observacion = revisarDto.observacion?.trim() || '';
    supervisorDoc.fechaActualizacion = new Date();
    supervisorDoc.fechaFinRevision = new Date();

    if (revisarDto.estado === SupervisorEstado.APROBADO) {
      supervisorDoc.fechaAprobacion = new Date();
    }

    documento.ultimoAcceso = new Date();
    documento.ultimoUsuario = `Supervisor: ${supervisorDoc.supervisor.fullName || supervisorDoc.supervisor.username}`;
    documento.fechaActualizacion = new Date();

    switch (revisarDto.estado) {
      case SupervisorEstado.APROBADO:
        documento.estado = 'APROBADO_SUPERVISOR';
        documento.comentarios = revisarDto.observacion || 'Aprobado por supervisor';
        break;

      case SupervisorEstado.OBSERVADO:
        documento.estado = 'OBSERVADO_SUPERVISOR';
        documento.comentarios = revisarDto.observacion || 'Observado por supervisor';
        documento.correcciones = revisarDto.correcciones?.trim() || '';
        break;

      case SupervisorEstado.RECHAZADO:
        documento.estado = 'RECHAZADO_SUPERVISOR';
        documento.comentarios = revisarDto.observacion || 'Rechazado por supervisor';
        break;
    }

    this.agregarAlHistorial(documento, supervisorDoc.supervisor, estadoAnterior, revisarDto.estado, revisarDto.observacion);

    await this.registrarAccesoSupervisor(
      documento.rutaCarpetaRadicado,
      supervisorId,
      `REVISIÓN: ${estadoAnterior} → ${revisarDto.estado} - ${revisarDto.observacion?.substring(0, 50) || 'Sin observación'}`
    );

    await this.documentoRepository.save(documento);
    const savedSupervisorDoc = await this.supervisorRepository.save(supervisorDoc);

    this.logger.log(`✅ Documento ${documento.numeroRadicado} revisado por supervisor. Estado: ${revisarDto.estado}, Último radicado: ${revisarDto.esUltimoRadicado}`);

    return {
      supervisor: savedSupervisorDoc,
      documento
    };
  }

  /**
   * GUARDAR ARCHIVO DEL SUPERVISOR (MODIFICADO PARA PAZ Y SALVO)
   */
  private async guardarArchivoSupervisor(
    documento: Documento,
    archivo: Express.Multer.File,
    tipo: 'aprobacion' | 'paz_salvo' = 'aprobacion'
  ): Promise<string> {
    try {
      const maxSize = 10 * 1024 * 1024;
      if (archivo.size > maxSize) {
        throw new BadRequestException('El archivo excede el tamaño máximo de 10MB');
      }

      const allowedMimes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/png'
      ];

      if (!allowedMimes.includes(archivo.mimetype)) {
        throw new BadRequestException('Tipo de archivo no permitido');
      }

      const rutaSupervisor = path.join(documento.rutaCarpetaRadicado, 'supervisor');
      if (!fs.existsSync(rutaSupervisor)) {
        fs.mkdirSync(rutaSupervisor, { recursive: true });
      }

      const extension = path.extname(archivo.originalname);
      const nombreBase = tipo === 'paz_salvo'
        ? `paz_salvo_${documento.numeroRadicado}`
        : `aprobacion_supervisor_${documento.numeroRadicado}`;
      const timestamp = Date.now();
      const hash = crypto.randomBytes(4).toString('hex');
      const nombreArchivo = `${nombreBase}_${timestamp}_${hash}${extension}`;
      const rutaCompleta = path.join(rutaSupervisor, nombreArchivo);

      fs.writeFileSync(rutaCompleta, archivo.buffer);

      const metadatos = {
        nombreOriginal: archivo.originalname,
        nombreGuardado: nombreArchivo,
        mimeType: archivo.mimetype,
        tamanio: archivo.size,
        fechaSubida: new Date().toISOString(),
        descripcion: tipo === 'paz_salvo' ? 'Paz y salvo del supervisor' : 'Aprobación del supervisor',
        tipo: tipo
      };

      fs.writeFileSync(
        path.join(rutaSupervisor, `${nombreBase}_${timestamp}_${hash}_meta.json`),
        JSON.stringify(metadatos, null, 2)
      );

      this.logger.log(`💾 Archivo de ${tipo} guardado: ${rutaCompleta} (${archivo.size} bytes)`);

      return nombreArchivo;
    } catch (error) {
      this.logger.error(`❌ Error guardando archivo de ${tipo}: ${error.message}`);
      throw new BadRequestException(`Error al guardar archivo: ${error.message}`);
    }
  }

  /**
   * NUEVO: OBTENER ARCHIVO DE PAZ Y SALVO
   */
  async obtenerArchivoPazSalvo(
    supervisorId: string,
    nombreArchivo: string
  ): Promise<{ ruta: string; nombre: string }> {
    const supervisorDoc = await this.supervisorRepository.findOne({
      where: {
        supervisor: { id: supervisorId },
        pazSalvo: nombreArchivo
      },
      relations: ['documento']
    });

    if (!supervisorDoc) {
      throw new NotFoundException('Archivo de paz y salvo no encontrado');
    }

    const documento = supervisorDoc.documento;
    const rutaSupervisor = path.join(documento.rutaCarpetaRadicado, 'supervisor');
    const rutaCompleta = path.join(rutaSupervisor, nombreArchivo);

    if (!fs.existsSync(rutaCompleta)) {
      throw new NotFoundException('El archivo de paz y salvo no existe en el servidor');
    }

    return {
      ruta: rutaCompleta,
      nombre: nombreArchivo
    };
  }

  /**
   * REGISTRAR ACCESO DEL SUPERVISOR
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

  /**
   * AGREGAR AL HISTORIAL
   */
  private agregarAlHistorial(
    documento: Documento,
    supervisor: User,
    estadoAnterior: string,
    estadoNuevo: string,
    observacion?: string
  ): void {
    const historial = documento.historialEstados || [];

    historial.push({
      fecha: new Date(),
      estado: estadoNuevo,
      usuarioId: supervisor.id,
      usuarioNombre: supervisor.fullName || supervisor.username,
      rolUsuario: supervisor.role,
      observacion: observacion || `Supervisor: ${estadoAnterior} → ${estadoNuevo}`,
    });

    documento.historialEstados = historial;
  }

  /**
   * OBTENER HISTORIAL DE REVISIONES DEL SUPERVISOR
   */
  async obtenerHistorialSupervisor(supervisorId: string): Promise<any[]> {
    const supervisorDocs = await this.supervisorRepository.find({
      where: { supervisor: { id: supervisorId } },
      relations: ['documento', 'documento.radicador'],
      order: { fechaActualizacion: 'DESC' },
      take: 50
    });

    return supervisorDocs.map(sd => ({
      id: sd.id,
      documento: {
        id: sd.documento.id,
        numeroRadicado: sd.documento.numeroRadicado,
        nombreContratista: sd.documento.nombreContratista,
        documentoContratista: sd.documento.documentoContratista,
        numeroContrato: sd.documento.numeroContrato,
        fechaInicio: sd.documento.fechaInicio,
        fechaFin: sd.documento.fechaFin,
        fechaRadicacion: sd.documento.fechaRadicacion,
        estado: sd.documento.estado,
        cuentaCobro: sd.documento.cuentaCobro,
        seguridadSocial: sd.documento.seguridadSocial,
        informeActividades: sd.documento.informeActividades,
        observacion: sd.documento.observacion,
        nombreRadicador: sd.documento.nombreRadicador
      },
      supervisorRevisor: sd.supervisor?.fullName || sd.supervisor?.username,
      estado: sd.estado,
      observacion: sd.observacion,
      fechaCreacion: sd.fechaCreacion,
      fechaActualizacion: sd.fechaActualizacion,
      fechaAprobacion: sd.fechaAprobacion,
      tieneArchivo: !!sd.nombreArchivoSupervisor,
      nombreArchivoSupervisor: sd.nombreArchivoSupervisor,
      tienePazSalvo: !!sd.pazSalvo,
      pazSalvo: sd.pazSalvo
    }));
  }

  /**
   * OBTENER ESTADÍSTICAS DEL SUPERVISOR
   */
  async obtenerEstadisticasSupervisor(supervisorId: string): Promise<any> {
    try {
      this.logger.log(`📊 Obteniendo estadísticas para supervisor: ${supervisorId}`);

      const totalDocumentosRadicados = await this.documentoRepository.count({
        where: { estado: 'RADICADO' }
      });

      const [enRevision, aprobados, observados, rechazados] = await Promise.all([
        this.supervisorRepository
          .createQueryBuilder('supervisor')
          .leftJoin('supervisor.supervisor', 'usuario')
          .where('usuario.id = :supervisorId', { supervisorId })
          .andWhere('supervisor.estado = :estado', { estado: SupervisorEstado.EN_REVISION })
          .getCount(),

        this.supervisorRepository
          .createQueryBuilder('supervisor')
          .leftJoin('supervisor.supervisor', 'usuario')
          .where('usuario.id = :supervisorId', { supervisorId })
          .andWhere('supervisor.estado = :estado', { estado: SupervisorEstado.APROBADO })
          .getCount(),

        this.supervisorRepository
          .createQueryBuilder('supervisor')
          .leftJoin('supervisor.supervisor', 'usuario')
          .where('usuario.id = :supervisorId', { supervisorId })
          .andWhere('supervisor.estado = :estado', { estado: SupervisorEstado.OBSERVADO })
          .getCount(),

        this.supervisorRepository
          .createQueryBuilder('supervisor')
          .leftJoin('supervisor.supervisor', 'usuario')
          .where('usuario.id = :supervisorId', { supervisorId })
          .andWhere('supervisor.estado = :estado', { estado: SupervisorEstado.RECHAZADO })
          .getCount()
      ]);

      const fechaLimite = new Date();
      fechaLimite.setDate(fechaLimite.getDate() - 7);

      const recientes = await this.supervisorRepository
        .createQueryBuilder('supervisor')
        .leftJoin('supervisor.supervisor', 'usuario')
        .where('usuario.id = :supervisorId', { supervisorId })
        .andWhere('supervisor.fechaCreacion >= :fechaLimite', { fechaLimite })
        .getCount();

      const aprobadosCompletos = await this.supervisorRepository
        .createQueryBuilder('supervisor')
        .leftJoin('supervisor.supervisor', 'usuario')
        .where('usuario.id = :supervisorId', { supervisorId })
        .andWhere('supervisor.estado = :estado', { estado: SupervisorEstado.APROBADO })
        .andWhere('supervisor.fechaCreacion IS NOT NULL')
        .andWhere('supervisor.fechaAprobacion IS NOT NULL')
        .select(['supervisor.fechaCreacion', 'supervisor.fechaAprobacion'])
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

      const totalProcesados = aprobados + observados + rechazados;
      const eficiencia = totalProcesados > 0 ?
        Math.round((aprobados / totalProcesados) * 100) : 0;

      const estadisticas = {
        totalDocumentosRadicados: totalDocumentosRadicados,
        enRevision: enRevision,
        aprobados: aprobados,
        observados: observados,
        rechazados: rechazados,
        recientes: recientes,
        tiempoPromedioHoras: tiempoPromedioHoras,
        eficiencia: eficiencia,
        totales: {
          enRevision: enRevision,
          aprobados: aprobados,
          observados: observados,
          rechazados: rechazados,
          total: enRevision + aprobados + observados + rechazados
        },
        fechaConsulta: new Date().toISOString()
      };

      this.logger.log(`✅ Estadísticas calculadas para supervisor ${supervisorId}`);

      return estadisticas;

    } catch (error) {
      this.logger.error(`❌ Error calculando estadísticas: ${error.message}`);
      throw new InternalServerErrorException(`Error al obtener estadísticas: ${error.message}`);
    }
  }

  /**
   * DEVOLVER DOCUMENTO AL RADICADOR (para correcciones)
   */
  async devolverDocumento(
    documentoId: string,
    supervisorId: string,
    motivo: string,
    instrucciones: string
  ): Promise<{ supervisor: SupervisorDocumento; documento: Documento }> {
    this.logger.log(`↩️ Supervisor ${supervisorId} devolviendo documento ${documentoId}`);

    const supervisorDoc = await this.supervisorRepository.findOne({
      where: {
        documento: { id: documentoId },
        supervisor: { id: supervisorId },
        estado: SupervisorEstado.EN_REVISION
      },
      relations: ['documento', 'supervisor']
    });

    if (!supervisorDoc) {
      throw new ForbiddenException('No tienes este documento en revisión');
    }

    const documento = supervisorDoc.documento;

    supervisorDoc.estado = SupervisorEstado.OBSERVADO;
    supervisorDoc.observacion = `DEVUELTO: ${motivo}. Instrucciones: ${instrucciones}`;
    supervisorDoc.fechaActualizacion = new Date();
    supervisorDoc.fechaFinRevision = new Date();

    documento.estado = 'DEVUELTO_SUPERVISOR';
    documento.ultimoAcceso = new Date();
    documento.ultimoUsuario = `Supervisor: ${supervisorDoc.supervisor.fullName || supervisorDoc.supervisor.username}`;
    documento.comentarios = motivo;
    documento.correcciones = instrucciones;
    documento.fechaActualizacion = new Date();

    this.agregarAlHistorial(
      documento,
      supervisorDoc.supervisor,
      'EN_REVISION',
      'DEVUELTO_SUPERVISOR',
      `Devuelto por supervisor: ${motivo}`
    );

    await this.documentoRepository.save(documento);
    const savedSupervisorDoc = await this.supervisorRepository.save(supervisorDoc);

    await this.registrarAccesoSupervisor(
      documento.rutaCarpetaRadicado,
      supervisorId,
      `DEVOLVIÓ documento: ${motivo}`
    );

    this.logger.log(`✅ Documento ${documento.numeroRadicado} devuelto al radicador por supervisor`);

    return {
      supervisor: savedSupervisorDoc,
      documento
    };
  }

  /**
   * OBTENER ARCHIVO DEL SUPERVISOR
   */
  async obtenerArchivoSupervisor(
    supervisorId: string,
    nombreArchivo: string
  ): Promise<{ ruta: string; nombre: string }> {
    const supervisorDoc = await this.supervisorRepository.findOne({
      where: {
        supervisor: { id: supervisorId },
        nombreArchivoSupervisor: nombreArchivo
      },
      relations: ['documento']
    });

    if (!supervisorDoc) {
      throw new NotFoundException('Archivo de supervisor no encontrado');
    }

    const documento = supervisorDoc.documento;
    const rutaSupervisor = path.join(documento.rutaCarpetaRadicado, 'supervisor');
    const rutaCompleta = path.join(rutaSupervisor, nombreArchivo);

    if (!fs.existsSync(rutaCompleta)) {
      throw new NotFoundException('El archivo del supervisor no existe en el servidor');
    }

    return {
      ruta: rutaCompleta,
      nombre: nombreArchivo
    };
  }

  /**
   * ✅ OBTENER CONTEO DE DOCUMENTOS RADICADOS
   */
  async obtenerConteoDocumentosRadicados(): Promise<number> {
    return await this.documentoRepository.count({
      where: { estado: 'RADICADO' }
    });
  }


}