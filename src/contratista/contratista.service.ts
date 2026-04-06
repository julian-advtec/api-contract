// src/contratista/contratista.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { Contratista } from './entities/contratista.entity';
import { DocumentoContratista, TipoDocumento } from './entities/documento-contratista.entity';
import { StorageService } from '../common/storage/storage.service';
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
    private readonly storageService: StorageService,
  ) {
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

      if (filtros.limit) {
        query.take(filtros.limit);
      }
      if (filtros.offset) {
        query.skip(filtros.offset);
      }

      query.orderBy('c.razonSocial', 'ASC');

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
      // Ordenar: primero ACTIVOS, luego INACTIVOS, luego SUSPENDIDOS
      order: { 
        estado: 'DESC',  // ACTIVO (valor más alto) va primero
        razonSocial: 'ASC' 
      },
      relations: ['documentos'],
      select: [
        'id',
        'tipoDocumento',
        'documentoIdentidad',
        'razonSocial',
        'representanteLegal',
        'documentoRepresentante',
        'telefono',
        'email',
        'direccion',
        'departamento',
        'ciudad',
        'tipoContratista',
        'estado',
        'numeroContrato',
        'cargo',
        'observaciones',
        'createdAt',
        'updatedAt'
      ]
    };

    if (options?.limit) {
      queryOptions.take = options.limit;
    }
    if (options?.offset) {
      queryOptions.skip = options.offset;
    }

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
    if (!documentoIdentidad || documentoIdentidad.trim().length < 1) {
      return [];
    }

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

  // ===============================
  // CREAR CONTRATISTA
  // ===============================

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
    observaciones?: string;
  }): Promise<Contratista> {
    try {
      this.logger.log('📝 Creando contratista con datos:', JSON.stringify(data, null, 2));

      if (!data.documentoIdentidad || !data.razonSocial) {
        throw new BadRequestException('Documento de identidad y razón social son requeridos');
      }

      if (data.documentoIdentidad.length < 3) {
        throw new BadRequestException('El documento debe tener al menos 3 caracteres');
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
      contratista.observaciones = data.observaciones?.trim() ?? null;

      this.logger.log('📦 Contratista a guardar:', JSON.stringify(contratista, null, 2));

      const saved = await this.contratistaRepository.save(contratista);
      this.logger.log(`✅ Contratista creado: ${saved.id} - ${saved.razonSocial}`);

      return saved;
    } catch (error) {
      this.logger.error(`❌ Error creando contratista: ${error.message}`);
      throw error;
    }
  }

  async crearConDocumentos(
    data: {
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
            const docSubido = await this.subirDocumento(
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

  // ===============================
  // ACTUALIZAR CONTRATISTA (SIMPLE)
  // ===============================

  async actualizar(
    id: string,
    data: Partial<{
      tipoDocumento: string;
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
      observaciones?: string;
    }>
  ): Promise<Contratista> {
    try {
      this.logger.log(`✏️ Actualizando contratista ${id} con:`, JSON.stringify(data, null, 2));

      const contratista = await this.buscarPorId(id);

      if (data.documentoIdentidad && data.documentoIdentidad !== contratista.documentoIdentidad) {
        const existente = await this.contratistaRepository.findOne({
          where: { documentoIdentidad: data.documentoIdentidad, estado: 'ACTIVO' },
        });

        if (existente && existente.id !== id) {
          throw new ConflictException(`Ya existe otro contratista activo con el documento ${data.documentoIdentidad}`);
        }
      }

      if (data.documentoIdentidad === '') {
        throw new BadRequestException('El documento de identidad no puede estar vacío');
      }
      if (data.razonSocial === '') {
        throw new BadRequestException('La razón social no puede estar vacía');
      }

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
      if (data.observaciones !== undefined) contratista.observaciones = data.observaciones;

      const updated = await this.contratistaRepository.save(contratista);
      this.logger.log(`✅ Contratista actualizado: ${updated.id}`);

      return updated;
    } catch (error) {
      this.logger.error(`❌ Error actualizando contratista: ${error.message}`);
      throw error;
    }
  }

  // ===============================
  // CREAR NUEVA VERSIÓN (DESACTIVA LA ANTERIOR)
  // ===============================

async crearVersion(id: string, nuevosDatos: any, usuario: string): Promise<Contratista> {
  this.logger.log(`📝 Creando nueva versión del contratista ${id}`);
  
  const original = await this.buscarPorId(id);
  
  // Desactivar el original
  original.estado = 'INACTIVO';
  await this.contratistaRepository.save(original);
  this.logger.log(`✅ Contratista original ${id} desactivado`);
  
  // Crear nuevo contratista con los datos actualizados
  const nuevoContratista = new Contratista();
  nuevoContratista.tipoDocumento = nuevosDatos.tipoDocumento || original.tipoDocumento;
  nuevoContratista.documentoIdentidad = nuevosDatos.documentoIdentidad || original.documentoIdentidad;
  nuevoContratista.razonSocial = nuevosDatos.razonSocial || original.razonSocial;
  nuevoContratista.representanteLegal = nuevosDatos.representanteLegal !== undefined ? nuevosDatos.representanteLegal : original.representanteLegal;
  nuevoContratista.documentoRepresentante = nuevosDatos.documentoRepresentante !== undefined ? nuevosDatos.documentoRepresentante : original.documentoRepresentante;
  nuevoContratista.telefono = nuevosDatos.telefono !== undefined ? nuevosDatos.telefono : original.telefono;
  nuevoContratista.email = nuevosDatos.email !== undefined ? nuevosDatos.email : original.email;
  nuevoContratista.direccion = nuevosDatos.direccion !== undefined ? nuevosDatos.direccion : original.direccion;
  nuevoContratista.departamento = nuevosDatos.departamento !== undefined ? nuevosDatos.departamento : original.departamento;
  nuevoContratista.ciudad = nuevosDatos.ciudad !== undefined ? nuevosDatos.ciudad : original.ciudad;
  nuevoContratista.tipoContratista = nuevosDatos.tipoContratista !== undefined ? nuevosDatos.tipoContratista : original.tipoContratista;
  nuevoContratista.estado = 'ACTIVO';
  nuevoContratista.numeroContrato = nuevosDatos.numeroContrato !== undefined ? nuevosDatos.numeroContrato : original.numeroContrato;
  nuevoContratista.cargo = nuevosDatos.cargo !== undefined ? nuevosDatos.cargo : original.cargo;
  nuevoContratista.observaciones = nuevosDatos.observaciones !== undefined ? nuevosDatos.observaciones : original.observaciones;
  
  // Agregar sufijo al documento para evitar duplicado
  nuevoContratista.documentoIdentidad = `${original.documentoIdentidad}_V${Date.now()}`;
  
  this.logger.log(`📦 Nuevo documento: ${nuevoContratista.documentoIdentidad} (original: ${original.documentoIdentidad})`);
  
  const saved = await this.contratistaRepository.save(nuevoContratista);
  this.logger.log(`✅ Nueva versión creada: ${saved.id}`);
  
  // Copiar documentos del original al nuevo contratista - ACTUALIZANDO LA RUTA
  const documentosOriginales = await this.obtenerDocumentos(id);
  this.logger.log(`📎 Copiando ${documentosOriginales.length} documentos a la nueva versión`);
  
  for (const doc of documentosOriginales) {
    const nuevoDoc = new DocumentoContratista();
    nuevoDoc.contratistaId = saved.id;
    nuevoDoc.tipo = doc.tipo;
    nuevoDoc.nombreArchivo = doc.nombreArchivo;
    
    // 🔥 CORRECCIÓN: Actualizar la ruta para que apunte al nuevo directorio
    const oldPath = doc.rutaArchivo;
    const newPath = oldPath.replace(id, saved.id);
    
    // Copiar físicamente el archivo al nuevo directorio
    try {
      const oldFullPath = path.join(process.cwd(), oldPath);
      const newFullPath = path.join(process.cwd(), newPath);
      
      // Crear directorio si no existe
      const newDir = path.dirname(newFullPath);
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true });
        this.logger.log(`📁 Directorio creado: ${newDir}`);
      }
      
      // Copiar archivo
      fs.copyFileSync(oldFullPath, newFullPath);
      this.logger.log(`✅ Archivo copiado: ${oldFullPath} -> ${newFullPath}`);
      
      nuevoDoc.rutaArchivo = newPath;
    } catch (error) {
      this.logger.error(`❌ Error copiando archivo: ${error.message}`);
      // Si no se puede copiar, usar la ruta original (puede que no funcione)
      nuevoDoc.rutaArchivo = doc.rutaArchivo;
    }
    
    nuevoDoc.tipoMime = doc.tipoMime;
    nuevoDoc.tamanoBytes = doc.tamanoBytes;
    nuevoDoc.subidoPor = usuario;
    await this.documentoRepository.save(nuevoDoc);
  }
  
  this.logger.log(`✅ Documentos copiados a la nueva versión`);
  return saved;
}

  // ===============================
  // ACTUALIZAR CON DOCUMENTOS (CREA NUEVA VERSIÓN)
  // ===============================

  async actualizarConDocumentos(
    id: string,
    data: any,
    documentos?: Array<{ tipo: TipoDocumento; archivo: Express.Multer.File }>,
    usuario?: string
  ): Promise<{ contratistaOriginal: Contratista; contratistaNuevo: Contratista; documentos: DocumentoContratista[] }> {
    this.logger.log(`📝 Actualizando contratista ${id} - Creando nueva versión`);
    
    // Crear nueva versión del contratista
    const nuevoContratista = await this.crearVersion(id, data, usuario || 'sistema');
    
    // Subir documentos nuevos a la nueva versión
    const documentosSubidos: DocumentoContratista[] = [];
    if (documentos && documentos.length > 0) {
      for (const doc of documentos) {
        try {
          const docSubido = await this.subirDocumento(nuevoContratista.id, doc.tipo, doc.archivo, usuario || 'sistema');
          documentosSubidos.push(docSubido);
          this.logger.log(`✅ Documento subido a nueva versión: ${doc.tipo}`);
        } catch (error) {
          this.logger.error(`Error subiendo documento ${doc.tipo}: ${error.message}`);
        }
      }
    }
    
    const contratistaOriginal = await this.buscarPorId(id);
    const documentosActualizados = await this.obtenerDocumentos(nuevoContratista.id);
    
    return {
      contratistaOriginal,
      contratistaNuevo: nuevoContratista,
      documentos: [...documentosActualizados, ...documentosSubidos]
    };
  }

  // ===============================
  // GESTIÓN DE DOCUMENTOS
  // ===============================

  async subirDocumento(
    contratistaId: string,
    tipo: TipoDocumento,
    archivo: Express.Multer.File,
    usuario: string
  ): Promise<DocumentoContratista> {
    try {
      await this.buscarPorId(contratistaId);

      const extension = path.extname(archivo.originalname).toLowerCase();
      const nombreUnico = `${tipo}_${Date.now()}${extension}`;
      const relativePath = `contratistas/${contratistaId}/${nombreUnico}`;

      const result = await this.storageService.uploadFile(
        relativePath,
        archivo.buffer,
        archivo.mimetype
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
      this.logger.log(`✅ Documento subido: ${tipo} para contratista ${contratistaId}`);

      return saved;
    } catch (error) {
      this.logger.error(`❌ Error subiendo documento: ${error.message}`);
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

 async descargarDocumento(documentoId: string, contratistaId: string): Promise<{ buffer: Buffer; nombre: string; mimeType: string }> {
  const documento = await this.obtenerDocumentoPorId(documentoId, contratistaId);
  
  this.logger.log(`📥 Buscando archivo en: ${documento.rutaArchivo}`);
  
  // Verificar si el archivo existe en la ruta actual
  let existe = await this.storageService.fileExists(documento.rutaArchivo);
  
  // Si no existe, intentar buscar en la ruta del contratista original
  if (!existe && documento.rutaArchivo.includes('/')) {
    // Extraer el ID original de la ruta
    const pathParts = documento.rutaArchivo.split('/');
    const oldContratistaId = pathParts[1];
    
    // Intentar con la ruta original
    const originalPath = documento.rutaArchivo.replace(contratistaId, oldContratistaId);
    existe = await this.storageService.fileExists(originalPath);
    
    if (existe) {
      this.logger.log(`✅ Archivo encontrado en ruta original: ${originalPath}`);
      documento.rutaArchivo = originalPath;
    }
  }
  
  if (!existe) {
    this.logger.error(`❌ Archivo no encontrado en ninguna ruta: ${documento.rutaArchivo}`);
    throw new NotFoundException(`Archivo no encontrado: ${documento.nombreArchivo}`);
  }

  const url = this.storageService.getFileUrl(documento.rutaArchivo);
  let buffer: Buffer;

  if (url.startsWith('http')) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } else {
    buffer = fs.readFileSync(documento.rutaArchivo);
  }

  return {
    buffer,
    nombre: documento.nombreArchivo,
    mimeType: documento.tipoMime || 'application/octet-stream',
  };
}

  async eliminarDocumento(documentoId: string, contratistaId: string): Promise<void> {
    try {
      const documento = await this.obtenerDocumentoPorId(documentoId, contratistaId);

      await this.storageService.deleteFile(documento.rutaArchivo);
      await this.documentoRepository.delete(documentoId);

      this.logger.log(`✅ Documento eliminado: ${documentoId}`);
    } catch (error) {
      this.logger.error(`❌ Error eliminando documento: ${error.message}`);
      throw error;
    }
  }

  // ===============================
  // BÚSQUEDAS
  // ===============================

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



  async buscarPorRazonSocial(razonSocial: string): Promise<Contratista[]> {
    try {
      if (!razonSocial || razonSocial.trim().length < 1) {
        return [];
      }

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
      if (!numeroContrato || numeroContrato.trim().length < 1) {
        return [];
      }

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
      where: { documentoIdentidad, estado: 'ACTIVO' }, // Solo verifica activos
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