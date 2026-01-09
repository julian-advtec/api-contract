import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Contratista } from './entities/contratista.entity';

@Injectable()
export class ContratistaService {
  constructor(
    @InjectRepository(Contratista)
    private readonly contratistaRepository: Repository<Contratista>,
  ) {}

  /**
   * Obtiene todos los contratistas
   */
  async obtenerTodos(): Promise<Contratista[]> {
    return await this.contratistaRepository.find({
      order: {
        nombreCompleto: 'ASC',
      },
    });
  }

  /**
   * Busca contratistas por término (documento o nombre)
   */
  async buscarPorTermino(termino: string): Promise<Contratista[]> {
    if (!termino || termino.trim() === '') {
      return await this.obtenerTodos();
    }

    return await this.contratistaRepository.find({
      where: [
        { documentoIdentidad: ILike(`%${termino}%`) },
        { nombreCompleto: ILike(`%${termino}%`) },
      ],
      order: {
        nombreCompleto: 'ASC',
      },
    });
  }

  /**
   * Crea un nuevo contratista
   */
  async crear(data: { documentoIdentidad: string; nombreCompleto: string }): Promise<Contratista> {
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
    const contratista = this.contratistaRepository.create({
      documentoIdentidad: data.documentoIdentidad.trim(),
      nombreCompleto: data.nombreCompleto.trim(),
    });

    return await this.contratistaRepository.save(contratista);
  }

  /**
   * Busca un contratista por ID
   */
  async buscarPorId(id: string): Promise<Contratista> {
    const contratista = await this.contratistaRepository.findOne({
      where: { id },
    });

    if (!contratista) {
      throw new NotFoundException(`Contratista con ID ${id} no encontrado`);
    }

    return contratista;
  }

  /**
   * Busca un contratista por documento de identidad
   */
  async buscarPorDocumento(documentoIdentidad: string): Promise<Contratista> {
    const contratista = await this.contratistaRepository.findOne({
      where: { documentoIdentidad },
    });

    if (!contratista) {
      throw new NotFoundException(
        `Contratista con documento ${documentoIdentidad} no encontrado`,
      );
    }

    return contratista;
  }

  /**
   * Actualiza un contratista
   */
  async actualizar(
    id: string,
    data: Partial<{ documentoIdentidad: string; nombreCompleto: string }>,
  ): Promise<Contratista> {
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
    Object.assign(contratista, data);

    return await this.contratistaRepository.save(contratista);
  }

  /**
   * Elimina un contratista
   */
  async eliminar(id: string): Promise<void> {
    const contratista = await this.buscarPorId(id);
    await this.contratistaRepository.remove(contratista);
  }

  /**
   * Verifica si existe un contratista por documento
   */
  async existePorDocumento(documentoIdentidad: string): Promise<boolean> {
    const count = await this.contratistaRepository.count({
      where: { documentoIdentidad },
    });
    return count > 0;
  }

  /**
   * Obtiene estadísticas básicas de contratistas
   */
  async obtenerEstadisticas(): Promise<{
    total: number;
    ultimoMes: number;
  }> {
    const total = await this.contratistaRepository.count();

    // Contratistas creados en el último mes
    const fechaLimite = new Date();
    fechaLimite.setMonth(fechaLimite.getMonth() - 1);

    const ultimoMes = await this.contratistaRepository
      .createQueryBuilder('contratista')
      .where('contratista.createdAt >= :fechaLimite', { fechaLimite })
      .getCount();

    return { total, ultimoMes };
  }
}