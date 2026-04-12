// src/contratista/contratista.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Contratista } from './entities/contratista.entity';
import { DocumentoContratista, TipoDocumento } from './entities/documento-contratista.entity';
import { StorageService } from '../common/storage/storage.service';
import * as path from 'path';

export interface EstadisticasContratista {
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
    @InjectRepository(DocumentoContratista)
    private readonly documentoRepository: Repository<DocumentoContratista>,
    private readonly storageService: StorageService,
  ) { }

  // ===============================
  // GESTIÓN DE DOCUMENTOS USANDO STORAGE SERVICE
  // ===============================

  async subirDocumento(
    contratistaId: string,
    tipo: TipoDocumento,
    archivo: Express.Multer.File,
    usuario: string
  ): Promise<DocumentoContratista> {
    try {
      const contratista = await this.buscarPorId(contratistaId);

      // ✅ Generar nombre de carpeta legible: [numeroContrato]_[razonSocial]
      const numeroContrato = contratista.numeroContrato || 'SIN_CONTRATO';
      const razonSocialLimpia = contratista.razonSocial
        .replace(/[^a-zA-Z0-9]/g, '_')
        .substring(0, 50);

      // Si no tiene número de contrato, usar el ID
      const folderName = contratista.numeroContrato
        ? `${numeroContrato}_${razonSocialLimpia}`
        : `${contratistaId}`;

      const extension = path.extname(archivo.originalname).toLowerCase();
      const nombreUnico = `${tipo}_${Date.now()}${extension}`;
      const folder = `contratistas/${folderName}`;

      // ✅ Usar StorageService
      const result = await this.storageService.uploadFile(
        archivo,
        folder,
        nombreUnico
      );

      this.logger.log(`✅ Archivo subido a: ${result.provider} - ${result.path}`);

      const documento = new DocumentoContratista();
      documento.contratistaId = contratistaId;
      documento.tipo = tipo;
      documento.nombreArchivo = archivo.originalname;
      documento.rutaArchivo = result.path;
      documento.tipoMime = archivo.mimetype;
      documento.tamanoBytes = archivo.size;
      documento.subidoPor = usuario;

      const saved = await this.documentoRepository.save(documento);
      this.logger.log(`✅ Documento subido: ${tipo} para contratista ${contratista.razonSocial}`);

      return saved;
    } catch (error) {
      this.logger.error(`❌ Error subiendo documento: ${error.message}`);
      throw error;
    }
  }

  async descargarDocumento(documentoId: string, contratistaId: string): Promise<{ buffer: Buffer; nombre: string; mimeType: string }> {
    const documento = await this.obtenerDocumentoPorId(documentoId, contratistaId);

    // ✅ Inicializar buffer como null
    let buffer: Buffer | null = null;
    let errorFinal: Error | null = null;

    // 1. Intentar con la ruta original
    try {
      buffer = await this.storageService.getFile(documento.rutaArchivo);
      this.logger.log(`✅ Archivo encontrado en ruta original: ${documento.rutaArchivo}`);
    } catch (error) {
      this.logger.warn(`⚠️ No se encontró en ruta original: ${documento.rutaArchivo}`);
      errorFinal = error;
    }

    // 2. Si no se encontró, intentar con la ruta del contratista actual
    if (!buffer) {
      try {
        const rutaAlternativa1 = documento.rutaArchivo.replace(/contratistas\/[^\/]+/, `contratistas/${contratistaId}`);
        this.logger.log(`🔍 Intentando ruta alternativa 1: ${rutaAlternativa1}`);
        buffer = await this.storageService.getFile(rutaAlternativa1);
        this.logger.log(`✅ Archivo encontrado en ruta alternativa 1`);
      } catch (error) {
        this.logger.warn(`⚠️ No se encontró en ruta alternativa 1`);
        errorFinal = error;
      }
    }

    // 3. Si no se encontró, intentar buscar por nombre de archivo
    if (!buffer) {
      try {
        const nombreArchivo = documento.nombreArchivo;
        this.logger.log(`🔍 Buscando archivo por nombre: ${nombreArchivo}`);

        const files = await this.storageService.listFiles('contratistas');

        for (const file of files) {
          if (file.includes(nombreArchivo) || file.includes(documento.tipo)) {
            try {
              buffer = await this.storageService.getFile(file);
              this.logger.log(`✅ Archivo encontrado en: ${file}`);
              break;
            } catch (e) {
              continue;
            }
          }
        }
      } catch (error) {
        this.logger.warn(`⚠️ Error en búsqueda por nombre: ${error.message}`);
        errorFinal = error;
      }
    }

    // 4. Si no se encontró el archivo, lanzar error
    if (!buffer) {
      this.logger.error(`❌ Archivo no encontrado: ${documento.nombreArchivo}`);
      throw new NotFoundException(`Archivo no encontrado: ${documento.nombreArchivo}`);
    }

    return {
      buffer,
      nombre: documento.nombreArchivo,
      mimeType: documento.tipoMime || 'application/octet-stream',
    };
  }



  async obtenerBufferDocumento(documentoId: string, contratistaId: string): Promise<{ buffer: Buffer; nombre: string; extension: string }> {
    const documento = await this.obtenerDocumentoPorId(documentoId, contratistaId);

    // ✅ Usar StorageService
    const buffer = await this.storageService.getFile(documento.rutaArchivo);
    const extension = documento.nombreArchivo.split('.').pop() || '';

    return {
      buffer,
      nombre: documento.nombreArchivo,
      extension
    };
  }

  async eliminarDocumento(documentoId: string, contratistaId: string): Promise<void> {
    try {
      const documento = await this.obtenerDocumentoPorId(documentoId, contratistaId);

      // ✅ Usar StorageService
      await this.storageService.deleteFile(documento.rutaArchivo);
      await this.documentoRepository.delete(documentoId);

      this.logger.log(`✅ Documento eliminado: ${documentoId}`);
    } catch (error) {
      this.logger.error(`❌ Error eliminando documento: ${error.message}`);
      throw error;
    }
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

  async descargarTodosDocumentos(contratistaId: string): Promise<{ zipBuffer: Buffer; nombreZip: string; totalDocumentos: number }> {
    try {
      this.logger.log(`📦 Preparando ZIP con documentos del contratista ${contratistaId}`);

      const contratista = await this.buscarPorId(contratistaId);
      const documentos = await this.obtenerDocumentos(contratistaId);

      if (!documentos || documentos.length === 0) {
        throw new NotFoundException(`El contratista ${contratistaId} no tiene documentos asociados`);
      }

      this.logger.log(`📎 Encontrados ${documentos.length} documentos para empaquetar`);

      const archiver = require('archiver');
      const chunks: Buffer[] = [];

      const zipStream = archiver('zip', {
        zlib: { level: 9 }
      });

      zipStream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      const zipPromise = new Promise<Buffer>((resolve, reject) => {
        zipStream.on('end', () => {
          const zipBuffer = Buffer.concat(chunks);
          resolve(zipBuffer);
        });
        zipStream.on('error', (err: Error) => reject(err));
      });

      for (const doc of documentos) {
        try {
          const { buffer } = await this.descargarDocumento(doc.id, contratistaId);
          const nombreLimpio = doc.nombreArchivo.replace(/[^a-zA-Z0-9.-]/g, '_');
          const nombreArchivoZip = `${doc.tipo}_${nombreLimpio}`;
          zipStream.append(buffer, { name: nombreArchivoZip });
          this.logger.log(`✅ Agregado al ZIP: ${nombreArchivoZip}`);
        } catch (error) {
          this.logger.error(`❌ Error agregando documento ${doc.id}: ${error.message}`);
        }
      }

      zipStream.finalize();
      const zipBuffer = await zipPromise;

      const nombreContratista = contratista.razonSocial.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const fecha = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const nombreZip = `documentos_${nombreContratista}_${fecha}.zip`;

      this.logger.log(`✅ ZIP creado: ${nombreZip} (${zipBuffer.length} bytes, ${documentos.length} archivos)`);

      return {
        zipBuffer,
        nombreZip,
        totalDocumentos: documentos.length
      };
    } catch (error) {
      this.logger.error(`❌ Error creando ZIP: ${error.message}`);
      throw error;
    }
  }

  // ===============================
  // CRUD CONTRATISTA
  // ===============================

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
          whereClause = [{ razonSocial: ILike(`%${terminoLower}%`) }];
          break;
        case 'documento':
          whereClause = [{ documentoIdentidad: ILike(`%${terminoLower}%`) }];
          break;
        case 'contrato':
          whereClause = [{ numeroContrato: ILike(`%${terminoLower}%`) }];
          break;
        default:
          whereClause = [
            { razonSocial: ILike(`%${terminoLower}%`) },
            { documentoIdentidad: ILike(`%${terminoLower}%`) },
            { numeroContrato: ILike(`%${terminoLower}%`) }
          ];
      }

      const contratistas = await this.contratistaRepository.find({
        where: whereClause,
        order: { razonSocial: 'ASC' },
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
        query.andWhere('c.razonSocial ILIKE :nombre', { nombre: `%${filtros.nombre}%` });
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

      if (filtros.limit) query.take(filtros.limit);
      if (filtros.offset) query.skip(filtros.offset);

      query.orderBy('c.razonSocial', 'ASC');
      const contratistas = await query.getMany();

      return { contratistas, total };
    } catch (error) {
      this.logger.error('❌ Error en búsqueda avanzada:', error.message);
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
          { razonSocial: ILike(`%${terminoLower}%`) },
          { numeroContrato: ILike(`%${terminoLower}%`) },
        ],
        relations: ['documentos'],
        order: { razonSocial: 'ASC' },
        take: 20,
      });
    } catch (error) {
      this.logger.error(`❌ Error buscando por término: ${error.message}`);
      throw error;
    }
  }

  async buscarPorDocumento(documentoIdentidad: string): Promise<Contratista[]> {
    try {
      if (!documentoIdentidad || documentoIdentidad.trim().length < 1) return [];
      const documentoLower = documentoIdentidad.toLowerCase().trim();
      return await this.contratistaRepository.find({
        where: { documentoIdentidad: ILike(`%${documentoLower}%`) },
        relations: ['documentos'],
        order: { razonSocial: 'ASC' },
        take: 20,
      });
    } catch (error) {
      this.logger.error(`❌ Error buscando por documento: ${error.message}`);
      return [];
    }
  }

  async buscarPorRazonSocial(razonSocial: string): Promise<Contratista[]> {
    try {
      if (!razonSocial || razonSocial.trim().length < 1) return [];
      const razonSocialLower = razonSocial.toLowerCase().trim();
      return await this.contratistaRepository.find({
        where: { razonSocial: ILike(`%${razonSocialLower}%`), estado: 'ACTIVO' },
        relations: ['documentos'],
        order: { razonSocial: 'ASC' },
        take: 20,
      });
    } catch (error) {
      this.logger.error(`❌ Error buscando por razón social: ${error.message}`);
      return [];
    }
  }

  async buscarPorNumeroContrato(numeroContrato: string): Promise<Contratista[]> {
    try {
      if (!numeroContrato || numeroContrato.trim().length < 1) return [];
      const numeroContratoLower = numeroContrato.toLowerCase().trim();
      return await this.contratistaRepository.find({
        where: { numeroContrato: ILike(`%${numeroContratoLower}%`), estado: 'ACTIVO' },
        relations: ['documentos'],
        order: { razonSocial: 'ASC' },
        take: 20,
      });
    } catch (error) {
      this.logger.error(`❌ Error buscando por contrato: ${error.message}`);
      return [];
    }
  }

// src/contratista/contratista.service.ts

async buscarPorNumeroContratoExacto(numeroContrato: string): Promise<Contratista | null> {
  try {
    this.logger.log(`🔍 Buscando contratista por número de contrato exacto: "${numeroContrato}"`);
    
    if (!numeroContrato || numeroContrato.trim().length < 1) {
      return null;
    }

    const contratista = await this.contratistaRepository.findOne({
      where: { 
        numeroContrato: numeroContrato.trim(),
        estado: 'ACTIVO'
      },
      relations: ['documentos'] // ✅ Esto ya está, pero asegúrate que existe
    });

    if (!contratista) {
      this.logger.log(`❌ No se encontró contratista con número de contrato: ${numeroContrato}`);
      return null;
    }

    // ✅ Log para verificar documentos
    this.logger.log(`✅ Contratista encontrado: ${contratista.razonSocial} (${contratista.id}) con ${contratista.documentos?.length || 0} documentos`);
    
    return contratista;
  } catch (error) {
    this.logger.error(`❌ Error buscando por número de contrato: ${error.message}`);
    return null;
  }
}

  async buscarPorId(id: string): Promise<Contratista> {
    try {
      const contratista = await this.contratistaRepository.findOne({
        where: { id },
        relations: ['documentos']
      });
      if (!contratista) throw new NotFoundException(`Contratista con ID ${id} no encontrado`);
      return contratista;
    } catch (error) {
      this.logger.error(`❌ Error buscando por ID: ${error.message}`);
      throw error;
    }
  }

  async obtenerContratistaCompleto(id: string): Promise<any> {
    try {
      const contratista = await this.buscarPorId(id);
      const documentos = await this.obtenerDocumentos(id);
      return { ...contratista, documentos };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo contratista completo: ${error.message}`);
      throw error;
    }
  }

  async crear(data: {
  tipoDocumento?: string;
  documentoIdentidad: string;
  razonSocial: string;
  representanteLegal?: string;
  documentoRepresentante?: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  departamento?: string;
  ciudad?: string;
  tipoContratista?: string;
  estado?: string;
  numeroContrato?: string;
  cargo?: string;
  objetivoContrato?: string;  // ✅ CAMBIADO DE observaciones A objetivoContrato
}): Promise<Contratista> {
  try {
    if (!data.documentoIdentidad || !data.razonSocial) {
      throw new BadRequestException('Documento de identidad y razón social son requeridos');
    }

    const existente = await this.contratistaRepository.findOne({
      where: { documentoIdentidad: data.documentoIdentidad, estado: 'ACTIVO' },
    });
    if (existente) {
      throw new ConflictException(`Ya existe un contratista activo con el documento ${data.documentoIdentidad}`);
    }

    const contratista = new Contratista();
    contratista.tipoDocumento = data.tipoDocumento || 'CC';
    contratista.documentoIdentidad = data.documentoIdentidad.trim();
    contratista.razonSocial = data.razonSocial.trim();
    contratista.representanteLegal = data.representanteLegal?.trim() ?? null;
    contratista.documentoRepresentante = data.documentoRepresentante?.trim() ?? null;
    contratista.telefono = data.telefono?.trim() ?? null;
    contratista.email = data.email?.trim() ?? null;
    contratista.direccion = data.direccion?.trim() ?? null;
    contratista.departamento = data.departamento?.trim() ?? null;
    contratista.ciudad = data.ciudad?.trim() ?? null;
    contratista.tipoContratista = data.tipoContratista?.trim() ?? null;
    contratista.estado = data.estado || 'ACTIVO';
    contratista.numeroContrato = data.numeroContrato?.trim() ?? null;
    contratista.cargo = data.cargo?.trim() ?? null;
    contratista.objetivoContrato = data.objetivoContrato?.trim() ?? null;  // ✅ CAMBIADO

    const saved = await this.contratistaRepository.save(contratista);
    this.logger.log(`✅ Contratista creado: ${saved.id} - ${saved.razonSocial}`);
    return saved;
  } catch (error) {
    this.logger.error(`❌ Error creando contratista: ${error.message}`);
    throw error;
  }
}

// CORREGIR el método actualizar para usar objetivoContrato
async actualizar(id: string, data: any): Promise<Contratista> {
  try {
    const contratista = await this.buscarPorId(id);
    
    // Mapear campos correctamente
    if (data.tipoDocumento !== undefined) contratista.tipoDocumento = data.tipoDocumento;
    if (data.documentoIdentidad !== undefined) contratista.documentoIdentidad = data.documentoIdentidad;
    if (data.razonSocial !== undefined) contratista.razonSocial = data.razonSocial;
    if (data.representanteLegal !== undefined) contratista.representanteLegal = data.representanteLegal;
    if (data.documentoRepresentante !== undefined) contratista.documentoRepresentante = data.documentoRepresentante;
    if (data.telefono !== undefined) contratista.telefono = data.telefono;
    if (data.email !== undefined) contratista.email = data.email;
    if (data.direccion !== undefined) contratista.direccion = data.direccion;
    if (data.departamento !== undefined) contratista.departamento = data.departamento;
    if (data.ciudad !== undefined) contratista.ciudad = data.ciudad;
    if (data.tipoContratista !== undefined) contratista.tipoContratista = data.tipoContratista;
    if (data.estado !== undefined) contratista.estado = data.estado;
    if (data.numeroContrato !== undefined) contratista.numeroContrato = data.numeroContrato;
    if (data.cargo !== undefined) contratista.cargo = data.cargo;
    if (data.objetivoContrato !== undefined) contratista.objetivoContrato = data.objetivoContrato;  // ✅ CAMBIADO
    if (data.observaciones !== undefined) contratista.objetivoContrato = data.observaciones; // Compatibilidad con datos antiguos

    const updated = await this.contratistaRepository.save(contratista);
    this.logger.log(`✅ Contratista actualizado: ${updated.id}`);
    return updated;
  } catch (error) {
    this.logger.error(`❌ Error actualizando contratista: ${error.message}`);
    throw error;
  }
}

// CORREGIR el método obtenerTodos
async obtenerTodos(options?: { limit?: number; offset?: number }): Promise<Contratista[]> {
  try {
    const queryOptions: any = {
      order: { estado: 'DESC', razonSocial: 'ASC' },
      relations: ['documentos'],
      select: [
        'id', 'tipoDocumento', 'documentoIdentidad', 'razonSocial',
        'representanteLegal', 'documentoRepresentante', 'telefono', 'email',
        'direccion', 'departamento', 'ciudad', 'tipoContratista', 'estado',
        'numeroContrato', 'cargo', 'objetivoContrato', 'createdAt', 'updatedAt'  // ✅ CAMBIADO
      ]
    };

    if (options?.limit) queryOptions.take = options.limit;
    if (options?.offset) queryOptions.skip = options.offset;

    const contratistas = await this.contratistaRepository.find(queryOptions);
    return contratistas.map(contratista => ({
      ...contratista,
      documentosCount: contratista.documentos?.length || 0,
      documentos: undefined
    })) as any;
  } catch (error) {
    this.logger.error(`❌ Error obteniendo todos los contratistas: ${error.message}`);
    throw error;
  }
}

  async crearConDocumentos(
    data: any,
    documentos?: Array<{ tipo: TipoDocumento; archivo: Express.Multer.File }>,
    usuario?: string
  ): Promise<{ contratista: Contratista; documentos: DocumentoContratista[] }> {
    try {
      const contratista = await this.crear(data);
      const documentosSubidos: DocumentoContratista[] = [];

      if (documentos && documentos.length > 0) {
        for (const doc of documentos) {
          try {
            const docSubido = await this.subirDocumento(contratista.id, doc.tipo, doc.archivo, usuario || 'sistema');
            documentosSubidos.push(docSubido);
          } catch (error) {
            this.logger.error(`Error subiendo documento ${doc.tipo}: ${error.message}`);
          }
        }
      }

      return { contratista, documentos: documentosSubidos };
    } catch (error) {
      this.logger.error(`❌ Error creando contratista con documentos: ${error.message}`);
      throw error;
    }
  }


  async actualizarConDocumentos(
    id: string,
    data: any,
    documentos?: Array<{ tipo: TipoDocumento; archivo: Express.Multer.File }>,
    usuario?: string
  ): Promise<{ contratistaOriginal: Contratista; contratistaNuevo: Contratista; documentos: DocumentoContratista[] }> {
    const contratistaOriginal = await this.buscarPorId(id);
    const contratistaNuevo = await this.actualizar(id, data);

    const documentosSubidos: DocumentoContratista[] = [];
    if (documentos && documentos.length > 0) {
      for (const doc of documentos) {
        try {
          const docSubido = await this.subirDocumento(contratistaNuevo.id, doc.tipo, doc.archivo, usuario || 'sistema');
          documentosSubidos.push(docSubido);
        } catch (error) {
          this.logger.error(`Error subiendo documento ${doc.tipo}: ${error.message}`);
        }
      }
    }

    const documentosActualizados = await this.obtenerDocumentos(contratistaNuevo.id);
    return {
      contratistaOriginal,
      contratistaNuevo,
      documentos: [...documentosActualizados, ...documentosSubidos]
    };
  }

  async existePorDocumento(documentoIdentidad: string): Promise<boolean> {
    try {
      const count = await this.contratistaRepository.count({
        where: { documentoIdentidad, estado: 'ACTIVO' },
      });
      return count > 0;
    } catch (error) {
      this.logger.error(`❌ Error verificando documento: ${error.message}`);
      return false;
    }
  }

  async obtenerEstadisticas(): Promise<EstadisticasContratista> {
    try {
      const total = await this.contratistaRepository.count({ where: { estado: 'ACTIVO' } });
      const fechaLimite = new Date();
      fechaLimite.setMonth(fechaLimite.getMonth() - 1);
      const ultimoMes = await this.contratistaRepository
        .createQueryBuilder('contratista')
        .where('contratista.createdAt >= :fechaLimite', { fechaLimite })
        .andWhere('contratista.estado = :estado', { estado: 'ACTIVO' })
        .getCount();
      return { total, ultimoMes, porTipoDocumento: [] };
    } catch (error) {
      this.logger.error(`❌ Error obteniendo estadísticas: ${error.message}`);
      return { total: 0, ultimoMes: 0, porTipoDocumento: [] };
    }
  }

  async obtenerRecientes(limit: number = 10): Promise<Contratista[]> {
    try {
      return await this.contratistaRepository.find({
        where: { estado: 'ACTIVO' },
        relations: ['documentos'],
        order: { createdAt: 'DESC' },
        take: limit
      });
    } catch (error) {
      this.logger.error(`❌ Error obteniendo contratistas recientes: ${error.message}`);
      return [];
    }
  }
}