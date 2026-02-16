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
import {
    TesoreriaDocumento,
    TesoreriaEstado
} from './entities/tesoreria-documento.entity';
import { Documento } from './../radicacion/entities/documento.entity';
import { User } from './../users/entities/user.entity';
import { UserRole } from './../users/enums/user-role.enum';
import { ContabilidadDocumento } from './../contabilidad/entities/contabilidad-documento.entity';
import { extname } from 'path';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as mime from 'mime-types';
import { TesoreriaSignatureService } from './tesoreria-signature.service';
import { Signature } from '../signatures/entities/signature.entity';

const execAsync = promisify(exec);

@Injectable()
export class TesoreriaService {
  private readonly logger = new Logger(TesoreriaService.name);

  constructor(
    @InjectRepository(TesoreriaDocumento)
    private tesoreriaRepository: Repository<TesoreriaDocumento>,
    @InjectRepository(Documento)
    private documentoRepository: Repository<Documento>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(ContabilidadDocumento)
    private contabilidadDocumentoRepository: Repository<ContabilidadDocumento>,
    private readonly configService: ConfigService,
    @InjectRepository(Signature) // 👈 AGREGAR ESTA LÍNEA
    private signaturesRepository: Repository<Signature>,
    private readonly tesoreriaSignatureService: TesoreriaSignatureService, // 👈 NUEVO SERVICIO
  ) {
    this.logger.log('💰 TesoreriaService inicializado');
  }

    async obtenerDocumentosDisponibles(tesoreroId: string): Promise<any[]> {
        this.logger.log(`📋 Tesorero ${tesoreroId} solicitando documentos disponibles`);

        try {
            const documentos = await this.documentoRepository
                .createQueryBuilder('documento')
                .leftJoinAndSelect('documento.radicador', 'radicador')
                .leftJoinAndSelect('documento.usuarioAsignado', 'usuarioAsignado')
                .where("documento.estado IN (:...estados)", {
                    estados: ['COMPLETADO_CONTABILIDAD']
                })
                .orderBy('documento.fechaRadicacion', 'ASC')
                .getMany();

            this.logger.log(`✅ Encontrados ${documentos.length} documentos completados por contabilidad`);

            const tesoreriaDocs = await this.tesoreriaRepository.find({
                where: {
                    tesorero: { id: tesoreroId },
                    estado: TesoreriaEstado.EN_REVISION
                },
                relations: ['documento']
            });

            const documentosEnRevisionIds = tesoreriaDocs.map(td => td.documento.id);

            const documentosFiltrados = documentos.filter(documento => {
                if (documento.estado === 'EN_REVISION_TESORERIA') {
                    const tesoreriaDoc = tesoreriaDocs.find(td => td.documento.id === documento.id);
                    return tesoreriaDoc !== undefined;
                }
                return true;
            });

            const documentosConEstado = documentosFiltrados.map(documento => {
                const estaRevisandoYo = documentosEnRevisionIds.includes(documento.id);
                const yaEstaEnTesoreria = documento.estado === 'EN_REVISION_TESORERIA';

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
                    contador: documento.usuarioAsignadoNombre,
                    observacion: documento.observacion || '',
                    disponible: !yaEstaEnTesoreria || estaRevisandoYo,
                    asignacion: {
                        enRevision: estaRevisandoYo,
                        puedoTomar: !yaEstaEnTesoreria,
                        tieneDocumentoSubido: false,
                        contadorAsignado: documento.usuarioAsignadoNombre,
                    }
                };
            });

            return documentosConEstado;
        } catch (error) {
            this.logger.error(`❌ Error obteniendo documentos disponibles: ${error.message}`);
            throw error;
        }
    }

    async tomarDocumentoParaRevision(documentoId: string, tesoreroId: string): Promise<{
        success: boolean;
        message: string;
        documento: any
    }> {
        this.logger.log(`🤝 Tesorero ${tesoreroId} tomando documento ${documentoId} para revisión`);

        const queryRunner = this.tesoreriaRepository.manager.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const documento = await queryRunner.manager
                .createQueryBuilder(Documento, 'documento')
                .where('documento.id = :id', { id: documentoId })
                .andWhere('documento.estado = :estado', {
                    estado: 'COMPLETADO_CONTABILIDAD'
                })
                .setLock('pessimistic_write')
                .getOne();

            if (!documento) {
                throw new NotFoundException(
                    'Documento no encontrado o no está disponible para tesorería (debe estar completado por contabilidad)'
                );
            }

            if (documento.estado === 'EN_REVISION_TESORERIA') {
                throw new ConflictException(
                    'Este documento ya está siendo procesado por otro tesorero'
                );
            }

            const tesorero = await queryRunner.manager.findOne(User, {
                where: { id: tesoreroId }
            });

            if (!tesorero) {
                throw new NotFoundException('Tesorero no encontrado');
            }

            const tesoreriaDocExistente = await queryRunner.manager.findOne(TesoreriaDocumento, {
                where: {
                    documento: { id: documentoId },
                    tesorero: { id: tesoreroId }
                },
                relations: ['tesorero']
            });

            if (tesoreriaDocExistente) {
                tesoreriaDocExistente.estado = TesoreriaEstado.EN_REVISION;
                tesoreriaDocExistente.fechaActualizacion = new Date();
                tesoreriaDocExistente.fechaInicioRevision = new Date();
                await queryRunner.manager.save(TesoreriaDocumento, tesoreriaDocExistente);
            } else {
                const tesoreriaDoc = queryRunner.manager.create(TesoreriaDocumento, {
                    documento: documento,
                    tesorero: tesorero,
                    estado: TesoreriaEstado.EN_REVISION,
                    fechaCreacion: new Date(),
                    fechaActualizacion: new Date(),
                    fechaInicioRevision: new Date(),
                    observaciones: 'Documento tomado para procesamiento de tesorería'
                });
                await queryRunner.manager.save(TesoreriaDocumento, tesoreriaDoc);
            }

            documento.estado = 'EN_REVISION_TESORERIA';
            documento.fechaActualizacion = new Date();
            documento.ultimoAcceso = new Date();
            documento.ultimoUsuario = `Tesoreria: ${tesorero.fullName || tesorero.username}`;
            documento.usuarioAsignado = tesorero;
            documento.usuarioAsignadoNombre = tesorero.fullName || tesorero.username;

            const historial = documento.historialEstados || [];
            historial.push({
                fecha: new Date(),
                estado: 'EN_REVISION_TESORERIA',
                usuarioId: tesorero.id,
                usuarioNombre: tesorero.fullName || tesorero.username,
                rolUsuario: tesorero.role,
                observacion: `Documento tomado para procesamiento por tesorería ${tesorero.username}`
            });
            documento.historialEstados = historial;

            await queryRunner.manager.save(Documento, documento);

            if (documento.rutaCarpetaRadicado) {
                await this.registrarAccesoTesoreria(
                    documento.rutaCarpetaRadicado,
                    tesoreroId,
                    `TOMÓ documento para tesorería`,
                    `Estado: ${documento.estado}`
                );
            }

            await queryRunner.commitTransaction();

            this.logger.log(`✅ Documento ${documento.numeroRadicado} tomado para procesamiento por ${tesorero.username}`);

            return {
                success: true,
                message: `Documento ${documento.numeroRadicado} tomado para procesamiento de tesorería`,
                documento: this.mapearDocumentoParaRespuesta(documento)
            };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error(`❌ Error tomando documento: ${error.message}`, error.stack);
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

    async obtenerDocumentosEnRevision(tesoreroId: string): Promise<any[]> {
        this.logger.log(`📋 Tesorero ${tesoreroId} solicitando documentos en revisión`);

        try {
            const tesoreriaDocs = await this.tesoreriaRepository.find({
                where: {
                    tesorero: { id: tesoreroId },
                    estado: TesoreriaEstado.EN_REVISION
                },
                relations: ['documento', 'documento.radicador', 'tesorero']
            });

            return tesoreriaDocs.map(tesoreriaDoc => {
                return this.mapearDocumentoParaRespuesta(tesoreriaDoc.documento, tesoreriaDoc);
            });
        } catch (error) {
            this.logger.error(`❌ Error obteniendo documentos en revisión: ${error.message}`);
            throw error;
        }
    }

    async obtenerDetalleDocumento(documentoId: string, userId: string): Promise<any> {
        this.logger.log(`🔍 Usuario ${userId} solicitando detalle del documento ${documentoId}`);

        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: ['id', 'username', 'role', 'fullName']
        });

        if (!user) {
            this.logger.warn(`Usuario no encontrado: ${userId}`);
            throw new NotFoundException('Usuario no encontrado');
        }

        this.logger.debug(`Usuario encontrado: ${user.username} (${user.role})`);

        const documento = await this.documentoRepository.findOne({
            where: { id: documentoId },
            relations: ['radicador', 'usuarioAsignado'],
        });

        if (!documento) {
            this.logger.warn(`Documento no encontrado: ${documentoId}`);
            throw new NotFoundException('Documento no encontrado');
        }

        const rol = user.role?.toLowerCase() || '';
        const estado = documento.estado?.toUpperCase() || '';

        let tieneAcceso = false;

        if (rol === 'tesoreria' || rol === 'admin') {
            tieneAcceso =
                estado.includes('TESORERIA') ||
                estado === 'COMPLETADO_CONTABILIDAD' ||
                estado.includes('RECHAZADO_TESORERIA') ||
                estado.includes('COMPLETADO_TESORERIA') ||
                estado.includes('PAGADO_TESORERIA');
        } else if (rol === 'contabilidad') {
            tieneAcceso = estado.includes('CONTABILIDAD') || estado === 'COMPLETADO_CONTABILIDAD';
        } else if (rol === 'supervisor') {
            tieneAcceso = ['RADICADO', 'EN_REVISION_SUPERVISOR'].includes(estado);
        }

        if (!tieneAcceso) {
            this.logger.warn(`Acceso denegado - Estado: ${estado} - Rol: ${rol}`);
            throw new ForbiddenException(
                `Solo puedes acceder a documentos en estado COMPLETADO_CONTABILIDAD o estados de tesorería (actual: ${estado})`
            );
        }

        let tesoreriaDoc: TesoreriaDocumento | null = null;
        if (rol === 'tesoreria' || rol === 'admin') {
            tesoreriaDoc = await this.tesoreriaRepository.findOne({
                where: {
                    documento: { id: documentoId },
                    tesorero: { id: userId }
                },
                relations: ['tesorero'],
            });
        }

        const contabilidadDoc = await this.contabilidadDocumentoRepository.findOne({
            where: { documento: { id: documentoId } },
            relations: ['contador'],
            order: { fechaActualizacion: 'DESC' }
        });

        const respuesta = this.construirRespuestaDetalle(documento, tesoreriaDoc, contabilidadDoc, user);

        await this.registrarUltimoAcceso(documento, user);

        this.logger.log(`Detalle entregado exitosamente para documento ${documentoId} a ${user.username}`);
        return respuesta;
    }

    private async registrarUltimoAcceso(documento: Documento, user: User): Promise<void> {
        try {
            if (!documento.radicador) {
                this.logger.warn(
                    `No se actualiza ultimoAcceso en documento ${documento.id}: no tiene radicador asociado`
                );
                return;
            }

            documento.ultimoAcceso = new Date();
            documento.ultimoUsuario = user.username || user.email || 'Sistema';

            await this.documentoRepository.save(documento);

            this.logger.debug(
                `Ultimo acceso actualizado en documento ${documento.id} por ${user.username}`
            );
        } catch (error: any) {
            this.logger.error(
                `Error actualizando ultimo acceso en documento ${documento.id}: ${error.message}`,
                error.stack
            );
        }
    }

async subirDocumentoTesoreria(
  documentoId: string,
  tesoreroId: string,
  datos: {
    observaciones?: string;
    estadoFinal?: string;
    signatureId?: string;
    signaturePosition?: string;
  },
  files: { [key: string]: Express.Multer.File[] },
): Promise<{ success: boolean; message: string; tesoreria: TesoreriaDocumento }> {
  const logPrefix = `[SUBIR-DOCS] doc=${documentoId} tesorero=${tesoreroId}`;
  this.logger.log(`${logPrefix} Iniciando subida...`);

  this.logger.log(`${logPrefix} Archivos recibidos: ${files ? Object.keys(files).join(', ') : 'NINGUNO'}`);
  if (files) {
    Object.keys(files).forEach(key => {
      if (files[key] && files[key][0]) {
        const file = files[key][0];
        this.logger.log(`${logPrefix}   → ${key}: ${file.originalname} (${file.size} bytes, ${file.mimetype})`);
      }
    });
  }

  const tesoreriaDoc = await this.tesoreriaRepository.findOne({
    where: {
      documento: { id: documentoId },
      tesorero: { id: tesoreroId },
      estado: TesoreriaEstado.EN_REVISION
    },
    relations: ['documento', 'tesorero']
  });

  if (!tesoreriaDoc) {
    this.logger.error(`${logPrefix} No tiene el documento en revisión`);
    throw new ForbiddenException('No tienes este documento asignado en revisión');
  }

  const documento = tesoreriaDoc.documento;
  const tesorero = tesoreriaDoc.tesorero;

  this.logger.log(`${logPrefix} Documento: ${documento.numeroRadicado}, Tesorero: ${tesorero.username}`);

  if (!documento.rutaCarpetaRadicado) {
    this.logger.error(`${logPrefix} No tiene rutaCarpetaRadicado`);
    throw new BadRequestException('El documento no tiene ruta de carpeta asignada');
  }

  if (!fs.existsSync(documento.rutaCarpetaRadicado)) {
    this.logger.error(`${logPrefix} Carpeta no existe: ${documento.rutaCarpetaRadicado}`);
    throw new BadRequestException(`La carpeta del documento no existe: ${documento.rutaCarpetaRadicado}`);
  }

  const carpetaTesoreria = path.join(documento.rutaCarpetaRadicado, 'tesoreria');
  if (!fs.existsSync(carpetaTesoreria)) {
    fs.mkdirSync(carpetaTesoreria, { recursive: true });
    this.logger.log(`${logPrefix} 📁 Creada carpeta tesorería: ${carpetaTesoreria}`);
  }

  if (datos.observaciones) {
    tesoreriaDoc.observaciones = datos.observaciones;
  }

  tesoreriaDoc.fechaActualizacion = new Date();

  const archivosGuardados: Record<string, string> = {};

  const guardarArchivo = async (tipo: string, file?: Express.Multer.File): Promise<boolean> => {
    if (!file) {
      this.logger.log(`${logPrefix} ⚠️ No se recibió archivo para ${tipo}`);
      return false;
    }

    if (!file.buffer || file.buffer.length === 0) {
      this.logger.error(`${logPrefix} ❌ Archivo ${tipo} no tiene buffer o está vacío`);
      throw new BadRequestException(`El archivo ${tipo} no tiene datos. Verifica la configuración.`);
    }

    const maxSize = 15 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException(`El archivo ${tipo} (${file.originalname}) excede 15MB`);
    }

    const allowedMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/jpg',
    ];

    if (!allowedMimes.includes(file.mimetype)) {
      throw new BadRequestException(`Tipo de archivo no permitido para ${tipo}: ${file.mimetype}`);
    }

    try {
      const extension = path.extname(file.originalname).toLowerCase() || this.obtenerExtensionPorMime(file.mimetype);
      const timestamp = Date.now();
      const hash = crypto.randomBytes(4).toString('hex');
      const nombreArchivo = `${tipo}_${documento.numeroRadicado}_${timestamp}_${hash}${extension}`;
      const rutaCompleta = path.join(carpetaTesoreria, nombreArchivo);

      this.logger.log(`${logPrefix} 💾 Guardando ${tipo} (${file.originalname}) en: ${rutaCompleta}`);

      fs.writeFileSync(rutaCompleta, file.buffer);

      if (!fs.existsSync(rutaCompleta)) {
        this.logger.error(`${logPrefix} ❌ Archivo no se creó: ${rutaCompleta}`);
        throw new InternalServerErrorException(`No se pudo guardar el archivo ${tipo}`);
      }

      const stats = fs.statSync(rutaCompleta);
      if (stats.size === 0) {
        this.logger.error(`${logPrefix} ❌ Archivo se guardó vacío: ${rutaCompleta}`);
        fs.unlinkSync(rutaCompleta);
        throw new InternalServerErrorException(`El archivo ${tipo} se guardó vacío`);
      }

      archivosGuardados[tipo] = nombreArchivo;

      const rutaRelativa = path.join('tesoreria', nombreArchivo).replace(/\\/g, '/');
      const fechaActual = new Date();

      switch (tipo) {
        case 'pagoRealizado':
          tesoreriaDoc.pagoRealizadoPath = rutaRelativa;
          tesoreriaDoc.fechaPago = fechaActual;
          this.logger.log(`${logPrefix} ✅ Pago guardado: ${rutaRelativa}`);
          break;
        default:
          this.logger.warn(`${logPrefix} ⚠️ Tipo desconocido: ${tipo}`);
      }

      this.logger.log(`${logPrefix} ✅ ${tipo} guardado correctamente: ${nombreArchivo} (${stats.size} bytes)`);
      return true;

    } catch (error) {
      this.logger.error(`${logPrefix} ❌ Error guardando ${tipo}: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Error al guardar ${tipo}: ${error.message}`);
    }
  };

  const obtenerExtensionPorMime = (mimeType: string): string => {
    const mimeToExt: Record<string, string> = {
      'application/pdf': '.pdf',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/jpg': '.jpg',
    };
    return mimeToExt[mimeType] || '.bin';
  };

  try {
    if (files['pagoRealizado'] && files['pagoRealizado'][0]) {
      await guardarArchivo('pagoRealizado', files['pagoRealizado'][0]);
    }
  } catch (error) {
    this.logger.error(`${logPrefix} ❌ Error durante la subida de archivos: ${error.message}`, error.stack);
    throw error;
  }

  // 👇 APLICAR FIRMA SI SE RECIBIERON LOS DATOS
  if (datos.signatureId && datos.signaturePosition && archivosGuardados['pagoRealizado']) {
    try {
      const position = JSON.parse(datos.signaturePosition);
      const rutaPagoCompleta = path.join(carpetaTesoreria, archivosGuardados['pagoRealizado']);
      
      await this.tesoreriaSignatureService.aplicarFirmaEnPDF(
        rutaPagoCompleta,
        datos.signatureId,
        position
      );
      
      // Marcar que se aplicó firma (opcional)
      tesoreriaDoc.firmaAplicada = true;
      
      this.logger.log(`${logPrefix} ✅ Firma aplicada al documento de pago`);
    } catch (error) {
      this.logger.error(`${logPrefix} ❌ Error aplicando firma: ${error.message}`);
      // No lanzamos error para no interrumpir el flujo principal
      // Pero registramos el error
    }
  }

  if (datos.estadoFinal?.toUpperCase() === 'PAGADO') {
    if (!tesoreriaDoc.pagoRealizadoPath) {
      this.logger.error(`${logPrefix} ❌ Para marcar como PAGADO debe subir comprobante de pago`);
      throw new BadRequestException('Para marcar como PAGADO es obligatorio subir el Comprobante de Pago');
    }
  }

  let estadoFinalMapeado: TesoreriaEstado | undefined;
  if (datos.estadoFinal) {
    const estadoUpper = datos.estadoFinal.toUpperCase();
    switch (estadoUpper) {
      case 'PAGADO':
        estadoFinalMapeado = TesoreriaEstado.COMPLETADO_TESORERIA;
        break;
      case 'OBSERVADO':
        estadoFinalMapeado = TesoreriaEstado.OBSERVADO_TESORERIA;
        break;
      case 'RECHAZADO':
        estadoFinalMapeado = TesoreriaEstado.RECHAZADO_TESORERIA;
        break;
      default:
        this.logger.warn(`${logPrefix} ⚠️ Estado final no reconocido: ${datos.estadoFinal}`);
    }
  }

  if (estadoFinalMapeado) {
    tesoreriaDoc.estado = estadoFinalMapeado;
    tesoreriaDoc.fechaFinRevision = new Date();

    let nuevoEstadoDocumento = documento.estado;
    switch (estadoFinalMapeado) {
      case TesoreriaEstado.COMPLETADO_TESORERIA:
        nuevoEstadoDocumento = 'COMPLETADO_TESORERIA';
        break;
      case TesoreriaEstado.OBSERVADO_TESORERIA:
        nuevoEstadoDocumento = 'OBSERVADO_TESORERIA';
        break;
      case TesoreriaEstado.RECHAZADO_TESORERIA:
        nuevoEstadoDocumento = 'RECHAZADO_TESORERIA';
        break;
    }

    if (documento.estado !== nuevoEstadoDocumento) {
      documento.estado = nuevoEstadoDocumento;
      documento.fechaActualizacion = new Date();

      const historial = documento.historialEstados || [];
      historial.push({
        fecha: new Date(),
        estado: nuevoEstadoDocumento,
        usuarioId: tesoreroId,
        usuarioNombre: tesorero.fullName || tesorero.username,
        rolUsuario: tesorero.role,
        observacion: `Procesado por tesorería: ${estadoFinalMapeado} - ${datos.observaciones?.substring(0, 100) || 'Sin observación'}`
      });
      documento.historialEstados = historial;

      await this.documentoRepository.save(documento);
      this.logger.log(`${logPrefix} ✅ Estado documento actualizado: ${documento.estado}`);
    }
  }

  const saved = await this.tesoreriaRepository.save(tesoreriaDoc);

  if (documento.rutaCarpetaRadicado) {
    await this.registrarAccesoTesoreria(
      documento.rutaCarpetaRadicado,
      tesoreroId,
      `SUBIÓ documento tesorería`,
      `Archivo: ${Object.keys(archivosGuardados).join(', ') || 'ninguno'} | Estado: ${datos.estadoFinal || 'sin cambio'}`
    );
  }

  this.logger.log(`${logPrefix} 🎉 Subida completada exitosamente`);
  this.logger.log(`${logPrefix}   Archivos guardados: ${JSON.stringify(archivosGuardados)}`);
  this.logger.log(`${logPrefix}   Estado tesorería: ${saved.estado}`);
  this.logger.log(`${logPrefix}   Ruta pago: ${saved.pagoRealizadoPath || 'NO'}`);

  return {
    success: true,
    message: 'Documento guardado correctamente en el servidor',
    tesoreria: saved
  };
}

    private obtenerExtensionPorMime(mimeType: string): string {
        const mimeToExt: Record<string, string> = {
            'application/pdf': '.pdf',
            'application/msword': '.doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/jpg': '.jpg',
        };
        return mimeToExt[mimeType] || '.bin';
    }

    async finalizarRevision(
        documentoId: string,
        tesoreroId: string,
        estado: TesoreriaEstado,
        observaciones?: string
    ): Promise<{ success: boolean; message: string; documento: Documento }> {
        this.logger.log(`🏁 Tesorero ${tesoreroId} finalizando documento ${documentoId} con estado: ${estado}`);

        const queryRunner = this.tesoreriaRepository.manager.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const tesoreriaDoc = await queryRunner.manager.findOne(TesoreriaDocumento, {
                where: {
                    documento: { id: documentoId },
                    tesorero: { id: tesoreroId },
                    estado: TesoreriaEstado.EN_REVISION
                },
                relations: ['documento', 'tesorero']
            });

            if (!tesoreriaDoc) {
                throw new ForbiddenException('No tienes este documento en revisión');
            }

            const documento = tesoreriaDoc.documento;
            const tesorero = tesoreriaDoc.tesorero;

            if (!tesoreriaDoc.pagoRealizadoPath) {
                throw new BadRequestException('Para finalizar debe subir el comprobante de pago');
            }

            tesoreriaDoc.estado = estado;
            tesoreriaDoc.observaciones = observaciones || tesoreriaDoc.observaciones;
            tesoreriaDoc.fechaActualizacion = new Date();
            tesoreriaDoc.fechaFinRevision = new Date();

            let estadoNuevoDocumento = '';

            switch (estado) {
                case TesoreriaEstado.COMPLETADO_TESORERIA:
                    estadoNuevoDocumento = 'COMPLETADO_TESORERIA';
                    break;
                case TesoreriaEstado.OBSERVADO_TESORERIA:
                    estadoNuevoDocumento = 'OBSERVADO_TESORERIA';
                    break;
                case TesoreriaEstado.RECHAZADO_TESORERIA:
                    estadoNuevoDocumento = 'RECHAZADO_TESORERIA';
                    break;
                default:
                    estadoNuevoDocumento = 'COMPLETADO_TESORERIA';
                    break;
            }

            documento.estado = estadoNuevoDocumento;
            documento.fechaActualizacion = new Date();
            documento.ultimoAcceso = new Date();
            documento.ultimoUsuario = `Tesoreria: ${tesorero.fullName || tesorero.username}`;
            documento.usuarioAsignado = null;
            documento.usuarioAsignadoNombre = '';

            const historial = documento.historialEstados || [];
            historial.push({
                fecha: new Date(),
                estado: estadoNuevoDocumento,
                usuarioId: tesoreroId,
                usuarioNombre: tesorero.fullName || tesorero.username,
                rolUsuario: tesorero.role,
                observacion: `Procesado por tesorería: ${estado} - ${observaciones?.substring(0, 100) || 'Sin observación'}`
            });
            documento.historialEstados = historial;

            await queryRunner.manager.save(Documento, documento);
            await queryRunner.manager.save(TesoreriaDocumento, tesoreriaDoc);

            if (documento.rutaCarpetaRadicado) {
                await this.registrarAccesoTesoreria(
                    documento.rutaCarpetaRadicado,
                    tesoreroId,
                    `FINALIZÓ revisión tesorería`,
                    `Estado: ${estado}`
                );
            }

            await queryRunner.commitTransaction();

            this.logger.log(`✅ Documento ${documento.numeroRadicado} finalizado por tesorería`);

            return {
                success: true,
                message: `Documento ${estadoNuevoDocumento} exitosamente`,
                documento
            };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error(`❌ Error finalizando documento: ${error.message}`);
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

    async liberarDocumento(documentoId: string, tesoreroId: string): Promise<{ success: boolean; message: string }> {
        this.logger.log(`🔄 Tesorero ${tesoreroId} liberando documento ${documentoId}`);

        const queryRunner = this.tesoreriaRepository.manager.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const tesoreriaDoc = await queryRunner.manager.findOne(TesoreriaDocumento, {
                where: {
                    documento: { id: documentoId },
                    tesorero: { id: tesoreroId },
                    estado: TesoreriaEstado.EN_REVISION
                },
                relations: ['documento', 'tesorero']
            });

            if (!tesoreriaDoc) {
                throw new NotFoundException('No tienes este documento en revisión');
            }

            const documento = tesoreriaDoc.documento;

            documento.estado = 'COMPLETADO_CONTABILIDAD';
            documento.fechaActualizacion = new Date();
            documento.ultimoAcceso = new Date();
            documento.ultimoUsuario = `Tesoreria: ${tesoreriaDoc.tesorero.fullName || tesoreriaDoc.tesorero.username} (liberó)`;
            documento.usuarioAsignado = null;
            documento.usuarioAsignadoNombre = '';

            const historial = documento.historialEstados || [];
            historial.push({
                fecha: new Date(),
                estado: 'COMPLETADO_CONTABILIDAD',
                usuarioId: tesoreroId,
                usuarioNombre: tesoreriaDoc.tesorero.fullName || tesoreriaDoc.tesorero.username,
                rolUsuario: 'TESORERIA',
                observacion: 'Documento liberado por tesorería - Volvió a estado COMPLETADO_CONTABILIDAD'
            });
            documento.historialEstados = historial;

            tesoreriaDoc.estado = TesoreriaEstado.DISPONIBLE;
            tesoreriaDoc.fechaActualizacion = new Date();
            tesoreriaDoc.fechaFinRevision = new Date();
            tesoreriaDoc.observaciones = 'Documento liberado - Disponible para otros tesoreros';

            await queryRunner.manager.save(Documento, documento);
            await queryRunner.manager.save(TesoreriaDocumento, tesoreriaDoc);

            if (documento.rutaCarpetaRadicado) {
                await this.registrarAccesoTesoreria(
                    documento.rutaCarpetaRadicado,
                    tesoreroId,
                    `LIBERÓ documento`,
                    `Estado: EN_REVISION_TESORERIA → COMPLETADO_CONTABILIDAD`
                );
            }

            await queryRunner.commitTransaction();

            return {
                success: true,
                message: 'Documento liberado correctamente y disponible para otros tesoreros'
            };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error(`❌ Error liberando documento: ${error.message}`);
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

    async obtenerMisProcesos(tesoreroId: string): Promise<any[]> {
        this.logger.log(`📋 Obteniendo MIS procesos para tesoreroId: ${tesoreroId}`);

        const tesoreriaDocs = await this.tesoreriaRepository.find({
            where: { tesorero: { id: tesoreroId } },
            relations: ['documento', 'tesorero'],
            order: { fechaActualizacion: 'DESC' }
        });

        return tesoreriaDocs.map(td => ({
            id: td.documento.id,
            numeroRadicado: td.documento.numeroRadicado,
            numeroContrato: td.documento.numeroContrato,
            nombreContratista: td.documento.nombreContratista,
            documentoContratista: td.documento.documentoContratista,
            fechaRadicacion: td.documento.fechaRadicacion,
            estado: td.documento.estado,
            tesoreriaEstado: td.estado,
            observaciones: td.observaciones || '',
            fechaInicioRevision: td.fechaInicioRevision,
            fechaFinRevision: td.fechaFinRevision,
            pagoRealizadoPath: td.pagoRealizadoPath,
            supervisor: td.documento.usuarioAsignadoNombre || 'No asignado',
            tesoreroAsignado: td.tesorero?.fullName || td.tesorero?.username,
        }));
    }

    async obtenerDocumentoParaVista(documentoId: string, tesoreroId?: string): Promise<any> {
        this.logger.log(`🔍 Solicitando documento ${documentoId} para vista de tesorería`);

        const documento = await this.documentoRepository.findOne({
            where: { id: documentoId },
            relations: ['radicador', 'usuarioAsignado'],
        });

        if (!documento) {
            throw new NotFoundException(`Documento ${documentoId} no encontrado`);
        }

        const estadosPermitidos = [
            'COMPLETADO_CONTABILIDAD',
            'EN_REVISION_TESORERIA',
            'COMPLETADO_TESORERIA',
            'OBSERVADO_TESORERIA',
            'RECHAZADO_TESORERIA'
        ];

        if (!estadosPermitidos.includes(documento.estado)) {
            throw new ForbiddenException(`Estado no permitido: ${documento.estado}`);
        }

        let tesoreriaDoc: TesoreriaDocumento | null = null;
        let contabilidadDoc: ContabilidadDocumento | null = null;

        if (tesoreroId) {
            tesoreriaDoc = await this.tesoreriaRepository.findOne({
                where: {
                    documento: { id: documentoId },
                    tesorero: { id: tesoreroId },
                },
                relations: ['tesorero'],
            });

            contabilidadDoc = await this.contabilidadDocumentoRepository.findOne({
                where: { documento: { id: documentoId } },
                relations: ['contador'],
                order: { fechaActualizacion: 'DESC' }
            });
        }

        const archivosRadicados = [
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
        ];

        const archivosContabilidad = contabilidadDoc ? [
            { tipo: 'glosa', descripcion: 'Documento de Glosa', subido: !!contabilidadDoc.glosaPath, nombreArchivo: contabilidadDoc.glosaPath },
            { tipo: 'causacion', descripcion: 'Comprobante de Causación', subido: !!contabilidadDoc.causacionPath, nombreArchivo: contabilidadDoc.causacionPath },
            { tipo: 'extracto', descripcion: 'Extracto Bancario', subido: !!contabilidadDoc.extractoPath, nombreArchivo: contabilidadDoc.extractoPath },
            { tipo: 'comprobanteEgreso', descripcion: 'Comprobante de Egreso', subido: !!contabilidadDoc.comprobanteEgresoPath, nombreArchivo: contabilidadDoc.comprobanteEgresoPath },
        ] : [];

        const archivosTesoreria = tesoreriaDoc ? [
            {
                tipo: 'pagoRealizado',
                descripcion: 'Comprobante de Pago Realizado',
                subido: !!tesoreriaDoc.pagoRealizadoPath,
                nombreArchivo: tesoreriaDoc.pagoRealizadoPath,
                requerido: true
            }
        ] : [];

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
                    contador: contabilidadDoc?.contador?.fullName || contabilidadDoc?.contador?.username || 'No asignado',
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
                archivosRadicados,
                archivosContabilidad,
                archivosTesoreria,
                contabilidad: contabilidadDoc
                    ? {
                        id: contabilidadDoc.id,
                        estado: contabilidadDoc.estado,
                        tieneGlosa: contabilidadDoc.tieneGlosa,
                        tipoCausacion: contabilidadDoc.tipoCausacion,
                        observaciones: contabilidadDoc.observaciones,
                        fechaCreacion: contabilidadDoc.fechaCreacion,
                        fechaInicioRevision: contabilidadDoc.fechaInicioRevision,
                        fechaFinRevision: contabilidadDoc.fechaFinRevision,
                        documentosSubidos: archivosContabilidad.filter(a => a.subido).map(a => a.tipo),
                        contador: contabilidadDoc.contador?.fullName || contabilidadDoc.contador?.username,
                    }
                    : null,
                tesoreria: tesoreriaDoc
                    ? {
                        id: tesoreriaDoc.id,
                        estado: tesoreriaDoc.estado,
                        observaciones: tesoreriaDoc.observaciones,
                        fechaCreacion: tesoreriaDoc.fechaCreacion,
                        fechaInicioRevision: tesoreriaDoc.fechaInicioRevision,
                        fechaFinRevision: tesoreriaDoc.fechaFinRevision,
                        documentosSubidos: archivosTesoreria.filter(a => a.subido).map(a => a.tipo),
                        tesorero: tesoreriaDoc.tesorero?.fullName || tesoreriaDoc.tesorero?.username,
                    }
                    : null,
            }
        };

        return respuesta;
    }

    async descargarArchivoTesoreria(
        documentoId: string,
        tipo: string,
        tesoreroId: string
    ): Promise<{ ruta: string; nombre: string }> {
        const tesoreriaDoc = await this.tesoreriaRepository.findOne({
            where: {
                documento: { id: documentoId },
                tesorero: { id: tesoreroId }
            },
            relations: ['documento'],
        });

        if (!tesoreriaDoc) {
            throw new ForbiddenException('No tienes acceso a este documento');
        }

        const documento = tesoreriaDoc.documento;

        let nombreArchivo: string | null = null;

        switch (tipo.toLowerCase()) {
            case 'pagorealizado':
                nombreArchivo = tesoreriaDoc.pagoRealizadoPath;
                break;
            default:
                throw new BadRequestException('Tipo de archivo no válido');
        }

        if (!nombreArchivo) {
            throw new BadRequestException('Archivo no encontrado');
        }

        const rutaCompleta = path.join(documento.rutaCarpetaRadicado, nombreArchivo);

        if (!fs.existsSync(rutaCompleta)) {
            throw new BadRequestException('El archivo no existe en el servidor');
        }

        const nombreDescarga = path.basename(nombreArchivo);

        await this.registrarAccesoTesoreria(
            documento.rutaCarpetaRadicado,
            tesoreroId,
            `DESCARGÓ archivo tesorería`,
            `Tipo: ${tipo} - ${nombreDescarga}`
        );

        return {
            ruta: rutaCompleta,
            nombre: nombreDescarga
        };
    }

    async obtenerRutaArchivoTesoreriaFull(
        documentoId: string,
        tipo: string,
        userId?: string,
    ): Promise<{ rutaAbsoluta: string; nombreArchivo: string }> {
        const logPrefix = `[obtenerRutaArchivoTesoreriaFull] doc=${documentoId} tipo=${tipo} user=${userId || 'anon'}`;

        const documento = await this.documentoRepository.findOne({
            where: { id: documentoId },
        });

        if (!documento) {
            throw new NotFoundException(`Documento ${documentoId} no encontrado`);
        }

        let tesoreriaDoc: TesoreriaDocumento | null = null;

        if (userId) {
            tesoreriaDoc = await this.tesoreriaRepository.findOne({
                where: {
                    documento: { id: documentoId },
                    tesorero: { id: userId }
                },
            });
        }

        if (!tesoreriaDoc) {
            tesoreriaDoc = await this.tesoreriaRepository.findOne({
                where: { documento: { id: documentoId } },
                order: { fechaActualizacion: 'DESC' }
            });
        }

        if (!tesoreriaDoc) {
            throw new NotFoundException('Registro de tesorería no encontrado');
        }

        let nombreArchivoBd: string | null = null;

        switch (tipo.toLowerCase()) {
            case 'pagorealizado':
                nombreArchivoBd = tesoreriaDoc.pagoRealizadoPath;
                break;
            default:
                throw new BadRequestException(`Tipo de archivo no soportado: ${tipo}`);
        }

        if (!nombreArchivoBd) {
            throw new NotFoundException(`No existe archivo registrado para tipo ${tipo}`);
        }

        let rutaBase = this.configService.get<string>('RUTA_BASE_ARCHIVOS') || '\\\\R2-D2\\api-contract';
        rutaBase = '\\\\' + rutaBase.replace(/^\\\\?/, '').replace(/^[\/\\]+/, '');

        let rutaCarpeta = documento.rutaCarpetaRadicado || '';
        rutaCarpeta = rutaCarpeta
            .replace(/^\\\\R2-D2\\api-contract/i, '')
            .replace(/^[\/\\]+/, '')
            .replace(/[\/\\]+$/, '')
            .trim();

        const rutaTesoreria = path.join(rutaCarpeta, 'tesoreria');

        let rutaAbsoluta = path.join(rutaBase, rutaTesoreria, nombreArchivoBd);
        rutaAbsoluta = rutaAbsoluta.replace(/\//g, '\\').replace(/^\\+/, '\\\\');

        if (!fs.existsSync(rutaAbsoluta)) {
            throw new NotFoundException(`Archivo ${tipo} no encontrado en disco`);
        }

        return { rutaAbsoluta, nombreArchivo: path.basename(nombreArchivoBd) };
    }

    private async guardarArchivoTesoreria(
        documento: Documento,
        archivo: Express.Multer.File,
        tipo: string,
        tesoreroId: string
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

            const rutaTesoreria = path.join(documento.rutaCarpetaRadicado, 'tesoreria');
            if (!fs.existsSync(rutaTesoreria)) {
                fs.mkdirSync(rutaTesoreria, { recursive: true });
            }

            const extension = extname(archivo.originalname);
            const timestamp = Date.now();
            const randomHash = Math.random().toString(36).substring(7);

            const nombreArchivo = `${tipo}_${documento.numeroRadicado}_${timestamp}_${randomHash}${extension}`;
            const rutaCompleta = path.join(rutaTesoreria, nombreArchivo);

            fs.writeFileSync(rutaCompleta, archivo.buffer);

            const metadatos = {
                nombreOriginal: archivo.originalname,
                nombreGuardado: nombreArchivo,
                mimeType: archivo.mimetype,
                tamanio: archivo.size,
                fechaSubida: new Date().toISOString(),
                tipoDocumento: tipo,
                tesoreroId: tesoreroId,
                documentoId: documento.id,
                numeroRadicado: documento.numeroRadicado
            };

            fs.writeFileSync(
                path.join(rutaTesoreria, `${tipo}_${timestamp}_${randomHash}_meta.json`),
                JSON.stringify(metadatos, null, 2)
            );

            this.logger.log(`💾 Archivo de tesorería (${tipo}) guardado: ${rutaCompleta}`);

            return path.join('tesoreria', nombreArchivo);
        } catch (error) {
            this.logger.error(`❌ Error guardando archivo de tesorería (${tipo}): ${error.message}`);
            throw new BadRequestException(`Error al guardar archivo ${tipo}: ${error.message}`);
        }
    }

    private mapearDocumentoParaRespuesta(documento: Documento, tesoreriaDoc?: TesoreriaDocumento): any {
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
            observacion: documento.observacion || '',
            primerRadicadoDelAno: documento.primerRadicadoDelAno,
            usuarioAsignadoNombre: documento.usuarioAsignadoNombre,
            asignacionTesoreria: tesoreriaDoc
                ? {
                    id: tesoreriaDoc.id,
                    estado: tesoreriaDoc.estado,
                    fechaInicioRevision: tesoreriaDoc.fechaInicioRevision,
                    tesorero: {
                        id: tesoreriaDoc.tesorero.id,
                        nombre: tesoreriaDoc.tesorero.fullName || tesoreriaDoc.tesorero.username,
                    },
                }
                : null,
        };
    }

    private async registrarAccesoTesoreria(
        rutaCarpeta: string,
        tesoreroId: string,
        accion: string,
        detallesExtra?: string
    ): Promise<void> {
        try {
            if (!rutaCarpeta) {
                this.logger.warn('No hay rutaCarpeta para registrar acceso');
                return;
            }

            const rutaArchivo = path.join(rutaCarpeta, 'registro_accesos_tesoreria.txt');
            const fecha = new Date().toLocaleString('es-CO', {
                timeZone: 'America/Bogota',
                dateStyle: 'full',
                timeStyle: 'long'
            });

            const tesorero = await this.userRepository.findOne({ where: { id: tesoreroId } });
            const nombreTesorero = tesorero?.fullName || tesorero?.username || 'Tesorero desconocido';

            let registro = `[${fecha}] ${nombreTesorero} (${tesorero?.username || tesoreroId}) - TESORERÍA - ${accion}`;
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

            this.logger.log(`📝 Registro tesorería actualizado: ${rutaArchivo} - ${accion}`);
        } catch (error) {
            this.logger.error(`⚠️ Error registrando acceso tesorería: ${error.message}`);
        }
    }

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

    async obtenerTesoreriaDocumento(documentoId: string, tesoreroId: string): Promise<TesoreriaDocumento | null> {
        return this.tesoreriaRepository.findOne({
            where: {
                documento: { id: documentoId },
                tesorero: { id: tesoreroId },
            },
            relations: ['documento', 'tesorero'],
        });
    }

    private construirRespuestaDetalle(
        documento: Documento,
        tesoreriaDoc: TesoreriaDocumento | null,
        contabilidadDoc: ContabilidadDocumento | null,
        user: User,
    ): any {
        const archivosRadicados = [
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
        ];

        const archivosContabilidad = contabilidadDoc ? [
            { tipo: 'glosa', descripcion: 'Documento de Glosa', subido: !!contabilidadDoc.glosaPath, nombreArchivo: contabilidadDoc.glosaPath },
            { tipo: 'causacion', descripcion: 'Comprobante de Causación', subido: !!contabilidadDoc.causacionPath, nombreArchivo: contabilidadDoc.causacionPath },
            { tipo: 'extracto', descripcion: 'Extracto Bancario', subido: !!contabilidadDoc.extractoPath, nombreArchivo: contabilidadDoc.extractoPath },
            { tipo: 'comprobanteEgreso', descripcion: 'Comprobante de Egreso', subido: !!contabilidadDoc.comprobanteEgresoPath, nombreArchivo: contabilidadDoc.comprobanteEgresoPath },
        ] : [];

        const archivosTesoreria = tesoreriaDoc ? [
            {
                tipo: 'pagoRealizado',
                descripcion: 'Comprobante de Pago Realizado',
                subido: !!tesoreriaDoc.pagoRealizadoPath,
                nombreArchivo: tesoreriaDoc.pagoRealizadoPath,
                requerido: true
            }
        ] : [];

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
                contador: contabilidadDoc?.contador?.fullName || contabilidadDoc?.contador?.username || 'No asignado',
                observacion: documento.observacion || '',
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
                observacionesTesoreria: tesoreriaDoc?.observaciones || '',
                pagoRealizadoPath: tesoreriaDoc?.pagoRealizadoPath || null,
                fechaPago: tesoreriaDoc?.fechaPago || null,
            },
            archivosRadicados,
            archivosContabilidad,
            archivosTesoreria,
            contabilidad: contabilidadDoc
                ? {
                    id: contabilidadDoc.id,
                    estado: contabilidadDoc.estado,
                    tieneGlosa: contabilidadDoc.tieneGlosa,
                    tipoCausacion: contabilidadDoc.tipoCausacion,
                    observaciones: contabilidadDoc.observaciones,
                    fechaCreacion: contabilidadDoc.fechaCreacion,
                    fechaInicioRevision: contabilidadDoc.fechaInicioRevision,
                    fechaFinRevision: contabilidadDoc.fechaFinRevision,
                    documentosSubidos: archivosContabilidad.filter(a => a.subido).map(a => a.tipo),
                    contador: contabilidadDoc.contador?.fullName || contabilidadDoc.contador?.username,
                }
                : null,
            tesoreria: tesoreriaDoc
                ? {
                    id: tesoreriaDoc.id,
                    estado: tesoreriaDoc.estado,
                    observaciones: tesoreriaDoc.observaciones,
                    fechaCreacion: tesoreriaDoc.fechaCreacion,
                    fechaInicioRevision: tesoreriaDoc.fechaInicioRevision,
                    fechaFinRevision: tesoreriaDoc.fechaFinRevision,
                    documentosSubidos: archivosTesoreria.filter(a => a.subido).map(a => a.tipo),
                    tesorero: tesoreriaDoc.tesorero?.fullName || tesoreriaDoc.tesorero?.username,
                }
                : null,
        };
    }

    async getHistorial(tesoreroId: string): Promise<any[]> {
        this.logger.log(`Obteniendo historial COMPLETO para tesorero ${tesoreroId}`);

        const tesoreriaDocs = await this.tesoreriaRepository.find({
            where: {
                tesorero: { id: tesoreroId },
            },
            relations: ['documento', 'tesorero'],
            order: { fechaActualizacion: 'DESC' }
        });

        return tesoreriaDocs.map(td => ({
            id: td.id,
            documento: {
                id: td.documento.id,
                numeroRadicado: td.documento.numeroRadicado,
                numeroContrato: td.documento.numeroContrato,
                nombreContratista: td.documento.nombreContratista,
                documentoContratista: td.documento.documentoContratista,
                fechaInicio: td.documento.fechaInicio,
                fechaFin: td.documento.fechaFin,
                fechaRadicacion: td.documento.fechaRadicacion,
                fechaActualizacion: td.documento.fechaActualizacion
            },
            estado: td.estado,
            observaciones: td.observaciones || '',
            pagoRealizadoPath: td.pagoRealizadoPath,
            fechaActualizacion: td.fechaActualizacion,
            fechaFinRevision: td.fechaFinRevision,
            fechaInicioRevision: td.fechaInicioRevision,
            tesoreroRevisor: td.tesorero?.fullName || td.tesorero?.username || 'Tesorero'
        }));
    }

    async obtenerRechazadosVisibles(user: any): Promise<any[]> {
        const rolUsuario = user.role?.toLowerCase() || '';

        this.logger.log(`[RECHAZADOS-VISIBLES] Rol: ${rolUsuario} | Username: ${user.username}`);

        const estadosRechazo = [
            'RECHAZADO_SUPERVISOR',
            'RECHAZADO_AUDITOR_CUENTAS',
            'RECHAZADO_CONTABILIDAD',
            'RECHAZADO_TESORERIA',
            'RECHAZADO_ASESOR_GERENCIA',
            'RECHAZADO_RENDICION_CUENTAS',
            'OBSERVADO_CONTABILIDAD',
            'GLOSADO_CONTABILIDAD',
            'OBSERVADO_TESORERIA'
        ];

        const query = this.documentoRepository
            .createQueryBuilder('doc')
            .leftJoinAndSelect('doc.radicador', 'radicador')
            .where('doc.estado IN (:...estados)', { estados: estadosRechazo })
            .orderBy('doc.fechaActualizacion', 'DESC');

        let estadosPermitidos: string[] = [];

        switch (rolUsuario) {
            case 'admin':
                estadosPermitidos = estadosRechazo;
                break;
            case 'tesoreria':
                estadosPermitidos = [
                    'RECHAZADO_TESORERIA',
                    'RECHAZADO_ASESOR_GERENCIA',
                    'RECHAZADO_RENDICION_CUENTAS',
                    'OBSERVADO_TESORERIA'
                ];
                break;
            case 'asesor_gerencia':
                estadosPermitidos = ['RECHAZADO_ASESOR_GERENCIA', 'RECHAZADO_RENDICION_CUENTAS'];
                break;
            case 'rendicion_cuentas':
                estadosPermitidos = ['RECHAZADO_RENDICION_CUENTAS'];
                break;
            default:
                estadosPermitidos = [];
        }

        if (estadosPermitidos.length > 0) {
            query.andWhere('doc.estado IN (:...permitidos)', { permitidos: estadosPermitidos });
        } else {
            query.andWhere('1 = 0');
        }

        const docs = await query.getMany();

        this.logger.log(`[RECHAZADOS-VISIBLES] Encontrados ${docs.length} documentos para ${rolUsuario}`);

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
            rechazadoPor: this.inferirRechazadoPor(doc.estado)
        }));
    }

    private inferirRechazadoPor(estado: string): string {
        const e = (estado || '').toUpperCase();

        if (e.includes('RENDICION')) return 'Rendición Cuentas';
        if (e.includes('ASESOR')) return 'Asesor Gerencia';
        if (e.includes('TESORERIA')) return 'Tesorería';
        if (e.includes('CONTABILIDAD')) return 'Contabilidad';
        if (e.includes('AUDITOR')) return 'Auditoría Cuentas';
        if (e.includes('SUPERVISOR')) return 'Supervisor';

        return 'Sistema / No especificado';
    }

    async getTesoreriaCount(): Promise<number> {
        return this.tesoreriaRepository.count();
    }

}