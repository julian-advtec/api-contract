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

import { SupervisorDocumento, SupervisorEstado } from '../entities/supervisor.entity';
import { Documento } from '../../radicacion/entities/documento.entity';
import { User } from '../../users/entities/user.entity';
import { RevisarDocumentoDto } from '../dto/revisar-documento.dto';

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
  ) { }


  public async revisarDocumento(
    documentoId: string,
    supervisorId: string,
    revisarDto: RevisarDocumentoDto,
    archivoSupervisor?: Express.Multer.File,
    pazSalvoArchivo?: Express.Multer.File
  ): Promise<{ supervisor: SupervisorDocumento; documento: Documento }> {
    try {
      this.logger.log(`🔍 ===== INICIO REVISAR DOCUMENTO =====`);
      this.logger.log(`🔍 Supervisor ${supervisorId} revisando documento ${documentoId} - Estado: ${revisarDto.estado}`);

      // LOG DETALLADO
      this.logger.log(`📦 Datos recibidos:`, {
        documentoId,
        supervisorId,
        estado: revisarDto.estado,
        observacion: revisarDto.observacion?.substring(0, 50),
        tieneArchivo: !!archivoSupervisor,
        tienePazSalvo: !!pazSalvoArchivo,
        esUltimoRadicado: revisarDto.esUltimoRadicado
      });

      // Validar que el estado sea válido
      const estadosValidos = [
        SupervisorEstado.APROBADO,
        SupervisorEstado.OBSERVADO,
        SupervisorEstado.RECHAZADO,
        'DEVUELTO' as any
      ];

      if (!estadosValidos.includes(revisarDto.estado as any)) {
        throw new BadRequestException(`Estado inválido: ${revisarDto.estado}. Estados permitidos: ${estadosValidos.join(', ')}`);
      }

      // PASO 1: Buscar el documento en revisión - AHORA PERMITIENDO OBSERVADO
      this.logger.log(`🔍 PASO 1: Buscando documento ${documentoId} para supervisor ${supervisorId}`);

      // Primero buscar cualquier registro para este documento y supervisor
      const cualquierRegistro = await this.supervisorRepository.findOne({
        where: {
          documento: { id: documentoId },
          supervisor: { id: supervisorId }
        },
        relations: ['documento', 'supervisor']
      });

      this.logger.log(`📊 PASO 1 - Resultado búsqueda:`, {
        encontrado: !!cualquierRegistro,
        id: cualquierRegistro?.id,
        estado: cualquierRegistro?.estado,
        supervisorId: cualquierRegistro?.supervisor?.id
      });

      if (!cualquierRegistro) {
        this.logger.error(`❌ PASO 1 - No se encontró documento ${documentoId} para supervisor ${supervisorId}`);
        throw new ForbiddenException('No tienes este documento asignado. Debes tomarlo primero desde la lista de pendientes.');
      }

      // ✅ MODIFICACIÓN: Verificar si está en EN_REVISION O OBSERVADO
      if (cualquierRegistro.estado !== SupervisorEstado.EN_REVISION &&
        cualquierRegistro.estado !== SupervisorEstado.OBSERVADO) {
        this.logger.error(`❌ PASO 1 - El documento está en estado ${cualquierRegistro.estado}, no puede ser modificado`);
        throw new ForbiddenException(`El documento está en estado ${cualquierRegistro.estado}, no puede ser modificado. Solo documentos en EN_REVISION u OBSERVADO pueden ser editados.`);
      }

      // ✅ LOG ESPECIAL PARA DOCUMENTOS OBSERVADOS
      if (cualquierRegistro.estado === SupervisorEstado.OBSERVADO) {
        this.logger.log(`⚠️ Documento en estado OBSERVADO - Se permite modificación como corrección`);
      }

      const supervisorDoc = cualquierRegistro;
      const documento = supervisorDoc.documento;

      this.logger.log(`✅ PASO 1 - Documento encontrado: ${documento.numeroRadicado}, estado actual: ${documento.estado}`);

      // PASO 2: Validar observación para estados que la requieren
      this.logger.log(`🔍 PASO 2: Validando observación para estado ${revisarDto.estado}`);

      if ((revisarDto.estado === SupervisorEstado.OBSERVADO ||
        revisarDto.estado === SupervisorEstado.RECHAZADO) &&
        (!revisarDto.observacion || revisarDto.observacion.trim() === '')) {
        this.logger.error(`❌ PASO 2 - Se requiere observación para estado ${revisarDto.estado}`);
        throw new BadRequestException('Se requiere una observación para este estado');
      }

      this.logger.log(`✅ PASO 2 - Validación de observación OK`);

      // PASO 3: Guardar archivos si existen
      this.logger.log(`🔍 PASO 3: Procesando archivos...`);

      // Guardar archivo de aprobación si existe (solo para APROBADO)
      if (archivoSupervisor && revisarDto.estado === SupervisorEstado.APROBADO) {
        this.logger.log(`📎 Procesando archivo de aprobación: ${archivoSupervisor.originalname}`);
        try {
          const nombreArchivo = await this.guardarArchivoSupervisor(documento, archivoSupervisor, 'aprobacion');
          supervisorDoc.nombreArchivoSupervisor = nombreArchivo;
          this.logger.log(`✅ Archivo de aprobación guardado: ${nombreArchivo}`);
        } catch (error) {
          this.logger.error(`Error guardando archivo de aprobación: ${error.message}`);
          // No lanzar error, continuar con la revisión
        }
      }

      // Guardar archivo de paz y salvo si existe (solo para APROBADO y último radicado)
      if (pazSalvoArchivo && revisarDto.estado === SupervisorEstado.APROBADO && revisarDto.esUltimoRadicado) {
        this.logger.log(`📎 Procesando paz y salvo: ${pazSalvoArchivo.originalname}`);
        try {
          const nombrePazSalvo = await this.guardarArchivoSupervisor(documento, pazSalvoArchivo, 'paz_salvo');
          supervisorDoc.pazSalvo = nombrePazSalvo;
          this.logger.log(`✅ Paz y salvo guardado: ${nombrePazSalvo}`);
        } catch (error) {
          this.logger.error(`Error guardando paz y salvo: ${error.message}`);
          // No lanzar error, continuar con la revisión
        }
      }

      this.logger.log(`✅ PASO 3 - Procesamiento de archivos completado`);

      // PASO 4: Actualizar estados
      this.logger.log(`🔍 PASO 4: Actualizando estados...`);

      const estadoAnterior = supervisorDoc.estado;

      // Actualizar supervisorDoc
      supervisorDoc.estado = revisarDto.estado;
      supervisorDoc.observacion = revisarDto.observacion?.trim() || '';
      supervisorDoc.correcciones = revisarDto.correcciones?.trim() || '';
      supervisorDoc.fechaActualizacion = new Date();
      supervisorDoc.fechaFinRevision = new Date();

      if (revisarDto.estado === SupervisorEstado.APROBADO) {
        supervisorDoc.fechaAprobacion = new Date();
      }

      // Actualizar documento principal
      documento.ultimoAcceso = new Date();
      documento.ultimoUsuario = `Supervisor: ${supervisorDoc.supervisor.fullName || supervisorDoc.supervisor.username}`;
      documento.fechaActualizacion = new Date();
      documento.esUltimoRadicado = revisarDto.esUltimoRadicado || false;

      this.logger.log(`🔄 Cambiando supervisorDoc de ${estadoAnterior} a ${revisarDto.estado}`);

      // Actualizar estado según la decisión
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

      // ✅ LÓGICA ADICIONAL: Si el documento estaba en OBSERVADO y ahora se aprueba
      if (estadoAnterior === SupervisorEstado.OBSERVADO && revisarDto.estado === SupervisorEstado.APROBADO) {
        this.logger.log(`📝 Documento corregido de OBSERVADO a APROBADO`);
        documento.comentarios = (documento.comentarios || '') + ' [Corrección aplicada al documento observado]';
      }

      this.logger.log(`📝 Estado final del documento principal: ${documento.estado}`);

      // PASO 5: Agregar al historial
      this.logger.log(`🔍 PASO 5: Agregando al historial`);
      this.agregarAlHistorial(documento, supervisorDoc.supervisor, estadoAnterior, revisarDto.estado, revisarDto.observacion);

      // PASO 6: Guardar en base de datos
      this.logger.log(`🔍 PASO 6: Guardando en base de datos...`);

      try {
        // Guardar primero el documento principal
        await this.documentoRepository.save(documento);
        this.logger.log('✅ Documento principal guardado');

        // Luego guardar el registro de supervisor
        const savedSupervisorDoc = await this.supervisorRepository.save(supervisorDoc);
        this.logger.log('✅ Registro de supervisor guardado');

        this.logger.log(`✅ ===== FIN REVISAR DOCUMENTO (ÉXITO) =====`);
        this.logger.log(`✅ Documento ${documento.numeroRadicado} revisado por supervisor. Estado: ${revisarDto.estado}, Último radicado: ${revisarDto.esUltimoRadicado}`);

        return {
          supervisor: savedSupervisorDoc,
          documento
        };
      } catch (dbError) {
        this.logger.error(`❌ PASO 6 - Error guardando en base de datos: ${dbError.message}`);
        this.logger.error(dbError.stack);

        if (dbError.code) {
          this.logger.error(`Código de error DB: ${dbError.code}`);
          this.logger.error(`Detalle DB: ${dbError.detail}`);
        }

        throw new InternalServerErrorException(`Error al guardar la revisión: ${dbError.message}`);
      }

    } catch (error) {
      this.logger.error(`❌ ===== ERROR EN REVISAR DOCUMENTO =====`);
      this.logger.error(`❌ Mensaje: ${error.message}`);
      this.logger.error(error.stack);

      if (error.code) {
        this.logger.error(`Código de error DB: ${error.code}`);
        this.logger.error(`Detalle DB: ${error.detail}`);
      }

      throw error;
    }
  }

  /**
   * ✅ CORREGIR DATOS INCONSISTENTES
   */
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

      this.logger.log(`📊 Encontradas ${supervisionesConPazSalvo.length} supervisiones con paz y salvo pero sin marcar como último radicado`);

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

      return {
        corregidos: documentosCorregidos,
        total: supervisionesConPazSalvo.length
      };

    } catch (error) {
      this.logger.error(`❌ Error en corrección de datos: ${error.message}`);
      throw new InternalServerErrorException('Error al corregir datos inconsistentes');
    }
  }

  /**
   * ✅ DEVOLVER DOCUMENTO AL RADICADOR
   */
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

      this.agregarAlHistorial(
        documento,
        supervisorDoc.supervisor,
        'EN_REVISION',
        'DEVUELTO_SUPERVISOR',
        `Devuelto por supervisor: ${motivo}`
      );

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

  /**
   * ✅ AGREGAR AL HISTORIAL
   */
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
      this.logger.log(`📋 Historial actualizado con estado: ${estadoNuevo}`);
    } catch (error) {
      this.logger.error(`Error agregando al historial: ${error.message}`);
    }
  }


  /**
   * ✅ GUARDAR ARCHIVO DEL SUPERVISOR
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
        informeActividades: sd.documento.informeActividades
      }));
    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos revisados: ${error.message}`);
      throw error;
    }
  }
}