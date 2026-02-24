// src/rendicion-cuentas/rendicion-cuentas.service.ts
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
  ) { }

  /**
   * 1. OBTENER DOCUMENTOS DISPONIBLES (los que vienen de asesor gerencia)
   */
  async obtenerDocumentosDisponibles(usuarioId: string): Promise<any[]> {
    this.logger.log(`Obteniendo documentos disponibles para usuario: ${usuarioId}`);

    const documentos = await this.documentoRadicacionRepo
      .createQueryBuilder('doc')
      .leftJoinAndSelect('doc.radicador', 'radicador')
      .leftJoinAndSelect('doc.usuarioAsignado', 'asignado')
      .where('doc.estado = :estado', { estado: 'COMPLETADO_ASESOR_GERENCIA' })
      .orderBy('doc.fechaActualizacion', 'ASC')
      .getMany();

    this.logger.log(`📄 Documentos encontrados: ${documentos.length}`);
    documentos.forEach(doc => {
      this.logger.log(`   ID: ${doc.id}, Radicado: ${doc.numeroRadicado}`);
    });

    const revisionesActivas = await this.documentoRepo.find({
      where: { estado: RendicionCuentasEstado.EN_REVISION },
      relations: ['documento', 'responsable'],
    });

    const idsEnRevision = revisionesActivas.map(r => r.documento.id);
    this.logger.log(`📋 IDs en revisión: ${idsEnRevision.join(', ')}`);

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

    this.logger.log(`📤 Resultado: ${resultado.length} documentos`);
    resultado.forEach(r => {
      this.logger.log(`   ID: ${r.id}, Disponible: ${r.disponible}`);
    });

    return resultado;
  }

  /**
   * 2. TOMAR DOCUMENTO PARA REVISIÓN
   */
// src/rendicion-cuentas/rendicion-cuentas.service.ts
async tomarDocumento(documentoId: string, usuarioId: string) {
  this.logger.log(`📥 Recibida solicitud para tomar documento: ${documentoId}`);
  this.logger.log(`👤 Usuario: ${usuarioId}`);

  const queryRunner = this.documentoRepo.manager.connection.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    // Paso 1: Buscar documento
    const documento = await queryRunner.manager
      .createQueryBuilder(Documento, 'doc')
      .where('doc.id = :id', { id: documentoId })
      .andWhere('doc.estado = :estado', { estado: 'COMPLETADO_ASESOR_GERENCIA' })
      .setLock('pessimistic_write')
      .getOne();

    if (!documento) {
      throw new NotFoundException('Documento no encontrado o no disponible');
    }

    // Paso 2: Verificar si ya está en revisión
    const existeEnRevision = await queryRunner.manager.findOne(RendicionCuentasDocumento, {
      where: {
        documento: { id: documentoId },
        estado: RendicionCuentasEstado.EN_REVISION
      }
    });

    if (existeEnRevision) {
      throw new BadRequestException('El documento ya está siendo revisado por otro usuario');
    }

    // Paso 3: Buscar usuario responsable
    const responsable = await queryRunner.manager.findOneOrFail(User, { where: { id: usuarioId } });

    // Paso 4: Crear registro en rendición
    const rendicionDoc = queryRunner.manager.create(RendicionCuentasDocumento, {
      documento,
      documentoId: documento.id,
      responsable,
      responsableId: responsable.id,
      estado: RendicionCuentasEstado.EN_REVISION,
      fechaInicioRevision: new Date(),
    });

    // Paso 5: Actualizar estado del documento original
    documento.estado = 'EN_REVISION_RENDICION_CUENTAS';
    documento.usuarioAsignado = responsable;
    documento.usuarioAsignadoNombre = responsable.fullName || responsable.username;
    documento.ultimoUsuario = `Rendición Cuentas: ${responsable.fullName || responsable.username}`;

    // Paso 6: Agregar al historial del documento original
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

    // Paso 7: Guardar documento original
    await queryRunner.manager.save(documento);

    // Paso 8: Guardar registro de rendición
    const savedRendicion = await queryRunner.manager.save(rendicionDoc);

    // Paso 9: Confirmar transacción PRIMERO
    await queryRunner.commitTransaction();

    // Paso 10: AHORA registrar en historial de rendición (fuera de la transacción)
    try {
      await this.registrarHistorial({
        documentoId: savedRendicion.id,
        usuarioId: responsable.id,
        estadoAnterior: null,
        estadoNuevo: RendicionCuentasEstado.EN_REVISION,
        accion: 'TOMAR_REVISION',
        observacion: `Documento tomado para revisión`,
      });
      this.logger.log(`✅ Historial de rendición registrado`);
    } catch (historialError) {
      // Solo loguear el error, no fallar la operación principal
      this.logger.error(`❌ Error registrando historial (no crítico): ${historialError.message}`);
    }

    return {
      success: true,
      message: `Documento ${documento.numeroRadicado} tomado para revisión`,
      rendicionId: savedRendicion.id,
    };
  } catch (error) {
    this.logger.error(`❌ Error en tomarDocumento: ${error.message}`, error.stack);
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
  /**
   * 3. OBTENER TODOS LOS DOCUMENTOS (lista completa)
   */
  async obtenerTodosDocumentos(usuarioId: string): Promise<any[]> {
    this.logger.log(`Obteniendo lista completa de documentos para usuarioId: ${usuarioId}`);

    const documentos = await this.documentoRepo.find({
      relations: ['documento', 'responsable'],
      order: { fechaCreacion: 'DESC' },
    });

    return documentos.map(doc => ({
      id: doc.documento.id,
      rendicionId: doc.id,
      numeroRadicado: doc.documento.numeroRadicado,
      numeroContrato: doc.documento.numeroContrato,
      nombreContratista: doc.documento.nombreContratista,
      documentoContratista: doc.documento.documentoContratista,
      fechaRadicacion: doc.documento.fechaRadicacion,
      fechaInicioRevision: doc.fechaInicioRevision,
      estado: doc.estado,
      observaciones: doc.observaciones,
      responsableId: doc.responsableId,
      responsableNombre: doc.responsable?.fullName || doc.responsable?.username,
      fechaDecision: doc.fechaDecision,
      esMio: doc.responsableId === usuarioId
    }));
  }

  /**
   * 4. OBTENER MIS DOCUMENTOS EN REVISIÓN
   */
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

  /**
   * 5. TOMAR DECISIÓN (APROBAR, OBSERVAR, RECHAZAR)
   */
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
      this.logger.error(`❌ No se encontró el documento ${id} en revisión para el usuario ${usuario.id}`);
      throw new ForbiddenException('No tienes este documento en revisión o ya fue procesado');
    }

    const queryRunner = this.documentoRepo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const documentoOriginal = documento.documento;
      const estadoAnterior = documento.estado;

      if (![RendicionCuentasEstado.APROBADO, RendicionCuentasEstado.OBSERVADO, RendicionCuentasEstado.RECHAZADO].includes(decisionDto.decision)) {
        throw new BadRequestException(`Decisión no válida: ${decisionDto.decision}`);
      }

      documento.estado = decisionDto.decision;
      documento.fechaDecision = new Date();
      documento.observaciones = decisionDto.observacion || null;

      let nuevoEstadoDoc: string;
      switch (decisionDto.decision) {
        case RendicionCuentasEstado.APROBADO:
          nuevoEstadoDoc = 'APROBADO_RENDICION_CUENTAS';
          break;
        case RendicionCuentasEstado.OBSERVADO:
          nuevoEstadoDoc = 'OBSERVADO_RENDICION_CUENTAS';
          break;
        case RendicionCuentasEstado.RECHAZADO:
          nuevoEstadoDoc = 'RECHAZADO_RENDICION_CUENTAS';
          break;
        default:
          nuevoEstadoDoc = documentoOriginal.estado;
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

      await this.registrarHistorial({
        documentoId: documento.id,
        usuarioId: usuario.id,
        estadoAnterior,
        estadoNuevo: decisionDto.decision,
        accion: decisionDto.decision,
        observacion: decisionDto.observacion,
      });

      await queryRunner.commitTransaction();
      this.logger.log(`✅ Decisión ${decisionDto.decision} aplicada correctamente al documento ${id}`);

      return documento;
    } catch (error) {
      this.logger.error(`❌ Error al tomar decisión: ${error.message}`, error.stack);
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * 6. OBTENER RUTA DE CARPETA PARA DESCARGA
   */
  async obtenerRutaCarpeta(documentoId: string, usuarioId: string): Promise<{ rutaCarpeta: string; documentoInfo: any }> {
    this.logger.log(`📂 Buscando carpeta para documento ${documentoId}, usuario ${usuarioId}`);

    const documento = await this.documentoRadicacionRepo.findOne({
      where: { id: documentoId }
    });

    if (!documento) {
      this.logger.error(`❌ Documento ${documentoId} no encontrado en radicacion`);
      throw new NotFoundException('Documento no encontrado');
    }

    this.logger.log(`📁 Documento encontrado: ${documento.numeroRadicado}`);
    this.logger.log(`📁 Ruta configurada: ${documento.rutaCarpetaRadicado}`);

    if (!documento.rutaCarpetaRadicado) {
      this.logger.error(`❌ La ruta de carpeta está vacía para documento ${documentoId}`);
      throw new NotFoundException('La ruta de la carpeta no está configurada');
    }

    if (!fs.existsSync(documento.rutaCarpetaRadicado)) {
      this.logger.error(`❌ La carpeta no existe: ${documento.rutaCarpetaRadicado}`);
      throw new NotFoundException(`La carpeta no existe: ${documento.rutaCarpetaRadicado}`);
    }

    try {
      const archivos = fs.readdirSync(documento.rutaCarpetaRadicado);
      this.logger.log(`📄 Archivos encontrados (${archivos.length}):`, archivos);
    } catch (error) {
      this.logger.error(`Error listando archivos: ${error.message}`);
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

  /**
   * 7. OBTENER HISTORIAL DEL USUARIO
   */
  async obtenerHistorial(usuarioId: string): Promise<any[]> {
    this.logger.log(`Obteniendo historial para usuarioId: ${usuarioId}`);

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

    this.logger.log(`Encontrados ${registros.length} registros para usuario ${usuarioId} (esAdmin: ${esAdmin})`);

    return registros.map(doc => ({
      id: doc.documento?.id,
      rendicionId: doc.id,
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
      esMio: doc.responsableId === usuarioId
    }));
  }

  /**
   * 8. OBTENER DETALLE DE UN DOCUMENTO POR ID DE RENDICIÓN
   */
  async obtenerDetalleDocumento(rendicionId: string, usuarioId: string): Promise<any> {
    this.logger.log(`🔍 Obteniendo detalle para rendición ${rendicionId}, usuario ${usuarioId}`);

    const rendicion = await this.documentoRepo.findOne({
      where: {
        id: rendicionId
      },
      relations: ['documento', 'responsable'],
    });

    if (!rendicion) {
      this.logger.error(`❌ No se encontró rendición para ID ${rendicionId}`);
      throw new NotFoundException('Documento no encontrado en rendición de cuentas');
    }

    this.logger.log(`📊 Rendición encontrada - ID: ${rendicion.id}, Estado: ${rendicion.estado}, Responsable: ${rendicion.responsableId}`);

    const usuario = await this.userRepo.findOne({ where: { id: usuarioId } });
    if (!usuario) {
      throw new ForbiddenException('Usuario no encontrado');
    }

    if (usuario.role === UserRole.ADMIN || usuario.role === UserRole.SUPERVISOR) {
      this.logger.log(`✅ Acceso permitido: usuario es ${usuario.role}`);
    }
    else if (rendicion.responsableId === usuarioId) {
      this.logger.log(`✅ Acceso permitido: es el responsable del documento`);
    }
    else if (rendicion.fechaDecision) {
      this.logger.log(`✅ Acceso permitido: documento ya procesado (modo lectura para todos)`);
    }
    else {
      this.logger.error(`❌ Acceso denegado para usuario ${usuarioId} al documento ${rendicionId}`);
      throw new ForbiddenException(`No tienes acceso a este documento en estado: ${rendicion.estado}`);
    }

    const response = {
      id: rendicion.id,
      documentoId: rendicion.documento.id,
      numeroRadicado: rendicion.documento.numeroRadicado,
      numeroContrato: rendicion.documento.numeroContrato,
      nombreContratista: rendicion.documento.nombreContratista,
      documentoContratista: rendicion.documento.documentoContratista,
      fechaRadicacion: rendicion.documento.fechaRadicacion,
      fechaInicio: rendicion.documento.fechaInicio,
      fechaFin: rendicion.documento.fechaFin,
      estado: rendicion.estado,
      estadoDocumento: rendicion.documento.estado,
      responsableId: rendicion.responsableId,
      responsable: rendicion.responsable ? {
        id: rendicion.responsable.id,
        nombreCompleto: rendicion.responsable.fullName || rendicion.responsable.username,
        email: rendicion.responsable.email
      } : null,
      fechaAsignacion: rendicion.fechaAsignacion,
      fechaInicioRevision: rendicion.fechaInicioRevision,
      fechaDecision: rendicion.fechaDecision,
      observaciones: rendicion.observaciones,
      observacionesRendicion: rendicion.observaciones,
      historialEstados: rendicion.documento.historialEstados || [],
      fechaCreacion: rendicion.fechaCreacion,
      fechaActualizacion: rendicion.fechaActualizacion,
      documento: {
        id: rendicion.documento.id,
        numeroRadicado: rendicion.documento.numeroRadicado,
        numeroContrato: rendicion.documento.numeroContrato,
        nombreContratista: rendicion.documento.nombreContratista,
        documentoContratista: rendicion.documento.documentoContratista,
        fechaRadicacion: rendicion.documento.fechaRadicacion,
        rutaCarpetaRadicado: rendicion.documento.rutaCarpetaRadicado
      }
    };

    this.logger.log(`📤 Respuesta preparada - ID: ${response.id}, DocumentoId: ${response.documentoId}`);
    return response;
  }

  /**
   * 9. REGISTRAR HISTORIAL
   */
 private async registrarHistorial(data: {
  documentoId: string;
  usuarioId: string;
  estadoAnterior: RendicionCuentasEstado | null;
  estadoNuevo: RendicionCuentasEstado;
  accion: string;
  observacion?: string | null;
}): Promise<RendicionCuentasHistorial> {
  this.logger.log(`📝 Registrando historial:`, data);
  const historial = new RendicionCuentasHistorial();
  historial.documentoId = data.documentoId;
  historial.usuarioId = data.usuarioId;
  historial.estadoAnterior = data.estadoAnterior;
  historial.estadoNuevo = data.estadoNuevo;
  historial.accion = data.accion;
  historial.observacion = data.observacion || null;

  try {
    const saved = await this.historialRepo.save(historial);
    this.logger.log(`✅ Historial guardado con ID: ${saved.id}`);
    return saved;
  } catch (error) {
    this.logger.error(`❌ Error guardando historial: ${error.message}`, error.stack);
    throw error;
  }
}
}