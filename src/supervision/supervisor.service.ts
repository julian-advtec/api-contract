import { 
  Injectable, 
  NotFoundException, 
  BadRequestException, 
  Logger, 
  InternalServerErrorException,
  ForbiddenException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, MoreThanOrEqual, Not, IsNull } from 'typeorm';
import { SupervisorDocumento, SupervisorEstado } from './entities/supervisor.entity';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { RevisarDocumentoDto } from './dto/revisar-documento.dto';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

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
  ) {
    this.logger.log('📋 SupervisorService inicializado');
  }

  /**
   * OBTENER DOCUMENTOS ASIGNADOS AL SUPERVISOR
   */
  async obtenerDocumentosAsignados(supervisorId: string): Promise<Documento[]> {
    this.logger.log(`📋 Supervisor ${supervisorId} solicitando documentos asignados`);

    try {
      const supervisorDocs = await this.supervisorRepository.find({
        where: {
          supervisor: { id: supervisorId },
          estado: In([SupervisorEstado.PENDIENTE, SupervisorEstado.OBSERVADO])
        },
        relations: ['documento', 'documento.radicador', 'documento.usuarioAsignado'],
        order: { fechaCreacion: 'ASC' },
      });

      return supervisorDocs.map(sd => sd.documento);
    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos asignados: ${error.message}`);
      throw new InternalServerErrorException('Error al obtener documentos asignados');
    }
  }

  /**
   * OBTENER DETALLE DE DOCUMENTO PARA REVISIÓN
   */
  async obtenerDetalleDocumento(documentoId: string, supervisorId: string): Promise<any> {
    this.logger.log(`🔍 Supervisor ${supervisorId} solicitando detalle de documento ${documentoId}`);

    try {
      const supervisorDoc = await this.supervisorRepository.findOne({
        where: {
          documento: { id: documentoId },
          supervisor: { id: supervisorId },
          estado: In([SupervisorEstado.PENDIENTE, SupervisorEstado.OBSERVADO])
        },
        relations: ['documento', 'documento.radicador', 'documento.usuarioAsignado'],
      });

      if (!supervisorDoc) {
        throw new ForbiddenException('No tienes acceso a este documento o ya fue procesado');
      }

      const documento = supervisorDoc.documento;

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
      documento.ultimoUsuario = `Supervisor: ${supervisorId}`;
      await this.documentoRepository.save(documento);

      supervisorDoc.fechaActualizacion = new Date();
      await this.supervisorRepository.save(supervisorDoc);

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
          estadoActual: supervisorDoc.estado,
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
        supervisor: {
          id: supervisorDoc.id,
          estado: supervisorDoc.estado,
          observacion: supervisorDoc.observacion,
          fechaCreacion: supervisorDoc.fechaCreacion
        }
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo detalle: ${error.message}`);
      if (error instanceof ForbiddenException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al obtener detalle del documento');
    }
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

    const supervisorDoc = await this.supervisorRepository.findOne({
      where: {
        documento: { id: documentoId },
        supervisor: { id: supervisorId },
        estado: In([SupervisorEstado.PENDIENTE, SupervisorEstado.OBSERVADO])
      }
    });

    if (!supervisorDoc) {
      throw new ForbiddenException('No tienes acceso a este documento');
    }

    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId }
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
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
        estado: In([SupervisorEstado.PENDIENTE, SupervisorEstado.OBSERVADO])
      },
      relations: ['documento', 'supervisor']
    });

    if (!supervisorDoc) {
      throw new ForbiddenException('No tienes acceso a este documento o ya fue procesado');
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
      
      case SupervisorEstado.PENDIENTE:
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

      // 1. Conteos por estado - CORREGIDO: usar JOIN en lugar de supervisorId
      const [pendientes, aprobados, observados, rechazados] = await Promise.all([
        this.supervisorRepository
          .createQueryBuilder('supervisor')
          .leftJoin('supervisor.supervisor', 'usuario')
          .where('usuario.id = :supervisorId', { supervisorId })
          .andWhere('supervisor.estado = :estado', { estado: SupervisorEstado.PENDIENTE })
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

      // 2. Documentos recientes (últimos 7 días)
      const fechaLimite = new Date();
      fechaLimite.setDate(fechaLimite.getDate() - 7);

      const recientes = await this.supervisorRepository
        .createQueryBuilder('supervisor')
        .leftJoin('supervisor.supervisor', 'usuario')
        .where('usuario.id = :supervisorId', { supervisorId })
        .andWhere('supervisor.fechaCreacion >= :fechaLimite', { fechaLimite })
        .getCount();

      // 3. Tiempo promedio de revisión
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

      // 4. Documentos urgentes (pendientes > 3 días)
      const fechaUrgente = new Date();
      fechaUrgente.setDate(fechaUrgente.getDate() - 3);

      const urgentes = await this.supervisorRepository
        .createQueryBuilder('supervisor')
        .leftJoin('supervisor.supervisor', 'usuario')
        .where('usuario.id = :supervisorId', { supervisorId })
        .andWhere('supervisor.estado = :estado', { estado: SupervisorEstado.PENDIENTE })
        .andWhere('supervisor.fechaCreacion < :fechaUrgente', { fechaUrgente })
        .getCount();

      // 5. Calcular eficiencia
      const totalProcesados = aprobados + observados + rechazados;
      const eficiencia = totalProcesados > 0 ? 
        Math.round((aprobados / totalProcesados) * 100) : 0;

      const estadisticas = {
        totalPendientes: pendientes,
        aprobados: aprobados,
        observados: observados,
        rechazados: rechazados,
        recientes: recientes,
        urgentes: urgentes,
        tiempoPromedioHoras: tiempoPromedioHoras,
        eficiencia: eficiencia,
        totales: {
          pendientes: pendientes,
          aprobados: aprobados,
          observados: observados,
          rechazados: rechazados,
          total: pendientes + aprobados + observados + rechazados
        },
        fechaConsulta: new Date().toISOString()
      };

      this.logger.log(`✅ Estadísticas calculadas para supervisor ${supervisorId}`);
      this.logger.log(`   - Pendientes: ${pendientes}`);
      this.logger.log(`   - Aprobados: ${aprobados}`);
      this.logger.log(`   - Observados: ${observados}`);
      this.logger.log(`   - Rechazados: ${rechazados}`);
      this.logger.log(`   - Recientes (7 días): ${recientes}`);
      this.logger.log(`   - Urgentes (>3 días): ${urgentes}`);

      return estadisticas;

    } catch (error) {
      this.logger.error(`❌ Error calculando estadísticas: ${error.message}`);
      this.logger.error(`❌ Detalles: ${error.stack}`);
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
        estado: SupervisorEstado.PENDIENTE
      },
      relations: ['documento', 'supervisor']
    });

    if (!supervisorDoc) {
      throw new ForbiddenException('No puedes devolver este documento');
    }

    const documento = supervisorDoc.documento;

    supervisorDoc.estado = SupervisorEstado.OBSERVADO;
    supervisorDoc.observacion = `DEVUELTO: ${motivo}. Instrucciones: ${instrucciones}`;
    supervisorDoc.fechaActualizacion = new Date();

    documento.estado = 'DEVUELTO_SUPERVISOR';
    documento.ultimoAcceso = new Date();
    documento.ultimoUsuario = `Supervisor: ${supervisorDoc.supervisor.fullName || supervisorDoc.supervisor.username}`;
    documento.comentarios = motivo;
    documento.correcciones = instrucciones;
    documento.fechaActualizacion = new Date();

    documento.usuarioAsignado = documento.radicador;
    documento.usuarioAsignadoNombre = documento.nombreRadicador;

    this.agregarAlHistorial(
      documento,
      supervisorDoc.supervisor,
      'PENDIENTE',
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
}