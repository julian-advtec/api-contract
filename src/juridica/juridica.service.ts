// src/juridica/juridica.service.ts

import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThan, FindOptionsWhere } from 'typeorm';
import { Contrato, EstadoContrato } from './entities/contrato.entity';
import { Proveedor } from './entities/proveedor.entity';
import { Poliza, EstadoPoliza } from './entities/poliza.entity';
import { ModificacionContrato, TipoModificacion } from './entities/modificacion-contrato.entity';
import { DocumentoContrato, TipoDocumento } from './entities/documento-contrato.entity';
import { CreateContratoDto } from './dto/create-contrato.dto';
import { UpdateContratoDto } from './dto/update-contrato.dto';
import { CreateModificacionDto } from './dto/create-modificacion.dto';
import { CambiarEstadoDto } from './dto/cambiar-estado.dto';
import { FiltrosContratoDto } from './dto/filtros-contrato.dto';
import * as path from 'path';
import * as fs from 'fs';
import { StorageService } from '../common/storage/storage.service';

@Injectable()
export class JuridicaService {
    private readonly logger = new Logger(JuridicaService.name);
    // ✅ SOLO RUTA UNC - NADA DE C:\
    private readonly BASE_UNC_PATH = '\\\\R2-D2\\api-contract';
    private readonly basePath: string;

    constructor(
        @InjectRepository(Contrato)
        private contratoRepository: Repository<Contrato>,
        @InjectRepository(Proveedor)
        private proveedorRepository: Repository<Proveedor>,
        @InjectRepository(Poliza)
        private polizaRepository: Repository<Poliza>,
        @InjectRepository(ModificacionContrato)
        private modificacionRepository: Repository<ModificacionContrato>,
        @InjectRepository(DocumentoContrato)
        private documentoRepository: Repository<DocumentoContrato>,
        private readonly storageService: StorageService,
    ) {
        // ✅ Construir ruta UNC correcta
        this.basePath = `${this.BASE_UNC_PATH}\\juridica`;
        this.verificarRutaServidor();
    }

    private verificarRutaServidor(): void {
        try {
            this.logger.log(`📁 Ruta base jurídica: ${this.basePath}`);
            
            if (!fs.existsSync(this.basePath)) {
                fs.mkdirSync(this.basePath, { recursive: true });
                this.logger.log(`✅ Directorio base creado: ${this.basePath}`);
            } else {
                this.logger.log(`✅ Directorio base existe: ${this.basePath}`);
            }
        } catch (error: any) {
            this.logger.error(`❌ Error verificando ruta servidor: ${error.message}`);
            throw new Error(`No se puede acceder al servidor R2-D2: ${error.message}`);
        }
    }

    
    // ==================== CONTRATOS ====================

    async create(
        createContratoDto: any,
        files?: {
            minutaFile?: Express.Multer.File[];
            actaInicioFile?: Express.Multer.File[];
            cdpFile?: Express.Multer.File[];
            rpFile?: Express.Multer.File[];
            polizaCumplimientoFile?: Express.Multer.File[];
            polizaCalidadFile?: Express.Multer.File[];
            polizaRCFile?: Express.Multer.File[];
        }
    ): Promise<Contrato> {
        try {
            this.logger.log(`📝 Creando nuevo contrato: ${createContratoDto.numeroContrato}`);

            const fechaInicio = new Date(createContratoDto.fechaInicio);
            const fechaTerminacion = new Date(createContratoDto.fechaTerminacion);
            const fechaFirma = new Date(createContratoDto.fechaFirma);

            const existente = await this.contratoRepository.findOne({
                where: { numeroContrato: createContratoDto.numeroContrato },
            });

            if (existente) {
                throw new BadRequestException(`El contrato ${createContratoDto.numeroContrato} ya existe`);
            }

            // Buscar proveedor existente o crear uno nuevo
            let proveedor: Proveedor;
            if (createContratoDto.proveedor) {
                const { numeroIdentificacion } = createContratoDto.proveedor;
                const proveedorExistente = await this.proveedorRepository.findOne({
                    where: { numeroIdentificacion }
                });

                if (proveedorExistente) {
                    proveedor = proveedorExistente;
                    this.logger.log(`✅ Proveedor existente encontrado: ${proveedor.nombreRazonSocial}`);
                } else {
                    proveedor = await this.proveedorRepository.save(createContratoDto.proveedor);
                    this.logger.log(`✅ Nuevo proveedor creado: ${proveedor.nombreRazonSocial}`);
                }
            } else {
                throw new BadRequestException('Debe especificar un proveedor');
            }

            const valorTotal = Number(createContratoDto.valor || 0) + Number(createContratoDto.adiciones || 0);

            const contratoEntity = this.contratoRepository.create({
                ...createContratoDto,
                fechaInicio,
                fechaTerminacion,
                fechaFirma,
                proveedor,
                valorTotal,
                saldoDisponible: valorTotal,
                creadoPor: createContratoDto.creadoPor || 'Sistema',
                ultimoUsuario: createContratoDto.creadoPor || 'Sistema',
                historialCambios: [{
                    fecha: new Date(),
                    usuario: createContratoDto.creadoPor || 'Sistema',
                    accion: 'CREACIÓN',
                    detalles: createContratoDto,
                }],
            });

            const savedContrato = await this.contratoRepository.save(contratoEntity);
            const contratoGuardado = Array.isArray(savedContrato) ? savedContrato[0] : savedContrato;

            if (!contratoGuardado || !contratoGuardado.id) {
                throw new BadRequestException('No se pudo guardar el contrato correctamente');
            }

            // ==================== SUBIR ARCHIVOS ====================
            if (files) {
                const usuario = createContratoDto.creadoPor || 'Sistema';

                if (files.minutaFile?.[0]) {
                    await this.subirDocumentoContrato(
                        contratoGuardado.id,
                        files.minutaFile[0],
                        TipoDocumento.MINUTA,
                        'Minuta de Contrato',
                        usuario
                    );
                    this.logger.log(`✅ Minuta subida correctamente`);
                }

                if (files.actaInicioFile?.[0]) {
                    await this.subirDocumentoContrato(
                        contratoGuardado.id,
                        files.actaInicioFile[0],
                        TipoDocumento.ACTA_INICIO,
                        'Acta de Inicio',
                        usuario
                    );
                    this.logger.log(`✅ Acta de Inicio subida correctamente`);
                }

                if (files.cdpFile?.[0]) {
                    await this.subirDocumentoContrato(
                        contratoGuardado.id,
                        files.cdpFile[0],
                        TipoDocumento.CDP,
                        'Certificado de Disponibilidad Presupuestal',
                        usuario
                    );
                }

                if (files.rpFile?.[0]) {
                    await this.subirDocumentoContrato(
                        contratoGuardado.id,
                        files.rpFile[0],
                        TipoDocumento.RP,
                        'Registro Presupuestal',
                        usuario
                    );
                }

                if (files.polizaCumplimientoFile?.[0]) {
                    await this.subirDocumentoContrato(
                        contratoGuardado.id,
                        files.polizaCumplimientoFile[0],
                        TipoDocumento.POLIZA_CUMPLIMIENTO,
                        'Póliza de Cumplimiento',
                        usuario
                    );
                }

                if (files.polizaCalidadFile?.[0]) {
                    await this.subirDocumentoContrato(
                        contratoGuardado.id,
                        files.polizaCalidadFile[0],
                        TipoDocumento.POLIZA_CALIDAD,
                        'Póliza de Calidad',
                        usuario
                    );
                }

                if (files.polizaRCFile?.[0]) {
                    await this.subirDocumentoContrato(
                        contratoGuardado.id,
                        files.polizaRCFile[0],
                        TipoDocumento.POLIZA_RC,
                        'Póliza de Responsabilidad Civil',
                        usuario
                    );
                }
            }

            this.logger.log(`✅ Contrato creado exitosamente: ${contratoGuardado.numeroContrato}`);
            return this.findOne(contratoGuardado.id);

        } catch (error) {
            this.logger.error(`❌ Error creando contrato: ${error.message}`);
            throw error;
        }
    }

    // ==================== DOCUMENTOS ====================

    async subirDocumentoContrato(
        contratoId: string,
        file: Express.Multer.File,
        tipoDocumento: TipoDocumento,
        descripcion: string,
        usuario: string,
    ): Promise<DocumentoContrato> {
        try {
            const contrato = await this.findOne(contratoId);

            const tipoDocumentoLower = tipoDocumento.toLowerCase();

            this.logger.log(`📄 Subiendo documento tipo: ${tipoDocumento}`);

            const folder = `juridica/${contrato.vigencia}/${contrato.numeroContrato}/documentos`;
            const extension = path.extname(file.originalname);
            const nombreArchivoServidor = `${tipoDocumentoLower}_${Date.now()}${extension}`;

            // Usar StorageService para guardar el archivo
            const result = await this.storageService.uploadFile(
                file,
                folder,
                nombreArchivoServidor            
            );

            this.logger.log(`✅ Archivo subido a: ${result.provider} - ${result.path}`);

            if (tipoDocumento !== TipoDocumento.OTRO) {
                await this.documentoRepository.update(
                    { contratoId, tipoDocumento, esVersionActual: true },
                    { esVersionActual: false },
                );
            }

            const documento = this.documentoRepository.create({
                nombreArchivo: nombreArchivoServidor,
                rutaArchivo: result.path,
                tipoDocumento: tipoDocumento,
                descripcion,
                version: 1,
                esVersionActual: true,
                tamanoBytes: file.size,
                mimeType: file.mimetype,
                contrato,
                contratoId,
                cargadoPor: usuario,
            });

            const documentoGuardado = await this.documentoRepository.save(documento);
            const resultado = Array.isArray(documentoGuardado) ? documentoGuardado[0] : documentoGuardado;

            return resultado;
        } catch (error) {
            this.logger.error(`❌ Error subiendo documento: ${error.message}`);
            throw error;
        }
    }

    async descargarDocumentoContrato(documentoId: string): Promise<{ buffer: Buffer; nombre: string; mimeType: string }> {
        try {
            const documento = await this.obtenerDocumentoContratoPorId(documentoId);

            // ✅ Usar StorageService para obtener el archivo
            const buffer = await this.storageService.getFile(documento.rutaArchivo);

            return {
                buffer,
                nombre: documento.nombreArchivo,
                mimeType: documento.mimeType || 'application/pdf',
            };
        } catch (error) {
            this.logger.error(`❌ Error descargando documento: ${error.message}`);
            throw error;
        }
    }

    async previsualizarDocumentoContrato(documentoId: string): Promise<{ buffer: Buffer; nombre: string; mimeType: string }> {
        try {
            const documento = await this.obtenerDocumentoContratoPorId(documentoId);

            // ✅ Usar StorageService para obtener el archivo
            const buffer = await this.storageService.getFile(documento.rutaArchivo);

            return {
                buffer,
                nombre: documento.nombreArchivo,
                mimeType: documento.mimeType || 'application/pdf',
            };
        } catch (error) {
            this.logger.error(`❌ Error previsualizando documento: ${error.message}`);
            throw error;
        }
    }

    async obtenerDocumentoContratoPorId(documentoId: string): Promise<DocumentoContrato> {
        try {
            this.logger.log(`🔍 Buscando documento de contrato por ID: ${documentoId}`);

            const documento = await this.documentoRepository.findOne({
                where: { id: documentoId }
            });

            if (!documento) {
                throw new NotFoundException(`Documento de contrato con ID ${documentoId} no encontrado`);
            }

            this.logger.log(`✅ Documento de contrato encontrado: ${documento.nombreArchivo}`);
            return documento;
        } catch (error) {
            this.logger.error(`❌ Error obteniendo documento de contrato: ${error.message}`);
            throw error;
        }
    }

    async actualizarCampoRpCdp(contratoId: string, campo: 'rp' | 'cdp', valor: string): Promise<void> {
        const contrato = await this.findOne(contratoId);
        if (campo === 'rp') {
            contrato.rp = valor;
        } else {
            contrato.cdp = valor;
        }
        await this.contratoRepository.save(contrato);
    }

    // ==================== CONTRATOS (resto de métodos) ====================

    async findAll(filtros: FiltrosContratoDto): Promise<Contrato[]> {
        try {
            const where: FindOptionsWhere<Contrato> = {};

            if (filtros.vigencia) where.vigencia = filtros.vigencia;
            if (filtros.tipoContrato) where.tipoContrato = filtros.tipoContrato;
            if (filtros.estado) where.estado = filtros.estado;
            if (filtros.proveedorId) where.proveedor = { id: filtros.proveedorId } as any;
            if (filtros.numeroContrato) where.numeroContrato = filtros.numeroContrato;
            if (filtros.supervisor) where.supervisor = filtros.supervisor;

            if (filtros.fechaInicioDesde || filtros.fechaInicioHasta) {
                where.fechaInicio = Between(
                    filtros.fechaInicioDesde || new Date('1900-01-01'),
                    filtros.fechaInicioHasta || new Date('2100-12-31'),
                );
            }

            if (filtros.fechaTerminacionDesde || filtros.fechaTerminacionHasta) {
                where.fechaTerminacion = Between(
                    filtros.fechaTerminacionDesde || new Date('1900-01-01'),
                    filtros.fechaTerminacionHasta || new Date('2100-12-31'),
                );
            }

            const contratos = await this.contratoRepository.find({
                where,
                relations: ['proveedor', 'polizas', 'modificaciones'],
                order: { fechaCreacion: 'DESC' },
            });

            return contratos.map(contrato => this.calcularIndicadores(contrato));
        } catch (error) {
            this.logger.error(`❌ Error buscando contratos: ${error.message}`);
            throw error;
        }
    }

    async findOne(id: string): Promise<Contrato> {
        try {
            const contrato = await this.contratoRepository.findOne({
                where: { id },
                relations: ['proveedor', 'polizas', 'modificaciones', 'documentos'],
            });

            if (!contrato) {
                throw new NotFoundException(`Contrato ${id} no encontrado`);
            }

            if (contrato.fechaInicio && typeof contrato.fechaInicio === 'string') {
                contrato.fechaInicio = new Date(contrato.fechaInicio);
            }
            if (contrato.fechaTerminacion && typeof contrato.fechaTerminacion === 'string') {
                contrato.fechaTerminacion = new Date(contrato.fechaTerminacion);
            }
            if (contrato.fechaFirma && typeof contrato.fechaFirma === 'string') {
                contrato.fechaFirma = new Date(contrato.fechaFirma);
            }

            return this.calcularIndicadores(contrato);
        } catch (error) {
            this.logger.error(`❌ Error buscando contrato ${id}: ${error.message}`);
            throw error;
        }
    }

    async update(id: string, updateContratoDto: UpdateContratoDto): Promise<Contrato> {
        try {
            const contrato = await this.findOne(id);

            const cambios: any[] = [];
            (Object.keys(updateContratoDto) as Array<keyof UpdateContratoDto>).forEach(key => {
                if (contrato[key as keyof Contrato] !== updateContratoDto[key]) {
                    cambios.push({
                        campo: key,
                        valorAnterior: contrato[key as keyof Contrato],
                        valorNuevo: updateContratoDto[key],
                    });
                }
            });

            Object.assign(contrato, updateContratoDto);

            if (updateContratoDto.valor !== undefined || updateContratoDto.adiciones !== undefined) {
                contrato.valorTotal = (updateContratoDto.valor ?? contrato.valor) +
                    (updateContratoDto.adiciones ?? contrato.adiciones);
                contrato.saldoDisponible = contrato.valorTotal - contrato.pagadoAcumulado - contrato.comprometido;
            }

            contrato.historialCambios = contrato.historialCambios || [];
            contrato.historialCambios.push({
                fecha: new Date(),
                usuario: updateContratoDto.ultimoUsuario || 'Sistema',
                accion: 'ACTUALIZACIÓN',
                detalles: { cambios },
            });

            contrato.ultimoUsuario = updateContratoDto.ultimoUsuario || 'Sistema';
            contrato.fechaActualizacion = new Date();

            const updated = await this.contratoRepository.save(contrato);
            return this.calcularIndicadores(updated);
        } catch (error) {
            this.logger.error(`❌ Error actualizando contrato ${id}: ${error.message}`);
            throw error;
        }
    }

    async cambiarEstado(id: string, cambiarEstadoDto: CambiarEstadoDto): Promise<Contrato> {
        try {
            const contrato = await this.findOne(id);

            this.validarTransicionEstado(contrato.estado, cambiarEstadoDto.estado);

            const estadoAnterior = contrato.estado;
            contrato.estado = cambiarEstadoDto.estado;

            contrato.historialCambios = contrato.historialCambios || [];
            contrato.historialCambios.push({
                fecha: new Date(),
                usuario: cambiarEstadoDto.usuario || 'Sistema',
                accion: 'CAMBIO_ESTADO',
                detalles: {
                    estadoAnterior,
                    estadoNuevo: cambiarEstadoDto.estado,
                    observacion: cambiarEstadoDto.observacion,
                    justificacion: cambiarEstadoDto.justificacion,
                },
            });

            contrato.ultimoUsuario = cambiarEstadoDto.usuario || 'Sistema';
            contrato.fechaActualizacion = new Date();

            const updated = await this.contratoRepository.save(contrato);
            return this.calcularIndicadores(updated);
        } catch (error) {
            this.logger.error(`❌ Error cambiando estado contrato ${id}: ${error.message}`);
            throw error;
        }
    }

    private validarTransicionEstado(estadoActual: EstadoContrato, estadoNuevo: EstadoContrato): void {
        const transicionesPermitidas: Record<EstadoContrato, EstadoContrato[]> = {
            [EstadoContrato.BORRADOR]: [EstadoContrato.EN_APROBACION, EstadoContrato.TERMINADO],
            [EstadoContrato.EN_APROBACION]: [EstadoContrato.FIRMADO, EstadoContrato.BORRADOR, EstadoContrato.TERMINADO],
            [EstadoContrato.FIRMADO]: [EstadoContrato.EN_EJECUCION, EstadoContrato.TERMINADO],
            [EstadoContrato.EN_EJECUCION]: [EstadoContrato.TERMINADO, EstadoContrato.SUSPENDIDO],
            [EstadoContrato.SUSPENDIDO]: [EstadoContrato.EN_EJECUCION, EstadoContrato.TERMINADO],
            [EstadoContrato.TERMINADO]: [EstadoContrato.LIQUIDADO],
            [EstadoContrato.LIQUIDADO]: [],
        };

        if (!transicionesPermitidas[estadoActual]?.includes(estadoNuevo)) {
            throw new BadRequestException(
                `No se puede cambiar de ${estadoActual} a ${estadoNuevo}`,
            );
        }
    }

    async agregarPoliza(contratoId: string, polizaDto: any): Promise<Poliza> {
        try {
            this.logger.log(`📝 Agregando póliza al contrato ${contratoId}`);

            const contrato = await this.findOne(contratoId);

            const poliza = this.polizaRepository.create({
                numeroPoliza: polizaDto.numeroPoliza,
                tipoPoliza: polizaDto.tipoPoliza,
                aseguradora: polizaDto.aseguradora,
                valorAsegurado: polizaDto.valorAsegurado,
                fechaExpedicion: new Date(polizaDto.fechaExpedicion),
                fechaVigenciaInicio: new Date(polizaDto.fechaVigenciaInicio),
                fechaVigenciaFin: new Date(polizaDto.fechaVigenciaFin),
                aprobada: polizaDto.aprobada || false,
                observaciones: polizaDto.observaciones,
                contrato: contrato,
                contratoId: contratoId,
                estado: this.calcularEstadoPoliza(new Date(polizaDto.fechaVigenciaFin)),
            });

            const polizaGuardada = await this.polizaRepository.save(poliza);

            contrato.historialCambios = contrato.historialCambios || [];
            contrato.historialCambios.push({
                fecha: new Date(),
                usuario: polizaDto.usuario || 'Sistema',
                accion: 'AGREGAR_POLIZA',
                detalles: { polizaId: polizaGuardada.id, tipo: polizaGuardada.tipoPoliza },
            });

            await this.contratoRepository.save(contrato);

            return polizaGuardada;
        } catch (error) {
            this.logger.error(`❌ Error agregando póliza: ${error.message}`);
            throw error;
        }
    }

    async aprobarPoliza(polizaId: string, usuario: string): Promise<Poliza> {
        try {
            const poliza = await this.polizaRepository.findOne({
                where: { id: polizaId },
                relations: ['contrato'],
            });

            if (!poliza) {
                throw new NotFoundException('Póliza no encontrada');
            }

            poliza.aprobada = true;
            poliza.fechaAprobacion = new Date();
            poliza.aprobadaPor = usuario;

            return await this.polizaRepository.save(poliza);
        } catch (error) {
            this.logger.error(`❌ Error aprobando póliza: ${error.message}`);
            throw error;
        }
    }

    async crearModificacion(createModificacionDto: CreateModificacionDto): Promise<ModificacionContrato> {
        try {
            const contrato = await this.findOne(createModificacionDto.contratoId);

            const modificacion = this.modificacionRepository.create({
                ...createModificacionDto,
                solicitadaPor: createModificacionDto.solicitadaPor || 'Sistema',
            });

            const saved = await this.modificacionRepository.save(modificacion);

            if (createModificacionDto.tipoModificacion === TipoModificacion.ADICION) {
                contrato.adiciones = (contrato.adiciones || 0) + (createModificacionDto.valorModificacion || 0);
                contrato.valorTotal = contrato.valor + contrato.adiciones;
                contrato.saldoDisponible = contrato.valorTotal - contrato.pagadoAcumulado - contrato.comprometido;
                await this.contratoRepository.save(contrato);
            }

            if (createModificacionDto.tipoModificacion === TipoModificacion.PRORROGA) {
                if (createModificacionDto.nuevaFechaTerminacion) {
                    contrato.fechaTerminacion = createModificacionDto.nuevaFechaTerminacion;
                    await this.contratoRepository.save(contrato);
                }
            }

            return saved;
        } catch (error) {
            this.logger.error(`❌ Error creando modificación: ${error.message}`);
            throw error;
        }
    }

    async buscarContratoPorNumero(numeroContrato: string): Promise<Contrato | null> {
        try {
            this.logger.log(`🔍 Buscando contrato por número: "${numeroContrato}"`);

            const contrato = await this.contratoRepository.findOne({
                where: { numeroContrato: numeroContrato.trim() },
                relations: ['proveedor', 'documentos']
            });

            if (!contrato) {
                this.logger.warn(`⚠️ No se encontró contrato con número: "${numeroContrato}"`);
                return null;
            }

            this.logger.log(`✅ Contrato encontrado: ${contrato.numeroContrato}`);
            this.logger.log(`📎 Documentos del contrato: ${contrato.documentos?.length || 0}`);

            return contrato;
        } catch (error) {
            this.logger.error(`❌ Error buscando contrato: ${error.message}`);
            return null;
        }
    }

    async obtenerDocumentosContrato(contratoId: string): Promise<DocumentoContrato[]> {
        try {
            return await this.documentoRepository.find({
                where: { contratoId: contratoId, esVersionActual: true },
                order: { fechaCarga: 'DESC' }
            });
        } catch (error) {
            this.logger.error(`❌ Error obteniendo documentos: ${error.message}`);
            return [];
        }
    }

    async obtenerDashboardGerencial(): Promise<any> {
        try {
            const now = new Date();

            const fechaLimite30 = new Date();
            fechaLimite30.setDate(fechaLimite30.getDate() + 30);

            const contratosPorVencer = await this.contratoRepository.count({
                where: {
                    fechaTerminacion: Between(now, fechaLimite30),
                    estado: EstadoContrato.EN_EJECUCION,
                },
            });

            const polizasVencidas = await this.polizaRepository.count({
                where: { fechaVigenciaFin: LessThan(new Date()) },
                relations: ['contrato'],
            });

            const contratos = await this.contratoRepository.find({
                where: { estado: EstadoContrato.EN_EJECUCION },
                relations: ['proveedor'],
            });

            let totalValor = 0;
            let totalPagado = 0;
            let totalComprometido = 0;

            contratos.forEach(c => {
                totalValor += Number(c.valorTotal);
                totalPagado += Number(c.pagadoAcumulado);
                totalComprometido += Number(c.comprometido);
            });

            const porEstado = await this.contratoRepository
                .createQueryBuilder('contrato')
                .select('contrato.estado', 'estado')
                .addSelect('COUNT(*)', 'cantidad')
                .groupBy('contrato.estado')
                .getRawMany();

            const tiempoVsPresupuesto = contratos.map(c => ({
                numeroContrato: c.numeroContrato,
                objeto: c.objeto,
                proveedor: c.proveedor?.nombreRazonSocial,
                tiempoTranscurrido: Math.round(this.calcularPorcentajeTiempo(c)),
                presupuestoEjecutado: Math.round((c.pagadoAcumulado / c.valorTotal) * 100),
                desviacion: Math.round(((c.pagadoAcumulado / c.valorTotal) * 100) - this.calcularPorcentajeTiempo(c)),
            }));

            return {
                resumen: {
                    totalContratos: contratos.length,
                    contratosPorVencer,
                    polizasVencidas,
                    valorTotalContratos: totalValor,
                    pagadoTotal: totalPagado,
                    comprometidoTotal: totalComprometido,
                    saldoDisponible: totalValor - totalPagado - totalComprometido,
                    porcentajeEjecucion: totalValor > 0 ? (totalPagado / totalValor * 100) : 0,
                },
                porEstado,
                tiempoVsPresupuesto,
                fechaCalculo: new Date().toISOString(),
            };
        } catch (error) {
            this.logger.error(`❌ Error obteniendo dashboard: ${error.message}`);
            throw error;
        }
    }

    async obtenerAlertas(): Promise<any[]> {
        try {
            const now = new Date();
            const alertas: any[] = [];

            const fechaLimite30 = new Date();
            fechaLimite30.setDate(fechaLimite30.getDate() + 30);

            const contratosPorVencer = await this.contratoRepository.find({
                where: {
                    fechaTerminacion: Between(now, fechaLimite30),
                    estado: EstadoContrato.EN_EJECUCION,
                },
                relations: ['proveedor'],
            });

            contratosPorVencer.forEach(c => {
                const diasRestantes = Math.ceil(
                    (c.fechaTerminacion.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
                );
                alertas.push({
                    tipo: 'CONTRATO_POR_VENCER',
                    gravedad: diasRestantes <= 7 ? 'ALTA' : 'MEDIA',
                    contrato: c.numeroContrato,
                    proveedor: c.proveedor?.nombreRazonSocial,
                    fechaVencimiento: c.fechaTerminacion,
                    diasRestantes,
                    mensaje: `Contrato ${c.numeroContrato} vence en ${diasRestantes} días`,
                });
            });

            const fechaLimitePolizas = new Date();
            fechaLimitePolizas.setDate(fechaLimitePolizas.getDate() + 30);

            const polizasPorVencer = await this.polizaRepository.find({
                where: {
                    fechaVigenciaFin: Between(now, fechaLimitePolizas),
                    estado: EstadoPoliza.VIGENTE,
                },
                relations: ['contrato', 'contrato.proveedor'],
            });

            polizasPorVencer.forEach(p => {
                if (p.contrato) {
                    const diasRestantes = Math.ceil(
                        (p.fechaVigenciaFin.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
                    );
                    alertas.push({
                        tipo: 'POLIZA_POR_VENCER',
                        gravedad: diasRestantes <= 7 ? 'ALTA' : 'MEDIA',
                        contrato: p.contrato.numeroContrato,
                        poliza: p.numeroPoliza,
                        tipoPoliza: p.tipoPoliza,
                        aseguradora: p.aseguradora,
                        fechaVencimiento: p.fechaVigenciaFin,
                        diasRestantes,
                        mensaje: `Póliza ${p.tipoPoliza} del contrato ${p.contrato.numeroContrato} vence en ${diasRestantes} días`,
                    });
                }
            });

            const fechaLimiteLiquidacion = new Date();
            fechaLimiteLiquidacion.setMonth(fechaLimiteLiquidacion.getMonth() - 4);

            const contratosSinLiquidar = await this.contratoRepository.find({
                where: {
                    estado: EstadoContrato.TERMINADO,
                    fechaTerminacion: LessThan(fechaLimiteLiquidacion),
                },
            });

            contratosSinLiquidar.forEach(c => {
                alertas.push({
                    tipo: 'CONTRATO_SIN_LIQUIDAR',
                    gravedad: 'ALTA',
                    contrato: c.numeroContrato,
                    fechaTerminacion: c.fechaTerminacion,
                    mensaje: `Contrato ${c.numeroContrato} terminado hace más de 4 meses sin liquidar`,
                });
            });

            const peso: Record<string, number> = { ALTA: 1, MEDIA: 2, BAJA: 3 };
            return alertas.sort((a, b) => {
                const pesoA = peso[a.gravedad] || 4;
                const pesoB = peso[b.gravedad] || 4;
                return pesoA - pesoB;
            });
        } catch (error) {
            this.logger.error(`❌ Error obteniendo alertas: ${error.message}`);
            throw error;
        }
    }

    private calcularIndicadores(contrato: Contrato): Contrato {
        if (contrato.fechaInicio && typeof contrato.fechaInicio === 'string') {
            contrato.fechaInicio = new Date(contrato.fechaInicio);
        }
        if (contrato.fechaTerminacion && typeof contrato.fechaTerminacion === 'string') {
            contrato.fechaTerminacion = new Date(contrato.fechaTerminacion);
        }

        const tiempoTranscurrido = this.calcularPorcentajeTiempo(contrato);

        contrato.saldoDisponible = Number(contrato.valorTotal) -
            Number(contrato.pagadoAcumulado) -
            Number(contrato.comprometido);

        if (contrato.seDesembolsaAnticipo && contrato.valorAnticipo) {
            contrato.anticipoPendienteAmortizar = Number(contrato.valorAnticipo) -
                (Number(contrato.pagadoAcumulado) > Number(contrato.valorAnticipo)
                    ? Number(contrato.valorAnticipo)
                    : Number(contrato.pagadoAcumulado));
        }

        const porcentajeEjecutado = (contrato.pagadoAcumulado / contrato.valorTotal) * 100;
        const desviacion = porcentajeEjecutado - tiempoTranscurrido;

        (contrato as any).indicadores = {
            porcentajeTiempo: Math.round(tiempoTranscurrido),
            porcentajeEjecutado: Math.round(porcentajeEjecutado),
            porcentajePagado: Math.round((contrato.pagadoAcumulado / contrato.valorTotal) * 100),
            desviacion: Math.round(desviacion),
            semaforo: Math.abs(desviacion) <= 10 ? 'VERDE' : Math.abs(desviacion) <= 20 ? 'AMARILLO' : 'ROJO',
        };

        return contrato;
    }

    private calcularPorcentajeTiempo(contrato: Contrato): number {
        const fechaInicio = contrato.fechaInicio instanceof Date
            ? contrato.fechaInicio
            : new Date(contrato.fechaInicio);
        const fechaTerminacion = contrato.fechaTerminacion instanceof Date
            ? contrato.fechaTerminacion
            : new Date(contrato.fechaTerminacion);

        const now = new Date();
        const total = fechaTerminacion.getTime() - fechaInicio.getTime();
        const transcurrido = now.getTime() - fechaInicio.getTime();

        if (transcurrido <= 0) return 0;
        if (transcurrido >= total) return 100;
        return (transcurrido / total) * 100;
    }

    private calcularEstadoPoliza(fechaVencimiento: Date): EstadoPoliza {
        const now = new Date();
        const diasRestantes = Math.ceil(
            (fechaVencimiento.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );

        if (diasRestantes < 0) return EstadoPoliza.VENCIDA;
        if (diasRestantes <= 30) return EstadoPoliza.POR_VENCER;
        return EstadoPoliza.VIGENTE;
    }
}