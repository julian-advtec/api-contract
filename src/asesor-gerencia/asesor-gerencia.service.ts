import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import * as crypto from 'node:crypto'; // ← import correcto para randomBytes

import { AsesorGerenciaDocumento } from './entities/asesor-gerencia-documento.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { TesoreriaDocumento } from '../tesoreria/entities/tesoreria-documento.entity'; // ← ruta ajustada (cámbiala si es diferente)

import { AsesorGerenciaSignatureService } from './asesor-gerencia-signature.service';
import { AsesorGerenciaEstado } from './entities/asesor-gerencia-estado.enum';

import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AsesorGerenciaService {
  private readonly logger = new Logger(AsesorGerenciaService.name);

  constructor(
    @InjectRepository(AsesorGerenciaDocumento)
    private asesorGerenciaRepository: Repository<AsesorGerenciaDocumento>,
    @InjectRepository(Documento)
    private documentoRepository: Repository<Documento>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(TesoreriaDocumento)
    private tesoreriaRepository: Repository<TesoreriaDocumento>,
    private readonly signatureService: AsesorGerenciaSignatureService,
  ) { }

  async obtenerDocumentosDisponibles(asesorId: string): Promise<any[]> {
    const documentos = await this.documentoRepository
      .createQueryBuilder('documento')
      .leftJoinAndSelect('documento.radicador', 'radicador')
      .leftJoinAndSelect('documento.usuarioAsignado', 'usuarioAsignado')
      .where("documento.estado = :estado", { estado: 'COMPLETADO_TESORERIA' })
      .orderBy('documento.fechaActualizacion', 'ASC')
      .getMany();

    const revisiones = await this.asesorGerenciaRepository.find({
      where: { asesor: { id: asesorId }, estado: AsesorGerenciaEstado.EN_REVISION },
      relations: ['documento'],
    });

    const enRevisionIds = revisiones.map(r => r.documento.id);

    return documentos.map(doc => ({
      id: doc.id,
      numeroRadicado: doc.numeroRadicado,
      numeroContrato: doc.numeroContrato,
      nombreContratista: doc.nombreContratista,
      documentoContratista: doc.documentoContratista,
      fechaInicio: doc.fechaInicio,
      fechaFin: doc.fechaFin,
      estado: doc.estado,
      fechaRadicacion: doc.fechaRadicacion,
      radicador: doc.nombreRadicador,
      supervisor: doc.usuarioAsignadoNombre,
      disponible: !enRevisionIds.includes(doc.id) || revisiones.some(r => r.documento.id === doc.id),
      enMiRevision: enRevisionIds.includes(doc.id),
      asignacion: {
        enRevision: enRevisionIds.includes(doc.id),
        puedoTomar: !enRevisionIds.includes(doc.id),
      },
    }));
  }

  async tomarDocumentoParaRevision(documentoId: string, asesorId: string) {
    const qr = this.asesorGerenciaRepository.manager.connection.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const documento = await qr.manager
        .createQueryBuilder(Documento, 'documento')
        .where('documento.id = :id', { id: documentoId })
        .andWhere('documento.estado = :estado', { estado: 'COMPLETADO_TESORERIA' })
        .setLock('pessimistic_write')
        .getOne();

      if (!documento) {
        throw new NotFoundException('Documento no encontrado o no disponible para asesor gerencia');
      }

      const asesor = await qr.manager.findOneOrFail(User, { where: { id: asesorId } });

      let gerenciaDoc = await qr.manager.findOne(AsesorGerenciaDocumento, {
        where: { documento: { id: documentoId } },
      });

      if (gerenciaDoc && gerenciaDoc.estado === AsesorGerenciaEstado.EN_REVISION) {
        throw new ConflictException('Documento ya en revisión por otro asesor');
      }

      if (gerenciaDoc) {
        gerenciaDoc.asesor = asesor;
        gerenciaDoc.estado = AsesorGerenciaEstado.EN_REVISION;
        gerenciaDoc.fechaInicioRevision = new Date();
        gerenciaDoc.fechaActualizacion = new Date();
      } else {
        gerenciaDoc = qr.manager.create(AsesorGerenciaDocumento, {
          documento,
          asesor,
          estado: AsesorGerenciaEstado.EN_REVISION,
          fechaInicioRevision: new Date(),
          fechaCreacion: new Date(),
          fechaActualizacion: new Date(),
        });
      }

      documento.estado = 'EN_REVISION_ASESOR_GERENCIA';
      documento.usuarioAsignado = asesor;
      documento.usuarioAsignadoNombre = asesor.fullName || asesor.username;
      documento.fechaActualizacion = new Date();
      documento.ultimoAcceso = new Date();
      documento.ultimoUsuario = `Asesor Gerencia: ${asesor.fullName || asesor.username}`;

      const historial = documento.historialEstados || [];
      historial.push({
        fecha: new Date(),
        estado: 'EN_REVISION_ASESOR_GERENCIA',
        usuarioId: asesor.id,
        usuarioNombre: asesor.fullName || asesor.username,
        rolUsuario: asesor.role,
        observacion: `Documento tomado por asesor gerencia ${asesor.username}`,
      });
      documento.historialEstados = historial;

      await qr.manager.save(documento);
      await qr.manager.save(gerenciaDoc);

      await qr.commitTransaction();

      return {
        success: true,
        message: `Documento ${documento.numeroRadicado} tomado para revisión por asesor gerencia`,
      };
    } catch (error) {
      await qr.rollbackTransaction();
      throw error;
    } finally {
      await qr.release();
    }
  }

  async obtenerMisDocumentosEnRevision(asesorId: string): Promise<any[]> {
    const registros = await this.asesorGerenciaRepository.find({
      where: {
        asesor: { id: asesorId },
        estado: AsesorGerenciaEstado.EN_REVISION,
      },
      relations: ['documento', 'asesor'],
      order: { fechaActualizacion: 'DESC' },
    });

    return registros.map(reg => ({
      id: reg.documento.id,
      numeroRadicado: reg.documento.numeroRadicado,
      numeroContrato: reg.documento.numeroContrato,
      nombreContratista: reg.documento.nombreContratista,
      estado: reg.documento.estado,
      fechaRadicacion: reg.documento.fechaRadicacion,
      observaciones: reg.observaciones || '',
      fechaInicioRevision: reg.fechaInicioRevision,
      asesor: reg.asesor?.fullName || reg.asesor?.username,
    }));
  }

  async subirDocumentoAprobacion(
    documentoId: string,
    asesorId: string,
    datos: {
      observaciones?: string;
      estadoFinal?: string;
      signatureId?: string;
      signaturePosition?: string;
    },
    files: { [key: string]: Express.Multer.File[] },
  ) {
    const registro = await this.asesorGerenciaRepository.findOne({
      where: {
        documento: { id: documentoId },
        asesor: { id: asesorId },
        estado: AsesorGerenciaEstado.EN_REVISION,
      },
      relations: ['documento', 'asesor'],
    });

    if (!registro) {
      throw new ForbiddenException('No tienes este documento asignado en revisión');
    }

    const documento = registro.documento;

    if (!documento.rutaCarpetaRadicado || !fs.existsSync(documento.rutaCarpetaRadicado)) {
      throw new BadRequestException('Carpeta del documento no existe');
    }

    const carpetaGerencia = path.join(documento.rutaCarpetaRadicado, 'asesor-gerencia');
    if (!fs.existsSync(carpetaGerencia)) {
      fs.mkdirSync(carpetaGerencia, { recursive: true });
    }

    let archivoGuardado: string | null = null;

    if (files['aprobacion']?.[0]) {
      const file = files['aprobacion'][0];
      const ext = path.extname(file.originalname) || '.pdf';
      const timestamp = Date.now();
      const hash = crypto.randomBytes(4).toString('hex');
      const nombreArchivo = `aprobacion_${documento.numeroRadicado}_${timestamp}_${hash}${ext}`;
      const rutaCompleta = path.join(carpetaGerencia, nombreArchivo);

      fs.writeFileSync(rutaCompleta, file.buffer);

      if (!fs.existsSync(rutaCompleta) || fs.statSync(rutaCompleta).size === 0) {
        throw new BadRequestException('No se pudo guardar el archivo de aprobación');
      }

      archivoGuardado = path.join('asesor-gerencia', nombreArchivo);
      registro.aprobacionPath = archivoGuardado;
      registro.fechaAprobacion = new Date();
    }

    // Aplicar firma si corresponde
    if (datos.signatureId && datos.signaturePosition && archivoGuardado) {
      try {
        const position = JSON.parse(datos.signaturePosition);
        const rutaAbsoluta = path.join(documento.rutaCarpetaRadicado, archivoGuardado);
        await this.signatureService.aplicarFirmaEnPDF(rutaAbsoluta, datos.signatureId, position);
        registro.firmaAplicada = true;
      } catch (err) {
        this.logger.error('Error aplicando firma en asesor gerencia', err);
        // No bloqueamos el proceso principal
      }
    }

    if (datos.observaciones) {
      registro.observaciones = datos.observaciones;
    }

    registro.fechaActualizacion = new Date();

    let estadoFinal: AsesorGerenciaEstado | null = null;
    let estadoDocumento: string | null = null;

    const ef = (datos.estadoFinal || '').toUpperCase();
    if (ef.includes('COMPLETADO') || ef.includes('APROBADO')) {
      estadoFinal = AsesorGerenciaEstado.COMPLETADO_ASESOR_GERENCIA;
      estadoDocumento = 'COMPLETADO_ASESOR_GERENCIA';
    } else if (ef.includes('OBSERVADO')) {
      estadoFinal = AsesorGerenciaEstado.OBSERVADO_ASESOR_GERENCIA;
      estadoDocumento = 'OBSERVADO_ASESOR_GERENCIA';
    } else if (ef.includes('RECHAZADO')) {
      estadoFinal = AsesorGerenciaEstado.RECHAZADO_ASESOR_GERENCIA;
      estadoDocumento = 'RECHAZADO_ASESOR_GERENCIA';
    }

    if (estadoFinal) {
      if (!registro.aprobacionPath) {
        throw new BadRequestException('Debe subir documento de aprobación para finalizar');
      }

      registro.estado = estadoFinal;
      registro.fechaFinRevision = new Date();

      if (estadoDocumento && documento.estado !== estadoDocumento) {
        documento.estado = estadoDocumento;
        documento.fechaActualizacion = new Date();
        documento.ultimoUsuario = `Asesor Gerencia: ${registro.asesor.fullName || registro.asesor.username}`;
        documento.usuarioAsignado = null;
        documento.usuarioAsignadoNombre = '';

        const historial = documento.historialEstados || [];
        historial.push({
          fecha: new Date(),
          estado: estadoDocumento,
          usuarioId: asesorId,
          usuarioNombre: registro.asesor.fullName || registro.asesor.username,
          rolUsuario: registro.asesor.role,
          observacion: `Procesado por asesor gerencia: ${estadoFinal} - ${datos.observaciones || 'sin obs'}`,
        });
        documento.historialEstados = historial;
      }
    }

    await this.asesorGerenciaRepository.save(registro);
    if (estadoDocumento) {
      await this.documentoRepository.save(documento);
    }

    return {
      success: true,
      message: 'Documento procesado correctamente',
      registro,
    };
  }



  async liberarDocumento(documentoId: string, asesorId: string) {
    const registro = await this.asesorGerenciaRepository.findOne({
      where: {
        documento: { id: documentoId },
        asesor: { id: asesorId },
        estado: AsesorGerenciaEstado.EN_REVISION,
      },
      relations: ['documento'],
    });

    if (!registro) {
      throw new NotFoundException('No tienes este documento en revisión');
    }

    const documento = registro.documento;

    documento.estado = 'COMPLETADO_TESORERIA';
    documento.usuarioAsignado = null;
    documento.usuarioAsignadoNombre = '';
    documento.fechaActualizacion = new Date();

    const historial = documento.historialEstados || [];
    historial.push({
      fecha: new Date(),
      estado: 'COMPLETADO_TESORERIA',
      usuarioId: asesorId,
      usuarioNombre: registro.asesor.fullName || registro.asesor.username,
      rolUsuario: registro.asesor.role,
      observacion: 'Documento liberado por asesor gerencia - vuelve a tesorería',
    });
    documento.historialEstados = historial;

    registro.estado = AsesorGerenciaEstado.DISPONIBLE;
    registro.fechaActualizacion = new Date();
    registro.fechaFinRevision = new Date();
    registro.observaciones = 'Liberado - disponible para otros asesores';

    await this.documentoRepository.save(documento);
    await this.asesorGerenciaRepository.save(registro);

    return {
      success: true,
      message: 'Documento liberado correctamente',
    };
  }

  async obtenerRutaArchivo(
    documentoId: string,
    tipo: string,
  ): Promise<{ rutaAbsoluta: string; nombreArchivo: string }> {
    this.logger.log(`[obtenerRutaArchivo] Solicitando tipo=${tipo} para documento=${documentoId}`);

    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId },
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    let nombreArchivo: string | null = null;
    const carpetaBase = documento.rutaCarpetaRadicado;

    if (tipo.toLowerCase() === 'comprobantefirmado' || tipo === 'comprobanteFirmado') {
    const registro = await this.asesorGerenciaRepository.findOne({
      where: { documento: { id: documentoId } },
    });

    if (!registro?.comprobanteFirmadoPath) {
      throw new NotFoundException('No hay comprobante firmado por gerencia');
    }


    nombreArchivo = registro.comprobanteFirmadoPath;
  }
    // Caso 1: Aprobación subido por Asesor Gerencia
    if (tipo.toLowerCase() === 'aprobacion') {
      const registro = await this.asesorGerenciaRepository.findOne({
        where: { documento: { id: documentoId } },
        order: { fechaActualizacion: 'DESC' },
      });

      if (!registro) {
        throw new NotFoundException('No hay registro de asesor gerencia');
      }

      nombreArchivo = registro.aprobacionPath;
      if (!nombreArchivo) {
        throw new NotFoundException('No se subió archivo de aprobación');
      }
    }

    // Caso 2: Comprobante de pago subido por Tesorería
    else if (tipo.toLowerCase() === 'pagorealizado' || tipo.toLowerCase() === 'pagoRealizado') {
      const tesoreria = await this.tesoreriaRepository.findOne({
        where: {
          documento: { id: documentoId }   // ← CORRECCIÓN AQUÍ: usa la propiedad real 'documento'
        },
      });

      if (!tesoreria) {
        this.logger.warn(`No hay registro en tesoreria_documentos para ${documentoId}`);
        throw new NotFoundException('No hay comprobante de pago registrado (sin registro en tesorería)');
      }

      nombreArchivo = tesoreria.pagoRealizadoPath;

      if (!nombreArchivo) {
        this.logger.warn(`Registro de tesorería existe pero pagoRealizadoPath está vacío para ${documentoId}`);
        throw new NotFoundException('Registro de tesorería encontrado, pero no hay path del comprobante');
      }

      this.logger.log(`Path encontrado en tesorería: ${nombreArchivo}`);
    }

    else {
      throw new BadRequestException(`Tipo de archivo no soportado: ${tipo}`);
    }

    // Construir ruta absoluta
    const rutaAbsoluta = path.join(carpetaBase, nombreArchivo);

    // Verificar existencia física
    if (!fs.existsSync(rutaAbsoluta)) {
      this.logger.error(`Archivo no existe en disco: ${rutaAbsoluta}`);
      throw new NotFoundException(`El archivo ${nombreArchivo} no se encuentra en el servidor`);
    }

    this.logger.log(`Archivo listo para servir: ${rutaAbsoluta}`);

    return {
      rutaAbsoluta,
      nombreArchivo: path.basename(nombreArchivo),
    };
  }

  async obtenerHistorial(asesorId: string): Promise<any[]> {
    this.logger.log(`Obteniendo historial COMPLETO para asesorId: ${asesorId}`);

    const revisiones = await this.asesorGerenciaRepository.find({
      where: {
        asesor: { id: asesorId },
      },
      relations: ['documento', 'asesor'],
      order: { fechaActualizacion: 'DESC' },
    });

    this.logger.log(`Encontradas ${revisiones.length} revisiones para el asesor ${asesorId}`);

    if (revisiones.length === 0) {
      this.logger.warn(`No hay registros en asesor_gerencia_documento para asesorId ${asesorId}`);
      const sinAsesor = await this.asesorGerenciaRepository.count({ where: { asesor: IsNull() } });
      if (sinAsesor > 0) {
        this.logger.warn(`Existen ${sinAsesor} registros sin asesor asignado`);
      }
    }

    return revisiones.map(rev => ({
      id: rev.id,
      documentoId: rev.documento?.id,
      numeroRadicado: rev.documento?.numeroRadicado || 'N/A',
      numeroContrato: rev.documento?.numeroContrato || 'N/A',
      nombreContratista: rev.documento?.nombreContratista || 'N/A',
      estadoGerencia: rev.estado,
      estadoDocumento: rev.documento?.estado || 'DESCONOCIDO',
      esPendiente: rev.estado === AsesorGerenciaEstado.EN_REVISION,
      observaciones: rev.observaciones || 'Sin observaciones',
      fechaInicioRevision: rev.fechaInicioRevision,
      fechaFinRevision: rev.fechaFinRevision || null,
      fechaActualizacion: rev.fechaActualizacion,
      asesor: rev.asesor?.fullName || rev.asesor?.username || 'Desconocido',
    }));
  }

  async obtenerRechazadosVisibles(asesorId: string): Promise<any[]> {
    const estadosRechazo = [
      'RECHAZADO_ASESOR_GERENCIA',
      'OBSERVADO_ASESOR_GERENCIA',
    ];

    const docs = await this.documentoRepository
      .createQueryBuilder('doc')
      .leftJoinAndSelect('doc.radicador', 'radicador')
      .leftJoinAndSelect('doc.usuarioAsignado', 'asignado')
      .where('doc.estado IN (:...estados)', { estados: estadosRechazo })
      .orderBy('doc.fechaActualizacion', 'DESC')
      .getMany();

    this.logger.log(`Encontrados ${docs.length} documentos rechazados/observados`);

    return docs.map(doc => ({
      id: doc.id,
      numeroRadicado: doc.numeroRadicado,
      numeroContrato: doc.numeroContrato,
      nombreContratista: doc.nombreContratista,
      documentoContratista: doc.documentoContratista,
      fechaInicio: doc.fechaInicio,
      fechaFin: doc.fechaFin,
      fechaRadicacion: doc.fechaRadicacion,
      estado: doc.estado,
      observacion: doc.observacion || '',
      motivoRechazo: doc.observacion || 'Sin motivo detallado',
      ultimoUsuario: doc.ultimoUsuario || 'Sistema',
    }));
  }

 async obtenerDetalleRevision(documentoId: string, asesorId: string): Promise<any> {
  try {
    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId },
      relations: ['radicador', 'usuarioAsignado'],
    });

    if (!documento) {
      throw new NotFoundException(`Documento ${documentoId} no encontrado`);
    }

    const registroGerencia = await this.asesorGerenciaRepository.findOne({
      where: { documento: { id: documentoId } },
      relations: ['asesor'],
    });

    return {
      success: true,
      data: {
        id: documento.id,
        numeroRadicado: documento.numeroRadicado,
        numeroContrato: documento.numeroContrato,
        nombreContratista: documento.nombreContratista,
        documentoContratista: documento.documentoContratista,
        fechaRadicacion: documento.fechaRadicacion,
        estado: documento.estado,
        observacion: documento.observacion || '',
        historialEstados: documento.historialEstados || [],
        asesorAsignado: registroGerencia?.asesor?.fullName || registroGerencia?.asesor?.username || null,
        fechaAsignacionGerencia: registroGerencia?.fechaInicioRevision || null,
        aprobacionPath: registroGerencia?.aprobacionPath || null,
        firmaAplicada: registroGerencia?.firmaAplicada || false,
        comprobanteFirmadoPath: registroGerencia?.comprobanteFirmadoPath || null,  // ← AGREGAR ESTA LÍNEA
        estadoGerencia: registroGerencia?.estado || 'PENDIENTE',
        observacionesGerencia: registroGerencia?.observaciones || '',
      }
    };
  } catch (error) {
    this.logger.error(`[obtenerDetalleRevision] Error para documento ${documentoId}: ${error.message}`, error.stack);
    throw new InternalServerErrorException(`Error al cargar detalle del documento: ${error.message}`);
  }
}
async finalizarRevision(
  documentoId: string,
  asesorId: string,
  estado: AsesorGerenciaEstado,
  observaciones?: string,
  signatureId?: string,
  signaturePosition?: any,
) {
  this.logger.log(`[finalizarRevision] Iniciando - docId: ${documentoId}, asesorId: ${asesorId}, estado: ${estado}`);

  const registro = await this.asesorGerenciaRepository.findOne({
    where: {
      documento: { id: documentoId },
      asesor: { id: asesorId },
      estado: AsesorGerenciaEstado.EN_REVISION,
    },
    relations: ['documento', 'asesor'],
  });

  if (!registro) {
    this.logger.warn(`No existe registro EN_REVISION para doc=${documentoId} y asesor=${asesorId}`);
    throw new ForbiddenException('No tienes este documento en revisión');
  }

  const documento = registro.documento;

  if (estado === AsesorGerenciaEstado.COMPLETADO_ASESOR_GERENCIA) {
    if (!signatureId || !signaturePosition) {
      throw new BadRequestException('Firma obligatoria para aprobar (signatureId y signaturePosition requeridos)');
    }

    const tesoreria = await this.tesoreriaRepository.findOne({
      where: { documento: { id: documentoId } },
    });

    if (!tesoreria?.pagoRealizadoPath) {
      this.logger.error(`[APROBADO] No hay pagoRealizadoPath en tesorería para ${documentoId}`);
      throw new BadRequestException('No existe comprobante de pago precargado para firmar');
    }

    const rutaOriginal = path.join(documento.rutaCarpetaRadicado, tesoreria.pagoRealizadoPath);
    this.logger.log(`[APROBADO] Ruta original (tesorería): ${rutaOriginal}`);

    const carpetaGerencia = path.join(documento.rutaCarpetaRadicado, 'asesor-gerencia');
    if (!fs.existsSync(carpetaGerencia)) {
      this.logger.log(`[APROBADO] Creando carpeta: ${carpetaGerencia}`);
      fs.mkdirSync(carpetaGerencia, { recursive: true });
    }

    const nombreFirmado = `comprobante_firmado_${Date.now()}.pdf`;
    const rutaDestino = path.join(carpetaGerencia, nombreFirmado);
    this.logger.log(`[APROBADO] Ruta destino (firmado): ${rutaDestino}`);

    try {
      fs.copyFileSync(rutaOriginal, rutaDestino);
      this.logger.log(`[APROBADO] Copia OK a ${rutaDestino}`);
    } catch (copyErr) {
      this.logger.error(`[APROBADO] Falló fs.copyFileSync: ${copyErr.message}`);
      throw new InternalServerErrorException(`No se pudo copiar el comprobante para firmar: ${copyErr.message}`);
    }

    if (!fs.existsSync(rutaDestino)) {
      this.logger.error(`[APROBADO] Archivo no existe después de copia: ${rutaDestino}`);
      throw new InternalServerErrorException('Copia realizada pero archivo no encontrado en destino');
    }

    try {
      await this.signatureService.aplicarFirmaEnPDF(rutaDestino, signatureId, signaturePosition);
      registro.firmaAplicada = true;
      registro.comprobanteFirmadoPath = path.join('asesor-gerencia', nombreFirmado);
      this.logger.log(`[APROBADO] Firma aplicada OK - Path guardado: ${registro.comprobanteFirmadoPath}`);
    } catch (firmErr) {
      this.logger.error(`[APROBADO] Error aplicando firma: ${firmErr.message}`);
      throw new InternalServerErrorException(`Error al aplicar la firma digital: ${firmErr.message}`);
    }
  }

  // Resto del método sin cambios (actualizaciones comunes, save, etc.)
  registro.estado = estado;
  registro.observaciones = observaciones || registro.observaciones;
  registro.fechaFinRevision = new Date();
  registro.fechaActualizacion = new Date();

  let estadoDoc: string;
  switch (estado) {
    case AsesorGerenciaEstado.COMPLETADO_ASESOR_GERENCIA:
      estadoDoc = 'COMPLETADO_ASESOR_GERENCIA';
      break;
    case AsesorGerenciaEstado.OBSERVADO_ASESOR_GERENCIA:
      estadoDoc = 'OBSERVADO_ASESOR_GERENCIA';
      break;
    case AsesorGerenciaEstado.RECHAZADO_ASESOR_GERENCIA:
      estadoDoc = 'RECHAZADO_ASESOR_GERENCIA';
      break;
    default:
      throw new BadRequestException('Estado no válido');
  }

  documento.estado = estadoDoc;
  documento.fechaActualizacion = new Date();
  documento.usuarioAsignado = null;
  documento.usuarioAsignadoNombre = '';

  const historial = documento.historialEstados || [];
  historial.push({
    fecha: new Date(),
    estado: estadoDoc,
    usuarioId: asesorId,
    usuarioNombre: registro.asesor.fullName || registro.asesor.username,
    rolUsuario: registro.asesor.role,
    observacion: `Finalizado por asesor gerencia: ${estado} - ${observaciones || 'sin observación'}${estado === AsesorGerenciaEstado.COMPLETADO_ASESOR_GERENCIA ? ' (con firma digital)' : ''}`,
  });
  documento.historialEstados = historial;

  try {
    await this.asesorGerenciaRepository.save(registro);
    await this.documentoRepository.save(documento);
    this.logger.log(`[finalizarRevision] Éxito - estado final: ${estadoDoc}`);
  } catch (saveError) {
    this.logger.error(`[finalizarRevision] Error al guardar: ${saveError.message}`, saveError.stack);
    throw new InternalServerErrorException('Error al guardar la revisión');
  }

  return {
    success: true,
    message: `Revisión finalizada - Estado: ${estadoDoc}`,
  };
}


async obtenerRutaComprobanteFirmado(documentoId: string): Promise<{ rutaAbsoluta: string; nombreArchivo: string }> {
  this.logger.log(`[obtenerRutaComprobanteFirmado] Iniciando para doc ${documentoId}`);

  const documento = await this.documentoRepository.findOne({ where: { id: documentoId } });
  if (!documento) throw new NotFoundException('Documento no encontrado');

  const registro = await this.asesorGerenciaRepository.findOne({ where: { documento: { id: documentoId } } });
  if (!registro?.comprobanteFirmadoPath) {
    this.logger.warn(`No hay comprobanteFirmadoPath en BD para ${documentoId}`);
    throw new NotFoundException('No hay comprobante firmado registrado');
  }

  const pathRelativo = registro.comprobanteFirmadoPath;
  this.logger.log(`Path relativo desde BD: ${pathRelativo}`);

  // Normalizamos separadores para Windows
  const pathNormalizado = pathRelativo.replace(/\\/g, path.sep).replace(/\//g, path.sep);

  const rutaAbsoluta = path.join(documento.rutaCarpetaRadicado, pathNormalizado);
  this.logger.log(`Ruta absoluta calculada: ${rutaAbsoluta}`);

  if (!fs.existsSync(rutaAbsoluta)) {
    this.logger.error(`Archivo NO encontrado en disco: ${rutaAbsoluta}`);
    throw new NotFoundException(`El archivo ${path.basename(pathNormalizado)} no existe en el servidor`);
  }

  this.logger.log(`Archivo listo para servir: ${rutaAbsoluta}`);

  return {
    rutaAbsoluta,
    nombreArchivo: path.basename(pathNormalizado),
  };
}


}