import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, Between } from 'typeorm';
import { Contratista } from './entities/contratista.entity';
import { CreateContratistaDto } from './dto/create-contratista.dto';

// ✅ Interfaz para las estadísticas
interface EstadisticasContratista {
    total: number;
    ultimoMes: number;
    porTipoDocumento: Array<{ tipo: string; cantidad: number }>;
}

@Injectable()
export class ContratistaService {
    private readonly logger = new Logger(ContratistaService.name);

    constructor(
        @InjectRepository(Contratista)
        private readonly contratistaRepository: Repository<Contratista>,
    ) { }

    /**
     * ✅ NUEVO: Buscar contratistas de manera combinada por cualquier campo
     */
    async buscarCombinado(tipo: 'nombre' | 'documento' | 'contrato', termino: string): Promise<Contratista[]> {
        try {
            this.logger.log(`🔍 Buscando contratistas por ${tipo}: "${termino}"`);

            // Validar que haya término
            if (!termino || termino.trim().length < 1) {
                return [];
            }

            const terminoLower = termino.toLowerCase().trim();
            let whereClause: any[] = [];

            switch (tipo) {
                case 'nombre':
                    whereClause = [{ nombreCompleto: ILike(`%${terminoLower}%`) }];
                    break;
                case 'documento':
                    whereClause = [{ documentoIdentidad: ILike(`%${terminoLower}%`) }];
                    break;
                case 'contrato':
                    whereClause = [{ numeroContrato: ILike(`%${terminoLower}%`) }];
                    break;
                default:
                    // Búsqueda general
                    whereClause = [
                        { nombreCompleto: ILike(`%${terminoLower}%`) },
                        { documentoIdentidad: ILike(`%${terminoLower}%`) },
                        { numeroContrato: ILike(`%${terminoLower}%`) }
                    ];
            }

            const contratistas = await this.contratistaRepository.find({
                where: whereClause,
                order: { nombreCompleto: 'ASC' },
                take: 20
            });

            this.logger.log(`✅ Encontrados ${contratistas.length} contratistas por ${tipo}`);
            return contratistas;

        } catch (error) {
            this.logger.error(`❌ Error en búsqueda combinada (${tipo}):`, error.message);
            throw error;
        }
    }

    /**
     * ✅ NUEVO: Búsqueda unificada que acepta múltiples criterios
     */
    async buscarAvanzado(filtros: {
        nombre?: string;
        documento?: string;
        contrato?: string;
        fechaDesde?: Date;
        fechaHasta?: Date;
        limit?: number;
        offset?: number;
    }): Promise<{ contratistas: Contratista[]; total: number }> {
        try {
            this.logger.log('🔍 Búsqueda avanzada de contratistas');

            const query = this.contratistaRepository.createQueryBuilder('c');

            // Aplicar filtros
            if (filtros.nombre) {
                query.andWhere('c.nombreCompleto ILIKE :nombre', { nombre: `%${filtros.nombre}%` });
            }

            if (filtros.documento) {
                query.andWhere('c.documentoIdentidad ILIKE :documento', { documento: `%${filtros.documento}%` });
            }

            if (filtros.contrato) {
                query.andWhere('c.numeroContrato ILIKE :contrato', { contrato: `%${filtros.contrato}%` });
            }

            if (filtros.fechaDesde) {
                query.andWhere('c.createdAt >= :fechaDesde', { fechaDesde: filtros.fechaDesde });
            }

            if (filtros.fechaHasta) {
                const fechaHasta = new Date(filtros.fechaHasta);
                fechaHasta.setHours(23, 59, 59, 999);
                query.andWhere('c.createdAt <= :fechaHasta', { fechaHasta });
            }

            // Contar total
            const total = await query.getCount();

            // Aplicar paginación
            if (filtros.limit) {
                query.take(filtros.limit);
            }
            if (filtros.offset) {
                query.skip(filtros.offset);
            }

            // Ordenar
            query.orderBy('c.nombreCompleto', 'ASC');

            const contratistas = await query.getMany();

            this.logger.log(`✅ Búsqueda avanzada: ${contratistas.length} de ${total} resultados`);
            return { contratistas, total };

        } catch (error) {
            this.logger.error('❌ Error en búsqueda avanzada:', error.message);
            throw error;
        }
    }

    /**
     * Obtener todos los contratistas con paginación
     */
    async obtenerTodos(options?: {
        limit?: number;
        offset?: number;
    }): Promise<Contratista[]> {
        try {
            const queryOptions: any = {
                order: {
                    nombreCompleto: 'ASC',
                }
            };

            if (options?.limit) {
                queryOptions.take = options.limit;
            }
            if (options?.offset) {
                queryOptions.skip = options.offset;
            }

            return await this.contratistaRepository.find(queryOptions);
        } catch (error) {
            this.logger.error(`❌ Error obteniendo todos los contratistas: ${error.message}`);
            throw error;
        }
    }

    /**
     * Busca contratistas por término (documento, nombre o número de contrato)
     */
    async buscarPorTermino(termino: string): Promise<Contratista[]> {
        try {
            if (!termino || termino.trim() === '') {
                return await this.obtenerTodos();
            }

            const terminoLower = termino.toLowerCase().trim();

            return await this.contratistaRepository.find({
                where: [
                    { documentoIdentidad: ILike(`%${terminoLower}%`) },
                    { nombreCompleto: ILike(`%${terminoLower}%`) },
                    { numeroContrato: ILike(`%${terminoLower}%`) },
                ],
                order: {
                    nombreCompleto: 'ASC',
                },
                take: 20,
            });
        } catch (error) {
            this.logger.error(`❌ Error buscando por término "${termino}": ${error.message}`);
            throw error;
        }
    }

    /**
     * Crea un nuevo contratista
     */
    async crear(data: { documentoIdentidad: string; nombreCompleto: string; numeroContrato?: string }): Promise<Contratista> {
        try {
            // Validar datos
            if (!data.documentoIdentidad || !data.nombreCompleto) {
                throw new BadRequestException('Documento de identidad y nombre completo son requeridos');
            }

            // Validar formato del documento
            if (data.documentoIdentidad.length < 3) {
                throw new BadRequestException('El documento debe tener al menos 3 caracteres');
            }

            // Validar que el documento no exista
            const existente = await this.contratistaRepository.findOne({
                where: { documentoIdentidad: data.documentoIdentidad },
            });

            if (existente) {
                throw new ConflictException(
                    `Ya existe un contratista con el documento ${data.documentoIdentidad}`,
                );
            }

            // Crear nuevo contratista
            const contratista = new Contratista();
            contratista.documentoIdentidad = data.documentoIdentidad.trim();
            contratista.nombreCompleto = data.nombreCompleto.trim();

            // Manejar número de contrato opcional
            if (data.numeroContrato && data.numeroContrato.trim()) {
                contratista.numeroContrato = data.numeroContrato.trim();
            }

            const saved = await this.contratistaRepository.save(contratista);
            this.logger.log(`✅ Contratista creado: ${saved.id} - ${saved.nombreCompleto}`);

            return saved;
        } catch (error) {
            this.logger.error(`❌ Error creando contratista: ${error.message}`);
            throw error;
        }
    }

    /**
     * Busca un contratista por ID
     */
    async buscarPorId(id: string): Promise<Contratista> {
        try {
            const contratista = await this.contratistaRepository.findOne({
                where: { id },
            });

            if (!contratista) {
                throw new NotFoundException(`Contratista con ID ${id} no encontrado`);
            }

            return contratista;
        } catch (error) {
            this.logger.error(`❌ Error buscando por ID ${id}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Busca contratistas por documento de identidad
     */
    async buscarPorDocumento(documentoIdentidad: string): Promise<Contratista[]> {
        try {
            // ✅ CAMBIADO: De 2 a 1 carácter mínimo
            if (!documentoIdentidad || documentoIdentidad.trim().length < 1) {
                return [];
            }

            const documentoLower = documentoIdentidad.toLowerCase().trim();

            // ✅ CAMBIADO: Usar ILike para búsqueda parcial
            const contratistas = await this.contratistaRepository.find({
                where: { documentoIdentidad: ILike(`%${documentoLower}%`) },
                order: { nombreCompleto: 'ASC' },
                take: 20,
            });

            if (contratistas.length === 0) {
                this.logger.warn(`⚠️ No se encontraron contratistas con documento que contenga: ${documentoIdentidad}`);
            }

            return contratistas;
        } catch (error) {
            this.logger.error(`❌ Error buscando por documento ${documentoIdentidad}: ${error.message}`);
            return [];
        }
    }

    /**
     * Busca contratistas por número de contrato
     * ✅ CAMBIADO: Ahora empieza con 1 carácter
     */
    async buscarPorNumeroContrato(numeroContrato: string): Promise<Contratista[]> {
        try {
            // ✅✅✅ CAMBIADO: De 2 a 1 carácter mínimo
            if (!numeroContrato || numeroContrato.trim().length < 1) {
                return [];
            }

            const numeroContratoLower = numeroContrato.toLowerCase().trim();

            return await this.contratistaRepository.find({
                where: { numeroContrato: ILike(`%${numeroContratoLower}%`) },
                order: { nombreCompleto: 'ASC' },
                take: 20,
            });
        } catch (error) {
            this.logger.error(`❌ Error buscando por número de contrato "${numeroContrato}": ${error.message}`);
            return [];
        }
    }

    /**
     * ✅ NUEVO: Buscar por nombre (para autocomplete)
     */
    async buscarPorNombre(nombre: string): Promise<Contratista[]> {
        try {
            if (!nombre || nombre.trim().length < 1) {
                return [];
            }

            const nombreLower = nombre.toLowerCase().trim();

            return await this.contratistaRepository.find({
                where: { nombreCompleto: ILike(`%${nombreLower}%`) },
                order: { nombreCompleto: 'ASC' },
                take: 20,
            });
        } catch (error) {
            this.logger.error(`❌ Error buscando por nombre "${nombre}": ${error.message}`);
            return [];
        }
    }

    /**
     * Actualiza un contratista
     */
    async actualizar(
        id: string,
        data: Partial<{ documentoIdentidad: string; nombreCompleto: string; numeroContrato?: string }>,
    ): Promise<Contratista> {
        try {
            const contratista = await this.buscarPorId(id);

            // Si se intenta cambiar el documento, verificar que no exista otro con el mismo
            if (data.documentoIdentidad && data.documentoIdentidad !== contratista.documentoIdentidad) {
                const existente = await this.contratistaRepository.findOne({
                    where: { documentoIdentidad: data.documentoIdentidad },
                });

                if (existente && existente.id !== id) {
                    throw new ConflictException(
                        `Ya existe otro contratista con el documento ${data.documentoIdentidad}`,
                    );
                }
            }

            // Actualizar campos
            if (data.documentoIdentidad) {
                contratista.documentoIdentidad = data.documentoIdentidad;
            }
            if (data.nombreCompleto) {
                contratista.nombreCompleto = data.nombreCompleto;
            }
            if (data.numeroContrato !== undefined) {
                contratista.numeroContrato = data.numeroContrato || null;
            }

            const updated = await this.contratistaRepository.save(contratista);
            this.logger.log(`✅ Contratista actualizado: ${updated.id}`);

            return updated;
        } catch (error) {
            this.logger.error(`❌ Error actualizando contratista ${id}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Verifica si existe un contratista por documento
     */
    async existePorDocumento(documentoIdentidad: string): Promise<boolean> {
        try {
            const count = await this.contratistaRepository.count({
                where: { documentoIdentidad },
            });
            return count > 0;
        } catch (error) {
            this.logger.error(`❌ Error verificando documento ${documentoIdentidad}: ${error.message}`);
            return false;
        }
    }

    /**
     * Obtiene estadísticas básicas de contratistas
     */
    async obtenerEstadisticas(): Promise<EstadisticasContratista> {
        try {
            const total = await this.contratistaRepository.count();

            // Contratistas creados en el último mes
            const fechaLimite = new Date();
            fechaLimite.setMonth(fechaLimite.getMonth() - 1);

            const ultimoMes = await this.contratistaRepository
                .createQueryBuilder('contratista')
                .where('contratista.createdAt >= :fechaLimite', { fechaLimite })
                .getCount();

            // ✅ CORREGIDO: Tipo explícito para el array
            const porTipoDocumento: Array<{ tipo: string; cantidad: number }> = [];

            return { 
                total, 
                ultimoMes, 
                porTipoDocumento 
            };
        } catch (error) {
            this.logger.error(`❌ Error obteniendo estadísticas: ${error.message}`);
            return {
                total: 0,
                ultimoMes: 0,
                porTipoDocumento: []
            };
        }
    }

    /**
     * ✅ NUEVO: Obtener contratistas recientes
     */
    async obtenerRecientes(limit: number = 10): Promise<Contratista[]> {
        try {
            return await this.contratistaRepository.find({
                order: { createdAt: 'DESC' },
                take: limit
            });
        } catch (error) {
            this.logger.error(`❌ Error obteniendo contratistas recientes: ${error.message}`);
            return [];
        }
    }
}