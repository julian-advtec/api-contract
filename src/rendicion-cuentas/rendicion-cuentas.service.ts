import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Brackets } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

import { RendicionCuentasDocumento } from './entities/rendicion-cuentas-documento.entity';
import { RendicionCuentasHistorial } from './entities/rendicion-cuentas-historial.entity';
import { RendicionCuentasEstado } from './entities/rendicion-cuentas-estado.enum';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { AsesorGerenciaDocumento } from '../asesor-gerencia/entities/asesor-gerencia-documento.entity';
import { TesoreriaDocumento } from '../tesoreria/entities/tesoreria-documento.entity';
import { BitacoraSistemaService } from '../bitacora-sistema/bitacora-sistema.service'; // ✅ Importar
import { ModuloBitacora, AccionBitacora } from '../bitacora-sistema/entities/bitacora-sistema.entity'; // ✅ Importar

import {
  TomarDecisionDto,
} from './dto/rendicion-cuentas.dto';

interface JwtUser {
  id: string;
  username: string;
  role: UserRole;
  fullName?: string;
  email?: string;
}

@Injectable()
export class RendicionCuentasService {
  private readonly logger = new Logger(RendicionCuentasService.name);

  constructor(
    @InjectRepository(RendicionCuentasDocumento)
    private documentoRepo: Repository<RendicionCuentasDocumento>,
    @InjectRepository(RendicionCuentasHistorial)
    private historialRepo: Repository<RendicionCuentasHistorial>,
    @InjectRepository(Documento)
    private documentoRadicacionRepo: Repository<Documento>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(AsesorGerenciaDocumento)
    private asesorGerenciaRepository: Repository<AsesorGerenciaDocumento>,
    @InjectRepository(TesoreriaDocumento)
    private tesoreriaRepository: Repository<TesoreriaDocumento>,
    private readonly bitacoraService: BitacoraSistemaService, // ✅ Inyectar servicio
  ) { }

  async obtenerDocumentosDisponibles(usuarioId: string): Promise<any[]> {
    this.logger.log(`Obteniendo documentos disponibles para usuario: ${usuarioId}`);

    // Consulta directa sin joins complejos
    const documentos = await this.documentoRadicacionRepo
      .createQueryBuilder('doc')
      .where('doc.estado = :estado', { estado: 'COMPLETADO_ASESOR_GERENCIA' })
      .getMany();

    this.logger.log(`📄 Documentos encontrados: ${documentos.length}`);

    if (documentos.length > 0) {
      documentos.forEach(doc => {
        this.logger.log(`   - ${doc.numeroRadicado}: ${doc.estado}`);
      });
    }

    // Verificar si hay rendiciones activas para estos documentos
    const revisionesActivas = await this.documentoRepo.find({
      where: { estado: RendicionCuentasEstado.EN_REVISION },
      relations: ['documento'],
    });

    const idsEnRevision = revisionesActivas.map(r => r.documento?.id).filter(id => id);
    this.logger.log(`📋 Documentos en revisión: ${idsEnRevision.length}`);

    const responsablePorDocumento = new Map();
    revisionesActivas.forEach(r => {
      if (r.documento && r.responsableId) {
        responsablePorDocumento.set(r.documento.id, r.responsableId);
      }
    });

    const resultado = documentos.map(doc => ({
      id: doc.id,
      numeroRadicado: doc.numeroRadicado,
      numeroContrato: doc.numeroContrato,
      nombreContratista: doc.nombreContratista,
      documentoContratista: doc.documentoContratista,
      fechaInicio: doc.fechaInicio,
      fechaFin: doc.fechaFin,
      fechaRadicacion: doc.fechaRadicacion,
      fechaCreacion: doc.fechaRadicacion,
      fechaActualizacion: doc.fechaActualizacion,
      radicador: doc.nombreRadicador,
      estado: doc.estado,
      responsableId: responsablePorDocumento.get(doc.id) || null,
      disponible: !idsEnRevision.includes(doc.id),
      enMiRevision: responsablePorDocumento.get(doc.id) === usuarioId,
    }));

    this.logger.log(`📤 Resultado final: ${resultado.length} documentos disponibles`);
    return resultado;
  }

  async tomarDocumento(documentoId: string, usuarioId: string) {
    this.logger.log(`📥 Recibida solicitud para tomar documento: ${documentoId}`);

    const queryRunner = this.documentoRepo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const documento = await queryRunner.manager
        .createQueryBuilder(Documento, 'doc')
        .where('doc.id = :id', { id: documentoId })
        .andWhere('doc.estado = :estado', { estado: 'COMPLETADO_ASESOR_GERENCIA' })
        .setLock('pessimistic_write')
        .getOne();

      if (!documento) {
        throw new NotFoundException('Documento no encontrado o no disponible');
      }

      const existeEnRevision = await queryRunner.manager.findOne(RendicionCuentasDocumento, {
        where: {
          documento: { id: documentoId },
          estado: RendicionCuentasEstado.EN_REVISION
        }
      });

      if (existeEnRevision) {
        throw new BadRequestException('El documento ya está siendo revisado por otro usuario');
      }

      const responsable = await queryRunner.manager.findOneOrFail(User, { where: { id: usuarioId } });

      const rendicionDoc = queryRunner.manager.create(RendicionCuentasDocumento, {
        documento,
        documentoId: documento.id,
        responsable,
        responsableId: responsable.id,
        estado: RendicionCuentasEstado.EN_REVISION,
        fechaInicioRevision: new Date(),
      });

      documento.estado = 'EN_REVISION_RENDICION_CUENTAS';
      documento.usuarioAsignado = responsable;
      documento.usuarioAsignadoNombre = responsable.fullName || responsable.username;
      documento.ultimoUsuario = `Rendición Cuentas: ${responsable.fullName || responsable.username}`;

      const historial = documento.historialEstados || [];
      historial.push({
        fecha: new Date(),
        estado: 'EN_REVISION_RENDICION_CUENTAS',
        usuarioId: responsable.id,
        usuarioNombre: responsable.fullName || responsable.username,
        rolUsuario: responsable.role,
        observacion: `Documento tomado para rendición de cuentas por ${responsable.username}`,
      });
      documento.historialEstados = historial;

      await queryRunner.manager.save(documento);
      const savedRendicion = await queryRunner.manager.save(rendicionDoc);
      await queryRunner.commitTransaction();

      // ✅ REGISTRAR EN BITÁCORA - TOMAR DOCUMENTO
      await this.bitacoraService.registrar(
        AccionBitacora.RENDICION_TOMAR,
        ModuloBitacora.RENDICION_CUENTAS,
        responsable,
        documento,
        {
          detalles: `Documento ${documento.numeroRadicado} tomado para revisión de rendición de cuentas`,
          numeroRadicado: documento.numeroRadicado,
          numeroContrato: documento.numeroContrato,
          nombreContratista: documento.nombreContratista,
        }
      );

      try {
        await this.registrarHistorial({
          documentoId: savedRendicion.id,
          usuarioId: responsable.id,
          estadoAnterior: null,
          estadoNuevo: RendicionCuentasEstado.EN_REVISION,
          accion: 'TOMAR_REVISION',
          observacion: `Documento tomado para revisión`,
        });
      } catch (historialError) {
        this.logger.error(`❌ Error registrando historial: ${historialError.message}`);
      }

      return {
        success: true,
        message: `Documento ${documento.numeroRadicado} tomado para revisión`,
        rendicionId: savedRendicion.id,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async obtenerTodosDocumentos(usuarioId: string): Promise<any[]> {
    this.logger.log(`Obteniendo TODOS los documentos de rendición para usuario: ${usuarioId}`);

    // Obtener todas las rendiciones sin filtros primero para debug
    const todasLasRendiciones = await this.documentoRepo.find({
      relations: ['documento', 'responsable'],
    });

    this.logger.log(`📊 Total rendiciones en BD: ${todasLasRendiciones.length}`);

    if (todasLasRendiciones.length === 0) {
      this.logger.warn('⚠️ No hay rendiciones en la base de datos');
      return [];
    }

    // Obtener el usuario actual
    const usuario = await this.userRepo.findOne({ where: { id: usuarioId } });
    const esAdmin = usuario?.role === UserRole.ADMIN || usuario?.role === UserRole.SUPERVISOR;

    this.logger.log(`👤 Usuario: ${usuarioId}, esAdmin: ${esAdmin}`);

    // Mapear todas las rendiciones
    const resultado = todasLasRendiciones.map(rendicion => {
      // Asegurar que documento existe
      if (!rendicion.documento) {
        this.logger.warn(`Rendición ${rendicion.id} no tiene documento asociado`);
        return null;
      }

      const esMio = rendicion.responsableId === usuarioId;
      const yaProcesado = rendicion.estado === 'APROBADO' || rendicion.estado === 'RECHAZADO' || rendicion.estado === 'COMPLETADO';
      const puedeVer = esAdmin || esMio || yaProcesado;

      this.logger.log(`📄 Rendición: ${rendicion.id}, documento: ${rendicion.documento.numeroRadicado}, estado: ${rendicion.estado}, esMio: ${esMio}, puedeVer: ${puedeVer}`);

      if (!puedeVer) {
        return null;
      }

      return {
        id: rendicion.id,
        rendicionId: rendicion.id,
        documentoId: rendicion.documento.id,
        numeroRadicado: rendicion.documento.numeroRadicado || 'N/A',
        numeroContrato: rendicion.documento.numeroContrato || 'N/A',
        nombreContratista: rendicion.documento.nombreContratista || 'N/A',
        documentoContratista: rendicion.documento.documentoContratista || 'N/A',
        fechaRadicacion: rendicion.documento.fechaRadicacion,
        fechaInicioRevision: rendicion.fechaInicioRevision,
        estado: rendicion.estado,
        estadoDocumento: rendicion.documento.estado,
        observaciones: rendicion.observaciones,
        responsableId: rendicion.responsableId,
        responsableNombre: rendicion.responsable?.fullName || rendicion.responsable?.username || 'N/A',
        fechaDecision: rendicion.fechaDecision,
        fechaCreacion: rendicion.fechaCreacion,
        fechaActualizacion: rendicion.fechaActualizacion,
        esMio: esMio,
        puedeEditar: esMio && rendicion.estado === 'EN_REVISION',
        puedeVer: true
      };
    }).filter(item => item !== null);

    this.logger.log(`📤 Resultado final: ${resultado.length} documentos visibles`);

    // Log del primer resultado para debug
    if (resultado.length > 0) {
      this.logger.log(`📄 Primer resultado:`, JSON.stringify(resultado[0], null, 2));
    }

    return resultado;
  }
  async obtenerMisDocumentosEnRevision(usuarioId: string): Promise<any[]> {
    const documentos = await this.documentoRepo.find({
      where: {
        responsableId: usuarioId,
        estado: RendicionCuentasEstado.EN_REVISION,
      },
      relations: ['documento', 'responsable'],
      order: { fechaInicioRevision: 'DESC' },
    });

    return documentos.map(doc => ({
      id: doc.documento.id,
      rendicionId: doc.id,
      numeroRadicado: doc.documento.numeroRadicado,
      numeroContrato: doc.documento.numeroContrato,
      nombreContratista: doc.documento.nombreContratista,
      fechaRadicacion: doc.documento.fechaRadicacion,
      fechaInicioRevision: doc.fechaInicioRevision,
      estado: doc.estado,
      observaciones: doc.observaciones,
    }));
  }

  async tomarDecision(
    id: string,
    decisionDto: TomarDecisionDto,
    usuario: JwtUser
  ): Promise<RendicionCuentasDocumento> {
    this.logger.log(`Tomando decisión ${decisionDto.decision} para documento ${id}`);

    const documento = await this.documentoRepo.findOne({
      where: {
        id,
        responsableId: usuario.id,
        estado: RendicionCuentasEstado.EN_REVISION
      },
      relations: ['documento', 'responsable'],
    });

    if (!documento) {
      throw new ForbiddenException('No tienes este documento en revisión o ya fue procesado');
    }

    const queryRunner = this.documentoRepo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const documentoOriginal = documento.documento;
      const estadoAnterior = documento.estado;

      documento.estado = decisionDto.decision;
      documento.fechaDecision = new Date();
      documento.observaciones = decisionDto.observacion || null;

      let nuevoEstadoDoc: string;
      let accionBitacora: AccionBitacora;

      switch (decisionDto.decision) {
        case RendicionCuentasEstado.APROBADO:
          nuevoEstadoDoc = 'APROBADO_RENDICION_CUENTAS';
          accionBitacora = AccionBitacora.RENDICION_APROBAR;
          break;
        case RendicionCuentasEstado.OBSERVADO:
          nuevoEstadoDoc = 'OBSERVADO_RENDICION_CUENTAS';
          accionBitacora = AccionBitacora.RENDICION_OBSERVAR;
          break;
        case RendicionCuentasEstado.RECHAZADO:
          nuevoEstadoDoc = 'RECHAZADO_RENDICION_CUENTAS';
          accionBitacora = AccionBitacora.RENDICION_RECHAZAR;
          break;
        default:
          nuevoEstadoDoc = documentoOriginal.estado;
          accionBitacora = AccionBitacora.RENDICION_REVISAR;
      }

      documentoOriginal.estado = nuevoEstadoDoc;
      documentoOriginal.ultimoUsuario = `Rendición Cuentas: ${usuario.fullName || usuario.username}`;
      documentoOriginal.usuarioAsignado = null;
      documentoOriginal.usuarioAsignadoNombre = '';

      const historial = documentoOriginal.historialEstados || [];
      historial.push({
        fecha: new Date(),
        estado: nuevoEstadoDoc,
        usuarioId: usuario.id,
        usuarioNombre: usuario.fullName || usuario.username,
        rolUsuario: usuario.role,
        observacion: `Decisión de rendición cuentas: ${decisionDto.decision} - ${decisionDto.observacion || ''}`,
      });
      documentoOriginal.historialEstados = historial;

      await queryRunner.manager.save(documentoOriginal);
      await queryRunner.manager.save(documento);

      // ✅ REGISTRAR EN BITÁCORA - DECISIÓN
      await this.bitacoraService.registrar(
        accionBitacora,
        ModuloBitacora.RENDICION_CUENTAS,
        {
          id: usuario.id,
          username: usuario.username,
          fullName: usuario.fullName,
          role: usuario.role,
        },
        documentoOriginal,
        {
          detalles: `Documento ${documentoOriginal.numeroRadicado} - Decisión: ${decisionDto.decision}${decisionDto.observacion ? ` - Observación: ${decisionDto.observacion}` : ''}`,
          decision: decisionDto.decision,
          observacion: decisionDto.observacion,
          numeroRadicado: documentoOriginal.numeroRadicado,
          numeroContrato: documentoOriginal.numeroContrato,
          nombreContratista: documentoOriginal.nombreContratista,
        }
      );

      await this.registrarHistorial({
        documentoId: documento.id,
        usuarioId: usuario.id,
        estadoAnterior,
        estadoNuevo: decisionDto.decision,
        accion: decisionDto.decision,
        observacion: decisionDto.observacion,
      });

      await queryRunner.commitTransaction();

      return documento;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async obtenerRutaCarpeta(documentoId: string, usuarioId: string): Promise<{ rutaCarpeta: string; documentoInfo: any }> {
    this.logger.log(`🔍 Buscando documento para descargar: ${documentoId}`);

    // Buscar el documento radicado
    const documento = await this.documentoRadicacionRepo.findOne({
      where: { id: documentoId }
    });

    if (!documento) {
      this.logger.error(`❌ Documento no encontrado: ${documentoId}`);
      throw new NotFoundException(`Documento ${documentoId} no encontrado`);
    }

    this.logger.log(`✅ Documento encontrado: ${documento.numeroRadicado}`);
    this.logger.log(`📁 Ruta de carpeta: ${documento.rutaCarpetaRadicado}`);

    if (!documento.rutaCarpetaRadicado) {
      this.logger.error(`❌ La ruta de carpeta es null o undefined`);
      throw new NotFoundException(`La ruta de carpeta no está configurada para el documento ${documento.numeroRadicado}`);
    }

    if (!fs.existsSync(documento.rutaCarpetaRadicado)) {
      this.logger.error(`❌ La carpeta no existe: ${documento.rutaCarpetaRadicado}`);
      throw new NotFoundException(`La carpeta no existe: ${documento.rutaCarpetaRadicado}`);
    }

    return {
      rutaCarpeta: documento.rutaCarpetaRadicado,
      documentoInfo: {
        id: documento.id,
        numeroRadicado: documento.numeroRadicado,
        numeroContrato: documento.numeroContrato,
        nombreContratista: documento.nombreContratista,
      }
    };
  }

  async obtenerHistorial(usuarioId: string): Promise<any[]> {
    const usuario = await this.userRepo.findOne({ where: { id: usuarioId } });
    const esAdmin = usuario?.role === UserRole.ADMIN;

    let query = this.documentoRepo
      .createQueryBuilder('rcd')
      .leftJoinAndSelect('rcd.documento', 'doc')
      .leftJoinAndSelect('rcd.responsable', 'resp')
      .orderBy('rcd.fechaCreacion', 'DESC');

    if (!esAdmin) {
      query = query.where('rcd.responsableId = :usuarioId', { usuarioId });
    }

    const registros = await query.getMany();

    return registros.map(doc => ({
      id: doc.id,
      rendicionId: doc.id,
      documentoId: doc.documento?.id || '',
      numeroRadicado: doc.documento?.numeroRadicado || 'N/A',
      numeroContrato: doc.documento?.numeroContrato || 'N/A',
      nombreContratista: doc.documento?.nombreContratista || 'N/A',
      documentoContratista: doc.documento?.documentoContratista || 'N/A',
      fechaRadicacion: doc.documento?.fechaRadicacion,
      fechaInicioRevision: doc.fechaInicioRevision,
      estado: doc.estado,
      observaciones: doc.observaciones,
      responsableId: doc.responsableId,
      responsableNombre: doc.responsable?.fullName || doc.responsable?.username || 'N/A',
      fechaDecision: doc.fechaDecision,
      fechaCreacion: doc.fechaCreacion,
      fechaActualizacion: doc.fechaActualizacion,
      disponible: doc.estado === 'PENDIENTE',
      enMiRevision: doc.responsableId === usuarioId,
      esMio: doc.responsableId === usuarioId
    }));
  }

  /**
   * 🆕 NUEVO MÉTODO: Obtener detalle por documento radicado (como Asesor Gerencia)
   * Este es el método principal que usa Rendición de Cuentas
   */
  // src/rendicion-cuentas/rendicion-cuentas.service.ts

  async obtenerDetallePorDocumentoRadicado(documentoId: string, usuarioId: string): Promise<any> {
    this.logger.log(`🔍 Buscando rendición para ID: ${documentoId}`);

    let rendicion: RendicionCuentasDocumento | null = null;
    let documento: Documento | null = null;

    // ✅ PASO 1: Buscar como rendicionId (ID de la tabla rendicion_cuentas_documentos)
    rendicion = await this.documentoRepo.findOne({
      where: { id: documentoId },
      relations: ['documento', 'responsable'],
    });

    if (rendicion) {
      this.logger.log(`✅ Encontrado como rendicionId: ${rendicion.id}`);
      documento = rendicion.documento;
    }

    // ✅ PASO 2: Si no se encontró, buscar como documentoId (ID de la tabla documentos dentro de rendicion)
    if (!rendicion) {
      rendicion = await this.documentoRepo.findOne({
        where: { documento: { id: documentoId } },
        relations: ['documento', 'responsable'],
      });

      if (rendicion) {
        this.logger.log(`✅ Encontrado como documentoId dentro de rendición: ${documentoId}`);
        documento = rendicion.documento;
      }
    }

    // ✅ PASO 3: Si aún no hay rendición, buscar el documento radicado directamente
    if (!documento) {
      documento = await this.documentoRadicacionRepo.findOne({
        where: { id: documentoId },
        relations: ['radicador', 'usuarioAsignado'],
      });

      if (documento) {
        this.logger.log(`✅ Encontrado como documento radicado directo: ${documento.id}`);
      }
    }

    // ✅ Si no se encontró nada, error
    if (!documento) {
      this.logger.error(`❌ No se encontró rendición ni documento con ID: ${documentoId}`);
      throw new NotFoundException(`No se encontró rendición ni documento con ID: ${documentoId}`);
    }

    // Verificar permisos
    const usuario = await this.userRepo.findOne({ where: { id: usuarioId } });
    const esAdmin = usuario?.role === UserRole.ADMIN || usuario?.role === UserRole.SUPERVISOR;
    const esResponsable = rendicion?.responsableId === usuarioId;
    const yaProcesado = !!rendicion?.fechaDecision;

    if (!esAdmin && !esResponsable && !yaProcesado && rendicion) {
      throw new ForbiddenException(`No tienes acceso a este documento`);
    }

    // Devolver todos los datos
    return {
      id: documento.id,
      numeroRadicado: documento.numeroRadicado,
      numeroContrato: documento.numeroContrato,
      nombreContratista: documento.nombreContratista,
      documentoContratista: documento.documentoContratista,
      fechaRadicacion: documento.fechaRadicacion,
      fechaInicio: documento.fechaInicio,
      fechaFin: documento.fechaFin,
      estado: documento.estado,
      observacion: documento.observacion || '',
      historialEstados: documento.historialEstados || [],
      radicador: documento.radicador,
      usuarioAsignado: documento.usuarioAsignado,
      usuarioAsignadoNombre: documento.usuarioAsignadoNombre,
      rutaCarpetaRadicado: documento.rutaCarpetaRadicado,

      rendicionId: rendicion?.id || null,
      rendicionEstado: rendicion?.estado || null,
      responsableId: rendicion?.responsableId || null,
      responsable: rendicion?.responsable ? {
        id: rendicion.responsable.id,
        nombreCompleto: rendicion.responsable.fullName || rendicion.responsable.username,
        email: rendicion.responsable.email
      } : null,
      fechaAsignacion: rendicion?.fechaAsignacion || null,
      fechaInicioRevisionRendicion: rendicion?.fechaInicioRevision || null,
      fechaDecisionRendicion: rendicion?.fechaDecision || null,
      observacionesRendicion: rendicion?.observaciones || null,

      tesoreria: await this.obtenerDatosTesoreria(documento.id),
      asesorGerencia: await this.obtenerDatosAsesorGerencia(documento.id)
    };
  }

  // src/rendicion-cuentas/rendicion-cuentas.service.ts

  private async obtenerDatosTesoreria(documentoId: string): Promise<any> {
    const tesoreria = await this.tesoreriaRepository.findOne({
      where: { documento: { id: documentoId } }
    });

    if (!tesoreria) return null;

    // ✅ Usando propiedades que SÍ existen en tu entidad
    return {
      pagoRealizadoPath: tesoreria.pagoRealizadoPath,
      observaciones: tesoreria.observaciones,
      fechaPago: tesoreria.fechaPago,
      fechaCreacion: tesoreria.fechaCreacion,
      fechaActualizacion: tesoreria.fechaActualizacion,
      fechaInicioRevision: tesoreria.fechaInicioRevision,
      fechaFinRevision: tesoreria.fechaFinRevision,
      firmaAplicada: tesoreria.firmaAplicada
    };
  }

  private async obtenerDatosAsesorGerencia(documentoId: string): Promise<any> {
    const asesorGerencia = await this.asesorGerenciaRepository.findOne({
      where: { documento: { id: documentoId } },
      relations: ['asesor']
    });

    if (!asesorGerencia) return null;

    return {
      estado: asesorGerencia.estado,
      observaciones: asesorGerencia.observaciones,
      aprobacionPath: asesorGerencia.aprobacionPath,
      comprobanteFirmadoPath: asesorGerencia.comprobanteFirmadoPath,
      firmaAplicada: asesorGerencia.firmaAplicada,
      asesor: asesorGerencia.asesor?.fullName || asesorGerencia.asesor?.username,
      fechaInicioRevision: asesorGerencia.fechaInicioRevision,
      fechaFinRevision: asesorGerencia.fechaFinRevision
    };
  }
  private async registrarHistorial(data: {
    documentoId: string;
    usuarioId: string;
    estadoAnterior: RendicionCuentasEstado | null;
    estadoNuevo: RendicionCuentasEstado;
    accion: string;
    observacion?: string | null;
  }): Promise<RendicionCuentasHistorial> {
    const historial = new RendicionCuentasHistorial();
    historial.documentoId = data.documentoId;
    historial.usuarioId = data.usuarioId;
    historial.estadoAnterior = data.estadoAnterior;
    historial.estadoNuevo = data.estadoNuevo;
    historial.accion = data.accion;
    historial.observacion = data.observacion || null;

    return this.historialRepo.save(historial);
  }

  async obtenerRendicionPorId(rendicionId: string): Promise<RendicionCuentasDocumento> {
    const rendicion = await this.documentoRepo.findOne({
      where: { id: rendicionId },
      relations: ['documento'],
    });

    if (!rendicion) {
      throw new NotFoundException(`Rendición ${rendicionId} no encontrada`);
    }

    return rendicion;
  }

  async liberarDocumento(rendicionId: string, usuarioId: string): Promise<any> {
    this.logger.log(`📤 Liberando documento rendición ${rendicionId} por usuario ${usuarioId}`);

    const rendicion = await this.documentoRepo.findOne({
      where: {
        id: rendicionId,
        responsableId: usuarioId,
        estado: RendicionCuentasEstado.EN_REVISION
      },
      relations: ['documento', 'responsable'],
    });

    if (!rendicion) {
      throw new ForbiddenException('No tienes este documento en revisión o ya fue procesado');
    }

    const documentoOriginal = rendicion.documento;
    const responsable = rendicion.responsable;

    // Cambiar estado del documento original a COMPLETADO_ASESOR_GERENCIA
    documentoOriginal.estado = 'COMPLETADO_ASESOR_GERENCIA';
    documentoOriginal.usuarioAsignado = null;
    documentoOriginal.usuarioAsignadoNombre = '';
    documentoOriginal.fechaActualizacion = new Date();
    documentoOriginal.ultimoUsuario = `Liberado desde rendición por: ${responsable?.fullName || responsable?.username}`;

    // Registrar en historial
    const historial = documentoOriginal.historialEstados || [];
    historial.push({
      fecha: new Date(),
      estado: 'COMPLETADO_ASESOR_GERENCIA',
      usuarioId: usuarioId,
      usuarioNombre: responsable?.fullName || responsable?.username,
      rolUsuario: responsable?.role,
      observacion: `Documento liberado desde rendición de cuentas`,
    });
    documentoOriginal.historialEstados = historial;

    rendicion.estado = RendicionCuentasEstado.PENDIENTE;
    rendicion.fechaActualizacion = new Date();

    await this.documentoRadicacionRepo.save(documentoOriginal);
    await this.documentoRepo.save(rendicion);

    // ✅ REGISTRAR EN BITÁCORA - LIBERAR DOCUMENTO
    await this.bitacoraService.registrar(
      AccionBitacora.RENDICION_LIBERAR,
      ModuloBitacora.RENDICION_CUENTAS,
      {
        id: responsable?.id,
        username: responsable?.username,
        fullName: responsable?.fullName,
        role: responsable?.role,
      },
      documentoOriginal,
      {
        detalles: `Documento ${documentoOriginal.numeroRadicado} liberado de rendición de cuentas`,
        numeroRadicado: documentoOriginal.numeroRadicado,
        numeroContrato: documentoOriginal.numeroContrato,
        nombreContratista: documentoOriginal.nombreContratista,
      }
    );

    return {
      success: true,
      message: 'Documento liberado correctamente'
    };
  }
}