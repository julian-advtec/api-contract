// src/juridica/juridica.service.ts
import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
    InternalServerErrorException,
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

@Injectable()
export class JuridicaService {
    private readonly logger = new Logger(JuridicaService.name);
    private readonly basePath = '\\\\R2-D2\\api-contract\\juridica';

    constructor(
        @InjectRepository(Contrato)
        private contratoRepository: Repository<Contrato>,
        @InjectRepository(Proveedor)
        private proveedorRepository: Repository<Proveedor>,
        @InjectRepository(Poliza)
        private polizaRepository: Repository<Poliza>,  // Debe ser Repository<Poliza>, no otra cosa
        @InjectRepository(ModificacionContrato)
        private modificacionRepository: Repository<ModificacionContrato>,
        @InjectRepository(DocumentoContrato)
        private documentoRepository: Repository<DocumentoContrato>,
    ) {
        this.verificarRutaServidor();
    }

    private verificarRutaServidor(): void {
        try {
            if (!fs.existsSync(this.basePath)) {
                fs.mkdirSync(this.basePath, { recursive: true });
                this.logger.log(`✅ Directorio base creado: ${this.basePath}`);
            }
        } catch (error) {
            this.logger.error(`❌ Error verificando ruta servidor: ${error.message}`);
        }
    }

    // ==================== CONTRATOS ====================

    async create(createContratoDto: CreateContratoDto): Promise<Contrato> {
        try {
            this.logger.log(`📝 Creando nuevo contrato: ${createContratoDto.numeroContrato}`);

            // Verificar si ya existe
            const existente = await this.contratoRepository.findOne({
                where: { numeroContrato: createContratoDto.numeroContrato },
            });

            if (existente) {
                throw new BadRequestException(`El contrato ${createContratoDto.numeroContrato} ya existe`);
            }

            // Manejar proveedor
            let proveedor: Proveedor;

            if (createContratoDto.proveedorId) {
                const proveedorEncontrado = await this.proveedorRepository.findOneBy({
                    id: createContratoDto.proveedorId
                });
                if (!proveedorEncontrado) {
                    throw new NotFoundException('Proveedor no encontrado');
                }
                proveedor = proveedorEncontrado;
            } else if (createContratoDto.proveedor) {
                proveedor = await this.proveedorRepository.save(createContratoDto.proveedor);
            } else {
                throw new BadRequestException('Debe especificar un proveedor');
            }

            // Calcular valores
            const valorTotal = createContratoDto.valor + (createContratoDto.adiciones || 0);

            // Crear contrato
            const contrato = this.contratoRepository.create({
                ...createContratoDto,
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

            const savedContrato = await this.contratoRepository.save(contrato);

            // Crear pólizas si vienen
            if (createContratoDto.polizas?.length) {
                for (const polizaDto of createContratoDto.polizas) {
                    const poliza = this.polizaRepository.create({
                        ...polizaDto,
                        contrato: savedContrato,
                        contratoId: savedContrato.id,
                    });
                    await this.polizaRepository.save(poliza);
                }
            }

            this.logger.log(`✅ Contrato creado: ${savedContrato.numeroContrato}`);
            return this.findOne(savedContrato.id);
        } catch (error) {
            this.logger.error(`❌ Error creando contrato: ${error.message}`);
            throw error;
        }
    }

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

            // Calcular indicadores
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
                relations: [
                    'proveedor',
                    'polizas',
                    'modificaciones',
                    'documentos',
                    'obligaciones',
                ],
            });

            if (!contrato) {
                throw new NotFoundException(`Contrato ${id} no encontrado`);
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

            // Registrar cambios
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

            // Actualizar
            Object.assign(contrato, updateContratoDto);

            // Recalcular valor total si cambió valor o adiciones
            if (updateContratoDto.valor !== undefined || updateContratoDto.adiciones !== undefined) {
                contrato.valorTotal = (updateContratoDto.valor ?? contrato.valor) +
                    (updateContratoDto.adiciones ?? contrato.adiciones);
                contrato.saldoDisponible = contrato.valorTotal - contrato.pagadoAcumulado - contrato.comprometido;
            }

            // Agregar al historial
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

            // Validar transición de estados
            this.validarTransicionEstado(contrato.estado, cambiarEstadoDto.estado);

            const estadoAnterior = contrato.estado;
            contrato.estado = cambiarEstadoDto.estado;

            // Agregar al historial
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

    // ==================== PÓLIZAS ====================

    async agregarPoliza(contratoId: string, polizaDto: any): Promise<Poliza> {
        try {
            this.logger.log(`📝 Agregando póliza al contrato ${contratoId}`);

            const contrato = await this.findOne(contratoId);

            // Crear la póliza directamente con el repositorio
            const poliza = new Poliza();
            poliza.numeroPoliza = polizaDto.numeroPoliza;
            poliza.tipoPoliza = polizaDto.tipoPoliza;
            poliza.aseguradora = polizaDto.aseguradora;
            poliza.valorAsegurado = polizaDto.valorAsegurado;
            poliza.fechaExpedicion = new Date(polizaDto.fechaExpedicion);
            poliza.fechaVigenciaInicio = new Date(polizaDto.fechaVigenciaInicio);
            poliza.fechaVigenciaFin = new Date(polizaDto.fechaVigenciaFin);
            poliza.aprobada = polizaDto.aprobada || false;
            poliza.observaciones = polizaDto.observaciones;
            poliza.contrato = contrato;
            poliza.contratoId = contratoId;
            poliza.estado = this.calcularEstadoPoliza(new Date(polizaDto.fechaVigenciaFin));

            const polizaGuardada = await this.polizaRepository.save(poliza);

            // Actualizar historial
            contrato.historialCambios = contrato.historialCambios || [];
            contrato.historialCambios.push({
                fecha: new Date(),
                usuario: polizaDto.usuario || 'Sistema',
                accion: 'AGREGAR_POLIZA',
                detalles: {
                    polizaId: polizaGuardada.id,
                    tipo: polizaGuardada.tipoPoliza
                },
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

    // ==================== MODIFICACIONES ====================

    async crearModificacion(createModificacionDto: CreateModificacionDto): Promise<ModificacionContrato> {
        try {
            const contrato = await this.findOne(createModificacionDto.contratoId);

            const modificacion = this.modificacionRepository.create({
                ...createModificacionDto,
                solicitadaPor: createModificacionDto.solicitadaPor || 'Sistema',
            });

            const saved = await this.modificacionRepository.save(modificacion);

            // Si es adición, actualizar valores del contrato
            if (createModificacionDto.tipoModificacion === TipoModificacion.ADICION) {
                contrato.adiciones = (contrato.adiciones || 0) + (createModificacionDto.valorModificacion || 0);
                contrato.valorTotal = contrato.valor + contrato.adiciones;
                contrato.saldoDisponible = contrato.valorTotal - contrato.pagadoAcumulado - contrato.comprometido;
                await this.contratoRepository.save(contrato);
            }

            // Si es prórroga, actualizar fecha terminación
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

    // ==================== DOCUMENTOS ====================

    async subirDocumento(
        contratoId: string,
        file: Express.Multer.File,
        tipoDocumento: TipoDocumento,
        descripcion: string,
        usuario: string,
    ): Promise<DocumentoContrato> {
        try {
            const contrato = await this.findOne(contratoId);

            // Crear estructura de carpetas
            const rutaContrato = path.join(
                this.basePath,
                contrato.vigencia,
                contrato.numeroContrato,
                'documentos',
            );

            if (!fs.existsSync(rutaContrato)) {
                fs.mkdirSync(rutaContrato, { recursive: true });
            }

            // Nombre del archivo
            const extension = path.extname(file.originalname);
            const nombreArchivo = `${tipoDocumento}_${Date.now()}${extension}`;
            const rutaCompleta = path.join(rutaContrato, nombreArchivo);

            // Guardar archivo
            fs.writeFileSync(rutaCompleta, file.buffer);

            // Si hay versión anterior, marcarla como no actual
            if (tipoDocumento !== TipoDocumento.OTRO) {
                await this.documentoRepository.update(
                    {
                        contratoId,
                        tipoDocumento,
                        esVersionActual: true,
                    },
                    { esVersionActual: false },
                );
            }

            // Crear registro
            const documento = this.documentoRepository.create({
                nombreArchivo,
                rutaArchivo: rutaCompleta,
                tipoDocumento,
                descripcion,
                version: 1,
                esVersionActual: true,
                tamanoBytes: file.size,
                mimeType: file.mimetype,
                contrato,
                contratoId,
                cargadoPor: usuario,
            });

            return await this.documentoRepository.save(documento);
        } catch (error) {
            this.logger.error(`❌ Error subiendo documento: ${error.message}`);
            throw error;
        }
    }

    // ==================== DASHBOARD Y REPORTES ====================

    async obtenerDashboardGerencial(): Promise<any> {
        try {
            const now = new Date();

            // Contratos críticos
            const contratosPorVencer = await this.contratoRepository.count({
                where: {
                    fechaTerminacion: Between(now, new Date(now.setDate(now.getDate() + 30))),
                    estado: EstadoContrato.EN_EJECUCION,
                },
            });

            const polizasVencidas = await this.polizaRepository.count({
                where: {
                    fechaVigenciaFin: LessThan(new Date()),
                },
                relations: ['contrato'],
            });

            // Ejecución presupuestal
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

            // Contratos por estado
            const porEstado = await this.contratoRepository
                .createQueryBuilder('contrato')
                .select('contrato.estado', 'estado')
                .addSelect('COUNT(*)', 'cantidad')
                .groupBy('contrato.estado')
                .getRawMany();

            // Porcentaje tiempo vs presupuesto
            const tiempoVsPresupuesto = contratos.map(c => {
                const tiempoTranscurrido = this.calcularPorcentajeTiempo(c);
                const presupuestoEjecutado = c.pagadoAcumulado / c.valorTotal * 100;
                return {
                    numeroContrato: c.numeroContrato,
                    objeto: c.objeto,
                    proveedor: c.proveedor?.nombreRazonSocial,
                    tiempoTranscurrido: Math.round(tiempoTranscurrido),
                    presupuestoEjecutado: Math.round(presupuestoEjecutado),
                    desviacion: Math.round(presupuestoEjecutado - tiempoTranscurrido),
                };
            });

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

            // Definir tipo para peso de gravedad
            interface PesoGravedad {
                ALTA: number;
                MEDIA: number;
                BAJA: number;
            }

            const peso: PesoGravedad = { ALTA: 1, MEDIA: 2, BAJA: 3 };

            // Contratos por vencer (30 días)
            const fechaLimite = new Date();
            fechaLimite.setDate(fechaLimite.getDate() + 30);

            const contratosPorVencer = await this.contratoRepository.find({
                where: {
                    fechaTerminacion: Between(now, fechaLimite),
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

            // Pólizas por vencer
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

            // Contratos sin liquidar
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

            return alertas.sort((a, b) => {
                const pesoA = a.gravedad as keyof PesoGravedad;
                const pesoB = b.gravedad as keyof PesoGravedad;
                return (peso[pesoA] || 4) - (peso[pesoB] || 4);
            });
        } catch (error) {
            this.logger.error(`❌ Error obteniendo alertas: ${error.message}`);
            throw error;
        }
    }

    // ==================== MÉTODOS AUXILIARES ====================

    private calcularIndicadores(contrato: Contrato): Contrato {
        // Porcentaje tiempo transcurrido
        const tiempoTranscurrido = this.calcularPorcentajeTiempo(contrato);

        // Saldo disponible
        contrato.saldoDisponible = Number(contrato.valorTotal) -
            Number(contrato.pagadoAcumulado) -
            Number(contrato.comprometido);

        // Anticipo pendiente
        if (contrato.seDesembolsaAnticipo && contrato.valorAnticipo) {
            contrato.anticipoPendienteAmortizar = Number(contrato.valorAnticipo) -
                (Number(contrato.pagadoAcumulado) > Number(contrato.valorAnticipo)
                    ? Number(contrato.valorAnticipo)
                    : Number(contrato.pagadoAcumulado));
        }

        // Semáforo (se puede usar en frontend)
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
        const now = new Date();
        const total = contrato.fechaTerminacion.getTime() - contrato.fechaInicio.getTime();
        const transcurrido = now.getTime() - contrato.fechaInicio.getTime();

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