// src/rendicion-cuentas/rendicion-cuentas.service.ts
import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Between } from 'typeorm';

import { RendicionCuentasDocumento } from './entities/rendicion-cuentas-documento.entity';
import { RendicionCuentasHistorial } from './entities/rendicion-cuentas-historial.entity';
import { RendicionCuentasEstado } from './entities/rendicion-cuentas-estado.enum';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';

import {
  CreateRendicionCuentasDto,
  AsignarRendicionCuentasDto,
  IniciarRevisionDto,
  TomarDecisionDto,
  CompletarDto,
  FiltrosRendicionCuentasDto,
} from './dto/rendicion-cuentas.dto';

@Injectable()
export class RendicionCuentasService {
  private readonly logger = new Logger(RendicionCuentasService.name);

  constructor(
    @InjectRepository(RendicionCuentasDocumento)
    private documentoRepo: Repository<RendicionCuentasDocumento>,
    @InjectRepository(RendicionCuentasHistorial)
    private historialRepo: Repository<RendicionCuentasHistorial>,
    @InjectRepository(Documento)
    private documentoRadicacionRepo: Repository<Documento>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async create(createDto: CreateRendicionCuentasDto, usuario: User): Promise<RendicionCuentasDocumento> {
    const documento = await this.documentoRadicacionRepo.findOne({
      where: { id: createDto.documentoId }
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    const existe = await this.documentoRepo.findOne({
      where: { documentoId: createDto.documentoId }
    });

    if (existe) {
      throw new BadRequestException('El documento ya está en rendición de cuentas');
    }

    const rendicionDocumento = new RendicionCuentasDocumento();
    rendicionDocumento.documentoId = createDto.documentoId;
    rendicionDocumento.estado = RendicionCuentasEstado.PENDIENTE;
    rendicionDocumento.responsableId = createDto.responsableId || null;
    rendicionDocumento.fechaAsignacion = createDto.responsableId ? new Date() : null;

    const saved = await this.documentoRepo.save(rendicionDocumento);
    
    await this.registrarHistorial({
      documentoId: saved.id,
      usuarioId: usuario.id,
      estadoAnterior: null,
      estadoNuevo: saved.estado,
      accion: 'CREAR',
      observacion: createDto.responsableId ? `Documento asignado` : 'Documento agregado a rendición de cuentas',
    });

    return this.findOne(saved.id);
  }

  async asignar(id: string, asignarDto: AsignarRendicionCuentasDto, usuario: User): Promise<RendicionCuentasDocumento> {
    const documento = await this.findOne(id);

    const responsable = await this.userRepo.findOne({
      where: { id: asignarDto.responsableId }
    });

    if (!responsable) {
      throw new NotFoundException('Responsable no encontrado');
    }

    if (documento.estado !== RendicionCuentasEstado.PENDIENTE) {
      throw new BadRequestException('Solo se pueden asignar documentos en estado PENDIENTE');
    }

    const estadoAnterior = documento.estado;

    documento.responsableId = asignarDto.responsableId;
    documento.fechaAsignacion = new Date();

    const updated = await this.documentoRepo.save(documento);

    const getNombreResponsable = (user: User): string => {
      try {
        if (user && typeof user === 'object') {
          const anyUser = user as any;
          return anyUser.nombreCompleto || 
                 anyUser.fullName || 
                 anyUser.name || 
                 anyUser.username || 
                 anyUser.email || 
                 `Usuario-${anyUser.id || ''}`;
        }
      } catch (e) {}
      return 'Usuario';
    };

    await this.registrarHistorial({
      documentoId: id,
      usuarioId: usuario.id,
      estadoAnterior,
      estadoNuevo: documento.estado,
      accion: 'ASIGNAR',
      observacion: `Documento asignado a ${getNombreResponsable(responsable)}`,
    });

    return updated;
  }

  async iniciarRevision(id: string, iniciarDto: IniciarRevisionDto, usuario: User): Promise<RendicionCuentasDocumento> {
    const documento = await this.findOne(id);

    this.verificarAcceso(documento, usuario);

    if (!documento.puedeIniciarRevision()) {
      throw new BadRequestException('No se puede iniciar revisión en este estado');
    }

    const estadoAnterior = documento.estado;

    documento.estado = RendicionCuentasEstado.EN_REVISION;
    documento.fechaInicioRevision = new Date();

    const updated = await this.documentoRepo.save(documento);

    await this.registrarHistorial({
      documentoId: id,
      usuarioId: usuario.id,
      estadoAnterior,
      estadoNuevo: documento.estado,
      accion: 'INICIAR_REVISION',
      observacion: iniciarDto.observacion,
    });

    return updated;
  }

  async tomarDecision(id: string, decisionDto: TomarDecisionDto, usuario: User): Promise<RendicionCuentasDocumento> {
    const documento = await this.findOne(id);

    this.verificarAcceso(documento, usuario);

    if (!documento.puedeTomarDecision()) {
      throw new BadRequestException('No se puede tomar decisión en este estado');
    }

    const estadoAnterior = documento.estado;

    documento.estado = decisionDto.decision;
    documento.fechaDecision = new Date();
    documento.observaciones = decisionDto.observacion || null;

    const updated = await this.documentoRepo.save(documento);

    await this.registrarHistorial({
      documentoId: id,
      usuarioId: usuario.id,
      estadoAnterior,
      estadoNuevo: documento.estado,
      accion: decisionDto.decision,
      observacion: decisionDto.observacion,
    });

    return updated;
  }

  async completar(id: string, completarDto: CompletarDto, usuario: User): Promise<RendicionCuentasDocumento> {
    const documento = await this.findOne(id);

    this.verificarAcceso(documento, usuario, true);

    if (![RendicionCuentasEstado.APROBADO, RendicionCuentasEstado.OBSERVADO, RendicionCuentasEstado.RECHAZADO].includes(documento.estado)) {
      throw new BadRequestException('Solo documentos con decisión pueden ser completados');
    }

    const estadoAnterior = documento.estado;

    documento.estado = RendicionCuentasEstado.COMPLETADO;

    const updated = await this.documentoRepo.save(documento);

    await this.registrarHistorial({
      documentoId: id,
      usuarioId: usuario.id,
      estadoAnterior,
      estadoNuevo: documento.estado,
      accion: 'COMPLETAR',
      observacion: completarDto.observacion,
    });

    return updated;
  }

  async findAll(filtros?: FiltrosRendicionCuentasDto): Promise<{ data: RendicionCuentasDocumento[]; total: number }> {
    const query = this.documentoRepo.createQueryBuilder('rcd')
      .leftJoinAndSelect('rcd.documento', 'doc')
      .leftJoinAndSelect('rcd.responsable', 'user');

    if (filtros?.estados?.length) {
      query.andWhere('rcd.estado IN (:...estados)', { estados: filtros.estados });
    }

    if (filtros?.responsableId) {
      query.andWhere('rcd.responsableId = :responsableId', { responsableId: filtros.responsableId });
    }

    if (filtros?.desde) {
      query.andWhere('rcd.fechaCreacion >= :desde', { desde: new Date(filtros.desde) });
    }

    if (filtros?.hasta) {
      query.andWhere('rcd.fechaCreacion <= :hasta', { hasta: new Date(filtros.hasta) });
    }

    const [data, total] = await query
      .orderBy('rcd.fechaCreacion', 'DESC')
      .skip(filtros?.offset || 0)
      .take(filtros?.limit || 100)
      .getManyAndCount();

    return { data, total };
  }

  async findMisDocumentos(usuario: User, filtros?: {
    estados?: RendicionCuentasEstado[];
    desde?: Date;
    hasta?: Date;
  }): Promise<RendicionCuentasDocumento[]> {
    const query = this.documentoRepo.createQueryBuilder('rcd')
      .leftJoinAndSelect('rcd.documento', 'doc')
      .where('rcd.responsableId = :userId', { userId: usuario.id });

    if (filtros?.estados?.length) {
      query.andWhere('rcd.estado IN (:...estados)', { estados: filtros.estados });
    }

    if (filtros?.desde) {
      query.andWhere('rcd.fechaCreacion >= :desde', { desde: filtros.desde });
    }

    if (filtros?.hasta) {
      query.andWhere('rcd.fechaCreacion <= :hasta', { hasta: filtros.hasta });
    }

    return query
      .orderBy('rcd.fechaCreacion', 'DESC')
      .getMany();
  }

  async findPendientes(usuario: User): Promise<RendicionCuentasDocumento[]> {
    return this.documentoRepo.find({
      where: [
        { estado: RendicionCuentasEstado.PENDIENTE },
        { estado: RendicionCuentasEstado.EN_REVISION, responsableId: usuario.id }
      ],
      relations: ['documento', 'responsable'],
      order: { fechaCreacion: 'DESC' },
    });
  }

  async findOne(id: string): Promise<RendicionCuentasDocumento> {
    const documento = await this.documentoRepo.findOne({
      where: { id },
      relations: ['documento', 'responsable'],
    });

    if (!documento) {
      throw new NotFoundException('Documento de rendición de cuentas no encontrado');
    }

    return documento;
  }

  async findHistorial(id: string): Promise<RendicionCuentasHistorial[]> {
    return this.historialRepo.find({
      where: { documentoId: id },
      relations: ['usuario'],
      order: { fechaCreacion: 'DESC' },
    });
  }

  async obtenerEstadisticas(usuario: User, filtros?: { desde?: Date; hasta?: Date }) {
    const desde = filtros?.desde || new Date(new Date().setMonth(new Date().getMonth() - 1));
    const hasta = filtros?.hasta || new Date();

    const documentosPorEstado = await this.documentoRepo
      .createQueryBuilder('rcd')
      .select('rcd.estado', 'estado')
      .addSelect('COUNT(rcd.id)', 'cantidad')
      .where('rcd.fechaCreacion BETWEEN :desde AND :hasta', { desde, hasta })
      .groupBy('rcd.estado')
      .getRawMany();

    const misPendientes = await this.documentoRepo.count({
      where: {
        responsableId: usuario.id,
        estado: In([RendicionCuentasEstado.PENDIENTE, RendicionCuentasEstado.EN_REVISION]),
      },
    });

    const aprobados = this.obtenerConteo(documentosPorEstado, RendicionCuentasEstado.APROBADO);
    const observados = this.obtenerConteo(documentosPorEstado, RendicionCuentasEstado.OBSERVADO);
    const rechazados = this.obtenerConteo(documentosPorEstado, RendicionCuentasEstado.RECHAZADO);

    const docsConDecision = await this.documentoRepo
      .createQueryBuilder('rcd')
      .where('rcd.estado IN (:...estados)', {
        estados: [RendicionCuentasEstado.APROBADO, RendicionCuentasEstado.OBSERVADO, RendicionCuentasEstado.RECHAZADO]
      })
      .andWhere('rcd.fechaDecision IS NOT NULL')
      .andWhere('rcd.fechaInicioRevision IS NOT NULL')
      .andWhere('rcd.fechaCreacion BETWEEN :desde AND :hasta', { desde, hasta })
      .getMany();

    let tiempoPromedioHoras = 0;
    if (docsConDecision.length > 0) {
      const tiempos = docsConDecision
        .map(d => {
          if (d.fechaInicioRevision && d.fechaDecision) {
            return d.fechaDecision.getTime() - d.fechaInicioRevision.getTime();
          }
          return 0;
        })
        .filter(t => t > 0);
      
      if (tiempos.length > 0) {
        tiempoPromedioHoras = tiempos.reduce((sum, t) => sum + t, 0) / tiempos.length / (1000 * 60 * 60);
      }
    }

    const total = documentosPorEstado.reduce((sum, d) => sum + Number(d.cantidad), 0);

    return {
      resumen: {
        total,
        pendientes: this.obtenerConteo(documentosPorEstado, RendicionCuentasEstado.PENDIENTE) +
                    this.obtenerConteo(documentosPorEstado, RendicionCuentasEstado.EN_REVISION),
        aprobados,
        observados,
        rechazados,
        completados: this.obtenerConteo(documentosPorEstado, RendicionCuentasEstado.COMPLETADO),
      },
      misMetricas: {
        pendientes: misPendientes,
      },
      rendimiento: {
        tiempoPromedioHoras: Math.round(tiempoPromedioHoras * 10) / 10,
        tasaAprobacion: this.calcularPorcentaje(aprobados, total),
        tasaObservacion: this.calcularPorcentaje(observados, total),
        tasaRechazo: this.calcularPorcentaje(rechazados, total),
      },
      distribucion: documentosPorEstado.map(d => ({
        estado: d.estado,
        cantidad: Number(d.cantidad),
        porcentaje: this.calcularPorcentaje(Number(d.cantidad), total),
        color: this.getColorPorEstado(d.estado),
      })),
    };
  }

  private obtenerConteo(conteos: any[], estado: string): number {
    const encontrado = conteos.find(c => c.estado === estado);
    return encontrado ? Number(encontrado.cantidad) : 0;
  }

  private calcularPorcentaje(valor: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((valor / total) * 1000) / 10;
  }

  private getColorPorEstado(estado: string): string {
    const colores: Record<string, string> = {
      [RendicionCuentasEstado.PENDIENTE]: '#FFC107',
      [RendicionCuentasEstado.EN_REVISION]: '#2196F3',
      [RendicionCuentasEstado.APROBADO]: '#4CAF50',
      [RendicionCuentasEstado.OBSERVADO]: '#FF9800',
      [RendicionCuentasEstado.RECHAZADO]: '#F44336',
      [RendicionCuentasEstado.COMPLETADO]: '#9E9E9E',
    };
    return colores[estado] || '#9E9E9E';
  }

  private async registrarHistorial(data: {
    documentoId: string;
    usuarioId: string;
    estadoAnterior: RendicionCuentasEstado | null;
    estadoNuevo: RendicionCuentasEstado;
    accion: string;
    observacion?: string | null;
  }): Promise<RendicionCuentasHistorial> {
    const historial = new RendicionCuentasHistorial();
    historial.documentoId = data.documentoId;
    historial.usuarioId = data.usuarioId;
    historial.estadoAnterior = data.estadoAnterior;
    historial.estadoNuevo = data.estadoNuevo;
    historial.accion = data.accion;
    historial.observacion = data.observacion || null;

    return this.historialRepo.save(historial);
  }

  private verificarAcceso(
    documento: RendicionCuentasDocumento,
    usuario: User,
    permitirAdminSiempre: boolean = false
  ): void {
    if (usuario.role === UserRole.ADMIN) {
      return;
    }

    if (usuario.role === UserRole.RENDICION_CUENTAS) {
      if (documento.responsableId === usuario.id) {
        return;
      }
      if (documento.estado === RendicionCuentasEstado.PENDIENTE) {
        return;
      }
    }

    if ([UserRole.SUPERVISOR, UserRole.AUDITOR_CUENTAS].includes(usuario.role as UserRole)) {
      return;
    }

    throw new ForbiddenException('No tiene permisos para realizar esta acción');
  }
}