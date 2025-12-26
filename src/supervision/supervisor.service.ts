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
import { Repository, In, Not, IsNull } from 'typeorm';
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
   * ✅ OBTENER DOCUMENTOS DISPONIBLES PARA REVISIÓN - SIN CONTRATISTA
   */
  async obtenerDocumentosDisponibles(supervisorId: string): Promise<any[]> {
    this.logger.log(`📋 Supervisor ${supervisorId} solicitando documentos disponibles`);

    try {
      // 1. Verificar y obtener ID real del usuario
      let userId = supervisorId;
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supervisorId);

      if (!isUUID) {
        const supervisor = await this.userRepository.findOne({
          where: { username: supervisorId }
        });

        if (!supervisor) {
          throw new ForbiddenException('Usuario no autorizado');
        }

        userId = supervisor.id;
      }

      // 2. Buscar documentos usando ILIKE para estado RADICADO
      const documentos = await this.documentoRepository
        .createQueryBuilder('documento')
        .leftJoinAndSelect('documento.radicador', 'radicador')
        .where("documento.estado ILIKE :estado", { estado: '%RADICADO%' })
        .orderBy('documento.fechaRadicacion', 'ASC')
        .getMany();

      this.logger.log(`✅ Encontrados ${documentos.length} documentos con estado que contiene 'RADICADO'`);

      // 3. DEBUG: Verificar qué documentos encontró
      if (documentos.length === 0) {
        const todosDocumentos = await this.documentoRepository.find({
          relations: ['radicador']
        });

        this.logger.log(`🔍 DEBUG - Todos los documentos en BD: ${todosDocumentos.length}`);
        todosDocumentos.forEach((doc, index) => {
          this.logger.log(`   [${index + 1}] ${doc.numeroRadicado} - Estado: "${doc.estado}" (tipo: ${typeof doc.estado}, longitud: ${doc.estado?.length})`);
        });
      } else {
        documentos.forEach((doc, index) => {
          this.logger.log(`   [${index + 1}] ${doc.numeroRadicado} - Estado: "${doc.estado}"`);
        });
      }

      // 4. Mapear respuesta
      const documentosConEstado = documentos.map(documento => {
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
            enRevision: false,
            puedoTomar: true
          }
        };
      });

      return documentosConEstado;

    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos disponibles: ${error.message}`);
      this.logger.error(`❌ Stack: ${error.stack}`);
      throw error;
    }
  }

  /**
   * ✅ TOMAR DOCUMENTO PARA REVISIÓN - SIN CONTRATISTA
   */
  async tomarDocumentoParaRevision(documentoId: string, supervisorId: string): Promise<{ success: boolean; message: string; documento: any }> {
    this.logger.log(`🤝 Supervisor ${supervisorId} tomando documento ${documentoId} para revisión`);

    try {
      // 1. Verificar documento - SIN contratista
      const documento = await this.documentoRepository.findOne({
        where: { id: documentoId, estado: 'RADICADO' },
        relations: ['radicador'] // ✅ SOLO radicador
      });

      if (!documento) {
        throw new NotFoundException('Documento no encontrado o no está disponible para revisión');
      }

      // 2. Verificar supervisor
      const supervisor = await this.userRepository.findOne({
        where: { id: supervisorId }
      });

      if (!supervisor) {
        throw new NotFoundException('Supervisor no encontrado');
      }

      // 3. Verificar si alguien más ya está revisando este documento
      const revisionActiva = await this.supervisorRepository.findOne({
        where: {
          documento: { id: documentoId },
          estado: SupervisorEstado.EN_REVISION
        },
        relations: ['supervisor']
      });

      if (revisionActiva) {
        const estaRevisandoElMismo = revisionActiva.supervisor.id === supervisorId;

        if (!estaRevisandoElMismo) {
          throw new BadRequestException(`Este documento ya está siendo revisado por ${revisionActiva.supervisor.fullName || revisionActiva.supervisor.username}`);
        }

        // Si ya lo está revisando, simplemente confirmar
        return {
          success: true,
          message: 'Ya tienes este documento en revisión',
          documento: this.mapearDocumentoParaRespuesta(documento, revisionActiva)
        };
      }

      // 4. Buscar si ya existe una asignación para este supervisor
      let supervisorDoc = await this.supervisorRepository.findOne({
        where: {
          documento: { id: documentoId },
          supervisor: { id: supervisorId }
        }
      });

      if (supervisorDoc) {
        // Actualizar a EN_REVISION
        supervisorDoc.estado = SupervisorEstado.EN_REVISION;
        supervisorDoc.fechaActualizacion = new Date();
        supervisorDoc.fechaInicioRevision = new Date();
      } else {
        // Crear nueva asignación
        supervisorDoc = this.supervisorRepository.create({
          documento: documento,
          supervisor: supervisor,
          estado: SupervisorEstado.EN_REVISION,
          fechaCreacion: new Date(),
          fechaActualizacion: new Date(),
          fechaInicioRevision: new Date()
        });
      }

      // 5. Guardar
      await this.supervisorRepository.save(supervisorDoc);

      // 6. Actualizar documento
      documento.ultimoAcceso = new Date();
      documento.ultimoUsuario = `Supervisor: ${supervisor.fullName || supervisor.username}`;
      documento.fechaActualizacion = new Date();
      await this.documentoRepository.save(documento);

      this.logger.log(`✅ Documento ${documento.numeroRadicado} tomado para revisión por ${supervisor.username}`);

      return {
        success: true,
        message: `Documento ${documento.numeroRadicado} tomado para revisión`,
        documento: this.mapearDocumentoParaRespuesta(documento, supervisorDoc)
      };

    } catch (error) {
      this.logger.error(`❌ Error tomando documento: ${error.message}`);
      throw error;
    }
  }

  /**
   * ✅ OBTENER DOCUMENTOS QUE ESTOY REVISANDO - SIN CONTRATISTA
   */
  async obtenerDocumentosEnRevision(supervisorId: string): Promise<any[]> {
    this.logger.log(`📋 Supervisor ${supervisorId} solicitando documentos en revisión`);

    try {
      const supervisorDocs = await this.supervisorRepository.find({
        where: {
          supervisor: { id: supervisorId },
          estado: SupervisorEstado.EN_REVISION
        },
        relations: ['documento', 'documento.radicador'], // ✅ SOLO radicador
        order: { fechaInicioRevision: 'DESC' }
      });

      return supervisorDocs.map(sd => this.mapearDocumentoParaRespuesta(sd.documento, sd));

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
      // Buscar asignación activa
      const supervisorDoc = await this.supervisorRepository.findOne({
        where: {
          documento: { id: documentoId },
          supervisor: { id: supervisorId },
          estado: SupervisorEstado.EN_REVISION
        }
      });

      if (!supervisorDoc) {
        throw new NotFoundException('No tienes este documento en revisión');
      }

      // Cambiar estado a DISPONIBLE (no eliminar, para mantener historial)
      supervisorDoc.estado = SupervisorEstado.DISPONIBLE;
      supervisorDoc.fechaActualizacion = new Date();
      supervisorDoc.fechaFinRevision = new Date();

      await this.supervisorRepository.save(supervisorDoc);

      // Actualizar documento
      const documento = await this.documentoRepository.findOne({ where: { id: documentoId } });
      if (documento) {
        documento.ultimoAcceso = new Date();
        documento.ultimoUsuario = `Supervisor: liberado`;
        documento.fechaActualizacion = new Date();
        await this.documentoRepository.save(documento);
      }

      this.logger.log(`✅ Documento liberado por ${supervisorId}`);

      return {
        success: true,
        message: 'Documento liberado correctamente'
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
        relations: ['radicador'] // ✅ SOLO radicador
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
   * ✅ OBTENER DETALLE DE DOCUMENTO PARA REVISIÓN - SIN CONTRATISTA
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

      // Verificar si el documento está en revisión por este supervisor
      const supervisorDoc = await this.supervisorRepository.findOne({
        where: {
          documento: { id: documentoId },
          supervisor: { id: supervisorId },
          estado: SupervisorEstado.EN_REVISION
        },
        relations: ['documento', 'documento.radicador'], // ✅ SOLO radicador
      });

      const documento = await this.documentoRepository.findOne({
        where: { id: documentoId },
        relations: ['radicador'], // ✅ SOLO radicador
      });

      if (!documento) {
        throw new NotFoundException('Documento no encontrado');
      }

      if (documento.estado !== 'RADICADO') {
        throw new BadRequestException('Solo puedes acceder a documentos en estado RADICADO');
      }

      return this.construirRespuestaDetalle(documento, supervisorDoc, supervisor);

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
        fechaInicioRevision: supervisorDoc.fechaInicioRevision
      } : null
    };
  }

  /**
   * DESCARGAR ARCHIVO DEL RADICADOR
   */
  async descargarArchivoRadicado(
    documentoId: string,
    numeroArchivo: number,
    supervisorId: string
  ): Promise<{ ruta: string; nombre: string }> {
    this.logger.log(`📥 Supervisor ${supervisorId} descargando archivo ${numeroArchivo} del documento ${documentoId}`);

    const supervisor = await this.userRepository.findOne({
      where: { id: supervisorId }
    });

    if (!supervisor) {
      throw new NotFoundException('Supervisor no encontrado');
    }

    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId }
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    if (documento.estado !== 'RADICADO') {
      throw new ForbiddenException('Solo puedes acceder a documentos RADICADOS');
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

    this.registrarAccesoSupervisor(
      documento.rutaCarpetaRadicado,
      supervisorId,
      `DESCARGÓ archivo: ${nombreArchivo}`
    );

    return {
      ruta: rutaCompleta,
      nombre: nombreArchivo
    };
  }

  /**
   * REVISAR DOCUMENTO (APROBAR/OBSERVAR/RECHAZAR)
   */
  async revisarDocumento(
    documentoId: string,
    supervisorId: string,
    revisarDto: RevisarDocumentoDto,
    archivoSupervisor?: Express.Multer.File
  ): Promise<{ supervisor: SupervisorDocumento; documento: Documento }> {
    this.logger.log(`🔍 Supervisor ${supervisorId} revisando documento ${documentoId} - Estado: ${revisarDto.estado}`);

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

    if ((revisarDto.estado === SupervisorEstado.OBSERVADO ||
      revisarDto.estado === SupervisorEstado.RECHAZADO) &&
      (!revisarDto.observacion || revisarDto.observacion.trim() === '')) {
      throw new BadRequestException('Se requiere una observación para este estado');
    }

    if (archivoSupervisor && revisarDto.estado === SupervisorEstado.APROBADO) {
      const nombreArchivo = await this.guardarArchivoSupervisor(documento, archivoSupervisor);
      supervisorDoc.nombreArchivoSupervisor = nombreArchivo;
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

    this.logger.log(`✅ Documento ${documento.numeroRadicado} revisado por supervisor. Estado: ${revisarDto.estado}`);

    return {
      supervisor: savedSupervisorDoc,
      documento
    };
  }

  /**
   * GUARDAR ARCHIVO DEL SUPERVISOR
   */
  private async guardarArchivoSupervisor(
    documento: Documento,
    archivo: Express.Multer.File
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
      const nombreBase = `aprobacion_supervisor_${documento.numeroRadicado}`;
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
        descripcion: 'Aprobación del supervisor'
      };

      fs.writeFileSync(
        path.join(rutaSupervisor, `${nombreBase}_${timestamp}_${hash}_meta.json`),
        JSON.stringify(metadatos, null, 2)
      );

      this.logger.log(`💾 Archivo de supervisor guardado: ${rutaCompleta} (${archivo.size} bytes)`);

      return nombreArchivo;
    } catch (error) {
      this.logger.error(`❌ Error guardando archivo de supervisor: ${error.message}`);
      throw new BadRequestException(`Error al guardar archivo: ${error.message}`);
    }
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
      relations: ['documento', 'documento.radicador'], // ✅ SOLO radicador
      order: { fechaActualizacion: 'DESC' },
      take: 50
    });

    return supervisorDocs.map(sd => ({
      id: sd.id,
      documento: {
        id: sd.documento.id,
        numeroRadicado: sd.documento.numeroRadicado,
        nombreContratista: sd.documento.nombreContratista,
      },
      estado: sd.estado,
      observacion: sd.observacion,
      fechaCreacion: sd.fechaCreacion,
      fechaActualizacion: sd.fechaActualizacion,
      fechaAprobacion: sd.fechaAprobacion,
      tieneArchivo: !!sd.nombreArchivoSupervisor,
      nombreArchivoSupervisor: sd.nombreArchivoSupervisor
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
      this.logger.log(`   - Documentos RADICADOS totales: ${totalDocumentosRadicados}`);
      this.logger.log(`   - En revisión: ${enRevision}`);
      this.logger.log(`   - Aprobados: ${aprobados}`);
      this.logger.log(`   - Observados: ${observados}`);
      this.logger.log(`   - Rechazados: ${rechazados}`);

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