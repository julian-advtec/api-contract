// src/radicacion/estados/estados.service.ts
import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Documento } from '../radicacion/entities/documento.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { RegistroAcceso } from '../radicacion/entities/registro-acceso.entity';

export interface FlujoConfig {
  estadoActual: string;
  estadoSiguiente: string;
  rolPermitido: UserRole[];
  mensaje: string;
  requiereObservacion?: boolean;
}

export interface EstadoDocumento {
  codigo: string;
  nombre: string;
  descripcion: string;
  rolesPermitidos: UserRole[];
  puedeDevolver?: boolean;
  tiempoEstimado: number;
}

@Injectable()
export class EstadosService {
  private readonly logger = new Logger(EstadosService.name);

  // CONFIGURACIÓN COMPLETA DEL FLUJO
  private readonly FLUJO_CONFIG: Record<string, FlujoConfig[]> = {
    'RADICADO': [
      {
        estadoActual: 'RADICADO',
        estadoSiguiente: 'EN_REVISION_SUPERVISOR',
        rolPermitido: [UserRole.SUPERVISOR],
        mensaje: 'Documento enviado a revisión por supervisor',
      }
    ],
    'EN_REVISION_SUPERVISOR': [
      {
        estadoActual: 'EN_REVISION_SUPERVISOR',
        estadoSiguiente: 'APROBADO_SUPERVISOR',
        rolPermitido: [UserRole.SUPERVISOR],
        mensaje: 'Documento aprobado por supervisor',
        requiereObservacion: true,
      },
      {
        estadoActual: 'EN_REVISION_SUPERVISOR',
        estadoSiguiente: 'DEVUELTO',
        rolPermitido: [UserRole.SUPERVISOR],
        mensaje: 'Documento devuelto para correcciones',
        requiereObservacion: true,
      }
    ],
    'APROBADO_SUPERVISOR': [
      {
        estadoActual: 'APROBADO_SUPERVISOR',
        estadoSiguiente: 'EN_AUDITORIA_CUENTAS',
        rolPermitido: [UserRole.AUDITOR_CUENTAS],
        mensaje: 'Documento enviado a auditoría de cuentas',
      }
    ],
    'EN_AUDITORIA_CUENTAS': [
      {
        estadoActual: 'EN_AUDITORIA_CUENTAS',
        estadoSiguiente: 'APROBADO_AUDITORIA',
        rolPermitido: [UserRole.AUDITOR_CUENTAS],
        mensaje: 'Documento aprobado en auditoría',
        requiereObservacion: true,
      },
      {
        estadoActual: 'EN_AUDITORIA_CUENTAS',
        estadoSiguiente: 'DEVUELTO',
        rolPermitido: [UserRole.AUDITOR_CUENTAS],
        mensaje: 'Documento devuelto para correcciones',
        requiereObservacion: true,
      }
    ],
    'APROBADO_AUDITORIA': [
      {
        estadoActual: 'APROBADO_AUDITORIA',
        estadoSiguiente: 'EN_CONTABILIDAD',
        rolPermitido: [UserRole.CONTABILIDAD],
        mensaje: 'Documento enviado a contabilidad',
      }
    ],
    'EN_CONTABILIDAD': [
      {
        estadoActual: 'EN_CONTABILIDAD',
        estadoSiguiente: 'APROBADO_CONTABILIDAD',
        rolPermitido: [UserRole.CONTABILIDAD],
        mensaje: 'Documento aprobado por contabilidad',
        requiereObservacion: true,
      },
      {
        estadoActual: 'EN_CONTABILIDAD',
        estadoSiguiente: 'DEVUELTO',
        rolPermitido: [UserRole.CONTABILIDAD],
        mensaje: 'Documento devuelto para correcciones',
        requiereObservacion: true,
      }
    ],
    'APROBADO_CONTABILIDAD': [
      {
        estadoActual: 'APROBADO_CONTABILIDAD',
        estadoSiguiente: 'EN_TESORERIA',
        rolPermitido: [UserRole.TESORERIA],
        mensaje: 'Documento enviado a tesorería',
      }
    ],
    'EN_TESORERIA': [
      {
        estadoActual: 'EN_TESORERIA',
        estadoSiguiente: 'APROBADO_TESORERIA',
        rolPermitido: [UserRole.TESORERIA],
        mensaje: 'Documento aprobado por tesorería',
        requiereObservacion: true,
      },
      {
        estadoActual: 'EN_TESORERIA',
        estadoSiguiente: 'DEVUELTO',
        rolPermitido: [UserRole.TESORERIA],
        mensaje: 'Documento devuelto para correcciones',
        requiereObservacion: true,
      }
    ],
    'APROBADO_TESORERIA': [
      {
        estadoActual: 'APROBADO_TESORERIA',
        estadoSiguiente: 'EN_REVISION_GERENCIA',
        rolPermitido: [UserRole.ASESOR_GERENCIA],
        mensaje: 'Documento enviado a gerencia',
      }
    ],
    'EN_REVISION_GERENCIA': [
      {
        estadoActual: 'EN_REVISION_GERENCIA',
        estadoSiguiente: 'APROBADO_GERENCIA',
        rolPermitido: [UserRole.ASESOR_GERENCIA],
        mensaje: 'Documento aprobado por gerencia',
        requiereObservacion: true,
      },
      {
        estadoActual: 'EN_REVISION_GERENCIA',
        estadoSiguiente: 'DEVUELTO',
        rolPermitido: [UserRole.ASESOR_GERENCIA],
        mensaje: 'Documento devuelto para correcciones',
        requiereObservacion: true,
      }
    ],
    'APROBADO_GERENCIA': [
      {
        estadoActual: 'APROBADO_GERENCIA',
        estadoSiguiente: 'EN_RENDICION_CUENTAS',
        rolPermitido: [UserRole.RENDICION_CUENTAS],
        mensaje: 'Documento enviado a rendición de cuentas',
      }
    ],
    'EN_RENDICION_CUENTAS': [
      {
        estadoActual: 'EN_RENDICION_CUENTAS',
        estadoSiguiente: 'FINALIZADO',
        rolPermitido: [UserRole.RENDICION_CUENTAS],
        mensaje: 'Proceso finalizado exitosamente',
        requiereObservacion: true,
      },
      {
        estadoActual: 'EN_RENDICION_CUENTAS',
        estadoSiguiente: 'DEVUELTO',
        rolPermitido: [UserRole.RENDICION_CUENTAS],
        mensaje: 'Documento devuelto para correcciones',
        requiereObservacion: true,
      }
    ],
    'DEVUELTO': [
      {
        estadoActual: 'DEVUELTO',
        estadoSiguiente: 'RADICADO',
        rolPermitido: [UserRole.RADICADOR, UserRole.ADMIN],
        mensaje: 'Documento corregido y reenviado',
        requiereObservacion: true,
      }
    ],
  };

  // CONFIGURACIÓN DE ESTADOS
  private readonly ESTADOS_CONFIG: EstadoDocumento[] = [
    { codigo: 'RADICADO', nombre: 'Radicado', descripcion: 'Documento radicado inicialmente', rolesPermitidos: [UserRole.RADICADOR, UserRole.ADMIN], tiempoEstimado: 0 },
    { codigo: 'EN_REVISION_SUPERVISOR', nombre: 'En Revisión Supervisor', descripcion: 'En revisión por supervisor', rolesPermitidos: [UserRole.SUPERVISOR], tiempoEstimado: 24 },
    { codigo: 'APROBADO_SUPERVISOR', nombre: 'Aprobado Supervisor', descripcion: 'Aprobado por supervisor', rolesPermitidos: [UserRole.SUPERVISOR], tiempoEstimado: 2 },
    { codigo: 'EN_AUDITORIA_CUENTAS', nombre: 'En Auditoría de Cuentas', descripcion: 'En revisión por auditor de cuentas', rolesPermitidos: [UserRole.AUDITOR_CUENTAS], tiempoEstimado: 48 },
    { codigo: 'APROBADO_AUDITORIA', nombre: 'Aprobado Auditoría', descripcion: 'Aprobado en auditoría de cuentas', rolesPermitidos: [UserRole.AUDITOR_CUENTAS], tiempoEstimado: 2 },
    { codigo: 'EN_CONTABILIDAD', nombre: 'En Contabilidad', descripcion: 'En revisión por contabilidad', rolesPermitidos: [UserRole.CONTABILIDAD], tiempoEstimado: 24 },
    { codigo: 'APROBADO_CONTABILIDAD', nombre: 'Aprobado Contabilidad', descripcion: 'Aprobado por contabilidad', rolesPermitidos: [UserRole.CONTABILIDAD], tiempoEstimado: 2 },
    { codigo: 'EN_TESORERIA', nombre: 'En Tesorería', descripcion: 'En revisión por tesorería', rolesPermitidos: [UserRole.TESORERIA], tiempoEstimado: 24 },
    { codigo: 'APROBADO_TESORERIA', nombre: 'Aprobado Tesorería', descripcion: 'Aprobado por tesorería', rolesPermitidos: [UserRole.TESORERIA], tiempoEstimado: 2 },
    { codigo: 'EN_REVISION_GERENCIA', nombre: 'En Revisión Gerencia', descripcion: 'En revisión por gerencia', rolesPermitidos: [UserRole.ASESOR_GERENCIA], tiempoEstimado: 48 },
    { codigo: 'APROBADO_GERENCIA', nombre: 'Aprobado Gerencia', descripcion: 'Aprobado por gerencia', rolesPermitidos: [UserRole.ASESOR_GERENCIA], tiempoEstimado: 2 },
    { codigo: 'EN_RENDICION_CUENTAS', nombre: 'En Rendición de Cuentas', descripcion: 'En proceso de rendición de cuentas', rolesPermitidos: [UserRole.RENDICION_CUENTAS], tiempoEstimado: 24 },
    { codigo: 'FINALIZADO', nombre: 'Finalizado', descripcion: 'Proceso finalizado exitosamente', rolesPermitidos: [UserRole.RENDICION_CUENTAS], tiempoEstimado: 0 },
    { codigo: 'DEVUELTO', nombre: 'Devuelto', descripcion: 'Devuelto para correcciones', rolesPermitidos: [UserRole.RADICADOR, UserRole.ADMIN], tiempoEstimado: 72 },
  ];

  constructor(
    @InjectRepository(Documento)
    private documentoRepository: Repository<Documento>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(RegistroAcceso)
    private registroAccesoRepository: Repository<RegistroAcceso>,
  ) {}

  // MÉTODO PÚBLICO - CORREGIDO
  public async obtenerEstadosPermitidosPorRol(userRole: UserRole): Promise<string[]> {
    const estados: string[] = [];
    
    for (const estado of this.ESTADOS_CONFIG) {
      if (estado.rolesPermitidos.includes(userRole)) {
        estados.push(estado.codigo);
      }
    }
    
    return estados;
  }

  // Método corregido para obtener documentos por estado
  async obtenerDocumentosPorEstado(user: User, estado?: string): Promise<Documento[]> {
    const estadosPermitidos = await this.obtenerEstadosPermitidosPorRol(user.role as UserRole);
    
    if (estado && !estadosPermitidos.includes(estado)) {
      throw new ForbiddenException(`No tienes permisos para ver documentos en estado ${estado}`);
    }

    const estadosFiltro = estado ? [estado] : estadosPermitidos;

    // USAR In() para array de estados - CORREGIDO
    return this.documentoRepository.find({
      where: {
        estado: In(estadosFiltro) // ✅ Usa In() para array
      },
      relations: ['radicador', 'usuarioAsignado'],
      order: { fechaRadicacion: 'DESC' },
    });
  }

  async obtenerDocumentosAsignados(user: User): Promise<Documento[]> {
    this.logger.log(`📋 Usuario ${user.username} solicitando documentos asignados`);

    const query = this.documentoRepository
      .createQueryBuilder('documento')
      .leftJoinAndSelect('documento.radicador', 'radicador')
      .leftJoinAndSelect('documento.usuarioAsignado', 'usuarioAsignado')
      .where('documento.estado NOT IN (:...estadosFinales)', {
        estadosFinales: ['FINALIZADO']
      });

    if (user.role === UserRole.ADMIN) {
      return query.orderBy('documento.fechaRadicacion', 'DESC').getMany();
    }

    if (user.role === UserRole.RADICADOR) {
      query.andWhere('documento.radicador.id = :userId', { userId: user.id });
    } else {
      query.andWhere('documento.usuarioAsignado.id = :userId', { userId: user.id });
    }

    return query.orderBy('documento.fechaRadicacion', 'DESC').getMany();
  }

  async avanzarEstado(
    documentoId: string,
    estadoSiguiente: string,
    user: User,
    observacion?: string,
  ): Promise<Documento> {
    this.logger.log(`➡️ Usuario ${user.username} avanzando documento ${documentoId} a ${estadoSiguiente}`);

    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId },
      relations: ['usuarioAsignado', 'radicador'],
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    // VERIFICAR PERMISOS
    this.verificarPermisosEstado(documento, user, estadoSiguiente);

    // OBTENER CONFIGURACIÓN DEL FLUJO
    const flujoConfig = this.obtenerFlujoConfig(documento.estado, estadoSiguiente, user.role as UserRole);
    
    if (!flujoConfig) {
      throw new BadRequestException(`Transición no permitida de ${documento.estado} a ${estadoSiguiente}`);
    }

    // VALIDAR OBSERVACIÓN SI ES REQUERIDA
    if (flujoConfig.requiereObservacion && (!observacion || observacion.trim() === '')) {
      throw new BadRequestException('Se requiere una observación para este cambio de estado');
    }

    // ACTUALIZAR DOCUMENTO
    const estadoAnterior = documento.estado;
    documento.estado = estadoSiguiente;
    documento.fechaActualizacion = new Date();
    
    if (observacion) {
      documento.comentarios = observacion;
    }

    // ASIGNAR NUEVO USUARIO SI CORRESPONDE
    if (estadoSiguiente !== 'DEVUELTO') {
      const nuevoUsuario = await this.asignarUsuarioPorEstado(estadoSiguiente);
      if (nuevoUsuario) {
        documento.usuarioAsignado = nuevoUsuario;
        documento.usuarioAsignadoNombre = nuevoUsuario.fullName || nuevoUsuario.username;
      }
    } else {
      // DEVUELTO: asignar al radicador original
      documento.usuarioAsignado = documento.radicador;
      documento.usuarioAsignadoNombre = documento.nombreRadicador;
    }

    // AGREGAR AL HISTORIAL
    this.agregarAlHistorial(documento, user, estadoAnterior, estadoSiguiente, observacion);

    // GUARDAR REGISTRO DE ACCESO
    await this.guardarRegistroAcceso(
      documento,
      user,
      'CAMBIAR_ESTADO',
      `De ${estadoAnterior} a ${estadoSiguiente}: ${observacion || flujoConfig.mensaje}`
    );

    const documentoActualizado = await this.documentoRepository.save(documento);
    
    this.logger.log(`✅ Documento ${documento.numeroRadicado} cambiado de ${estadoAnterior} a ${estadoSiguiente}`);
    
    return documentoActualizado;
  }

  async devolverDocumento(
    documentoId: string,
    user: User,
    motivo: string,
    instruccionesCorreccion: string,
  ): Promise<Documento> {
    this.logger.log(`↩️ Usuario ${user.username} devolviendo documento ${documentoId}`);

    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId },
      relations: ['radicador'],
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    // VERIFICAR QUE EL USUARIO PUEDE DEVOLVER
    const puedeDevolver = this.puedeDevolverEstado(documento.estado, user.role as UserRole);
    if (!puedeDevolver) {
      throw new ForbiddenException(`No puedes devolver documentos en estado ${documento.estado}`);
    }

    // CAMBIAR A ESTADO DEVUELTO
    return this.avanzarEstado(
      documentoId,
      'DEVUELTO',
      user,
      `DEVUELTO: ${motivo}. Instrucciones: ${instruccionesCorreccion}`
    );
  }

  async corregirDocumento(
    documentoId: string,
    user: User,
    observacion: string,
  ): Promise<Documento> {
    this.logger.log(`🔧 Usuario ${user.username} corrigiendo documento ${documentoId}`);

    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId },
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    // VERIFICAR QUE ESTÁ DEVUELTO
    if (documento.estado !== 'DEVUELTO') {
      throw new BadRequestException('El documento no está en estado DEVUELTO');
    }

    // VERIFICAR QUE ES EL RADICADOR O ADMIN
    if (documento.radicador.id !== user.id && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Solo el radicador original puede corregir este documento');
    }

    // VOLVER A RADICADO
    return this.avanzarEstado(
      documentoId,
      'RADICADO',
      user,
      `CORREGIDO: ${observacion}`
    );
  }

  async obtenerHistorial(documentoId: string, user: User): Promise<any> {
    const documento = await this.documentoRepository.findOne({
      where: { id: documentoId },
    });

    if (!documento) {
      throw new NotFoundException('Documento no encontrado');
    }

    // VERIFICAR ACCESO
    await this.verificarAccesoDocumento(documento, user);

    const registrosAcceso = await this.registroAccesoRepository.find({
      where: { documentoId },
      order: { fechaAcceso: 'DESC' },
      take: 50,
    });

    return {
      documento: {
        id: documento.id,
        numeroRadicado: documento.numeroRadicado,
        estado: documento.estado,
        radicador: documento.nombreRadicador,
        usuarioAsignado: documento.usuarioAsignadoNombre,
      },
      historial: documento.historialEstados || [],
      registrosAcceso,
      configuracionEstados: this.ESTADOS_CONFIG,
    };
  }

  async obtenerEstadisticas(user: User): Promise<any> {
    const totalDocumentos = await this.documentoRepository.count();
    
    const documentosPorEstado = await this.documentoRepository
      .createQueryBuilder('documento')
      .select('documento.estado', 'estado')
      .addSelect('COUNT(*)', 'cantidad')
      .groupBy('documento.estado')
      .getRawMany();

    const misDocumentos = await this.obtenerDocumentosAsignados(user);
    
    const tiempoPromedio = await this.calcularTiempoPromedio();

    return {
      usuario: {
        nombre: user.fullName || user.username,
        rol: user.role,
        documentosAsignados: misDocumentos.length,
      },
      general: {
        totalDocumentos,
        documentosPorEstado,
        tiempoPromedioFinalizacion: tiempoPromedio,
      },
      misEstadisticas: {
        pendientes: misDocumentos.filter(d => d.estado !== 'FINALIZADO').length,
        finalizados: misDocumentos.filter(d => d.estado === 'FINALIZADO').length,
        devueltos: misDocumentos.filter(d => d.estado === 'DEVUELTO').length,
      },
    };
  }

  obtenerConfiguracionFlujo(): any {
    return {
      estados: this.ESTADOS_CONFIG,
      flujos: this.FLUJO_CONFIG,
    };
  }

  // MÉTODOS AUXILIARES PRIVADOS
  private verificarPermisosEstado(documento: Documento, user: User, estadoSiguiente: string): void {
    const userRole = user.role as UserRole;
    
    // ADMIN puede todo
    if (userRole === UserRole.ADMIN) return;

    // RADICADOR solo puede corregir documentos devueltos
    if (userRole === UserRole.RADICADOR) {
      if (documento.estado === 'DEVUELTO' && estadoSiguiente === 'RADICADO') {
        return;
      }
      throw new ForbiddenException('Solo puedes corregir documentos devueltos');
    }

    // VERIFICAR QUE EL USUARIO ESTÉ ASIGNADO
    if (documento.usuarioAsignado?.id !== user.id) {
      throw new ForbiddenException('No estás asignado a este documento');
    }

    // VERIFICAR QUE EL ROL PUEDE REALIZAR LA TRANSICIÓN
    const flujoConfig = this.obtenerFlujoConfig(documento.estado, estadoSiguiente, userRole);
    if (!flujoConfig) {
      throw new ForbiddenException(
        `Tu rol ${userRole} no puede cambiar de ${documento.estado} a ${estadoSiguiente}`
      );
    }
  }

  private obtenerFlujoConfig(estadoActual: string, estadoSiguiente: string, userRole: UserRole): FlujoConfig | null {
    const flujos = this.FLUJO_CONFIG[estadoActual];
    if (!flujos) return null;

    return flujos.find(flujo => 
      flujo.estadoSiguiente === estadoSiguiente && 
      flujo.rolPermitido.includes(userRole)
    ) || null;
  }

  private puedeDevolverEstado(estado: string, userRole: UserRole): boolean {
    const flujos = this.FLUJO_CONFIG[estado];
    if (!flujos) return false;

    return flujos.some(flujo => 
      flujo.estadoSiguiente === 'DEVUELTO' && 
      flujo.rolPermitido.includes(userRole)
    );
  }

  private async asignarUsuarioPorEstado(estado: string): Promise<User | null> {
    const estadoConfig = this.ESTADOS_CONFIG.find(e => e.codigo === estado);
    if (!estadoConfig) return null;

    // Buscar usuario con ese rol (podrías tener lógica más compleja aquí)
    return await this.userRepository.findOne({
      where: { role: estadoConfig.rolesPermitidos[0] },
    });
  }

  private agregarAlHistorial(
    documento: Documento,
    user: User,
    estadoAnterior: string,
    estadoNuevo: string,
    observacion?: string
  ): void {
    const historial = documento.historialEstados || [];
    
    historial.push({
      fecha: new Date(),
      estado: estadoNuevo,
      usuarioId: user.id,
      usuarioNombre: user.fullName || user.username,
      rolUsuario: user.role,
      observacion: observacion || `Cambio de ${estadoAnterior} a ${estadoNuevo}`,
    });

    documento.historialEstados = historial;
  }

  private async guardarRegistroAcceso(
    documento: Documento,
    user: User,
    accion: string,
    detalles?: string
  ): Promise<void> {
    const registro = this.registroAccesoRepository.create({
      documentoId: documento.id,
      usuarioId: user.id,
      nombreUsuario: user.fullName || user.username,
      rolUsuario: user.role,
      accion,
      detalles,
      fechaAcceso: new Date(),
    });

    await this.registroAccesoRepository.save(registro);
  }

  private async verificarAccesoDocumento(documento: Documento, user: User): Promise<void> {
    const userRole = user.role as UserRole;
    
    if (userRole === UserRole.ADMIN) return;
    
    const puedeVer = 
      documento.usuarioAsignado?.id === user.id ||
      documento.radicador.id === user.id ||
      userRole === UserRole.SUPERVISOR; // Supervisor puede ver todo

    if (!puedeVer) {
      throw new ForbiddenException('No tienes acceso a este documento');
    }
  }

  private async calcularTiempoPromedio(): Promise<number> {
    const documentos = await this.documentoRepository.find({
      where: { estado: 'FINALIZADO' },
      select: ['fechaRadicacion', 'fechaActualizacion'],
    });

    if (documentos.length === 0) return 0;

    const totalHoras = documentos.reduce((total, doc) => {
      const inicio = new Date(doc.fechaRadicacion);
      const fin = new Date(doc.fechaActualizacion);
      const horas = (fin.getTime() - inicio.getTime()) / (1000 * 60 * 60);
      return total + horas;
    }, 0);

    return Math.round(totalHoras / documentos.length);
  }
}