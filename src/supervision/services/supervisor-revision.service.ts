// src/supervision/services/supervisor-revision.service.ts

import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { promises as fsPromises } from 'fs';

import { SupervisorDocumento, SupervisorEstado } from '../entities/supervisor.entity';
import { Documento } from '../../radicacion/entities/documento.entity';
import { User } from '../../users/entities/user.entity';
import { RevisarDocumentoDto } from '../dto/revisar-documento.dto';
import { StorageService } from '../../common/storage/storage.service';
import { SignaturesService } from '../../signatures/signatures.service';
import { SupervisorSignatureService } from './supervisor-signature.service';

@Injectable()
export class SupervisorRevisionService {
  private readonly logger = new Logger(SupervisorRevisionService.name);

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

  // ==================== MÉTODO PRINCIPAL PARA REVISAR DOCUMENTO ====================
  public async revisarDocumento(
    documentoId: string,
    supervisorId: string,
    revisarDto: RevisarDocumentoDto,
    archivoSupervisor?: Express.Multer.File,
    pazSalvoArchivo?: Express.Multer.File
  ): Promise<{ supervisor: SupervisorDocumento; documento: Documento }> {
    const logPrefix = `[revisarDocumento] doc=${documentoId} sup=${supervisorId}`;

    const queryRunner = this.documentoRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      this.logger.log(`${logPrefix} ===== INICIO REVISAR DOCUMENTO =====`);
      this.logger.log(`${logPrefix} Estado: ${revisarDto.estado}`);
      this.logger.log(`${logPrefix} Tiene signatureId: ${!!revisarDto.signatureId}`);
      this.logger.log(`${logPrefix} Tiene signaturePosition: ${!!revisarDto.signaturePosition}`);

      // Validar estados permitidos
      const estadosValidos = [
        SupervisorEstado.APROBADO,
        SupervisorEstado.OBSERVADO,
        SupervisorEstado.RECHAZADO,
        'DEVUELTO' as any
      ];

      if (!estadosValidos.includes(revisarDto.estado as any)) {
        throw new BadRequestException(`Estado inválido: ${revisarDto.estado}`);
      }

      // Obtener el registro del supervisor
      const supervisorDoc = await queryRunner.manager.findOne(SupervisorDocumento, {
        where: {
          documento: { id: documentoId },
          supervisor: { id: supervisorId }
        },
        relations: ['documento', 'supervisor']
      });

      if (!supervisorDoc) {
        throw new ForbiddenException('No tienes este documento asignado. Debes tomarlo primero.');
      }

      if (supervisorDoc.estado !== SupervisorEstado.EN_REVISION &&
          supervisorDoc.estado !== SupervisorEstado.OBSERVADO) {
        throw new ForbiddenException(`El documento está en estado ${supervisorDoc.estado}, no puede ser modificado.`);
      }

      const documento = supervisorDoc.documento;
      const supervisor = supervisorDoc.supervisor;

      // Validar observación para estados que la requieren
      if ((revisarDto.estado === SupervisorEstado.OBSERVADO ||
        revisarDto.estado === SupervisorEstado.RECHAZADO) &&
        (!revisarDto.observacion || revisarDto.observacion.trim() === '')) {
        throw new BadRequestException('Se requiere una observación para este estado');
      }

      // ==================== APLICAR FIRMA (SOLO PARA APROBADO Y CON DATOS DE FIRMA) ====================
      let actaFirmadaPath: string | null = null;
      let actaFirmadaNombre: string | null = null;
      let fechaFirma: Date | null = null;

     if (revisarDto.estado === SupervisorEstado.APROBADO &&
    revisarDto.signatureId &&
    revisarDto.signaturePosition) {

  this.logger.log(`${logPrefix} 🔏 Aplicando firma digital al acta...`);

  try {
    // Verificar que tenga acta de supervisión
    if (!documento.actaSupervisionPath) {
      throw new BadRequestException('El documento no tiene acta de supervisión para firmar');
    }

    // Verificar que no tenga ya un acta firmada
    if (documento.actaFirmadaPath) {
      throw new BadRequestException('El documento ya tiene un acta firmada');
    }

    // Parsear la posición de la firma
    let position: { page: number; x: number; y: number; width: number; height: number };
    if (typeof revisarDto.signaturePosition === 'string') {
      position = JSON.parse(revisarDto.signaturePosition);
    } else {
      position = revisarDto.signaturePosition;
    }

    const finalPosition = {
      page: position.page || 1,
      x: position.x,
      y: position.y,
      width: position.width || 180,
      height: position.height || 80
    };

    // ✅ OBTENER EL BUFFER DEL ACTA DE SUPERVISIÓN - Usando fs directamente
    let actaBuffer: Buffer;
    let actaPath = documento.actaSupervisionPath;
    
    // Intentar diferentes formas de construir la ruta
    if (fs.existsSync(actaPath)) {
      actaBuffer = fs.readFileSync(actaPath);
      this.logger.log(`${logPrefix} Acta encontrada en ruta absoluta: ${actaPath}`);
    } else {
      // Intentar construir ruta con la carpeta del documento
      const rutaCompleta = path.join(documento.rutaCarpetaRadicado, actaPath);
      if (fs.existsSync(rutaCompleta)) {
        actaBuffer = fs.readFileSync(rutaCompleta);
        this.logger.log(`${logPrefix} Acta encontrada en: ${rutaCompleta}`);
      } else {
        // Intentar buscar el archivo en la carpeta del documento
        const carpetaDoc = documento.rutaCarpetaRadicado;
        this.logger.log(`${logPrefix} Buscando en carpeta: ${carpetaDoc}`);
        
        if (fs.existsSync(carpetaDoc)) {
          const archivos = fs.readdirSync(carpetaDoc);
          const pdfs = archivos.filter(f => f.toLowerCase().endsWith('.pdf'));
          this.logger.log(`${logPrefix} PDFs encontrados: ${pdfs.join(', ')}`);
          
          // Buscar acta por nombre
          const actaPdf = pdfs.find(f => f.includes('acta_supervision') || f.includes('acta'));
          if (actaPdf) {
            const rutaActa = path.join(carpetaDoc, actaPdf);
            actaBuffer = fs.readFileSync(rutaActa);
            this.logger.log(`${logPrefix} Acta encontrada como: ${actaPdf}`);
          } else {
            throw new NotFoundException(`No se encontró el archivo del acta de supervisión en ${carpetaDoc}`);
          }
        } else {
          throw new NotFoundException(`La carpeta del documento no existe: ${carpetaDoc}`);
        }
      }
    }
    
    this.logger.log(`${logPrefix} Acta cargada, tamaño: ${actaBuffer.length} bytes`);

    // ✅ APLICAR FIRMA
    const signedBuffer = await this.supervisorSignatureService.aplicarFirmaEnActa(
      actaBuffer,
      revisarDto.signatureId,
      finalPosition
    );

    // ✅ GUARDAR EL PDF FIRMADO
    fechaFirma = new Date();
    
    // Crear carpeta de firmas
    const firmasDir = path.join(documento.rutaCarpetaRadicado, 'firmas');
    if (!fs.existsSync(firmasDir)) {
      fs.mkdirSync(firmasDir, { recursive: true });
    }
    
    actaFirmadaNombre = `acta_firmada_${documento.numeroRadicado}_${fechaFirma.getTime()}.pdf`;
    const rutaRelativaFirmada = path.join('firmas', actaFirmadaNombre).replace(/\\/g, '/');
    const rutaAbsolutaFirmada = path.join(firmasDir, actaFirmadaNombre);
    
    fs.writeFileSync(rutaAbsolutaFirmada, signedBuffer);
    actaFirmadaPath = rutaRelativaFirmada;

    this.logger.log(`${logPrefix} ✅ Acta firmada guardada: ${actaFirmadaPath}`);

    // ============================================================
    // ✅ ACTUALIZAR LA TABLA documentos CON EL ACTA FIRMADA
    // ============================================================
    documento.actaFirmadaPath = actaFirmadaPath;
    documento.actaFirmadaNombre = actaFirmadaNombre;
    documento.actaFirmadaFecha = fechaFirma;
    documento.actaFirmadaPor = supervisorId;

    // ============================================================
    // ✅ ACTUALIZAR LA TABLA supervisor_documentos CON EL ACTA FIRMADA
    // ============================================================
    supervisorDoc.actaFirmadaPath = actaFirmadaPath;
    supervisorDoc.actaFirmadaNombre = actaFirmadaNombre;
    supervisorDoc.fechaFirma = fechaFirma;
    supervisorDoc.fechaAprobacion = fechaFirma;

  } catch (error) {
    this.logger.error(`${logPrefix} ❌ Error aplicando firma: ${error.message}`);
    throw new BadRequestException(`Error al aplicar la firma digital: ${error.message}`);
  }
}

      // ==================== GUARDAR ARCHIVOS DE APROBACIÓN ====================

      if (archivoSupervisor && revisarDto.estado === SupervisorEstado.APROBADO) {
        try {
          const nombreArchivo = await this.guardarArchivoSupervisor(documento, archivoSupervisor, 'aprobacion');
          supervisorDoc.nombreArchivoSupervisor = nombreArchivo;
          this.logger.log(`${logPrefix} ✅ Archivo aprobación guardado: ${nombreArchivo}`);
        } catch (error) {
          this.logger.error(`${logPrefix} Error guardando aprobación: ${error.message}`);
          throw new BadRequestException(`Error al guardar archivo de aprobación: ${error.message}`);
        }
      }

      if (pazSalvoArchivo && revisarDto.estado === SupervisorEstado.APROBADO && revisarDto.esUltimoRadicado) {
        try {
          const nombrePazSalvo = await this.guardarArchivoSupervisor(documento, pazSalvoArchivo, 'paz_salvo');
          supervisorDoc.pazSalvo = nombrePazSalvo;
          this.logger.log(`${logPrefix} ✅ Paz y salvo guardado: ${nombrePazSalvo}`);
        } catch (error) {
          this.logger.error(`${logPrefix} Error guardando paz y salvo: ${error.message}`);
          throw new BadRequestException(`Error al guardar paz y salvo: ${error.message}`);
        }
      }

      // ==================== ACTUALIZAR ESTADOS ====================

      const estadoAnterior = supervisorDoc.estado;

      supervisorDoc.estado = revisarDto.estado;
      supervisorDoc.observacion = revisarDto.observacion?.trim() || '';
      supervisorDoc.correcciones = revisarDto.correcciones?.trim() || '';
      supervisorDoc.fechaActualizacion = new Date();
      supervisorDoc.fechaFinRevision = new Date();

      if (revisarDto.estado === SupervisorEstado.APROBADO && !supervisorDoc.fechaAprobacion) {
        supervisorDoc.fechaAprobacion = fechaFirma || new Date();
      }

      documento.ultimoAcceso = new Date();
      documento.ultimoUsuario = `Supervisor: ${supervisorDoc.supervisor.fullName || supervisorDoc.supervisor.username}`;
      documento.fechaActualizacion = new Date();
      documento.esUltimoRadicado = revisarDto.esUltimoRadicado || false;

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
        case 'DEVUELTO':
          documento.estado = 'DEVUELTO_SUPERVISOR';
          documento.comentarios = revisarDto.observacion || 'Devuelto por supervisor';
          documento.correcciones = revisarDto.correcciones?.trim() || '';
          break;
      }

      this.agregarAlHistorial(documento, supervisorDoc.supervisor, estadoAnterior, revisarDto.estado, revisarDto.observacion);

      // ==================== GUARDAR EN BASE DE DATOS ====================

      await queryRunner.manager.save(documento);
      this.logger.log(`${logPrefix} ✅ Documento principal guardado - Nuevo estado: ${documento.estado}`);

      const savedSupervisorDoc = await queryRunner.manager.save(supervisorDoc);
      this.logger.log(`${logPrefix} ✅ Registro supervisor guardado - Estado: ${savedSupervisorDoc.estado}`);

      if (actaFirmadaPath) {
        this.logger.log(`${logPrefix} 📝 Documento.actaFirmadaPath: ${documento.actaFirmadaPath}`);
        this.logger.log(`${logPrefix} 📝 SupervisorDoc.actaFirmadaPath: ${savedSupervisorDoc.actaFirmadaPath}`);
      }

      await queryRunner.commitTransaction();

      this.logger.log(`${logPrefix} ===== FIN REVISAR DOCUMENTO (ÉXITO) =====`);

      return {
        supervisor: savedSupervisorDoc,
        documento
      };

    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`❌ ERROR EN REVISAR DOCUMENTO: ${error.message}`);
      this.logger.error(error.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // ==================== GUARDAR ARCHIVO DEL SUPERVISOR ====================
  private async guardarArchivoSupervisor(
    documento: Documento,
    archivo: Express.Multer.File,
    tipo: 'aprobacion' | 'paz_salvo'
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

      this.logger.log(`💾 Archivo de ${tipo} guardado: ${rutaCompleta} (${archivo.size} bytes)`);
      return nombreArchivo;
    } catch (error) {
      this.logger.error(`❌ Error guardando archivo de ${tipo}: ${error.message}`);
      throw new BadRequestException(`Error al guardar archivo: ${error.message}`);
    }
  }

  // ==================== AGREGAR AL HISTORIAL ====================
  private agregarAlHistorial(
    documento: Documento,
    supervisor: User,
    estadoAnterior: string,
    estadoNuevo: string,
    observacion?: string
  ): void {
    try {
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
      this.logger.log(`📋 Historial actualizado: ${estadoAnterior} → ${estadoNuevo}`);
    } catch (error) {
      this.logger.error(`Error agregando al historial: ${error.message}`);
    }
  }

  // ==================== MÉTODOS EXISTENTES ====================
  async corregirDatosInconsistentes(): Promise<{ corregidos: number; total: number }> {
    try {
      this.logger.log('🔄 Iniciando corrección de datos inconsistentes...');

      const supervisionesConPazSalvo = await this.supervisorRepository
        .createQueryBuilder('supervisor')
        .leftJoinAndSelect('supervisor.documento', 'documento')
        .where('supervisor.paz_salvo IS NOT NULL')
        .andWhere('supervisor.paz_salvo != :empty', { empty: '' })
        .andWhere('(documento.esUltimoRadicado = :false OR documento.esUltimoRadicado IS NULL)', { false: false })
        .getMany();

      this.logger.log(`📊 Encontradas ${supervisionesConPazSalvo.length} supervisiones con paz y salvo sin marcar como último radicado`);

      let documentosCorregidos = 0;

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
      return { corregidos: documentosCorregidos, total: supervisionesConPazSalvo.length };
    } catch (error) {
      this.logger.error(`❌ Error en corrección de datos: ${error.message}`);
      throw new InternalServerErrorException('Error al corregir datos inconsistentes');
    }
  }

  async devolverDocumento(
    documentoId: string,
    supervisorId: string,
    motivo: string,
    instrucciones: string
  ): Promise<{ supervisor: SupervisorDocumento; documento: Documento }> {
    try {
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

      this.agregarAlHistorial(documento, supervisorDoc.supervisor, 'EN_REVISION', 'DEVUELTO_SUPERVISOR', `Devuelto por supervisor: ${motivo}`);

      await this.documentoRepository.save(documento);
      const savedSupervisorDoc = await this.supervisorRepository.save(supervisorDoc);

      this.logger.log(`✅ Documento ${documento.numeroRadicado} devuelto al radicador por supervisor`);

      return {
        supervisor: savedSupervisorDoc,
        documento
      };
    } catch (error) {
      this.logger.error(`❌ Error devolviendo documento: ${error.message}`);
      throw error;
    }
  }

  async obtenerDocumentosRevisados(supervisorId: string): Promise<any[]> {
    try {
      this.logger.log(`📋 Supervisor ${supervisorId} solicitando documentos revisados`);

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

      this.logger.log(`✅ Encontrados ${supervisiones.length} documentos revisados`);

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

  async obtenerRevisionPorDocumento(documentoId: string, supervisorId: string): Promise<any> {
    this.logger.log(`🔍 Buscando revisión de supervisor para documento ${documentoId}, supervisor ${supervisorId}`);

    const revision = await this.supervisorRepository.findOne({
      where: {
        documento: { id: documentoId },
        supervisor: { id: supervisorId }
      }
    });

    if (!revision) {
      this.logger.warn(`⚠️ No se encontró revisión para documento ${documentoId} y supervisor ${supervisorId}`);
      return null;
    }

    return {
      id: revision.id,
      estado: revision.estado,
      observacion: revision.observacion,
      correcciones: revision.correcciones,
      nombreArchivoSupervisor: revision.nombreArchivoSupervisor,
      pazSalvo: revision.pazSalvo,
      actaFirmadaPath: revision.actaFirmadaPath,
      actaFirmadaNombre: revision.actaFirmadaNombre,
      fechaFirma: revision.fechaFirma,
      fechaInicioRevision: revision.fechaInicioRevision,
      fechaFinRevision: revision.fechaFinRevision,
      fechaAprobacion: revision.fechaAprobacion,
      fechaActualizacion: revision.fechaActualizacion
    };
  }
}