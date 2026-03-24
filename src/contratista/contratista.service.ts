// src/contratista/contratista.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Contratista } from './entities/contratista.entity';
import { DocumentoContratista, TipoDocumento } from './entities/documento-contratista.entity';
import type { IStorageService } from '../common/storage/storage.interface';
import * as path from 'path';
import * as fs from 'fs';

export interface EstadisticasContratista {
  total: number;
  ultimoMes: number;
  porTipoDocumento: Array<{ tipo: string; cantidad: number }>;
}

@Injectable()
export class ContratistaService {
  private readonly logger = new Logger(ContratistaService.name);
  private readonly baseStoragePath: string;

  constructor(
    @InjectRepository(Contratista)
    private readonly contratistaRepository: Repository<Contratista>,
    @InjectRepository(DocumentoContratista)
    private readonly documentoRepository: Repository<DocumentoContratista>,
    @Inject('IStorageService')
    private readonly storageService: IStorageService,
  ) {
    // Usar ruta local para desarrollo
    this.baseStoragePath = path.join(process.cwd(), 'uploads', 'contratistas');
    this.crearDirectorioBase();
  }

  private crearDirectorioBase(): void {
    try {
      if (!fs.existsSync(this.baseStoragePath)) {
        fs.mkdirSync(this.baseStoragePath, { recursive: true });
        this.logger.log(`📁 Directorio base creado: ${this.baseStoragePath}`);
      }
    } catch (error) {
      this.logger.error(`❌ Error creando directorio base: ${error.message}`);
    }
  }

  async buscarCombinado(tipo: 'nombre' | 'documento' | 'contrato', termino: string): Promise<Contratista[]> {
    try {
      this.logger.log(`🔍 Buscando contratistas por ${tipo}: "${termino}"`);

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
          whereClause = [
            { nombreCompleto: ILike(`%${terminoLower}%`) },
            { documentoIdentidad: ILike(`%${terminoLower}%`) },
            { numeroContrato: ILike(`%${terminoLower}%`) }
          ];
      }

      const contratistas = await this.contratistaRepository.find({
        where: whereClause,
        order: { nombreCompleto: 'ASC' },
        relations: ['documentos'],
        take: 20
      });

      this.logger.log(`✅ Encontrados ${contratistas.length} contratistas`);
      return contratistas;

    } catch (error) {
      this.logger.error(`❌ Error en búsqueda combinada:`, error.message);
      throw error;
    }
  }

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

      const query = this.contratistaRepository.createQueryBuilder('c')
        .leftJoinAndSelect('c.documentos', 'documentos');

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

      const total = await query.getCount();

      if (filtros.limit) {
        query.take(filtros.limit);
      }
      if (filtros.offset) {
        query.skip(filtros.offset);
      }

      query.orderBy('c.nombreCompleto', 'ASC');

      const contratistas = await query.getMany();

      this.logger.log(`✅ Búsqueda avanzada: ${contratistas.length} de ${total} resultados`);
      return { contratistas, total };

    } catch (error) {
      this.logger.error('❌ Error en búsqueda avanzada:', error.message);
      throw error;
    }
  }

  async obtenerTodos(options?: { limit?: number; offset?: number }): Promise<Contratista[]> {
    try {
      const queryOptions: any = {
        order: { nombreCompleto: 'ASC' },
        relations: ['documentos']
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
        relations: ['documentos'],
        order: { nombreCompleto: 'ASC' },
        take: 20,
      });
    } catch (error) {
      this.logger.error(`❌ Error buscando por término: ${error.message}`);
      throw error;
    }
  }

  async crear(data: {
    documentoIdentidad: string;
    nombreCompleto: string;
    numeroContrato?: string;
    email?: string;
    telefono?: string;
    direccion?: string;
    cargo?: string;
    tipoContratista?: string;
    estado?: string;
    observaciones?: string;
  }): Promise<Contratista> {
    try {
      if (!data.documentoIdentidad || !data.nombreCompleto) {
        throw new BadRequestException('Documento de identidad y nombre completo son requeridos');
      }

      if (data.documentoIdentidad.length < 3) {
        throw new BadRequestException('El documento debe tener al menos 3 caracteres');
      }

      const existente = await this.contratistaRepository.findOne({
        where: { documentoIdentidad: data.documentoIdentidad },
      });

      if (existente) {
        throw new ConflictException(`Ya existe un contratista con el documento ${data.documentoIdentidad}`);
      }

      const contratista = new Contratista();
      contratista.documentoIdentidad = data.documentoIdentidad.trim();
      contratista.nombreCompleto = data.nombreCompleto.trim();
      contratista.numeroContrato = data.numeroContrato?.trim() || null;
      contratista.email = data.email?.trim() || null;
      contratista.telefono = data.telefono?.trim() || null;
      contratista.direccion = data.direccion?.trim() || null;
      contratista.cargo = data.cargo?.trim() || null;
      contratista.tipoContratista = data.tipoContratista?.trim() || null;
      contratista.estado = data.estado || 'ACTIVO';
      contratista.observaciones = data.observaciones?.trim() || null;

      const saved = await this.contratistaRepository.save(contratista);
      this.logger.log(`✅ Contratista creado: ${saved.id} - ${saved.nombreCompleto}`);

      // Crear directorio para este contratista
      const contratistaDir = path.join(this.baseStoragePath, saved.id);
      if (!fs.existsSync(contratistaDir)) {
        fs.mkdirSync(contratistaDir, { recursive: true });
        this.logger.log(`📁 Directorio creado: ${contratistaDir}`);
      }

      return saved;
    } catch (error) {
      this.logger.error(`❌ Error creando contratista: ${error.message}`);
      throw error;
    }
  }

  async actualizar(
    id: string,
    data: Partial<{
      documentoIdentidad: string;
      nombreCompleto: string;
      numeroContrato?: string;
      email?: string;
      telefono?: string;
      direccion?: string;
      cargo?: string;
      tipoContratista?: string;
      estado?: string;
      observaciones?: string;
    }>
  ): Promise<Contratista> {
    try {
      const contratista = await this.buscarPorId(id);

      if (data.documentoIdentidad && data.documentoIdentidad !== contratista.documentoIdentidad) {
        const existente = await this.contratistaRepository.findOne({
          where: { documentoIdentidad: data.documentoIdentidad },
        });

        if (existente && existente.id !== id) {
          throw new ConflictException(`Ya existe otro contratista con el documento ${data.documentoIdentidad}`);
        }
      }

      if (data.documentoIdentidad) contratista.documentoIdentidad = data.documentoIdentidad;
      if (data.nombreCompleto) contratista.nombreCompleto = data.nombreCompleto;
      if (data.numeroContrato !== undefined) contratista.numeroContrato = data.numeroContrato || null;
      if (data.email !== undefined) contratista.email = data.email || null;
      if (data.telefono !== undefined) contratista.telefono = data.telefono || null;
      if (data.direccion !== undefined) contratista.direccion = data.direccion || null;
      if (data.cargo !== undefined) contratista.cargo = data.cargo || null;
      if (data.tipoContratista !== undefined) contratista.tipoContratista = data.tipoContratista || null;
      if (data.estado !== undefined) contratista.estado = data.estado;
      if (data.observaciones !== undefined) contratista.observaciones = data.observaciones || null;

      const updated = await this.contratistaRepository.save(contratista);
      this.logger.log(`✅ Contratista actualizado: ${updated.id}`);

      return updated;
    } catch (error) {
      this.logger.error(`❌ Error actualizando contratista: ${error.message}`);
      throw error;
    }
  }

  async crearConDocumentos(
    data: {
      documentoIdentidad: string;
      nombreCompleto: string;
      numeroContrato?: string;
      email?: string;
      telefono?: string;
      direccion?: string;
      cargo?: string;
      tipoContratista?: string;
      estado?: string;
      observaciones?: string;
    },
    documentos?: Array<{ tipo: TipoDocumento; archivo: Express.Multer.File }>,
    usuario?: string
  ): Promise<{ contratista: Contratista; documentos: DocumentoContratista[] }> {
    try {
      const contratista = await this.crear(data);

      const documentosSubidos: DocumentoContratista[] = [];

      if (documentos && documentos.length > 0) {
        for (const doc of documentos) {
          try {
            const docSubido = await this.subirDocumentoLocal(
              contratista.id,
              doc.tipo,
              doc.archivo,
              usuario || 'sistema'
            );
            documentosSubidos.push(docSubido);
          } catch (error) {
            this.logger.error(`Error subiendo documento ${doc.tipo}: ${error.message}`);
          }
        }
      }

      return {
        contratista,
        documentos: documentosSubidos
      };
    } catch (error) {
      this.logger.error(`❌ Error creando contratista con documentos: ${error.message}`);
      throw error;
    }
  }

  async subirDocumentoLocal(
    contratistaId: string,
    tipo: TipoDocumento,
    archivo: Express.Multer.File,
    usuario: string
  ): Promise<DocumentoContratista> {
    try {
      const contratista = await this.buscarPorId(contratistaId);

      const extension = path.extname(archivo.originalname).toLowerCase();
      const nombreUnico = `${tipo}_${Date.now()}${extension}`;
      const contratistaDir = path.join(this.baseStoragePath, contratistaId);
      
      // Asegurar que el directorio existe
      if (!fs.existsSync(contratistaDir)) {
        fs.mkdirSync(contratistaDir, { recursive: true });
        this.logger.log(`📁 Directorio creado: ${contratistaDir}`);
      }

      const fullPath = path.join(contratistaDir, nombreUnico);
      const relativePath = `contratistas/${contratistaId}/${nombreUnico}`;

      // Guardar archivo físicamente
      fs.writeFileSync(fullPath, archivo.buffer);
      this.logger.log(`✅ Archivo guardado localmente: ${fullPath} (${archivo.buffer.length} bytes)`);

      const documento = new DocumentoContratista();
      documento.contratistaId = contratistaId;
      documento.tipo = tipo;
      documento.nombreArchivo = archivo.originalname;
      documento.rutaArchivo = relativePath;
      documento.tipoMime = archivo.mimetype;
      documento.tamanoBytes = archivo.size;
      documento.subidoPor = usuario;

      const saved = await this.documentoRepository.save(documento);
      this.logger.log(`✅ Documento subido: ${tipo} para contratista ${contratistaId}`);

      return saved;
    } catch (error) {
      this.logger.error(`❌ Error subiendo documento: ${error.message}`);
      throw error;
    }
  }

  async subirDocumento(
    contratistaId: string,
    tipo: TipoDocumento,
    archivo: Express.Multer.File,
    usuario: string
  ): Promise<DocumentoContratista> {
    return this.subirDocumentoLocal(contratistaId, tipo, archivo, usuario);
  }

  async obtenerDocumentos(contratistaId: string): Promise<DocumentoContratista[]> {
    try {
      return await this.documentoRepository.find({
        where: { contratistaId },
        order: { fechaSubida: 'DESC' }
      });
    } catch (error) {
      this.logger.error(`❌ Error obteniendo documentos: ${error.message}`);
      return [];
    }
  }

  async obtenerDocumentoPorId(documentoId: string, contratistaId: string): Promise<DocumentoContratista> {
    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId, contratistaId }
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    return documento;
  }

  async descargarDocumento(documentoId: string, contratistaId: string): Promise<{ buffer: Buffer; nombre: string; mimeType: string }> {
    const documento = await this.obtenerDocumentoPorId(documentoId, contratistaId);
    
    // Buscar archivo en el sistema local
    const fullPath = path.join(this.baseStoragePath, contratistaId, path.basename(documento.rutaArchivo));
    
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException(`Archivo no encontrado: ${documento.nombreArchivo}`);
    }

    const buffer = fs.readFileSync(fullPath);

    return {
      buffer,
      nombre: documento.nombreArchivo,
      mimeType: documento.tipoMime || 'application/octet-stream',
    };
  }

  async eliminarDocumento(documentoId: string, contratistaId: string): Promise<void> {
    try {
      const documento = await this.obtenerDocumentoPorId(documentoId, contratistaId);
      
      // Eliminar archivo físico
      const fullPath = path.join(this.baseStoragePath, contratistaId, path.basename(documento.rutaArchivo));
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        this.logger.log(`🗑️ Archivo eliminado: ${fullPath}`);
      }

      await this.documentoRepository.delete(documentoId);
      this.logger.log(`✅ Documento eliminado: ${documentoId}`);
    } catch (error) {
      this.logger.error(`❌ Error eliminando documento: ${error.message}`);
      throw error;
    }
  }

  async buscarPorId(id: string): Promise<Contratista> {
    try {
      const contratista = await this.contratistaRepository.findOne({
        where: { id },
        relations: ['documentos']
      });

      if (!contratista) {
        throw new NotFoundException(`Contratista con ID ${id} no encontrado`);
      }

      return contratista;
    } catch (error) {
      this.logger.error(`❌ Error buscando por ID: ${error.message}`);
      throw error;
    }
  }

  async buscarPorDocumento(documentoIdentidad: string): Promise<Contratista[]> {
    try {
      if (!documentoIdentidad || documentoIdentidad.trim().length < 1) {
        return [];
      }

      const documentoLower = documentoIdentidad.toLowerCase().trim();

      return await this.contratistaRepository.find({
        where: { documentoIdentidad: ILike(`%${documentoLower}%`) },
        relations: ['documentos'],
        order: { nombreCompleto: 'ASC' },
        take: 20,
      });
    } catch (error) {
      this.logger.error(`❌ Error buscando por documento: ${error.message}`);
      return [];
    }
  }

  async buscarPorNombre(nombre: string): Promise<Contratista[]> {
    try {
      if (!nombre || nombre.trim().length < 1) {
        return [];
      }

      const nombreLower = nombre.toLowerCase().trim();

      return await this.contratistaRepository.find({
        where: { nombreCompleto: ILike(`%${nombreLower}%`) },
        relations: ['documentos'],
        order: { nombreCompleto: 'ASC' },
        take: 20,
      });
    } catch (error) {
      this.logger.error(`❌ Error buscando por nombre: ${error.message}`);
      return [];
    }
  }

  async buscarPorNumeroContrato(numeroContrato: string): Promise<Contratista[]> {
    try {
      if (!numeroContrato || numeroContrato.trim().length < 1) {
        return [];
      }

      const numeroContratoLower = numeroContrato.toLowerCase().trim();

      return await this.contratistaRepository.find({
        where: { numeroContrato: ILike(`%${numeroContratoLower}%`) },
        relations: ['documentos'],
        order: { nombreCompleto: 'ASC' },
        take: 20,
      });
    } catch (error) {
      this.logger.error(`❌ Error buscando por contrato: ${error.message}`);
      return [];
    }
  }

  async obtenerContratistaCompleto(id: string): Promise<any> {
    try {
      const contratista = await this.buscarPorId(id);
      const documentos = await this.obtenerDocumentos(id);

      return {
        ...contratista,
        documentos
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo contratista completo: ${error.message}`);
      throw error;
    }
  }

  async existePorDocumento(documentoIdentidad: string): Promise<boolean> {
    try {
      const count = await this.contratistaRepository.count({
        where: { documentoIdentidad },
      });
      return count > 0;
    } catch (error) {
      this.logger.error(`❌ Error verificando documento: ${error.message}`);
      return false;
    }
  }

  async obtenerEstadisticas(): Promise<EstadisticasContratista> {
    try {
      const total = await this.contratistaRepository.count();

      const fechaLimite = new Date();
      fechaLimite.setMonth(fechaLimite.getMonth() - 1);

      const ultimoMes = await this.contratistaRepository
        .createQueryBuilder('contratista')
        .where('contratista.createdAt >= :fechaLimite', { fechaLimite })
        .getCount();

      return {
        total,
        ultimoMes,
        porTipoDocumento: []
      };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo estadísticas: ${error.message}`);
      return { total: 0, ultimoMes: 0, porTipoDocumento: [] };
    }
  }

  async obtenerRecientes(limit: number = 10): Promise<Contratista[]> {
    try {
      return await this.contratistaRepository.find({
        relations: ['documentos'],
        order: { createdAt: 'DESC' },
        take: limit
      });
    } catch (error) {
      this.logger.error(`❌ Error obteniendo contratistas recientes: ${error.message}`);
      return [];
    }
  }

  buscarPorDocumentoExacto(documento: string): Observable<any> {
  const headers = this.getAuthHeaders();

  if (!headers.get('Authorization')) {
    return of({ success: false, data: null });
  }

  if (!documento || documento.trim().length < 3) {
    return of({ success: true, data: null });
  }

  return this.http.get<any>(
    `${this.apiUrl}/buscar-por-documento/${encodeURIComponent(documento.trim())}`,
    { headers }
  ).pipe(
    map(response => {
      if (response?.data?.data) {
        return response.data.data;
      }
      return null;
    }),
    catchError(() => of(null))
  );
}

/**
 * Buscar contratistas por documento (autocomplete)
 */
buscarPorDocumentoAutocomplete(documento: string): Observable<Contratista[]> {
  const headers = this.getAuthHeaders();

  if (!headers.get('Authorization')) {
    return of([]);
  }

  if (!documento || documento.trim().length < 1) {
    return of([]);
  }

  return this.http.get<any>(
    `${this.apiUrl}/autocomplete/documento?q=${encodeURIComponent(documento.trim())}`,
    { headers }
  ).pipe(
    map(response => {
      const contratistasData = this.extraerDatosAutocomplete(response);
      return contratistasData.map(item => this.mapearContratista(item));
    }),
    catchError(() => of([]))
  );
}
}