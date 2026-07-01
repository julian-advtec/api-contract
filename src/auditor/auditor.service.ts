import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
  ForbiddenException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { AuditorDocumento, AuditorEstado } from './entities/auditor-documento.entity';
import { Documento } from './../radicacion/entities/documento.entity';
import { User } from './../users/entities/user.entity';
import { UserRole } from './../users/enums/user-role.enum';
import { RevisarAuditorDocumentoDto } from './dto/revisar-auditor-documento.dto';
import { SubirDocumentosAuditorDto } from './dto/subir-documentos-auditor.dto';
import { extname } from 'path';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ConfigService } from '@nestjs/config';
import { AuditorValidationHelper } from './auditor-validation.helper';
import { BitacoraSistemaService } from '../bitacora-sistema/bitacora-sistema.service';
import { ModuloBitacora, AccionBitacora } from '../bitacora-sistema/entities/bitacora-sistema.entity';
import { JuridicaService } from '../juridica/juridica.service';
import { Contratista } from '../contratista/entities/contratista.entity';
import { ContratistaService } from '../contratista/services/contratista.service';

const execAsync = promisify(exec);

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
    @InjectRepository(Contratista) // ← AGREGAR
    private contratistaRepository: Repository<Contratista>,
    @InjectRepository(AuditorDocumento)
    private auditorDocumentoRepository: Repository<AuditorDocumento>,
    private readonly configService: ConfigService,
    private readonly bitacoraService: BitacoraSistemaService,
    private readonly juridicaService: JuridicaService,
    private readonly contratistaService: ContratistaService, // ← AGREGAR (inyectado directamente)
  ) {
    this.logger.log('📋 AuditorService inicializado');
  }

  // ===============================
  // 1. OBTENER DOCUMENTOS DISPONIBLES PARA AUDITOR
  // ===============================

  async obtenerDocumentosDisponibles(auditorId: string): Promise<any[]> {
    this.logger.log(`📋 Auditor ${auditorId} solicitando documentos disponibles`);

    try {
      // ✅ CAMBIO IMPORTANTE: Solo documentos con acta (estado CON_ACTA)
      const documentos = await this.documentoRepository
        .createQueryBuilder('documento')
        .leftJoinAndSelect('documento.radicador', 'radicador')
        .leftJoinAndSelect('documento.usuarioAsignado', 'usuarioAsignado')
        .where("documento.estado = :estado", { estado: 'CON_ACTA' })  // ← CAMBIADO
        .orderBy('documento.fechaRadicacion', 'ASC')
        .getMany();

      this.logger.log(`✅ Encontrados ${documentos.length} documentos con acta de supervisión`);

      // Resto del código igual...
      const asignacionesEnRevision = await this.auditorRepository.find({
        where: { estado: AuditorEstado.EN_REVISION },
        relations: ['documento', 'auditor']
      });

      const mapaDocumentosEnRevision = new Map<string, string>();
      for (const asignacion of asignacionesEnRevision) {
        if (asignacion.documento && asignacion.documento.id) {
          mapaDocumentosEnRevision.set(asignacion.documento.id, asignacion.auditor.id);
        }
      }

      const misDocumentosEnRevision = await this.auditorRepository.find({
        where: {
          auditor: { id: auditorId },
          estado: AuditorEstado.EN_REVISION
        },
        relations: ['documento']
      });

      const misDocumentosIds = new Set(misDocumentosEnRevision.map(ad => ad.documento?.id).filter(id => id));

      return documentos.map(documento => {
        const auditorAsignadoId = mapaDocumentosEnRevision.get(documento.id);
        const estaEnRevisionPorMi = misDocumentosIds.has(documento.id);
        const tieneAuditorAsignado = !!auditorAsignadoId;

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
          tieneActa: !!documento.actaSupervisionPath,  // ← NUEVO
          disponible: !tieneAuditorAsignado || estaEnRevisionPorMi,
          asignacion: {
            enRevision: estaEnRevisionPorMi,
            puedoTomar: !tieneAuditorAsignado && documento.estado === 'CON_ACTA',  // ← CAMBIADO
            yaAsignado: tieneAuditorAsignado && !estaEnRevisionPorMi,
            auditorAsignadoId: auditorAsignadoId,
            puedeSubirDocumentos: documento.primerRadicadoDelAno,
            supervisorAsignado: documento.usuarioAsignadoNombre,
            tieneSupervisor: !!documento.usuarioAsignadoNombre
          }
        };
      });
    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos disponibles: ${error.message}`);
      throw error;
    }
  }


  // ===============================
  // 2. TOMAR DOCUMENTO PARA REVISIÓN
  // ===============================

  async tomarDocumentoParaRevision(documentoId: string, auditorId: string): Promise<{ success: boolean; message: string; documento: any }> {
    this.logger.log(`🤝 Auditor ${auditorId} tomando documento ${documentoId} para revisión`);
    const queryRunner = this.auditorRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // ✅ CORRECCIÓN: Buscar documentos en estado CON_ACTA (ya tienen acta)
      const documento = await queryRunner.manager
        .createQueryBuilder(Documento, 'documento')
        .where('documento.id = :id', { id: documentoId })
        .andWhere('documento.estado IN (:...estados)', { estados: ['CON_ACTA'] })  // ← CAMBIADO
        .getOne();

      // Si no se encuentra, verificar si existe pero con otro estado
      if (!documento) {
        const docExistente = await queryRunner.manager.findOne(Documento, {
          where: { id: documentoId }
        });

        if (docExistente) {
          throw new BadRequestException(
            `El documento existe pero está en estado "${docExistente.estado}". Solo se pueden tomar documentos en estado CON_ACTA.`
          );
        }
        throw new NotFoundException('Documento no encontrado');
      }

      this.logger.log(`✅ Documento encontrado: ${documento.numeroRadicado} - Estado actual: ${documento.estado}`);
      const auditor = await queryRunner.manager.findOne(User, {
        where: { id: auditorId }
      });

      if (!auditor) {
        throw new NotFoundException('Auditor no encontrado');
      }

      // Verificar si ya existe una asignación EN_REVISION para este documento
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

      // Actualizar estado del documento principal
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

      // Crear o actualizar registro en auditor_documento
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
      this.logger.log(`✅ Registro en auditor_documento creado/actualizado con estado: ${auditorDoc.estado}`);

      // Registrar en bitácora
      try {
        await this.bitacoraService.registrar(
          AccionBitacora.AUDITOR_TOMAR,
          ModuloBitacora.AUDITORIA,
          auditor,
          documento,
          {
            detalles: `Auditor ${auditor.username} tomó documento para revisión`,
            estadoAnterior: 'RADICADO',
            estadoNuevo: 'EN_REVISION_AUDITOR'
          },
        );
        this.logger.log(`✅ Bitácora registrada: AUDITOR_TOMAR - ${documento.numeroRadicado}`);
      } catch (bitacoraError) {
        this.logger.warn(`⚠️ Error registrando bitácora (no crítico): ${bitacoraError.message}`);
      }

      // Registrar acceso en carpeta
      if (documento && documento.rutaCarpetaRadicado) {
        await this.registrarAccesoAuditor(
          documento.rutaCarpetaRadicado,
          auditorId,
          `TOMÓ documento para auditoría`,
          `Estado: RADICADO → EN_REVISION_AUDITOR`
        );
      }

      await queryRunner.commitTransaction();
      this.logger.log(`✅ Documento ${documento.numeroRadicado} tomado para revisión por ${auditor.username}`);

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

  // ===============================
  // 3. REVISAR DOCUMENTO (APROBAR/OBSERVAR/RECHAZAR)
  // ===============================

  async revisarDocumento(
    documentoId: string,
    auditorId: string,
    revisarDto: RevisarAuditorDocumentoDto
  ): Promise<{ success: boolean; message: string; auditor: AuditorDocumento; documento: Documento }> {
    this.logger.log(`🔍 Auditor ${auditorId} revisando documento ${documentoId} - Estado: ${revisarDto.estado}`);

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
        mensajeEstado = 'Documento aprobado por auditor, enviado a supervisor';
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

    try {
      await this.bitacoraService.registrar(
        revisarDto.estado === AuditorEstado.APROBADO ? AccionBitacora.AUDITOR_APROBAR :
          revisarDto.estado === AuditorEstado.OBSERVADO ? AccionBitacora.AUDITOR_OBSERVAR :
            revisarDto.estado === AuditorEstado.RECHAZADO ? AccionBitacora.AUDITOR_RECHAZAR :
              AccionBitacora.AUDITOR_COMPLETAR,
        ModuloBitacora.AUDITORIA,
        auditorDoc.auditor,
        documento,
        {
          detalles: `Auditor ${auditorDoc.auditor.username} revisó documento`,
          estadoAnterior: estadoAnterior,
          estadoNuevo: revisarDto.estado,
          estadoDocumentoNuevo: estadoNuevoDocumento,
          observacion: revisarDto.observaciones
        },
      );
      this.logger.log(`✅ Bitácora registrada: ${revisarDto.estado} - ${documento.numeroRadicado}`);
    } catch (bitacoraError) {
      this.logger.warn(`⚠️ Error registrando bitácora: ${bitacoraError.message}`);
    }

    if (documento.rutaCarpetaRadicado) {
      await this.registrarAccesoAuditor(
        documento.rutaCarpetaRadicado,
        auditorId,
        `REALIZÓ REVISIÓN`,
        `${estadoAnterior} → ${revisarDto.estado} - ${revisarDto.observaciones?.substring(0, 100) || 'Sin observación'}`
      );
    }

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

  // ===============================
  // 4. OBTENER DOCUMENTOS EN REVISIÓN
  // ===============================

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

  // ===============================
  // 5. OBTENER DETALLE DE DOCUMENTO
  // ===============================

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

      if (!auditorDoc && documento.estado !== 'RADICADO') {
        throw new ForbiddenException('No tienes acceso a este documento');
      }

      if (documento.estado === 'EN_REVISION_AUDITOR' && (!auditorDoc || auditorDoc.auditor.id !== auditorId)) {
        throw new ForbiddenException('Este documento está siendo revisado por otro auditor');
      }

      return this.construirRespuestaDetalle(documento, auditorDoc, auditor);
    } catch (error) {
      this.logger.error(`❌ Error obteniendo detalle: ${error.message}`);
      throw error;
    }
  }

  // ===============================
  // 6. OBTENER DOCUMENTO PARA VISTA
  // ===============================

async obtenerDocumentoParaVista(
  documentoId: string,
  auditorId?: string,
): Promise<any> {
  this.logger.log(`🔍 Solicitando documento ${documentoId} para vista de auditoría (auditorId: ${auditorId || 'no proporcionado'})`);

  try {
    // 1. Obtener el documento con TODOS los campos incluyendo acta
    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId },
      relations: ['radicador', 'usuarioAsignado'],
      select: [
        'id', 'numeroRadicado', 'numeroContrato', 'nombreContratista',
        'documentoContratista', 'emailContratista', 'telefonoContratista',
        'fechaInicio', 'fechaFin', 'estado', 'primerRadicadoDelAno',
        'observacion', 'rutaCarpetaRadicado', 'fechaRadicacion',
        'cuentaCobro', 'seguridadSocial', 'informeActividades',
        'descripcionCuentaCobro', 'descripcionSeguridadSocial', 'descripcionInformeActividades',
        'comentarios', 'correcciones', 'usuarioAsignadoNombre',
        'nombreRadicador', 'usuarioRadicador', 'historialEstados',
        'actaSupervisionPath', 'actaSupervisionNombre',
        'actaSupervisionFecha', 'actaSupervisionSubidaPor'
      ]
    });

    if (!documento) {
      throw new NotFoundException(`Documento ${documentoId} no encontrado`);
    }

    this.logger.log(`📄 Documento encontrado: ${documento.numeroRadicado}`);
    this.logger.log(`📋 Acta de supervisión en BD: ${documento.actaSupervisionPath ? 'SÍ' : 'NO'}`);
    this.logger.log(`📊 Estado del documento: ${documento.estado}`);

    // 2. ✅ MODIFICAR: Aceptar más estados para vista
    // Incluir APROBADO_SUPERVISOR y otros estados finales en modo solo lectura
const estadosPermitidosVista = [
  // Estados iniciales
  'RADICADO', 'CON_ACTA', 'EN_REVISION_AUDITOR',
  
  // Estados del auditor
  'APROBADO_AUDITOR', 'OBSERVADO_AUDITOR', 'RECHAZADO_AUDITOR', 'COMPLETADO_AUDITOR',
  
  // Estados del supervisor
  'APROBADO_SUPERVISOR', 'OBSERVADO_SUPERVISOR', 'RECHAZADO_SUPERVISOR', 'FIRMADO_SUPERVISOR', 'EN_REVISION_SUPERVISOR',
  
  // Estados de contabilidad
  'EN_REVISION_CONTABILIDAD', 'APROBADO_CONTABILIDAD', 'OBSERVADO_CONTABILIDAD',
  'RECHAZADO_CONTABILIDAD', 'COMPLETADO_CONTABILIDAD',
  
  // Estados de tesorería
  'EN_REVISION_TESORERIA', 'APROBADO_TESORERIA', 'OBSERVADO_TESORERIA',
  'RECHAZADO_TESORERIA', 'COMPLETADO_TESORERIA',
  
  // Estados de asesor gerencia
  'EN_REVISION_ASESOR_GERENCIA', 'APROBADO_ASESOR_GERENCIA', 'OBSERVADO_ASESOR_GERENCIA',
  'RECHAZADO_ASESOR_GERENCIA',
  
  // Estados de rendición cuentas
  'EN_REVISION_RENDICION_CUENTAS', 'APROBADO_RENDICION_CUENTAS', 'OBSERVADO_RENDICION_CUENTAS',
  'RECHAZADO_RENDICION_CUENTAS',
  
  // Estados finales
  
  'COMPLETADO', 'PAGADO', 'FINALIZADO', 'ANULADO'
];

    let auditorDoc: AuditorDocumento | null = null;

    if (auditorId) {
      auditorDoc = await this.auditorDocumentoRepository.findOne({
        where: {
          documento: { id: documentoId },
          auditor: { id: auditorId },
        },
        relations: ['auditor'],
      });
    }

    let permitido = false;
    let esSoloLectura = false;

    // Verificar si el estado está en la lista de permitidos
    if (estadosPermitidosVista.includes(documento.estado)) {
      permitido = true;
    }

    // Si es un estado final (aprobado, rechazado, etc.), forzar solo lectura
    const estadosFinales = [
      'APROBADO_SUPERVISOR', 'APROBADO_AUDITOR', 'APROBADO_RENDICION_CUENTAS',
      'APROBADO_CONTABILIDAD', 'APROBADO_TESORERIA', 'COMPLETADO',
      'COMPLETADO_AUDITOR', 'RECHAZADO_SUPERVISOR', 'RECHAZADO_AUDITOR',
      'OBSERVADO_SUPERVISOR', 'OBSERVADO_AUDITOR', 'FIRMADO_SUPERVISOR', 'COMPLETADO_TESORERIA',
    ];

    if (estadosFinales.includes(documento.estado)) {
      esSoloLectura = true;
      this.logger.log(`🔒 Estado final: ${documento.estado} - Modo solo lectura forzado`);
    }

    // Si hay un registro en auditor_documento y está en estado final
    if (auditorDoc && estadosFinales.includes(auditorDoc.estado)) {
      esSoloLectura = true;
    }

    // ✅ NUEVO: Si el estado es APROBADO_SUPERVISOR, permitir vista en modo solo lectura
    if (documento.estado === 'APROBADO_SUPERVISOR') {
      permitido = true;
      esSoloLectura = true;
      this.logger.log(`🔓 Documento APROBADO_SUPERVISOR - Vista permitida en modo solo lectura`);
    }

    if (!permitido) {
      this.logger.warn(`⚠️ Vista no permitida para estado: ${documento.estado}`);
      throw new ForbiddenException(`Vista no permitida en estado actual (${documento.estado})`);
    }

    // 3. Obtener archivos del auditor (RP, CDP, etc.)
    const tiposArchivo = [
      { key: 'rp', desc: 'Resolución de Pago', campo: 'rpPath' },
      { key: 'cdp', desc: 'Certificado de Disponibilidad Presupuestal', campo: 'cdpPath' },
      { key: 'poliza', desc: 'Póliza de Cumplimiento', campo: 'polizaPath' },
      { key: 'certificadoBancario', desc: 'Certificado Bancario', campo: 'certificadoBancarioPath' },
      { key: 'minuta', desc: 'Minuta de Contrato', campo: 'minutaPath' },
      { key: 'actaInicio', desc: 'Acta de Inicio', campo: 'actaInicioPath' },
    ];

    const archivosAuditor = [];

    for (const tipo of tiposArchivo) {
      const resultado = await this.encontrarRutaArchivoAuditor(documento, tipo.campo as any);

      if (resultado) {
        archivosAuditor.push({
          tipo: tipo.key,
          descripcion: tipo.desc,
          subido: true,
          nombreArchivo: resultado.nombreArchivo,
          rutaServidor: resultado.rutaAbsoluta,
        });
      } else {
        archivosAuditor.push({
          tipo: tipo.key,
          descripcion: tipo.desc,
          subido: false,
          nombreArchivo: 'No disponible',
          rutaServidor: null,
        });
      }
    }

    // 4. Construir respuesta INCLUYENDO el acta de supervisión y el modo solo lectura
    const response = {
      data: {
        documento: {
          id: documento.id,
          numeroRadicado: documento.numeroRadicado,
          numeroContrato: documento.numeroContrato,
          nombreContratista: documento.nombreContratista,
          documentoContratista: documento.documentoContratista,
          emailContratista: documento.emailContratista,
          telefonoContratista: documento.telefonoContratista,
          fechaInicio: documento.fechaInicio,
          fechaFin: documento.fechaFin,
          fechaRadicacion: documento.fechaRadicacion,
          radicador: documento.nombreRadicador,
          supervisor: documento.usuarioAsignadoNombre,
          observacion: documento.observacion,
          estado: documento.estado,
          primerRadicadoDelAno: documento.primerRadicadoDelAno,
          usuarioAsignadoNombre: documento.usuarioAsignadoNombre,
          historialEstados: documento.historialEstados || [],
          rutaCarpetaRadicado: documento.rutaCarpetaRadicado,
          cuentaCobro: documento.cuentaCobro,
          seguridadSocial: documento.seguridadSocial,
          informeActividades: documento.informeActividades,
          descripcionCuentaCobro: documento.descripcionCuentaCobro,
          descripcionSeguridadSocial: documento.descripcionSeguridadSocial,
          descripcionInformeActividades: documento.descripcionInformeActividades,
          // ✅ INCLUIR CAMPOS DEL ACTA DE SUPERVISIÓN
          actaSupervisionPath: documento.actaSupervisionPath,
          actaSupervisionNombre: documento.actaSupervisionNombre,
          actaSupervisionFecha: documento.actaSupervisionFecha,
          actaSupervisionSubidaPor: documento.actaSupervisionSubidaPor
        },
        archivosRadicados: [
          { numero: 1, nombre: documento.cuentaCobro, descripcion: documento.descripcionCuentaCobro, tipo: 'cuenta_cobro', existe: !!documento.cuentaCobro },
          { numero: 2, nombre: documento.seguridadSocial, descripcion: documento.descripcionSeguridadSocial, tipo: 'seguridad_social', existe: !!documento.seguridadSocial },
          { numero: 3, nombre: documento.informeActividades, descripcion: documento.descripcionInformeActividades, tipo: 'informe_actividades', existe: !!documento.informeActividades },
        ],
        archivosAuditor,
        // ✅ NUEVO: Indicar si es solo lectura
        esSoloLectura: esSoloLectura,
        auditor: auditorDoc ? {
          id: auditorDoc.id,
          estado: auditorDoc.estado,
          observaciones: auditorDoc.observaciones,
          tieneTodosDocumentos: auditorDoc.tieneTodosDocumentos(),
          puedeSubirDocumentos: !esSoloLectura && documento.primerRadicadoDelAno && documento.estado === 'EN_REVISION_AUDITOR',
          documentosSubidos: archivosAuditor.filter(a => a.subido).map(a => a.tipo),
          documentosFaltantes: this.obtenerDocumentosFaltantes(auditorDoc),
        } : null,
      }
    };

    // Log para verificar el acta en la respuesta
    this.logger.log(`📤 Respuesta - Acta incluida: ${!!response.data.documento.actaSupervisionPath}`);
    this.logger.log(`📤 Modo solo lectura: ${esSoloLectura}`);

    return response;
  } catch (error) {
    this.logger.error(`❌ Error grave en obtenerDocumentoParaVista: ${error.message}`, error.stack);
    throw error;
  }
}


  // ===============================
  // 7. LIBERAR DOCUMENTO
  // ===============================

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

      documento.estado = 'RADICADO';
      documento.fechaActualizacion = new Date();
      documento.ultimoAcceso = new Date();
      documento.ultimoUsuario = `Auditor: ${auditorDoc.auditor.fullName || auditorDoc.auditor.username} (liberó)`;
      documento.usuarioAsignado = null;
      documento.usuarioAsignadoNombre = '';

      const historial = documento.historialEstados || [];
      historial.push({
        fecha: new Date(),
        estado: 'RADICADO',
        usuarioId: auditorId,
        usuarioNombre: auditorDoc.auditor.fullName || auditorDoc.auditor.username,
        rolUsuario: 'AUDITOR_CUENTAS',
        observacion: 'Documento liberado por auditor - Volvió a estado RADICADO'
      });
      documento.historialEstados = historial;

      await queryRunner.manager.save(Documento, documento);

      auditorDoc.estado = AuditorEstado.DISPONIBLE;
      auditorDoc.fechaActualizacion = new Date();
      auditorDoc.fechaFinRevision = new Date();
      auditorDoc.observaciones = 'Documento liberado - Disponible para otros auditores';

      await queryRunner.manager.save(AuditorDocumento, auditorDoc);

      try {
        await this.bitacoraService.registrar(
          AccionBitacora.AUDITOR_LIBERAR,
          ModuloBitacora.AUDITORIA,
          auditorDoc.auditor,
          documento,
          {
            detalles: `Auditor ${auditorDoc.auditor.username} liberó documento`,
            estadoAnterior: 'EN_REVISION_AUDITOR',
            estadoNuevo: 'RADICADO'
          },
        );
      } catch (bitacoraError) {
        this.logger.warn(`⚠️ Error registrando bitácora: ${bitacoraError.message}`);
      }

      if (documento.rutaCarpetaRadicado) {
        await this.registrarAccesoAuditor(
          documento.rutaCarpetaRadicado,
          auditorId,
          `LIBERÓ documento`,
          `Estado: EN_REVISION_AUDITOR → RADICADO`
        );
      }

      await queryRunner.commitTransaction();
      this.logger.log(`✅ Documento ${documento.numeroRadicado} liberado por ${auditorId}. Estado revertido a RADICADO`);

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

  // ===============================
  // 8. OBTENER MIS AUDITORÍAS
  // ===============================

async obtenerMisAuditorias(auditorId: string): Promise<any[]> {
  this.logger.log(`📋 Obteniendo MIS auditorías para auditorId: ${auditorId}`);

  const auditorDocs = await this.auditorRepository.find({
    where: { auditor: { id: auditorId } },
    relations: ['documento', 'documento.radicador', 'auditor'],
    order: { fechaActualizacion: 'DESC' }
  });

  // Procesar cada documento para obtener fechas del contrato si es necesario
  const resultados = [];
  
  for (const ad of auditorDocs) {
    let fechaInicio = ad.documento.fechaInicio;
    let fechaFin = ad.documento.fechaFin;
    
    // Si las fechas están vacías, intentar obtenerlas del contrato
    if (!fechaInicio || !fechaFin) {
      try {
        const contrato = await this.juridicaService.buscarContratoPorNumero(
          ad.documento.numeroContrato
        );
        
        if (contrato) {
          fechaInicio = fechaInicio || contrato.fechaInicio;
          fechaFin = fechaFin || contrato.fechaTerminacion;
          this.logger.log(`📅 Fechas obtenidas del contrato: ${fechaInicio} - ${fechaFin}`);
        }
      } catch (error) {
        this.logger.warn(`⚠️ No se pudo obtener contrato para ${ad.documento.numeroContrato}`);
      }
    }
    
    resultados.push({
      id: ad.documento.id,
      numeroRadicado: ad.documento.numeroRadicado,
      numeroContrato: ad.documento.numeroContrato,
      nombreContratista: ad.documento.nombreContratista,
      documentoContratista: ad.documento.documentoContratista,
      fechaRadicacion: ad.documento.fechaRadicacion,
      fechaInicio: fechaInicio,
      fechaFin: fechaFin,
      estado: ad.documento.estado,
      auditorEstado: ad.estado,
      observaciones: ad.observaciones || '',
      fechaInicioRevision: ad.fechaInicioRevision,
      fechaFinRevision: ad.fechaFinRevision,
      fechaAprobacion: ad.fechaAprobacion,
      primerRadicadoDelAno: ad.documento.primerRadicadoDelAno,
      supervisor: ad.documento.usuarioAsignadoNombre || 'No asignado',
      auditorAsignado: ad.auditor?.fullName || ad.auditor?.username,
      tieneDocumentos: ad.tieneTodosDocumentos()
    });
  }
  
  return resultados;
}

  // ===============================
  // MÉTODOS AUXILIARES PRIVADOS
  // ===============================

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
        }
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
      { tipo: 'rp', descripcion: 'Resolución de Pago', subido: !!auditorDoc?.rpPath, nombreArchivo: auditorDoc?.rpPath },
      { tipo: 'cdp', descripcion: 'Certificado de Disponibilidad Presupuestal', subido: !!auditorDoc?.cdpPath, nombreArchivo: auditorDoc?.cdpPath },
      { tipo: 'poliza', descripcion: 'Póliza', subido: !!auditorDoc?.polizaPath, nombreArchivo: auditorDoc?.polizaPath },
      { tipo: 'certificadoBancario', descripcion: 'Certificado Bancario', subido: !!auditorDoc?.certificadoBancarioPath, nombreArchivo: auditorDoc?.certificadoBancarioPath },
      { tipo: 'minuta', descripcion: 'Minuta', subido: !!auditorDoc?.minutaPath, nombreArchivo: auditorDoc?.minutaPath },
      { tipo: 'actaInicio', descripcion: 'Acta de Inicio', subido: !!auditorDoc?.actaInicioPath, nombreArchivo: auditorDoc?.actaInicioPath }
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

  private async encontrarRutaArchivoAuditor(
    documento: Documento,
    tipoArchivo: 'rpPath' | 'cdpPath' | 'polizaPath' | 'certificadoBancarioPath' | 'minutaPath' | 'actaInicioPath'
  ): Promise<{ rutaAbsoluta: string; nombreArchivo: string; documentoOrigen: Documento } | null> {
    this.logger.debug(`[BUSQUEDA-ARCHIVO] Buscando ${tipoArchivo} para doc ${documento.id}`);

    // Mapear tipoArchivo a tipo de documento
    const mapaTipo: Record<string, { tipoContrato: string; tipoContratista: string }> = {
      rpPath: { tipoContrato: 'RP', tipoContratista: '' },
      cdpPath: { tipoContrato: 'CDP', tipoContratista: '' },
      polizaPath: { tipoContrato: '', tipoContratista: 'GARANTIA' },
      certificadoBancarioPath: { tipoContrato: '', tipoContratista: 'CERTIFICADO_BANCARIO' },
      minutaPath: { tipoContrato: 'MINUTA', tipoContratista: '' },
      actaInicioPath: { tipoContrato: 'ACTA_INICIO', tipoContratista: '' },
    };

    const tipos = mapaTipo[tipoArchivo];
    if (!tipos) {
      this.logger.warn(`⚠️ Tipo de archivo no reconocido: ${tipoArchivo}`);
      return null;
    }

    // 1. PRIMERO: Buscar en auditor_documentos (archivos subidos por el auditor)
    let auditorDoc = await this.auditorDocumentoRepository.findOne({
      where: { documento: { id: documento.id } },
    });

    if (auditorDoc && (auditorDoc as any)[tipoArchivo]) {
      const nombreArchivo = (auditorDoc as any)[tipoArchivo];
      const rutaAbsoluta = path.join(documento.rutaCarpetaRadicado, nombreArchivo);
      if (fs.existsSync(rutaAbsoluta)) {
        this.logger.debug(`[BUSQUEDA-ARCHIVO] ✅ Encontrado en auditor_documentos: ${nombreArchivo}`);
        return { rutaAbsoluta, nombreArchivo, documentoOrigen: documento };
      }
    }

    // 2. SEGUNDO: Buscar en DOCUMENTOS DEL CONTRATO (para RP, CDP, Minuta, Acta de Inicio)
    if (tipos.tipoContrato) {
      try {
        const contrato = await this.juridicaService.buscarContratoPorNumero(documento.numeroContrato);

        if (contrato && contrato.documentos && contrato.documentos.length > 0) {
          const docContrato = contrato.documentos.find((doc: any) => {
            const tipoDoc = doc.tipoDocumento?.toUpperCase() || '';
            return tipoDoc === tipos.tipoContrato || tipoDoc.includes(tipos.tipoContrato);
          });

          if (docContrato && docContrato.rutaArchivo) {
            let rutaAbsoluta = docContrato.rutaArchivo;
            if (!path.isAbsolute(rutaAbsoluta)) {
              const basePath = this.configService.get('STORAGE_LOCAL_PATH') || '\\\\R2-D2\\api-contract';
              rutaAbsoluta = path.join(basePath, rutaAbsoluta);
            }

            if (fs.existsSync(rutaAbsoluta)) {
              this.logger.debug(`[BUSQUEDA-ARCHIVO] ✅ Encontrado en documentos_contrato: ${docContrato.nombreArchivo}`);
              return {
                rutaAbsoluta,
                nombreArchivo: docContrato.nombreArchivo,
                documentoOrigen: documento
              };
            }
          }
        }
      } catch (error) {
        this.logger.warn(`⚠️ Error buscando en contrato: ${error.message}`);
      }
    }

    // 3. TERCERO: Buscar en DOCUMENTOS DEL CONTRATISTA (para Póliza, Certificado Bancario)
    if (tipos.tipoContratista) {
      try {
        const contratista = await this.buscarContratistaPorNumeroContrato(documento.numeroContrato);

        if (contratista && contratista.documentos && contratista.documentos.length > 0) {
          const docContratista = contratista.documentos.find((doc: any) => {
            const tipoDoc = doc.tipo?.toUpperCase() || '';
            return tipoDoc === tipos.tipoContratista || tipoDoc.includes(tipos.tipoContratista);
          });

          if (docContratista && docContratista.rutaArchivo) {
            let rutaAbsoluta = docContratista.rutaArchivo;
            if (!path.isAbsolute(rutaAbsoluta)) {
              const basePath = this.configService.get('STORAGE_LOCAL_PATH') || '\\\\R2-D2\\api-contract';
              rutaAbsoluta = path.join(basePath, rutaAbsoluta);
            }

            if (fs.existsSync(rutaAbsoluta)) {
              this.logger.debug(`[BUSQUEDA-ARCHIVO] ✅ Encontrado en documentos_contratista: ${docContratista.nombreArchivo}`);
              return {
                rutaAbsoluta,
                nombreArchivo: docContratista.nombreArchivo,
                documentoOrigen: documento
              };
            }
          }
        }
      } catch (error) {
        this.logger.warn(`⚠️ Error buscando en contratista: ${error.message}`);
      }
    }

    // 4. CUARTO: Buscar en el PRIMER RADICADO del año (solo si no es primer radicado)
    if (!documento.primerRadicadoDelAno) {
      const primerRadicado = await this.documentoRepository.findOne({
        where: {
          numeroContrato: documento.numeroContrato,
          primerRadicadoDelAno: true,
        },
        order: { fechaRadicacion: 'ASC' },
      });

      if (primerRadicado) {
        const auditorDocPrimero = await this.auditorDocumentoRepository.findOne({
          where: { documento: { id: primerRadicado.id } },
        });

        if (auditorDocPrimero && (auditorDocPrimero as any)[tipoArchivo]) {
          const nombreArchivo = (auditorDocPrimero as any)[tipoArchivo];
          const rutaAbsoluta = path.join(primerRadicado.rutaCarpetaRadicado, nombreArchivo);
          if (fs.existsSync(rutaAbsoluta)) {
            this.logger.debug(`[BUSQUEDA-ARCHIVO] ✅ Encontrado en primer radicado (${primerRadicado.numeroRadicado}): ${nombreArchivo}`);
            return { rutaAbsoluta, nombreArchivo, documentoOrigen: primerRadicado };
          }
        }
      }
    }

    this.logger.debug(`[BUSQUEDA-ARCHIVO] ❌ No se encontró ${tipoArchivo} para el documento ${documento.id}.`);
    return null;
  }

  // ===============================
  // MÉTODOS DE SUBIDA DE DOCUMENTOS
  // ===============================

  async subirDocumentosAuditor(
    documentoId: string,
    auditorId: string,
    datos: { observaciones?: string; estado?: AuditorEstado },
    files: { [key: string]: Express.Multer.File[] },
  ) {
    this.logger.log(`📤 subirDocumentosAuditor - doc:${documentoId} auditor:${auditorId}`);

    const documento = await this.documentoRepository.findOne({ where: { id: documentoId } });
    if (!documento) throw new NotFoundException(`Documento ${documentoId} no encontrado`);

    const carpetaAuditor = path.join(documento.rutaCarpetaRadicado, 'auditor');
    if (!fs.existsSync(carpetaAuditor)) {
      fs.mkdirSync(carpetaAuditor, { recursive: true });
    }

    let auditorDoc = await this.auditorDocumentoRepository.findOne({
      where: { documento: { id: documentoId }, auditor: { id: auditorId } },
    });

    if (!auditorDoc) {
      auditorDoc = this.auditorDocumentoRepository.create({
        documento: { id: documentoId },
        auditor: { id: auditorId },
        estado: AuditorEstado.EN_REVISION,
        fechaCreacion: new Date(),
        fechaActualizacion: new Date(),
        fechaInicioRevision: new Date(),
        observaciones: datos.observaciones || '',
      });
    }

    const archivosGuardados: Record<string, string> = {};
    const campos = [
      { name: 'rp', pathKey: 'rpPath' },
      { name: 'cdp', pathKey: 'cdpPath' },
      { name: 'poliza', pathKey: 'polizaPath' },
      { name: 'certificadoBancario', pathKey: 'certificadoBancarioPath' },
      { name: 'minuta', pathKey: 'minutaPath' },
      { name: 'actaInicio', pathKey: 'actaInicioPath' },
    ];

    for (const campo of campos) {
      const archivosCampo = files[campo.name];
      if (!archivosCampo?.length) continue;

      const file = archivosCampo[0];
      const ext = extname(file.originalname).toLowerCase() || '.pdf';
      const nombreFinal = `${campo.name}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      const rutaAbsoluta = path.join(carpetaAuditor, nombreFinal);
      const rutaRelativa = path.join('auditor', nombreFinal);

      fs.copyFileSync(file.path, rutaAbsoluta);
      (auditorDoc as any)[campo.pathKey] = rutaRelativa;
      archivosGuardados[campo.name] = rutaRelativa;

      try { fs.unlinkSync(file.path); } catch (e) { }
    }

    const saved = await this.auditorDocumentoRepository.save(auditorDoc);

    return {
      success: true,
      auditorDocumentoId: saved.id,
      estado: saved.estado,
      archivosGuardados,
      observaciones: saved.observaciones,
      mensaje: 'Archivos procesados correctamente',
    };
  }

  // ===============================
  // MÉTODOS DE DESCARGA DE ARCHIVOS
  // ===============================

  async descargarArchivoRadicado(
    documentoId: string,
    numeroArchivo: number,
    auditorId: string
  ): Promise<{ ruta: string; nombre: string }> {
    const documento = await this.documentoRepository.findOne({ where: { id: documentoId } });
    if (!documento) throw new NotFoundException('Documento no encontrado');

    let nombreArchivo: string;
    switch (numeroArchivo) {
      case 1: nombreArchivo = documento.cuentaCobro; break;
      case 2: nombreArchivo = documento.seguridadSocial; break;
      case 3: nombreArchivo = documento.informeActividades; break;
      default: throw new BadRequestException('Número de archivo inválido (1-3)');
    }

    if (!nombreArchivo) throw new NotFoundException('Archivo no encontrado');

    const rutaCompleta = path.join(documento.rutaCarpetaRadicado, nombreArchivo);
    if (!fs.existsSync(rutaCompleta)) throw new NotFoundException(`Archivo no encontrado: ${nombreArchivo}`);

    await this.registrarAccesoAuditor(documento.rutaCarpetaRadicado, auditorId, `DESCARGÓ archivo radicado`, `Archivo ${numeroArchivo}`);

    return { ruta: rutaCompleta, nombre: nombreArchivo };
  }

  async descargarArchivoAuditor(
    documentoId: string,
    tipoArchivo: string,
    auditorId: string
  ): Promise<{ ruta: string; nombre: string }> {
    const { rutaAbsoluta, nombreArchivo } = await this.obtenerRutaArchivoAuditorFull(documentoId, tipoArchivo, auditorId);
    await this.registrarAccesoAuditor(path.dirname(rutaAbsoluta), auditorId, `DESCARGÓ archivo de auditor`, `Tipo: ${tipoArchivo}`);
    return { ruta: rutaAbsoluta, nombre: nombreArchivo };
  }

  async buscarContratistaPorNumeroContrato(numeroContrato: string): Promise<Contratista | null> {
    this.logger.log(`🔍 Buscando contratista por número de contrato: ${numeroContrato}`);

    try {
      // ✅ El método ya devuelve Contratista | null
      const contratista = await this.contratistaService.buscarPorNumeroContratoExacto(numeroContrato);

      if (!contratista) {
        this.logger.warn(`⚠️ No se encontró contratista para el contrato: ${numeroContrato}`);
        return null;
      }

      this.logger.log(`✅ Contratista encontrado: ${contratista.razonSocial}`);
      return contratista;
    } catch (error) {
      this.logger.error(`❌ Error buscando contratista: ${error.message}`);
      return null;
    }
  }
  // ===============================
  // MÉTODO CORREGIDO PARA OBTENER RUTA DE ARCHIVO AUDITOR
  // ===============================

  async obtenerRutaArchivoAuditorFull(
    documentoId: string,
    tipo: string,
    userId?: string,
  ): Promise<{ rutaAbsoluta: string; nombreArchivo: string }> {
    this.logger.log(`🔍 Buscando archivo auditor: ${tipo} para documento ${documentoId}`);

    // Obtener el documento principal
    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId },
      relations: ['radicador']
    });

    if (!documento) {
      throw new NotFoundException(`Documento ${documentoId} no encontrado`);
    }

    let rutaRelativa: string | null = null;
    let fuente = '';

    // Mapear tipo a la fuente correspondiente
    const tiposContrato = ['rp', 'cdp', 'minuta', 'actaInicio'];
    const tiposContratista = ['poliza', 'certificadoBancario'];

    try {
      if (tiposContrato.includes(tipo)) {
        // Buscar en documentos del CONTRATO
        fuente = 'contrato';
        const numeroContrato = documento.numeroContrato;

        // ✅ CORREGIDO: usar buscarContratoPorNumero en lugar de obtenerContratoPorNumero
        const contrato = await this.juridicaService.buscarContratoPorNumero(numeroContrato);

        if (contrato && contrato.documentos) {
          let tipoDocumento = '';
          switch (tipo) {
            case 'rp': tipoDocumento = 'RP'; break;
            case 'cdp': tipoDocumento = 'CDP'; break;
            case 'minuta': tipoDocumento = 'MINUTA'; break;
            case 'actaInicio': tipoDocumento = 'ACTA_INICIO'; break;
          }

          const documentoContrato = contrato.documentos.find((doc: any) =>
            doc.tipoDocumento === tipoDocumento ||
            doc.tipoDocumento?.toUpperCase().includes(tipoDocumento)
          );

          if (documentoContrato && documentoContrato.rutaArchivo) {
            rutaRelativa = documentoContrato.rutaArchivo;
            this.logger.log(`✅ ${tipo} encontrado en contrato: ${rutaRelativa}`);
          }
        }
      }
      else if (tiposContratista.includes(tipo)) {
        // Buscar en documentos del CONTRATISTA
        fuente = 'contratista';
        const numeroContrato = documento.numeroContrato;

        // ✅ CORREGIDO: usar buscarContratistaPorNumeroContrato
        const contratista = await this.buscarContratistaPorNumeroContrato(numeroContrato);

        if (contratista && contratista.documentos) {
          let tipoDocumento = '';
          switch (tipo) {
            case 'poliza': tipoDocumento = 'GARANTIA'; break;
            case 'certificadoBancario': tipoDocumento = 'CERTIFICADO_BANCARIO'; break;
          }

          const documentoContratista = contratista.documentos.find((doc: any) =>
            doc.tipo === tipoDocumento ||
            doc.tipo?.toUpperCase().includes(tipoDocumento)
          );

          if (documentoContratista && documentoContratista.rutaArchivo) {
            rutaRelativa = documentoContratista.rutaArchivo;
            this.logger.log(`✅ ${tipo} encontrado en contratista: ${rutaRelativa}`);
          }
        }
      }
      else {
        throw new BadRequestException(`Tipo de archivo no soportado: ${tipo}`);
      }

      if (!rutaRelativa) {
        this.logger.warn(`⚠️ No se encontró ${tipo} en ${fuente}`);
        throw new NotFoundException(`No se encontró el archivo ${tipo} en ${fuente}`);
      }

      // Construir ruta absoluta
      let rutaAbsoluta = rutaRelativa;
      if (!path.isAbsolute(rutaAbsoluta)) {
        // Si la ruta es relativa, construir a partir de la carpeta base
        const basePath = this.configService.get('STORAGE_LOCAL_PATH') || '\\\\R2-D2\\api-contract';
        rutaAbsoluta = path.join(basePath, rutaRelativa);
      }

      // Verificar que el archivo existe
      if (!fs.existsSync(rutaAbsoluta)) {
        this.logger.error(`❌ Archivo no existe en disco: ${rutaAbsoluta}`);
        throw new NotFoundException(`El archivo ${tipo} no existe físicamente en el servidor`);
      }

      return {
        rutaAbsoluta,
        nombreArchivo: path.basename(rutaRelativa)
      };

    } catch (error) {
      this.logger.error(`❌ Error obteniendo ${tipo}: ${error.message}`);
      throw error;
    }
  }

  // ===============================
  // MÉTODOS DE ESTADÍSTICAS Y HISTORIAL
  // ===============================

  async obtenerEstadisticasAuditor(auditorId: string): Promise<any> {
    const [enRevision, aprobados, observados, rechazados, completados] = await Promise.all([
      this.auditorRepository.count({ where: { auditor: { id: auditorId }, estado: AuditorEstado.EN_REVISION } }),
      this.auditorRepository.count({ where: { auditor: { id: auditorId }, estado: AuditorEstado.APROBADO } }),
      this.auditorRepository.count({ where: { auditor: { id: auditorId }, estado: AuditorEstado.OBSERVADO } }),
      this.auditorRepository.count({ where: { auditor: { id: auditorId }, estado: AuditorEstado.RECHAZADO } }),
      this.auditorRepository.count({ where: { auditor: { id: auditorId }, estado: AuditorEstado.COMPLETADO } }),
    ]);

    return {
      misDocumentos: {
        enRevision,
        aprobados,
        observados,
        rechazados,
        completados,
        total: enRevision + aprobados + observados + rechazados + completados
      },
      fechaConsulta: new Date().toISOString()
    };
  }

  async obtenerHistorialAuditor(auditorId: string): Promise<any[]> {
  this.logger.log(`📋 [SERVICE] Obteniendo historial para auditor: ${auditorId}`);

  try {
    const auditorDocs = await this.auditorRepository.find({
      where: { auditor: { id: auditorId } },
      relations: ['documento', 'documento.radicador', 'auditor'],
      order: { fechaActualizacion: 'DESC' },
    });

    this.logger.log(`✅ [SERVICE] ${auditorDocs.length} registros encontrados`);

    if (auditorDocs.length > 0) {
      this.logger.log(`[SERVICE] Primer registro - Estado: ${auditorDocs[0].estado}, Documento: ${auditorDocs[0].documento?.numeroRadicado}`);
    }

    return auditorDocs.map(ad => ({
      id: ad.id,
      documento: {
        id: ad.documento?.id,
        numeroRadicado: ad.documento?.numeroRadicado || 'N/A',
        fechaRadicacion: ad.documento?.fechaRadicacion,
        nombreContratista: ad.documento?.nombreContratista || 'N/A',
        documentoContratista: ad.documento?.documentoContratista || 'N/A',
        numeroContrato: ad.documento?.numeroContrato || 'N/A',
        fechaInicio: ad.documento?.fechaInicio,
        // ✅ CORREGIDO: Usar fechaTerminacionContrato
        fechaFin: ad.documento?.fechaFin || null,
        fechaTerminacionContrato: ad.documento?.fechaFin || null,
        cuentaCobro: ad.documento?.cuentaCobro,
        seguridadSocial: ad.documento?.seguridadSocial,
        informeActividades: ad.documento?.informeActividades,
        primerRadicadoDelAno: ad.documento?.primerRadicadoDelAno || false,
        comentarios: ad.documento?.comentarios || '',
        observaciones: ad.documento?.observacion || '',
        estado: ad.documento?.estado || ''
      },
      // ✅ También incluir en el nivel superior para fácil acceso
      fechaInicio: ad.documento?.fechaInicio,
      fechaFin: ad.documento?.fechaFin || null,
      fechaTerminacionContrato: ad.documento?.fechaFin || null,
      estado: ad.estado,
      observaciones: ad.observaciones || '',
      motivoRechazo: ad.observaciones || '',
      fechaRechazo: ad.fechaAprobacion || ad.fechaActualizacion || ad.fechaCreacion,
      fechaActualizacion: ad.fechaActualizacion || ad.fechaCreacion,
      fechaCreacion: ad.fechaCreacion,
      fechaAprobacion: ad.fechaAprobacion,
      fechaInicioRevision: ad.fechaInicioRevision,
      fechaFinRevision: ad.fechaFinRevision,
      auditorRevisor: ad.auditor?.fullName || ad.auditor?.username || '',
      usuarioAsignadoNombre: ad.auditor?.fullName || ad.auditor?.username || '',
      rechazadoPor: ad.auditor?.fullName || ad.auditor?.username || '',
      rpPath: ad.rpPath,
      cdpPath: ad.cdpPath,
      polizaPath: ad.polizaPath,
      certificadoBancarioPath: ad.certificadoBancarioPath,
      minutaPath: ad.minutaPath,
      actaInicioPath: ad.actaInicioPath
    }));
  } catch (error) {
    this.logger.error(`❌ [SERVICE] Error obteniendo historial: ${error.message}`);
    throw error;
  }
}

  async obtenerEstadoArchivos(documentoId: string, auditorId: string): Promise<any> {
    const documento = await this.documentoRepository.findOne({ where: { id: documentoId } });
    if (!documento) throw new NotFoundException('Documento no encontrado');

    const auditorDoc = await this.auditorRepository.findOne({
      where: { documento: { id: documentoId }, auditor: { id: auditorId } }
    });

    const esPrimerRadicado = documento.primerRadicadoDelAno;

    const archivosAuditoria = [
      { tipo: 'rp', nombre: 'Resolución de Pago', requerido: esPrimerRadicado, subido: !!auditorDoc?.rpPath },
      { tipo: 'cdp', nombre: 'Certificado de Disponibilidad Presupuestal', requerido: esPrimerRadicado, subido: !!auditorDoc?.cdpPath },
      { tipo: 'poliza', nombre: 'Póliza', requerido: esPrimerRadicado, subido: !!auditorDoc?.polizaPath },
      { tipo: 'certificadoBancario', nombre: 'Certificado Bancario', requerido: esPrimerRadicado, subido: !!auditorDoc?.certificadoBancarioPath },
      { tipo: 'minuta', nombre: 'Minuta', requerido: esPrimerRadicado, subido: !!auditorDoc?.minutaPath },
      { tipo: 'actaInicio', nombre: 'Acta de Inicio', requerido: esPrimerRadicado, subido: !!auditorDoc?.actaInicioPath },
    ];

    return {
      documento: { id: documento.id, numeroRadicado: documento.numeroRadicado, primerRadicadoDelAno: esPrimerRadicado, estado: documento.estado },
      archivos: archivosAuditoria,
      resumen: {
        totalRequeridos: esPrimerRadicado ? 6 : 0,
        totalSubidos: archivosAuditoria.filter(a => a.subido).length,
        completado: esPrimerRadicado ? archivosAuditoria.filter(a => a.subido).length === 6 : true
      }
    };
  }

  async obtenerDocumentoDebug(documentoId: string, auditorId: string): Promise<any> {
    const documento = await this.documentoRepository.findOne({ where: { id: documentoId } });
    if (!documento) throw new NotFoundException('Documento no encontrado');

    const auditorDoc = await this.auditorRepository.findOne({
      where: { documento: { id: documentoId }, auditor: { id: auditorId } }
    });

    return {
      debug: true,
      timestamp: new Date().toISOString(),
      documento: { id: documento.id, numeroRadicado: documento.numeroRadicado, estado: documento.estado, primerRadicadoDelAno: documento.primerRadicadoDelAno },
      auditorDoc: auditorDoc ? { id: auditorDoc.id, estado: auditorDoc.estado } : null,
      usuario: await this.userRepository.findOne({ where: { id: auditorId }, select: ['id', 'username', 'fullName', 'role'] })
    };
  }

  async diagnosticoDocumentos(documentoId: string, auditorId: string): Promise<any> {
    const auditorDoc = await this.auditorRepository.findOne({
      where: { documento: { id: documentoId }, auditor: { id: auditorId } },
      relations: ['documento']
    });

    return {
      auditorDoc: {
        id: auditorDoc?.id,
        estado: auditorDoc?.estado,
        tieneTodosDocumentos: auditorDoc?.tieneTodosDocumentos(),
        archivos: {
          rp: auditorDoc?.rpPath, cdp: auditorDoc?.cdpPath, poliza: auditorDoc?.polizaPath,
          certificadoBancario: auditorDoc?.certificadoBancarioPath,
          minuta: auditorDoc?.minutaPath, actaInicio: auditorDoc?.actaInicioPath
        }
      },
      documento: { id: documentoId, numeroRadicado: auditorDoc?.documento?.numeroRadicado, primerRadicadoDelAno: auditorDoc?.documento?.primerRadicadoDelAno }
    };
  }

  async convertirWordAPdf(inputPath: string, outputPath: string): Promise<void> {
    const cmd = `soffice --headless --convert-to pdf --outdir "${path.dirname(outputPath)}" "${inputPath}"`;
    await exec(cmd, (error) => { if (error) throw error; });
    const pdfGenerado = path.join(path.dirname(outputPath), path.basename(inputPath).replace(/\.(docx|doc)$/i, '.pdf'));
    fs.renameSync(pdfGenerado, outputPath);
  }

  async asignarDocumentoAAuditoresAutomaticamente(documentoId: string): Promise<void> {
    try {
      this.logger.log(`🔄 Asignando documento ${documentoId} a auditores automáticamente...`);

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

      const asignacionesExistentes = await this.auditorRepository.find({
        where: { documento: { id: documentoId } }
      });

      if (asignacionesExistentes.length > 0) {
        this.logger.log(`✅ Documento ${documentoId} ya tiene ${asignacionesExistentes.length} asignaciones`);
        return;
      }

      const auditores = await this.userRepository.find({
        where: {
          role: UserRole.AUDITOR_CUENTAS,
          isActive: true
        }
      });

      if (auditores.length === 0) {
        this.logger.warn('⚠️ No hay auditores disponibles para asignar documento');
        return;
      }

      this.logger.log(`👥 ${auditores.length} auditores activos encontrados`);

      for (const auditor of auditores) {
        try {
          const auditorDoc = this.auditorRepository.create({
            documento: documento,
            auditor: auditor,
            estado: AuditorEstado.DISPONIBLE,
            fechaCreacion: new Date(),
            fechaActualizacion: new Date()
          });

          await this.auditorRepository.save(auditorDoc);
          this.logger.log(`✅ Documento ${documento.numeroRadicado} marcado como disponible para auditor ${auditor.username}`);
        } catch (error) {
          this.logger.error(`❌ Error asignando a auditor ${auditor.username}: ${error.message}`);
        }
      }

      this.logger.log(`✅ Documento ${documento.numeroRadicado} disponible para ${auditores.length} auditores`);
    } catch (error) {
      this.logger.error(`❌ Error en asignación automática: ${error.message}`);
      throw new InternalServerErrorException('Error al asignar documento a auditores');
    }
  }

  // ===============================
  // MÉTODOS PARA ACCEDER A DOCUMENTOS DEL CONTRATO (SIN HTTP)
  // ===============================

  async obtenerDocumentoContratoPorId(documentoId: string): Promise<any> {
    try {
      // Usar juridicaService para obtener el documento
      const documentoContrato = await this.juridicaService.obtenerDocumentoContratoPorId(documentoId);
      return documentoContrato;
    } catch (error) {
      this.logger.error(`Error obteniendo documento del contrato: ${error.message}`);
      throw error;
    }
  }

  async obtenerBufferDocumentoContrato(documentoId: string): Promise<{ buffer: Buffer; nombre: string; mimeType: string }> {
    try {
      return await this.juridicaService.previsualizarDocumentoContrato(documentoId);
    } catch (error) {
      this.logger.error(`Error obteniendo buffer del documento: ${error.message}`);
      throw error;
    }
  }

  async obtenerDocumentoConActa(documentoId: string): Promise<Documento> {
    this.logger.log(`[SERVICE] Buscando documento ${documentoId} para acta`);

    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId },
      select: [
        'id',
        'numeroRadicado',
        'actaSupervisionPath',
        'actaSupervisionNombre',
        'actaSupervisionFecha',
        'actaSupervisionSubidaPor',
        'estado'
      ]
    });

    if (!documento) {
      throw new NotFoundException(`Documento ${documentoId} no encontrado`);
    }

    this.logger.log(`[SERVICE] Documento encontrado - Acta path: ${documento.actaSupervisionPath || 'No tiene acta'}`);

    return documento;
  }
  
}