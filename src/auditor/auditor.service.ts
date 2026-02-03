import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
  ForbiddenException,
  ConflictException
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
import { ConfigService } from '@nestjs/config'

import { AuditorValidationHelper } from './auditor-validation.helper';

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
    @InjectRepository(AuditorDocumento)
    private auditorDocumentoRepository: Repository<AuditorDocumento>,
    private readonly configService: ConfigService,

  ) {
    this.logger.log('📋 AuditorService inicializado');
  }

  async obtenerDocumentosDisponibles(auditorId: string): Promise<any[]> {
    this.logger.log(`📋 Auditor ${auditorId} solicitando documentos disponibles`);
    try {
      const documentos = await this.documentoRepository
        .createQueryBuilder('documento')
        .leftJoinAndSelect('documento.radicador', 'radicador')
        .leftJoinAndSelect('documento.usuarioAsignado', 'usuarioAsignado')
        .where("documento.estado = :estado", { estado: 'APROBADO_SUPERVISOR' })
        .orderBy('documento.fechaRadicacion', 'ASC')
        .getMany();
      this.logger.log(`✅ Encontrados ${documentos.length} documentos en estado APROBADO_SUPERVISOR`);
      const auditorDocs = await this.auditorRepository.find({
        where: {
          auditor: { id: auditorId },
          estado: AuditorEstado.EN_REVISION
        },
        relations: ['documento']
      });
      const documentosEnRevisionIds = auditorDocs.map(ad => ad.documento.id);
      const documentosConEstado = documentos.map(documento => {
        const estaRevisandoYo = documentosEnRevisionIds.includes(documento.id);
        const puedeSubirDocumentos = documento.primerRadicadoDelAno;
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
          disponible: true,
          asignacion: {
            enRevision: estaRevisandoYo,
            puedoTomar: !estaRevisandoYo && documento.estado === 'APROBADO_SUPERVISOR',
            puedeSubirDocumentos: puedeSubirDocumentos,
            supervisorAsignado: documento.usuarioAsignadoNombre,
            tieneSupervisor: !!documento.usuarioAsignadoNombre
          }
        };
      });
      return documentosConEstado;
    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos disponibles: ${error.message}`);
      throw error;
    }
  }

  async tomarDocumentoParaRevision(documentoId: string, auditorId: string): Promise<{ success: boolean; message: string; documento: any }> {
    this.logger.log(`🤝 Auditor ${auditorId} tomando documento ${documentoId} para revisión`);
    const queryRunner = this.auditorRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const documento = await queryRunner.manager
        .createQueryBuilder(Documento, 'documento')
        .where('documento.id = :id', { id: documentoId })
        .andWhere('documento.estado = :estado', { estado: 'APROBADO_SUPERVISOR' })
        .setLock('pessimistic_write')
        .getOne();

      if (!documento) {
        throw new NotFoundException('Documento no encontrado o no está disponible para auditoría (debe estar en estado APROBADO_SUPERVISOR)');
      }

      const auditor = await queryRunner.manager.findOne(User, {
        where: { id: auditorId }
      });

      if (!auditor) {
        throw new NotFoundException('Auditor no encontrado');
      }

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

      documento.estado = 'EN_REVISION_AUDITOR';
      documento.fechaActualizacion = new Date();
      documento.ultimoAcceso = new Date();
      documento.ultimoUsuario = `Auditor: ${auditor.fullName || auditor.username}`;
      documento.usuarioAsignado = auditor;
      documento.usuarioAsignadoNombre = auditor.fullName || auditor.username;

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

      if (documento && documento.rutaCarpetaRadicado) {
        await this.registrarAccesoAuditor(
          documento.rutaCarpetaRadicado,
          auditorId,
          `TOMÓ documento para auditoría`,
          `Estado: APROBADO_SUPERVISOR → EN_REVISION_AUDITOR`
        );
      }

      await queryRunner.commitTransaction();
      this.logger.log(`✅ Documento ${documento.numeroRadicado} tomado para revisión por ${auditor.username}. Estado actualizado a EN_REVISION_AUDITOR`);

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



  async obtenerDetalleDocumento(documentoId: string, auditorId: string): Promise<any> {
    this.logger.log(`🔍 Auditor ${auditorId} solicitando detalle de documento ${documentoId}`);

    try {
      // 1. Cargar el auditor completo (User) – esto resuelve el error TS2345
      const auditor = await this.userRepository.findOne({
        where: { id: auditorId }
      });

      if (!auditor) {
        throw new NotFoundException('Auditor no encontrado');
      }

      // 2. Buscar auditor_documento
      const auditorDoc = await this.auditorRepository.findOne({
        where: {
          documento: { id: documentoId },
          auditor: { id: auditorId }
        },
        relations: ['documento', 'documento.radicador', 'documento.usuarioAsignado', 'auditor'],
      });

      // 3. Buscar documento principal
      const documento = await this.documentoRepository.findOne({
        where: { id: documentoId },
        relations: ['radicador', 'usuarioAsignado'],
      });

      if (!documento) {
        throw new NotFoundException('Documento no encontrado');
      }

      // 4. Validaciones de acceso
      if (!auditorDoc && documento.estado !== 'APROBADO_SUPERVISOR') {
        throw new ForbiddenException('No tienes acceso a este documento');
      }

      if (documento.estado === 'EN_REVISION_AUDITOR' && (!auditorDoc || auditorDoc.auditor.id !== auditorId)) {
        throw new ForbiddenException('Este documento está siendo revisado por otro auditor');
      }

      // 5. Construir respuesta pasando el objeto User completo
      return this.construirRespuestaDetalle(documento, auditorDoc, auditor);
    } catch (error) {
      this.logger.error(`❌ Error obteniendo detalle: ${error.message}`);
      throw error;
    }
  }
  async obtenerDocumentoParaVista(documentoId: string, auditorId?: string): Promise<any> {
    this.logger.log(`🔍 Solicitando documento ${documentoId} para vista de auditoría (auditorId: ${auditorId || 'no proporcionado'})`);

    let auditorIdSanitizado = auditorId?.trim();
    if (!auditorIdSanitizado || auditorIdSanitizado === 'undefined') {
      auditorIdSanitizado = undefined;
    }

    try {
      const documento = await this.documentoRepository.findOne({
        where: { id: documentoId },
        relations: ['radicador', 'usuarioAsignado'],
      });

      if (!documento) {
        throw new NotFoundException(`Documento ${documentoId} no encontrado`);
      }

      let primerRadicado: Documento | null = null;

      const estadosPermitidos = [
        'APROBADO_SUPERVISOR',
        'EN_REVISION_AUDITOR',
        'APROBADO_AUDITOR',
        'OBSERVADO_AUDITOR',
        'RECHAZADO_AUDITOR',
        'COMPLETADO_AUDITOR',
      ];

      if (!estadosPermitidos.includes(documento.estado)) {
        throw new ForbiddenException(`Estado no permitido: ${documento.estado}`);
      }

      let auditorDoc: AuditorDocumento | null = null;

      if (auditorIdSanitizado) {
        auditorDoc = await this.auditorDocumentoRepository.findOne({
          where: {
            documento: { id: documentoId },
            auditor: { id: auditorIdSanitizado },
          },
          relations: ['auditor'],
        });
      }

      let paths = {
        rpPath: null as string | null,
        cdpPath: null as string | null,
        polizaPath: null as string | null,
        certificadoBancarioPath: null as string | null,
        minutaPath: null as string | null,
        actaInicioPath: null as string | null,
      };

      if (documento.primerRadicadoDelAno) {
        if (auditorDoc) {
          paths = {
            rpPath: auditorDoc.rpPath,
            cdpPath: auditorDoc.cdpPath,
            polizaPath: auditorDoc.polizaPath,
            certificadoBancarioPath: auditorDoc.certificadoBancarioPath,
            minutaPath: auditorDoc.minutaPath,
            actaInicioPath: auditorDoc.actaInicioPath,
          };
        }
      } else {
        console.log('[VISTA-AUDITORIA] Buscando primer radicado válido con auditoría para contrato:', documento.numeroContrato);

        const posiblesPrimeros = await this.documentoRepository.find({
          where: {
            numeroContrato: documento.numeroContrato,
            primerRadicadoDelAno: true,
          },
          order: { fechaRadicacion: 'ASC' },
        });

        let encontrado = false;
        for (const primer of posiblesPrimeros) {
          const ad = await this.auditorDocumentoRepository.findOne({
            where: { documento: { id: primer.id } },
          });

          if (ad && (ad.rpPath || ad.cdpPath || ad.polizaPath || ad.certificadoBancarioPath || ad.minutaPath || ad.actaInicioPath)) {
            primerRadicado = primer;
            paths = {
              rpPath: ad.rpPath,
              cdpPath: ad.cdpPath,
              polizaPath: ad.polizaPath,
              certificadoBancarioPath: ad.certificadoBancarioPath,
              minutaPath: ad.minutaPath,
              actaInicioPath: ad.actaInicioPath,
            };
            console.log('[VISTA-AUDITORIA] Usando primer radicado con auditoría:', primer.numeroRadicado);
            encontrado = true;
            break;
          }
        }

        if (!encontrado) {
          console.log('[VISTA-AUDITORIA] No se encontró primer radicado con documentos de auditoría guardados');
        }
      }

      const archivosAuditor = [
        {
          tipo: 'rp',
          descripcion: 'Resolución de Pago',
          subido: !!paths.rpPath,
          nombreArchivo: paths.rpPath || 'No disponible',
          rutaServidor: paths.rpPath ? path.join(primerRadicado?.rutaCarpetaRadicado || documento.rutaCarpetaRadicado, paths.rpPath) : null,
        },
        {
          tipo: 'cdp',
          descripcion: 'Certificado de Disponibilidad Presupuestal',
          subido: !!paths.cdpPath,
          nombreArchivo: paths.cdpPath || 'No disponible',
          rutaServidor: paths.cdpPath ? path.join(primerRadicado?.rutaCarpetaRadicado || documento.rutaCarpetaRadicado, paths.cdpPath) : null,
        },
        {
          tipo: 'poliza',
          descripcion: 'Póliza',
          subido: !!paths.polizaPath,
          nombreArchivo: paths.polizaPath || 'No disponible',
          rutaServidor: paths.polizaPath ? path.join(primerRadicado?.rutaCarpetaRadicado || documento.rutaCarpetaRadicado, paths.polizaPath) : null,
        },
        {
          tipo: 'certificadoBancario',
          descripcion: 'Certificado Bancario',
          subido: !!paths.certificadoBancarioPath,
          nombreArchivo: paths.certificadoBancarioPath || 'No disponible',
          rutaServidor: paths.certificadoBancarioPath ? path.join(primerRadicado?.rutaCarpetaRadicado || documento.rutaCarpetaRadicado, paths.certificadoBancarioPath) : null,
        },
        {
          tipo: 'minuta',
          descripcion: 'Minuta',
          subido: !!paths.minutaPath,
          nombreArchivo: paths.minutaPath || 'No disponible',
          rutaServidor: paths.minutaPath ? path.join(primerRadicado?.rutaCarpetaRadicado || documento.rutaCarpetaRadicado, paths.minutaPath) : null,
        },
        {
          tipo: 'actaInicio',
          descripcion: 'Acta de Inicio',
          subido: !!paths.actaInicioPath,
          nombreArchivo: paths.actaInicioPath || 'No disponible',
          rutaServidor: paths.actaInicioPath ? path.join(primerRadicado?.rutaCarpetaRadicado || documento.rutaCarpetaRadicado, paths.actaInicioPath) : null,
        },
      ];

      let notaAuditoria: string | null = null;
      if (!documento.primerRadicadoDelAno) {
        if (primerRadicado) {
          notaAuditoria = `Documentos de auditoría tomados del primer radicado del año: ${primerRadicado.numeroRadicado}`;
        } else {
          notaAuditoria = 'No se encontraron documentos de auditoría para este contrato';
        }
      }

      const respuesta = {
        data: {
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
            estado: documento.estado,
            estadoDocumento: documento.estado,
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
          },
          archivosRadicados: [
            {
              numero: 1,
              nombre: documento.cuentaCobro,
              descripcion: documento.descripcionCuentaCobro,
              tipo: 'cuenta_cobro',
              existe: !!documento.cuentaCobro,
            },
            {
              numero: 2,
              nombre: documento.seguridadSocial,
              descripcion: documento.descripcionSeguridadSocial,
              tipo: 'seguridad_social',
              existe: !!documento.seguridadSocial,
            },
            {
              numero: 3,
              nombre: documento.informeActividades,
              descripcion: documento.descripcionInformeActividades,
              tipo: 'informe_actividades',
              existe: !!documento.informeActividades,
            },
          ],
          archivosAuditor,
          notaAuditoria,
          auditor: auditorDoc
            ? {
              id: auditorDoc.id,
              estado: auditorDoc.estado,
              observaciones: auditorDoc.observaciones,
              tieneTodosDocumentos: auditorDoc.tieneTodosDocumentos(),
              puedeSubirDocumentos: documento.primerRadicadoDelAno && documento.estado === 'EN_REVISION_AUDITOR',
              documentosSubidos: archivosAuditor.filter(a => a.subido).map(a => a.tipo),
              documentosFaltantes: this.obtenerDocumentosFaltantes(auditorDoc),
            }
            : null,
        }
      };

      return respuesta;
    } catch (error) {
      this.logger.error(`❌ Error grave en obtenerDocumentoParaVista: ${error.message}`, error.stack);
      throw error;
    }
  }

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






  async obtenerEstadoArchivos(documentoId: string, auditorId: string): Promise<any> {
    this.logger.log(`📊 Verificando estado de archivos para documento ${documentoId}`);

    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId }
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    const auditorDoc = await this.auditorRepository.findOne({
      where: {
        documento: { id: documentoId },
        auditor: { id: auditorId }
      }
    });

    const esPrimerRadicado = documento.primerRadicadoDelAno;

    const archivosAuditoria = [
      {
        tipo: 'rp',
        nombre: 'Resolución de Pago',
        requerido: esPrimerRadicado,
        subido: auditorDoc?.rpPath ? true : false,
        nombreArchivo: auditorDoc?.rpPath || '',
        puedeDescargar: !!auditorDoc?.rpPath,
        puedeSubir: esPrimerRadicado
      },
      {
        tipo: 'cdp',
        nombre: 'Certificado de Disponibilidad Presupuestal',
        requerido: esPrimerRadicado,
        subido: auditorDoc?.cdpPath ? true : false,
        nombreArchivo: auditorDoc?.cdpPath || '',
        puedeDescargar: !!auditorDoc?.cdpPath,
        puedeSubir: esPrimerRadicado
      },
      {
        tipo: 'poliza',
        nombre: 'Póliza',
        requerido: esPrimerRadicado,
        subido: auditorDoc?.polizaPath ? true : false,
        nombreArchivo: auditorDoc?.polizaPath || '',
        puedeDescargar: !!auditorDoc?.polizaPath,
        puedeSubir: esPrimerRadicado
      },
      {
        tipo: 'certificadoBancario',
        nombre: 'Certificado Bancario',
        requerido: esPrimerRadicado,
        subido: auditorDoc?.certificadoBancarioPath ? true : false,
        nombreArchivo: auditorDoc?.certificadoBancarioPath || '',
        puedeDescargar: !!auditorDoc?.certificadoBancarioPath,
        puedeSubir: esPrimerRadicado
      },
      {
        tipo: 'minuta',
        nombre: 'Minuta',
        requerido: esPrimerRadicado,
        subido: auditorDoc?.minutaPath ? true : false,
        nombreArchivo: auditorDoc?.minutaPath || '',
        puedeDescargar: !!auditorDoc?.minutaPath,
        puedeSubir: esPrimerRadicado
      },
      {
        tipo: 'actaInicio',
        nombre: 'Acta de Inicio',
        requerido: esPrimerRadicado,
        subido: auditorDoc?.actaInicioPath ? true : false,
        nombreArchivo: auditorDoc?.actaInicioPath || '',
        puedeDescargar: !!auditorDoc?.actaInicioPath,
        puedeSubir: esPrimerRadicado
      }
    ];

    return {
      documento: {
        id: documento.id,
        numeroRadicado: documento.numeroRadicado,
        primerRadicadoDelAno: esPrimerRadicado,
        estado: documento.estado
      },
      archivos: archivosAuditoria,
      resumen: {
        totalRequeridos: esPrimerRadicado ? 6 : 0,
        totalSubidos: archivosAuditoria.filter(a => a.subido).length,
        completado: esPrimerRadicado ?
          archivosAuditoria.filter(a => a.subido).length === 6 :
          true
      }
    };
  }
  private obtenerArchivosAuditor(auditorDoc: AuditorDocumento): any[] {
    return [
      {
        tipo: 'rp',
        descripcion: 'Resolución de Pago',
        subido: !!auditorDoc.rpPath,
        nombreArchivo: auditorDoc.rpPath
      },
      {
        tipo: 'cdp',
        descripcion: 'Certificado de Disponibilidad Presupuestal',
        subido: !!auditorDoc.cdpPath,
        nombreArchivo: auditorDoc.cdpPath
      },
      {
        tipo: 'poliza',
        descripcion: 'Póliza',
        subido: !!auditorDoc.polizaPath,
        nombreArchivo: auditorDoc.polizaPath
      },
      {
        tipo: 'certificadoBancario',
        descripcion: 'Certificado Bancario',
        subido: !!auditorDoc.certificadoBancarioPath,
        nombreArchivo: auditorDoc.certificadoBancarioPath
      },
      {
        tipo: 'minuta',
        descripcion: 'Minuta',
        subido: !!auditorDoc.minutaPath,
        nombreArchivo: auditorDoc.minutaPath
      },
      {
        tipo: 'actaInicio',
        descripcion: 'Acta de Inicio',
        subido: !!auditorDoc.actaInicioPath,
        nombreArchivo: auditorDoc.actaInicioPath
      }
    ];
  }

  private crearNombreArchivoSeguro(
    tipo: string,
    radicado: string,
    extension: string,
  ): string {
    const nombreLimpio = tipo
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^\w._-]/g, '');

    const randomName = Array(8)
      .fill(null)
      .map(() => Math.round(Math.random() * 16).toString(16))
      .join('');

    return `${nombreLimpio}_${radicado}-${randomName}${extension}`;
  }

  /**
   * 🔍 BÚSQUEDA INTENSIVA: Busca archivos en toda la estructura del documento
   */
  private busquedaIntensivaArchivos(documento: Documento): {
    rp: string | null;
    cdp: string | null;
    poliza: string | null;
    certificadoBancario: string | null;
    minuta: string | null;
    actaInicio: string | null;
  } {
    const resultado = {
      rp: null as string | null,
      cdp: null as string | null,
      poliza: null as string | null,
      certificadoBancario: null as string | null,
      minuta: null as string | null,
      actaInicio: null as string | null,
    };

    if (!documento.rutaCarpetaRadicado) return resultado;

    const rutaBase = documento.rutaCarpetaRadicado;
    console.log('[BUSQUEDA-INTENSIVA] 🔍 Ruta base:', rutaBase);

    try {
      // 1. Prioridad: carpeta 'auditor'
      const rutaAuditor = path.join(rutaBase, 'auditor');
      let archivos: string[] = [];

      if (fs.existsSync(rutaAuditor)) {
        archivos = fs.readdirSync(rutaAuditor).filter(f =>
          !f.includes('_meta.json') && !f.startsWith('.')
        );
        console.log(`[BUSQUEDA] Archivos en /auditor: ${archivos.length}`);
      }

      // Fallback a raíz si no hay nada en auditor
      if (archivos.length === 0) {
        archivos = fs.readdirSync(rutaBase).filter(f =>
          !f.includes('_meta.json') && !f.startsWith('.')
        );
        console.log(`[BUSQUEDA] Archivos en raíz (fallback): ${archivos.length}`);
      }

      if (archivos.length === 0) {
        console.log('[BUSQUEDA] No se encontraron archivos válidos');
        return resultado;
      }

      // 2. Mapeo inteligente usando campos del documento + reglas fallback
      const mapeoBase = {
        rp: documento.cuentaCobro,
        // Puedes agregar más si tienes campos equivalentes en el futuro
      };

      archivos.forEach(archivo => {
        const lower = archivo.toLowerCase();

        // Prioridad 1: coincidencia directa con nombre guardado en BD
        if (mapeoBase.rp && lower.includes(mapeoBase.rp.toLowerCase().replace(/\.[^/.]+$/, ""))) {
          if (!resultado.rp) {
            resultado.rp = fs.existsSync(rutaAuditor) ? path.join('auditor', archivo) : archivo;
            console.log(`[MATCH-DIRECTO] RP → ${archivo} (coincide con cuentaCobro)`);
          }
        }

        // Prioridad 2: reglas fallback más permisivas
        if (!resultado.rp && (
          lower.includes('cobro') ||
          lower.includes('pago') ||
          lower.includes('cuenta') ||
          /rp/i.test(lower)
        )) {
          resultado.rp = fs.existsSync(rutaAuditor) ? path.join('auditor', archivo) : archivo;
          console.log(`[MATCH-FALLBACK] RP → ${archivo}`);
        }

        if (!resultado.cdp && (
          lower.includes('cdp') ||
          lower.includes('disponibilidad') ||
          lower.includes('presupuestal')
        )) {
          resultado.cdp = fs.existsSync(rutaAuditor) ? path.join('auditor', archivo) : archivo;
        }

        if (!resultado.poliza && (
          lower.includes('póliza') || lower.includes('poliza') ||
          lower.includes('cumplimiento') || lower.includes('garantia')
        )) {
          resultado.poliza = fs.existsSync(rutaAuditor) ? path.join('auditor', archivo) : archivo;
        }

        if (!resultado.certificadoBancario && (
          lower.includes('certificado') && lower.includes('bancario')
        )) {
          resultado.certificadoBancario = fs.existsSync(rutaAuditor) ? path.join('auditor', archivo) : archivo;
        }

        if (!resultado.minuta && (
          lower.includes('minuta') || lower.includes('contrato')
        )) {
          resultado.minuta = fs.existsSync(rutaAuditor) ? path.join('auditor', archivo) : archivo;
        }

        if (!resultado.actaInicio && (
          lower.includes('acta') || lower.includes('inicio') ||
          lower.includes('actainicio')
        )) {
          resultado.actaInicio = fs.existsSync(rutaAuditor) ? path.join('auditor', archivo) : archivo;
        }
      });

      console.log('[BUSQUEDA-INTENSIVA] Resultado final:', resultado);
      return resultado;

    } catch (err: any) {
      console.error('[BUSQUEDA-INTENSIVA] Error:', err.message);
      return resultado;
    }
  }



  /**
   * 🔦 BUSQUEDA AGRESIVA: Recorre toda la estructura de carpetas
   */
  private buscarArchivoAgresivo(rutaBase: string, palabrasClave: string[], numeroRadicado: string): string | null {
    try {
      if (!fs.existsSync(rutaBase)) return null;

      const archivosEncontrados: string[] = [];

      const buscarRecursivo = (ruta: string) => {
        try {
          const items = fs.readdirSync(ruta);

          for (const item of items) {
            const rutaItem = path.join(ruta, item);
            const stat = fs.statSync(rutaItem);

            if (stat.isDirectory()) {
              // Buscar en subcarpetas
              buscarRecursivo(rutaItem);
            } else if (stat.isFile()) {
              // Verificar si coincide con las palabras clave
              const nombreLower = item.toLowerCase();
              const radicadoLower = numeroRadicado.toLowerCase();

              // Buscar coincidencias
              const coincidePalabra = palabrasClave.some(palabra =>
                nombreLower.includes(palabra.toLowerCase())
              );

              // También verificar si contiene el número de radicado
              const coincideRadicado = nombreLower.includes(radicadoLower);

              if (coincidePalabra || coincideRadicado) {
                archivosEncontrados.push(item);
                console.log(`[BUSQUEDA-AGRESIVA] 🔍 Coincidencia encontrada: ${item}`, {
                  palabrasClave,
                  coincidePalabra,
                  coincideRadicado
                });
              }
            }
          }
        } catch (error) {
          console.error(`[BUSQUEDA-AGRESIVA] Error en ${ruta}:`, error.message);
        }
      };

      buscarRecursivo(rutaBase);

      // Devolver el primer archivo encontrado
      return archivosEncontrados.length > 0 ? archivosEncontrados[0] : null;
    } catch (error) {
      console.error('[BUSQUEDA-AGRESIVA] Error general:', error.message);
      return null;
    }
  }

  /**
   * 🛠️ Construir ruta completa del archivo
   */
  private construirRutaArchivo(documento: Documento, nombreArchivo: string): string | null {
    if (!nombreArchivo || !documento.rutaCarpetaRadicado) {
      return null;
    }

    // Buscar en múltiples ubicaciones posibles
    const ubicacionesPosibles = [
      documento.rutaCarpetaRadicado,
      path.join(documento.rutaCarpetaRadicado, 'auditor'),
      path.join(documento.rutaCarpetaRadicado, 'documentos'),
      path.join(documento.rutaCarpetaRadicado, 'anexos'),
    ];

    for (const ubicacion of ubicacionesPosibles) {
      const rutaCompleta = path.join(ubicacion, nombreArchivo);
      if (fs.existsSync(rutaCompleta)) {
        console.log(`[CONSTRUIR-RUTA] ✅ Archivo encontrado en: ${ubicacion}`);
        return rutaCompleta;
      }
    }

    console.log(`[CONSTRUIR-RUTA] ❌ Archivo no encontrado: ${nombreArchivo}`);
    return null;
  }

  async subirDocumentosAuditor(
    documentoId: string,
    auditorId: string,
    datos: { observaciones?: string; estado?: AuditorEstado },
    files: { [key: string]: Express.Multer.File[] },
  ) {
    this.logger.log(`📤 INICIO subirDocumentosAuditor - doc:${documentoId} auditor:${auditorId}`);
    console.log('[SUBIR-AUDITOR] Archivos recibidos:', Object.keys(files || {}));

    const temporalesAEliminar: string[] = []; // Lista para limpiar al final SIEMPRE

    try {
      const documento = await this.documentoRepository.findOne({ where: { id: documentoId } });
      if (!documento) throw new NotFoundException(`Documento ${documentoId} no encontrado`);

      if (!documento.rutaCarpetaRadicado) {
        throw new BadRequestException('Falta rutaCarpetaRadicado en el documento');
      }

      const carpetaAuditor = path.join(documento.rutaCarpetaRadicado, 'auditor');
      console.log('[SUBIR-AUDITOR] Carpeta destino:', carpetaAuditor);

      if (!fs.existsSync(carpetaAuditor)) {
        console.log('[SUBIR-AUDITOR] Creando carpeta auditor...');
        fs.mkdirSync(carpetaAuditor, { recursive: true });
      }

      try {
        fs.accessSync(carpetaAuditor, fs.constants.W_OK);
        console.log('[SUBIR-AUDITOR] Permisos de escritura OK');
      } catch (permErr) {
        throw new InternalServerErrorException(`Sin permisos para escribir en ${carpetaAuditor}`);
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
      } else {
        auditorDoc.observaciones = datos.observaciones || auditorDoc.observaciones;
        auditorDoc.fechaActualizacion = new Date();
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
        temporalesAEliminar.push(file.path); // Siempre lo agregamos para limpiar al final

        console.log(`[SUBIR-${campo.name.toUpperCase()}] Procesando: ${file.originalname} (${file.size} bytes)`);
        console.log(`[SUBIR-${campo.name.toUpperCase()}] Temporal: ${file.path}`);

        const ext = extname(file.originalname).toLowerCase() || '.pdf';
        const nombreFinal = `${campo.name}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
        const rutaAbsoluta = path.join(carpetaAuditor, nombreFinal);
        const rutaRelativa = path.join('auditor', nombreFinal);

        try {
          fs.copyFileSync(file.path, rutaAbsoluta);
          console.log(`[SUBIR-${campo.name.toUpperCase()}] Copia OK → ${rutaAbsoluta}`);

          // Intentamos eliminar inmediatamente
          try {
            fs.unlinkSync(file.path);
            console.log(`[SUBIR-${campo.name.toUpperCase()}] Temporal ELIMINADO inmediatamente`);
          } catch (unlinkErr: any) {
            console.warn(`[SUBIR-${campo.name.toUpperCase()}] Falló eliminación inmediata: ${unlinkErr.message}`);
            // No lanzamos error, lo limpiamos al final
          }

          (auditorDoc as any)[campo.pathKey] = rutaRelativa;
          archivosGuardados[campo.name] = rutaRelativa;

        } catch (err: any) {
          console.error(`[SUBIR-${campo.name.toUpperCase()}] ERROR CRÍTICO:`, err.message);
          throw new InternalServerErrorException(`Fallo al procesar ${campo.name}: ${err.message}`);
        }
      }

      // Limpieza FINAL de TODOS los temporales (incluso si hubo éxito parcial)
      console.log('[LIMPIEZA-FINAL] Temporales a eliminar:', temporalesAEliminar);
      for (const tempPath of temporalesAEliminar) {
        try {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
            console.log('[LIMPIEZA-FINAL] Eliminado OK:', tempPath);
          } else {
            console.log('[LIMPIEZA-FINAL] Ya no existía:', tempPath);
          }
        } catch (finalErr: any) {
          console.warn('[LIMPIEZA-FINAL] Falló en', tempPath, ':', finalErr.message);
        }
      }

      const saved = await this.auditorDocumentoRepository.save(auditorDoc);
      console.log('[SUBIR-AUDITOR] Guardado OK - AuditorDoc ID:', saved.id);

      return {
        success: true,
        auditorDocumentoId: saved.id,
        estado: saved.estado,
        archivosGuardados,
        observaciones: saved.observaciones,
        mensaje: 'Archivos procesados correctamente',
      };

    } catch (error: any) {
      console.error('[SUBIR-AUDITOR] ERROR GENERAL:', error.message);

      // Limpieza de emergencia aunque todo falle
      for (const tempPath of temporalesAEliminar) {
        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch { }
      }

      throw error;
    }
  }

  private obtenerArchivoAuditorDesdeDoc(auditorDoc: AuditorDocumento, tipo: string): string | null {
    switch (tipo) {
      case 'rp':
        return auditorDoc.rpPath || null;
      case 'cdp':
        return auditorDoc.cdpPath || null;
      case 'poliza':
        return auditorDoc.polizaPath || null;
      case 'certificadoBancario':
        return auditorDoc.certificadoBancarioPath || null;
      case 'minuta':
        return auditorDoc.minutaPath || null;
      case 'actaInicio':
        return auditorDoc.actaInicioPath || null;
      default:
        return null;
    }
  }


  private buscarArchivoEnServidor(rutaCarpeta: string, tipo: string, numeroRadicado: string): string | null {
    try {
      if (!fs.existsSync(rutaCarpeta)) {
        return null;
      }

      const archivos = fs.readdirSync(rutaCarpeta);

      // Patrones de búsqueda
      const patrones = [
        `${tipo}_${numeroRadicado}*`,
        `${tipo}_*`,
        `*${tipo}*`
      ];

      for (const patron of patrones) {
        const archivoEncontrado = archivos.find(archivo =>
          archivo.includes(tipo) &&
          !archivo.endsWith('_meta.json')
        );

        if (archivoEncontrado) {
          return archivoEncontrado;
        }
      }

      return null;
    } catch (error) {
      this.logger.error(`Error buscando archivo ${tipo}: ${error.message}`);
      return null;
    }
  }

  /**
   * Obtiene el archivo del auditor desde auditorDoc
   */
  private obtenerArchivoAuditor(auditorDoc: AuditorDocumento, tipo: string): string | null {
    switch (tipo) {
      case 'rp':
        return auditorDoc.rpPath || null;
      case 'cdp':
        return auditorDoc.cdpPath || null;
      case 'poliza':
        return auditorDoc.polizaPath || null;
      case 'certificadoBancario':
        return auditorDoc.certificadoBancarioPath || null;
      case 'minuta':
        return auditorDoc.minutaPath || null;
      case 'actaInicio':
        return auditorDoc.actaInicioPath || null;
      default:
        return null;
    }
  }

  /**
   * Actualiza el path en auditorDoc
   */
  private actualizarPathAuditorDoc(auditorDoc: AuditorDocumento, tipo: string, nombreArchivo: string): void {
    switch (tipo) {
      case 'rp':
        auditorDoc.rpPath = nombreArchivo;
        break;
      case 'cdp':
        auditorDoc.cdpPath = nombreArchivo;
        break;
      case 'poliza':
        auditorDoc.polizaPath = nombreArchivo;
        break;
      case 'certificadoBancario':
        auditorDoc.certificadoBancarioPath = nombreArchivo;
        break;
      case 'minuta':
        auditorDoc.minutaPath = nombreArchivo;
        break;
      case 'actaInicio':
        auditorDoc.actaInicioPath = nombreArchivo;
        break;
    }
  }

  async revisarDocumento(
    documentoId: string,
    auditorId: string,
    revisarDto: RevisarAuditorDocumentoDto
  ): Promise<{ success: boolean; message: string; auditor: AuditorDocumento; documento: Documento }> {
    this.logger.log(`🔍 Auditor ${auditorId} revisando documento ${documentoId} - Estado: ${revisarDto.estado}`);

    // ✅ CORREGIDO: Usar el método estático correctamente
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

    // ✅ MEJORAR LOGGING PARA DIAGNÓSTICO
    console.log('[BACKEND DEBUG] 🧾 ESTADO ACTUAL DE ARCHIVOS EN BD:');
    console.log('• RP:', auditorDoc.rpPath || 'NO SUBIDO');
    console.log('• CDP:', auditorDoc.cdpPath || 'NO SUBIDO');
    console.log('• Póliza:', auditorDoc.polizaPath || 'NO SUBIDO');
    console.log('• Certificado Bancario:', auditorDoc.certificadoBancarioPath || 'NO SUBIDO');
    console.log('• Minuta:', auditorDoc.minutaPath || 'NO SUBIDO');
    console.log('• Acta Inicio:', auditorDoc.actaInicioPath || 'NO SUBIDO');
    console.log('• ¿Documento es primer radicado?:', documento.primerRadicadoDelAno);
    console.log('• ¿tieneTodosDocumentos()?:', auditorDoc.tieneTodosDocumentos());

    console.log('[BACKEND DEBUG] Validaciones:', {
      estadoDocumento: documento.estado,
      primerRadicadoDelAno: documento.primerRadicadoDelAno,
      tieneTodosDocumentos: auditorDoc.tieneTodosDocumentos(),
      estadoSolicitado: revisarDto.estado
    });

    // ✅ Solo validar archivos completos si es PRIMER RADICADO
    if (documento.primerRadicadoDelAno && !auditorDoc.tieneTodosDocumentos()) {
      console.log('[BACKEND DEBUG] ❌ Validación fallida: primer radicado sin documentos completos');

      // Detallar exactamente qué falta
      const faltantes = [];
      if (!auditorDoc.rpPath) faltantes.push('RP');
      if (!auditorDoc.cdpPath) faltantes.push('CDP');
      if (!auditorDoc.polizaPath) faltantes.push('Póliza');
      if (!auditorDoc.certificadoBancarioPath) faltantes.push('Certificado Bancario');
      if (!auditorDoc.minutaPath) faltantes.push('Minuta');
      if (!auditorDoc.actaInicioPath) faltantes.push('Acta de Inicio');

      console.log('[BACKEND DEBUG] 📋 Documentos faltantes:', faltantes);

      throw new BadRequestException(
        `Debes subir todos los documentos requeridos. Faltan: ${faltantes.join(', ')}`
      );
    }



    console.log('[BACKEND DEBUG] Validaciones:', {
      estadoDocumento: documento.estado,
      primerRadicadoDelAno: documento.primerRadicadoDelAno,
      tieneTodosDocumentos: auditorDoc.tieneTodosDocumentos(),
      estadoSolicitado: revisarDto.estado
    });

    // ✅ Solo validar archivos completos si es PRIMER RADICADO
    if (documento.primerRadicadoDelAno && !auditorDoc.tieneTodosDocumentos()) {
      console.log('[BACKEND DEBUG] Validación fallida: primer radicado sin documentos completos');
      throw new BadRequestException('Debes subir todos los documentos requeridos (RP, CDP, Póliza, Certificado Bancario, Minuta, Acta de Inicio) antes de revisar');
    }

    // Solo verificar observaciones si es necesario
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
        mensajeEstado = 'Documento aprobado por auditor';
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

    // Agregar al historial
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

    // Registrar acceso
    if (documento.rutaCarpetaRadicado) {
      await this.registrarAccesoAuditor(
        documento.rutaCarpetaRadicado,
        auditorId,
        `REALIZÓ REVISIÓN`,
        `${estadoAnterior} → ${revisarDto.estado} - ${revisarDto.observaciones?.substring(0, 100) || 'Sin observación'}`
      );
    }

    // Guardar cambios
    await this.documentoRepository.save(documento);
    const savedAuditorDoc = await this.auditorRepository.save(auditorDoc);

    console.log('[BACKEND DEBUG] Revisión completada:', {
      documento: documento.numeroRadicado,
      estadoAnterior: estadoAnterior,
      estadoNuevo: revisarDto.estado,
      estadoDocumentoNuevo: estadoNuevoDocumento,
      mensaje: mensajeEstado
    });

    this.logger.log(`✅ Documento ${documento.numeroRadicado} revisado por auditor. Estado: ${revisarDto.estado}`);

    return {
      success: true,
      message: mensajeEstado,
      auditor: savedAuditorDoc,
      documento
    };
  }

  async descargarArchivoRadicado(
    documentoId: string,
    numeroArchivo: number,
    auditorId: string
  ): Promise<{ ruta: string; nombre: string }> {
    this.logger.log(`📥 Auditor ${auditorId} descargando archivo ${numeroArchivo} del documento ${documentoId}`);
    const auditor = await this.userRepository.findOne({
      where: { id: auditorId }
    });
    if (!auditor) {
      throw new NotFoundException('Auditor no encontrado');
    }
    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId }
    });
    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }
    const auditorDoc = await this.auditorRepository.findOne({
      where: {
        documento: { id: documentoId },
        auditor: { id: auditorId }
      }
    });
    if (!auditorDoc && documento.estado !== 'APROBADO_SUPERVISOR') {
      throw new ForbiddenException('No tienes permisos para acceder a este documento');
    }
    let nombreArchivo: string;
    let descripcion: string;
    switch (numeroArchivo) {
      case 1:
        nombreArchivo = documento.cuentaCobro;
        descripcion = documento.descripcionCuentaCobro;
        break;
      case 2:
        nombreArchivo = documento.seguridadSocial;
        descripcion = documento.descripcionSeguridadSocial;
        break;
      case 3:
        nombreArchivo = documento.informeActividades;
        descripcion = documento.descripcionInformeActividades;
        break;
      default:
        throw new BadRequestException('Número de archivo inválido (1-3)');
    }
    if (!nombreArchivo) {
      throw new NotFoundException(`Archivo no encontrado para el documento`);
    }
    const rutaCompleta = path.join(documento.rutaCarpetaRadicado, nombreArchivo);
    if (!fs.existsSync(rutaCompleta)) {
      throw new NotFoundException(`Archivo no encontrado en el servidor: ${nombreArchivo}`);
    }
    await this.registrarAccesoAuditor(
      documento.rutaCarpetaRadicado,
      auditorId,
      `DESCARGÓ archivo radicado`,
      `Archivo ${numeroArchivo} - ${descripcion || nombreArchivo}`
    );
    return {
      ruta: rutaCompleta,
      nombre: nombreArchivo
    };
  }

  async descargarArchivoAuditor(
    documentoId: string,
    tipoArchivo: string,
    auditorId: string
  ): Promise<{ ruta: string; nombre: string }> {
    const auditorDoc = await this.auditorRepository.findOne({
      where: { documento: { id: documentoId }, auditor: { id: auditorId } },
      relations: ['documento'],
    });

    if (!auditorDoc) {
      throw new NotFoundException('Registro de auditoría no encontrado');
    }

    const documento = auditorDoc.documento;

    let nombreArchivo: string | null = null;
    switch (tipoArchivo.toLowerCase()) {
      case 'rp': nombreArchivo = auditorDoc.rpPath; break;
      case 'cdp': nombreArchivo = auditorDoc.cdpPath; break;
      case 'poliza': nombreArchivo = auditorDoc.polizaPath; break;
      case 'certificadobancario': nombreArchivo = auditorDoc.certificadoBancarioPath; break;
      case 'minuta': nombreArchivo = auditorDoc.minutaPath; break;
      case 'actainicio': nombreArchivo = auditorDoc.actaInicioPath; break;
      default:
        throw new BadRequestException(`Tipo de archivo no válido: ${tipoArchivo}`);
    }

    if (!nombreArchivo) {
      throw new NotFoundException(`No se ha subido archivo de tipo ${tipoArchivo}`);
    }

    // Corrección clave: usar ruta del primer radicado si aplica
    let rutaBase = documento.rutaCarpetaRadicado;

    if (!documento.primerRadicadoDelAno) {
      const primerRadicado = await this.documentoRepository.findOne({
        where: {
          numeroContrato: documento.numeroContrato,
          primerRadicadoDelAno: true,
        },
        order: { fechaRadicacion: 'ASC' },
      });

      if (primerRadicado?.rutaCarpetaRadicado) {
        rutaBase = primerRadicado.rutaCarpetaRadicado;
        this.logger.log(`[DESCARGA] Usando ruta del primer radicado: ${rutaBase}`);
      } else {
        this.logger.warn(`[DESCARGA] No se encontró primer radicado para contrato ${documento.numeroContrato}`);
      }
    }

    const rutaAbsoluta = path.join(rutaBase, nombreArchivo);

    this.logger.log(`[DESCARGA] Ruta calculada: ${rutaAbsoluta}`);

    if (!fs.existsSync(rutaAbsoluta)) {
      this.logger.error(`[DESCARGA 404] No existe: ${rutaAbsoluta}`);
      throw new NotFoundException(`Archivo no encontrado: ${path.basename(nombreArchivo)}`);
    }

    const nombreDescarga = path.basename(nombreArchivo);

    await this.registrarAccesoAuditor(
      rutaBase,
      auditorId,
      `DESCARGÓ archivo de auditor`,
      `Tipo: ${tipoArchivo} - ${nombreDescarga}`
    );

    return {
      ruta: rutaAbsoluta,
      nombre: nombreDescarga,
    };
  }

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
      documento.estado = 'APROBADO_SUPERVISOR';
      documento.fechaActualizacion = new Date();
      documento.ultimoAcceso = new Date();
      documento.ultimoUsuario = `Auditor: ${auditorDoc.auditor.fullName || auditorDoc.auditor.username} (liberó)`;
      documento.usuarioAsignado = null;
      documento.usuarioAsignadoNombre = '';
      const historial = documento.historialEstados || [];
      historial.push({
        fecha: new Date(),
        estado: 'APROBADO_SUPERVISOR',
        usuarioId: auditorId,
        usuarioNombre: auditorDoc.auditor.fullName || auditorDoc.auditor.username,
        rolUsuario: 'AUDITOR_CUENTAS',
        observacion: 'Documento liberado por auditor - Volvió a estado APROBADO_SUPERVISOR'
      });
      documento.historialEstados = historial;
      await queryRunner.manager.save(Documento, documento);
      auditorDoc.estado = AuditorEstado.DISPONIBLE;
      auditorDoc.fechaActualizacion = new Date();
      auditorDoc.fechaFinRevision = new Date();
      auditorDoc.observaciones = 'Documento liberado - Disponible para otros auditores';
      await queryRunner.manager.save(AuditorDocumento, auditorDoc);
      if (documento.rutaCarpetaRadicado) {
        await this.registrarAccesoAuditor(
          documento.rutaCarpetaRadicado,
          auditorId,
          `LIBERÓ documento`,
          `Estado: EN_REVISION_AUDITOR → APROBADO_SUPERVISOR`
        );
      }
      await queryRunner.commitTransaction();
      this.logger.log(`✅ Documento ${documento.numeroRadicado} liberado por ${auditorId}. Estado revertido a APROBADO_SUPERVISOR`);
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

  async obtenerEstadisticasAuditor(auditorId: string): Promise<any> {
    try {
      this.logger.log(`📊 Obteniendo estadísticas para auditor: ${auditorId}`);
      const [
        totalDocumentosDisponibles,
        enRevision,
        aprobados,
        observados,
        rechazados,
        completados,
        primerRadicados
      ] = await Promise.all([
        this.documentoRepository.count({
          where: { estado: 'APROBADO_SUPERVISOR' }
        }),
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.EN_REVISION
          }
        }),
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.APROBADO
          }
        }),
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.OBSERVADO
          }
        }),
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.RECHAZADO
          }
        }),
        this.auditorRepository.count({
          where: {
            auditor: { id: auditorId },
            estado: AuditorEstado.COMPLETADO
          }
        }),
        this.auditorRepository.createQueryBuilder('ad')
          .leftJoin('ad.documento', 'documento')
          .where('ad.auditor_id = :auditorId', { auditorId })
          .andWhere('documento.primer_radicado_ano = true')
          .getCount()
      ]);
      const fechaLimite = new Date();
      fechaLimite.setDate(fechaLimite.getDate() - 7);
      const recientes = await this.auditorRepository
        .createQueryBuilder('auditor')
        .leftJoin('auditor.auditor', 'usuario')
        .where('usuario.id = :auditorId', { auditorId })
        .andWhere('auditor.fechaCreacion >= :fechaLimite', { fechaLimite })
        .getCount();
      const revisionesCompletas = await this.auditorRepository
        .createQueryBuilder('ad')
        .where('ad.auditor_id = :auditorId', { auditorId })
        .andWhere('ad.estado IN (:...estados)', {
          estados: [AuditorEstado.APROBADO, AuditorEstado.COMPLETADO, AuditorEstado.RECHAZADO, AuditorEstado.OBSERVADO]
        })
        .andWhere('ad.fechaInicioRevision IS NOT NULL')
        .andWhere('ad.fechaFinRevision IS NOT NULL')
        .select(['ad.fechaInicioRevision', 'ad.fechaFinRevision'])
        .getMany();
      let tiempoPromedioHoras = 0;
      if (revisionesCompletas.length > 0) {
        const totalHoras = revisionesCompletas.reduce((total, doc) => {
          const inicio = new Date(doc.fechaInicioRevision);
          const fin = new Date(doc.fechaFinRevision);
          const horas = (fin.getTime() - inicio.getTime()) / (1000 * 60 * 60);
          return total + horas;
        }, 0);
        tiempoPromedioHoras = Math.round(totalHoras / revisionesCompletas.length);
      }
      const totalProcesados = aprobados + observados + rechazados + completados;
      const eficiencia = totalProcesados > 0 ?
        Math.round(((aprobados + completados) / totalProcesados) * 100) : 0;
      const estadisticas = {
        totalDocumentosDisponibles: totalDocumentosDisponibles,
        misDocumentos: {
          enRevision: enRevision,
          aprobados: aprobados,
          observados: observados,
          rechazados: rechazados,
          completados: completados,
          primerRadicados: primerRadicados,
          total: enRevision + aprobados + observados + rechazados + completados
        },
        recientes: recientes,
        tiempoPromedioHoras: tiempoPromedioHoras,
        eficiencia: eficiencia,
        fechaConsulta: new Date().toISOString()
      };
      this.logger.log(`✅ Estadísticas calculadas para auditor ${auditorId}`);
      return estadisticas;
    } catch (error) {
      this.logger.error(`❌ Error calculando estadísticas: ${error.message}`);
      throw new InternalServerErrorException(`Error al obtener estadísticas: ${error.message}`);
    }
  }

  async obtenerHistorialAuditor(auditorId: string): Promise<any[]> {
    try {
      console.log(`[HISTORIAL AUDITOR] Buscando para auditorId: ${auditorId}`);

      const auditorDocs = await this.auditorRepository.find({
        where: { auditor: { id: auditorId } },
        relations: ['documento', 'documento.radicador', 'auditor'],
        order: { fechaActualizacion: 'DESC' },
        take: 50
      });

      console.log(`[HISTORIAL AUDITOR] Registros encontrados en BD: ${auditorDocs.length}`);

      if (auditorDocs.length === 0) {
        console.log('[HISTORIAL AUDITOR] No hay registros para este auditor');
      } else {
        console.log('[HISTORIAL AUDITOR] Primer registro:', {
          id: auditorDocs[0].id,
          estado: auditorDocs[0].estado,
          observaciones: auditorDocs[0].observaciones,
          fechaCreacion: auditorDocs[0].fechaCreacion,
          auditor: auditorDocs[0].auditor?.fullName || auditorDocs[0].auditor?.username,
          documentoId: auditorDocs[0].documento?.id,
          numeroRadicado: auditorDocs[0].documento?.numeroRadicado
        });
      }

      const resultado = auditorDocs.map(ad => ({
        id: ad.id,
        documento: {
          id: ad.documento.id,
          numeroRadicado: ad.documento.numeroRadicado,
          nombreContratista: ad.documento.nombreContratista,
          documentoContratista: ad.documento.documentoContratista,
          numeroContrato: ad.documento.numeroContrato,
          fechaRadicacion: ad.documento.fechaRadicacion,
          estado: ad.documento.estado,
          primerRadicadoDelAno: ad.documento.primerRadicadoDelAno
        },
        auditor: ad.auditor?.fullName || ad.auditor?.username,
        estado: ad.estado,
        observaciones: ad.observaciones,
        fechaCreacion: ad.fechaCreacion,
        fechaActualizacion: ad.fechaActualizacion,
        fechaAprobacion: ad.fechaAprobacion,
        fechaInicioRevision: ad.fechaInicioRevision,
        tieneDocumentos: ad.tieneTodosDocumentos(),
        auditorAsignado: ad.auditor?.fullName || ad.auditor?.username
      }));

      console.log(`[HISTORIAL AUDITOR] Enviando al frontend ${resultado.length} registros`);

      return resultado;
    } catch (error) {
      console.error('[HISTORIAL AUDITOR] Error:', error.message, error.stack);
      throw error;
    }
  }

  private async guardarArchivoAuditor(
    documento: Documento,
    archivo: Express.Multer.File,
    tipo: string,
    auditorId: string
  ): Promise<string> {
    try {
      const maxSize = 15 * 1024 * 1024;
      if (archivo.size > maxSize) {
        throw new BadRequestException(`El archivo ${tipo} excede el tamaño máximo de 15MB`);
      }
      const allowedMimes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/png',
        'image/jpg'
      ];
      if (!allowedMimes.includes(archivo.mimetype)) {
        throw new BadRequestException(`Tipo de archivo no permitido para ${tipo}: ${archivo.mimetype}`);
      }
      const rutaAuditor = path.join(documento.rutaCarpetaRadicado, 'auditor', auditorId);
      if (!fs.existsSync(rutaAuditor)) {
        fs.mkdirSync(rutaAuditor, { recursive: true });
      }
      const extension = path.extname(archivo.originalname);
      const nombreBase = `${tipo}_${documento.numeroRadicado}`;
      const timestamp = Date.now();
      const hash = crypto.randomBytes(4).toString('hex');
      const nombreArchivo = `${nombreBase}_${timestamp}_${hash}${extension}`;
      const rutaCompleta = path.join(rutaAuditor, nombreArchivo);
      fs.writeFileSync(rutaCompleta, archivo.buffer);
      const metadatos = {
        nombreOriginal: archivo.originalname,
        nombreGuardado: nombreArchivo,
        mimeType: archivo.mimetype,
        tamanio: archivo.size,
        fechaSubida: new Date().toISOString(),
        tipoDocumento: tipo,
        descripcion: this.obtenerDescripcionTipo(tipo),
        auditorId: auditorId,
        documentoId: documento.id,
        numeroRadicado: documento.numeroRadicado
      };
      fs.writeFileSync(
        path.join(rutaAuditor, `${nombreBase}_${timestamp}_${hash}_meta.json`),
        JSON.stringify(metadatos, null, 2)
      );
      this.logger.log(`💾 Archivo de auditor (${tipo}) guardado: ${rutaCompleta} (${archivo.size} bytes)`);
      return nombreArchivo;
    } catch (error) {
      this.logger.error(`❌ Error guardando archivo de auditor (${tipo}): ${error.message}`);
      throw new BadRequestException(`Error al guardar archivo ${tipo}: ${error.message}`);
    }
  }

  private obtenerDescripcionTipo(tipo: string): string {
    const descripciones: Record<string, string> = {
      'rp': 'Resolución de Pago',
      'cdp': 'Certificado de Disponibilidad Presupuestal',
      'poliza': 'Póliza de Cumplimiento',
      'certificadoBancario': 'Certificado Bancario',
      'minuta': 'Minuta de Contrato',
      'actaInicio': 'Acta de Inicio'
    };
    return descripciones[tipo] || tipo;
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
        },
        tieneDocumentos: auditorDoc.tieneTodosDocumentos(),
        puedeSubirDocumentos: documento.primerRadicadoDelAno
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
      {
        tipo: 'rp',
        descripcion: 'Resolución de Pago',
        subido: !!auditorDoc?.rpPath,
        nombreArchivo: auditorDoc?.rpPath
      },
      {
        tipo: 'cdp',
        descripcion: 'Certificado de Disponibilidad Presupuestal',
        subido: !!auditorDoc?.cdpPath,
        nombreArchivo: auditorDoc?.cdpPath
      },
      {
        tipo: 'poliza',
        descripcion: 'Póliza',
        subido: !!auditorDoc?.polizaPath,
        nombreArchivo: auditorDoc?.polizaPath
      },
      {
        tipo: 'certificadoBancario',
        descripcion: 'Certificado Bancario',
        subido: !!auditorDoc?.certificadoBancarioPath,
        nombreArchivo: auditorDoc?.certificadoBancarioPath
      },
      {
        tipo: 'minuta',
        descripcion: 'Minuta',
        subido: !!auditorDoc?.minutaPath,
        nombreArchivo: auditorDoc?.minutaPath
      },
      {
        tipo: 'actaInicio',
        descripcion: 'Acta de Inicio',
        subido: !!auditorDoc?.actaInicioPath,
        nombreArchivo: auditorDoc?.actaInicioPath
      }
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
        descripcionCuentaCobro: documento.descripcionCuentaCobro,
        descripcionSeguridadSocial: documento.descripcionSeguridadSocial,
        descripcionInformeActividades: documento.descripcionInformeActividades
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

  private agregarAlHistorial(
    documento: Documento,
    auditor: User,
    estadoAnterior: string,
    estadoNuevo: string,
    observaciones?: string
  ): void {
    const historial = documento.historialEstados || [];
    historial.push({
      fecha: new Date(),
      estado: estadoNuevo,
      usuarioId: auditor.id,
      usuarioNombre: auditor.fullName || auditor.username,
      rolUsuario: auditor.role,
      observacion: observaciones || `Auditor: ${estadoAnterior} → ${estadoNuevo}`,
    });
    documento.historialEstados = historial;
  }

  async obtenerMisAuditorias(auditorId: string): Promise<any[]> {
    this.logger.log(`📋 Obteniendo MIS auditorías para auditorId: ${auditorId}`);

    console.log(`[obtenerMisAuditorias] Buscando para auditorId exacto: ${auditorId}`);

    const auditorDocs = await this.auditorRepository.find({
      where: { auditor: { id: auditorId } },
      relations: ['documento', 'auditor'],
      order: { fechaActualizacion: 'DESC' }
    });

    console.log(`[obtenerMisAuditorias] Registros encontrados: ${auditorDocs.length}`);
    if (auditorDocs.length > 0) {
      console.log('Primer registro:', auditorDocs[0]);
    }

    try {
      const auditorDocs = await this.auditorRepository.find({
        where: {
          auditor: { id: auditorId }
          // Sin filtro de estado → trae todos: EN_REVISION, APROBADO_AUDITOR, etc.
        },
        relations: [
          'documento',
          'documento.radicador',
          'documento.usuarioAsignado',
          'auditor'
        ],
        order: { fechaActualizacion: 'DESC' }
      });

      this.logger.log(`✅ Encontradas ${auditorDocs.length} auditorías propias`);

      return auditorDocs.map(ad => ({
        id: ad.documento.id,
        numeroRadicado: ad.documento.numeroRadicado,
        numeroContrato: ad.documento.numeroContrato,
        nombreContratista: ad.documento.nombreContratista,
        documentoContratista: ad.documento.documentoContratista,
        fechaRadicacion: ad.documento.fechaRadicacion,
        estado: ad.documento.estado,              // estado general del doc
        auditorEstado: ad.estado,                 // estado en auditor_documentos
        observaciones: ad.observaciones || '',
        fechaInicioRevision: ad.fechaInicioRevision,
        fechaFinRevision: ad.fechaFinRevision,
        fechaAprobacion: ad.fechaAprobacion,
        primerRadicadoDelAno: ad.documento.primerRadicadoDelAno,
        supervisor: ad.documento.usuarioAsignadoNombre || 'No asignado',
        auditorAsignado: ad.auditor?.fullName || ad.auditor?.username,
        tieneDocumentos: ad.tieneTodosDocumentos()
      }));
    } catch (error) {
      this.logger.error(`❌ Error en mis-auditorias: ${error.message}`);
      throw error;
    }
  }

  private buscarArchivosEnCarpeta(rutaCarpeta: string, numeroRadicado: string): {
    rp: string | null;
    cdp: string | null;
    poliza: string | null;
    certificadoBancario: string | null;
    minuta: string | null;
    actaInicio: string | null;
  } {
    const resultado: Record<'rp' | 'cdp' | 'poliza' | 'certificadoBancario' | 'minuta' | 'actaInicio', string | null> = {
      rp: null,
      cdp: null,
      poliza: null,
      certificadoBancario: null,
      minuta: null,
      actaInicio: null,
    };

    if (!rutaCarpeta || !fs.existsSync(rutaCarpeta)) {
      console.log(`[BUSCAR-CARPETA] ❌ Carpeta no existe: ${rutaCarpeta}`);
      return resultado;
    }

    try {
      const archivos = fs.readdirSync(rutaCarpeta);
      console.log(`[BUSCAR-CARPETA] 📁 Archivos en ${rutaCarpeta}:`, archivos.length);

      const patrones: Record<keyof typeof resultado, RegExp[]> = {
        rp: [
          new RegExp(`rp.*${numeroRadicado}`, 'i'),
          /resoluci[oó]n.*pago/i,
          /rp[_-]/i,
          /^rp/i,
          /.*pago.*/i,
        ],
        cdp: [
          new RegExp(`cdp.*${numeroRadicado}`, 'i'),
          /certificado.*disponibilidad/i,
          /cdp[_-]/i,
          /^cdp/i,
          /.*disponibilidad.*/i,
        ],
        poliza: [
          new RegExp(`poliza.*${numeroRadicado}`, 'i'),
          /p[oó]liza.*cumplimiento/i,
          /poliza[_-]/i,
          /^poliza/i,
          /.*cumplimiento.*/i,
        ],
        certificadoBancario: [
          new RegExp(`certificado.*bancario.*${numeroRadicado}`, 'i'),
          /certificado.*bancario/i,
          /certificado[_-]bancario/i,
          /.*bancario.*/i,
          /.*banco.*/i,
        ],
        minuta: [
          new RegExp(`minuta.*${numeroRadicado}`, 'i'),
          /minuta.*contrato/i,
          /minuta[_-]/i,
          /^minuta/i,
          /.*contrato.*/i,
        ],
        actaInicio: [
          new RegExp(`acta.*inicio.*${numeroRadicado}`, 'i'),
          /acta.*de.*inicio/i,
          /acta[_-]inicio/i,
          /^acta/i,
          /.*inicio.*/i,
        ],
      };

      const ignorar = [
        /_meta\.json$/i,
        /\.tmp$/i,
        /~$/i,
        /^\./,
        /Thumbs\.db/i,
        /desktop\.ini/i,
      ];

      archivos.forEach((archivo) => {
        const nombreLower = archivo.toLowerCase();

        if (ignorar.some((regex) => regex.test(nombreLower))) {
          return;
        }

        (Object.keys(patrones) as (keyof typeof resultado)[]).forEach((tipo) => {
          if (resultado[tipo] !== null) return; // ya encontrado

          const regexList = patrones[tipo];
          if (regexList.some((regex) => regex.test(nombreLower))) {
            resultado[tipo] = archivo;
            console.log(`[BUSCAR-CARPETA] ✅ ${tipo.toUpperCase()} encontrado: ${archivo}`);
          }
        });
      });

      return resultado;
    } catch (error) {
      console.error(`[BUSCAR-CARPETA] Error en ${rutaCarpeta}:`, error);
      return resultado;
    }
  }

  // Método para obtener documento en modo debug
  async obtenerDocumentoDebug(documentoId: string, auditorId: string): Promise<any> {
    this.logger.log(`🔍 [DEBUG] Obteniendo documento ${documentoId} para auditor ${auditorId}`);

    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId },
      select: ['id', 'numeroRadicado', 'estado', 'primerRadicadoDelAno', 'nombreContratista', 'usuarioAsignadoNombre']
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    const auditorDoc = await this.auditorRepository.findOne({
      where: {
        documento: { id: documentoId },
        auditor: { id: auditorId }
      },
      relations: ['auditor']
    });

    const auditor = await this.userRepository.findOne({
      where: { id: auditorId }
    });

    return {
      debug: true,
      timestamp: new Date().toISOString(),
      documento: {
        id: documento.id,
        numeroRadicado: documento.numeroRadicado,
        estado: documento.estado,
        primerRadicadoDelAno: documento.primerRadicadoDelAno,
        nombreContratista: documento.nombreContratista,
        usuarioAsignadoNombre: documento.usuarioAsignadoNombre
      },
      auditorDoc: auditorDoc ? {
        id: auditorDoc.id,
        estado: auditorDoc.estado,
        auditorId: auditorDoc.auditor?.id,
        auditorNombre: auditorDoc.auditor?.fullName || auditorDoc.auditor?.username
      } : null,
      usuario: {
        id: auditorId,
        username: auditor?.username,
        fullName: auditor?.fullName,
        role: auditor?.role
      },
      permisos: {
        puedeVer: ['APROBADO_SUPERVISOR', 'EN_REVISION_AUDITOR', 'APROBADO_AUDITOR', 'OBSERVADO_AUDITOR', 'RECHAZADO_AUDITOR', 'COMPLETADO_AUDITOR'].includes(documento.estado),
        puedeRevisar: documento.estado === 'EN_REVISION_AUDITOR' && auditorDoc?.auditor?.id === auditorId
      }
    };
  }

  async diagnosticoDocumentos(documentoId: string, auditorId: string): Promise<any> {
    const auditorDoc = await this.auditorRepository.findOne({
      where: {
        documento: { id: documentoId },
        auditor: { id: auditorId }
      },
      relations: ['documento']
    });

    if (!auditorDoc) {
      return { error: 'No se encontró registro de auditoría' };
    }

    return {
      auditorDoc: {
        id: auditorDoc.id,
        estado: auditorDoc.estado,
        tieneTodosDocumentos: auditorDoc.tieneTodosDocumentos(),
        archivos: {
          rp: auditorDoc.rpPath,
          cdp: auditorDoc.cdpPath,
          poliza: auditorDoc.polizaPath,
          certificadoBancario: auditorDoc.certificadoBancarioPath,
          minuta: auditorDoc.minutaPath,
          actaInicio: auditorDoc.actaInicioPath
        }
      },
      documento: {
        id: auditorDoc.documento.id,
        numeroRadicado: auditorDoc.documento.numeroRadicado,
        primerRadicadoDelAno: auditorDoc.documento.primerRadicadoDelAno,
        estado: auditorDoc.documento.estado
      }
    };
  }



async obtenerRutaArchivoAuditorFull(
  documentoId: string,
  tipo: string,
  userId?: string,
): Promise<{ rutaAbsoluta: string; nombreArchivo: string }> {
  const logPrefix = `[obtenerRutaArchivoAuditorFull] doc=${documentoId} tipo=${tipo} user=${userId || 'anon'}`;
  this.logger.log(`${logPrefix} → Iniciando`);

  const documentoSolicitado = await this.documentoRepository.findOne({
    where: { id: documentoId },
  });

  if (!documentoSolicitado) {
    this.logger.error(`${logPrefix} → Documento no encontrado`);
    throw new NotFoundException(`Documento ${documentoId} no encontrado`);
  }

  this.logger.debug(`${logPrefix} → Documento: ${documentoSolicitado.numeroRadicado} | primerRadicado: ${documentoSolicitado.primerRadicadoDelAno}`);

  let auditorDoc: AuditorDocumento | null = null;
  let documentoParaArchivos = documentoSolicitado;

  if (!documentoSolicitado.primerRadicadoDelAno) {
    this.logger.log(`${logPrefix} → No es primer → buscando AuditorDocumento con archivos para contrato ${documentoSolicitado.numeroContrato}`);

    const auditorConArchivos = await this.auditorDocumentoRepository
      .createQueryBuilder('aud')
      .innerJoinAndSelect('aud.documento', 'doc')
      .where('doc.numeroContrato = :contrato', { contrato: documentoSolicitado.numeroContrato })
      .andWhere(
        'aud.rpPath IS NOT NULL OR aud.cdpPath IS NOT NULL OR aud.polizaPath IS NOT NULL OR ' +
        'aud.certificadoBancarioPath IS NOT NULL OR aud.minutaPath IS NOT NULL OR aud.actaInicioPath IS NOT NULL'
      )
      .orderBy('doc.fechaRadicacion', 'ASC')
      .limit(1)
      .getOne();

    if (!auditorConArchivos) {
      this.logger.warn(`${logPrefix} → No se encontró AuditorDocumento con archivos`);
      throw new NotFoundException(
        `No se encontraron documentos de auditoría subidos para el contrato ${documentoSolicitado.numeroContrato}.`
      );
    }

    documentoParaArchivos = auditorConArchivos.documento;
    auditorDoc = auditorConArchivos;
    this.logger.log(`${logPrefix} → Usando radicado con archivos: ${documentoParaArchivos.numeroRadicado} (id: ${documentoParaArchivos.id})`);
  } else {
    auditorDoc = await this.auditorDocumentoRepository.findOne({
      where: { documento: { id: documentoParaArchivos.id } },
    });

    if (!auditorDoc) {
      this.logger.error(`${logPrefix} → Registro auditor no encontrado para doc ${documentoParaArchivos.id}`);
      throw new NotFoundException(`Registro de auditoría no encontrado`);
    }
  }

  // Aquí auditorDoc ya está garantizado no-null
  let nombreArchivoBd: string | undefined | null;
  switch (tipo.toLowerCase()) {
    case 'rp':
      nombreArchivoBd = auditorDoc.rpPath;
      break;
    case 'cdp':
      nombreArchivoBd = auditorDoc.cdpPath;
      break;
    case 'poliza':
      nombreArchivoBd = auditorDoc.polizaPath;
      break;
    case 'certificadobancario':
      nombreArchivoBd = auditorDoc.certificadoBancarioPath;
      break;
    case 'minuta':
      nombreArchivoBd = auditorDoc.minutaPath;
      break;
    case 'actainicio':
      nombreArchivoBd = auditorDoc.actaInicioPath;
      break;
    default:
      this.logger.error(`${logPrefix} → Tipo inválido: ${tipo}`);
      throw new BadRequestException(`Tipo de archivo no soportado: ${tipo}`);
  }

  if (!nombreArchivoBd || nombreArchivoBd.trim() === '') {
    this.logger.warn(`${logPrefix} → No hay archivo para tipo ${tipo} en auditor_documentos (id: ${auditorDoc.id})`);
    throw new NotFoundException(`No existe archivo registrado para tipo ${tipo}`);
  }

  let nombreArchivoLimpio = nombreArchivoBd
    .replace(/^auditor[\/\\]?/i, '')
    .replace(/^[\/\\]+/, '')
    .replace(/[\/\\]+$/, '')
    .trim();

  this.logger.log(`${logPrefix} → Nombre BD: ${nombreArchivoBd}`);
  this.logger.log(`${logPrefix} → Nombre limpio: ${nombreArchivoLimpio}`);

  let rutaBase = this.configService.get<string>('RUTA_BASE_ARCHIVOS') || '\\\\R2-D2\\api-contract';
  rutaBase = '\\\\' + rutaBase.replace(/^\\\\?/, '').replace(/^[\/\\]+/, '');

  let rutaCarpeta = documentoParaArchivos.rutaCarpetaRadicado || '';
  rutaCarpeta = rutaCarpeta
    .replace(/^\\\\R2-D2\\api-contract/i, '')
    .replace(/^[\/\\]+/, '')
    .replace(/[\/\\]+$/, '')
    .trim();

  const rutaAuditor = path.join(rutaCarpeta, 'auditor');

  let rutaAbsoluta = path.join(rutaBase, rutaAuditor, nombreArchivoLimpio);
  rutaAbsoluta = rutaAbsoluta.replace(/\//g, '\\').replace(/^\\+/, '\\\\');

  this.logger.log(`${logPrefix} → Ruta base: ${rutaBase}`);
  this.logger.log(`${logPrefix} → Carpeta limpia: ${rutaCarpeta}`);
  this.logger.log(`${logPrefix} → Ruta final: ${rutaAbsoluta}`);

  if (!fs.existsSync(rutaAbsoluta)) {
    this.logger.error(`${logPrefix} → NO existe: ${rutaAbsoluta}`);
    try {
      const carpeta = path.dirname(rutaAbsoluta);
      this.logger.log(`[DEBUG] ¿Existe carpeta? ${fs.existsSync(carpeta)}`);
      if (fs.existsSync(carpeta)) {
        this.logger.log(`[DEBUG] Archivos: ${fs.readdirSync(carpeta).join(', ') || 'ninguno'}`);
      }
    } catch (e) {
      this.logger.error(`[DEBUG] Error: ${e.message}`);
    }
    throw new NotFoundException(`Archivo ${tipo} no encontrado en disco`);
  }

  this.logger.log(`${logPrefix} → ÉXITO: ${rutaAbsoluta}`);

  return { rutaAbsoluta, nombreArchivo: nombreArchivoLimpio };
}

  // ============================================================================
  // CONVERSIÓN WORD → PDF (usando LibreOffice)
  // ============================================================================
  async convertirWordAPdf(inputPath: string, outputPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cmd = `soffice --headless --convert-to pdf --outdir "${path.dirname(outputPath)}" "${inputPath}"`;

      exec(cmd, (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          this.logger.error(`[CONVERSIÓN ERROR] ${error.message}`);
          return reject(error);
        }

        if (stderr) {
          this.logger.warn(`[CONVERSIÓN STDERR] ${stderr}`);
        }

        const pdfGenerado = path.join(
          path.dirname(outputPath),
          path.basename(inputPath).replace(/\.(docx|doc)$/i, '.pdf')
        );

        if (fs.existsSync(pdfGenerado)) {
          fs.renameSync(pdfGenerado, outputPath);
          this.logger.log(`[CONVERSIÓN OK] PDF creado: ${outputPath}`);
          resolve();
        } else {
          reject(new Error(`No se generó el PDF esperado en ${path.dirname(outputPath)}`));
        }
      });
    });
  }



}